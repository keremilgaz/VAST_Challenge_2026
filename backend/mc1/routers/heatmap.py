# ============================================================
# ============================================================

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

from ..db import get_driver
from ..domain import (
    normalize_message_types,
    normalize_text_sources,
    round_bucket_expression,
    combine_cell_texts,
    market_sentiment_to_value,
)
from ..queries import build_time_axis, fetch_all_rows, fetch_rows_for_semantic
from ..nlp import get_embedding, sentiment_score
from ..config import SENTIMENT_LABEL_TO_VALUE

router = APIRouter()


@router.get("/api/heatmap")
def heatmap(
    granularity: str = Query("daily", pattern="^(daily|hourly)$"),
    mode: str = Query("count", pattern="^(count|sentiment|semantic_change)$"),
    merger_only: bool = False,
    message_types: Optional[list[str]] = Query(default=None),
    message_type: str = "all",
    text_sources: Optional[list[str]] = Query(default=None),
    visibility: str = Query("all", pattern="^(all|internal|external)$"),
    start_time: str = "",
    end_time: str = "",
    keyword: str = "",
):
    selected_message_types = normalize_message_types(message_types, message_type)
    selected_text_sources = normalize_text_sources(text_sources)
    normalized_keyword = keyword.lower().strip()

    time_buckets = build_time_axis(granularity, start_time, end_time)

    rows = fetch_all_rows(
        granularity,
        merger_only,
        selected_message_types,
        selected_text_sources,
        visibility,
        start_time,
        end_time,
        normalized_keyword,
    )

    with get_driver().session() as session:
        all_agents = [
            {"agent_id": r["agent_id"], "agent_label": r["agent_label"]}
            for r in session.run(
                """
                MATCH (a:Agent)
                RETURN a.agent_id AS agent_id,
                       coalesce(a.agent_label, a.agent_id) AS agent_label
                ORDER BY agent_id
                """
            )
        ]

    grouped: Dict[tuple, List[Dict[str, Any]]] = {}
    for r in rows:
        key = (r["agent_id"], r["bucket"])
        grouped.setdefault(key, []).append(r)

    semantic_grouped: Dict[tuple, List[Dict[str, Any]]] = {}
    if mode == "semantic_change":
        for r in fetch_rows_for_semantic(granularity, start_time, end_time):
            key = (r["agent_id"], r["bucket"])
            semantic_grouped.setdefault(key, []).append(r)

    cell_embedding_cache: Dict[tuple, Optional[np.ndarray]] = {}

    def cell_embedding(agent_id: str, bucket: str) -> Optional[np.ndarray]:
        key = (agent_id, bucket)
        if key in cell_embedding_cache:
            return cell_embedding_cache[key]
        cell_rows = semantic_grouped.get(key, [])
        texts = combine_cell_texts(cell_rows, [])
        if not texts:
            cell_embedding_cache[key] = None
            return None
        joined = " ".join(texts)
        emb = get_embedding(joined)
        cell_embedding_cache[key] = emb
        return emb

    def cell_sentiment(agent_id: str, bucket: str) -> Optional[float]:
        cell_rows = grouped.get((agent_id, bucket), [])
        texts = combine_cell_texts(cell_rows, selected_text_sources)
        scores = [s for s in (sentiment_score(t) for t in texts) if s is not None]
        if not scores:
            return None
        return float(np.mean(scores))

    bucket_index = {b: i for i, b in enumerate(time_buckets)}

    cells = []
    max_count = 0

    for agent in all_agents:
        aid = agent["agent_id"]
        for bucket in time_buckets:
            cell_rows = grouped.get((aid, bucket), [])
            message_count = len(cell_rows)
            if message_count > max_count:
                max_count = message_count

            cell = {
                "agent_id": aid,
                "agent_label": agent["agent_label"],
                "bucket": bucket,
                "message_count": message_count,
                "bert_sentiment_score": None,
                "cosine_similarity_prev": None,
                "semantic_distance_prev": None,
                "cosine_similarity_next": None,
                "semantic_distance_next": None,
            }

            if mode == "sentiment" and message_count > 0:
                cell["bert_sentiment_score"] = cell_sentiment(aid, bucket)

            cells.append(cell)

    if mode == "semantic_change":
        cell_lookup = {(c["agent_id"], c["bucket"]): c for c in cells}
        for agent in all_agents:
            aid = agent["agent_id"]
            for i, bucket in enumerate(time_buckets):
                c = cell_lookup[(aid, bucket)]
                cur = cell_embedding(aid, bucket)

                if i > 0 and cur is not None:
                    prev_emb = cell_embedding(aid, time_buckets[i - 1])
                    if prev_emb is not None:
                        sim = float(cosine_similarity([cur], [prev_emb])[0][0])
                        c["cosine_similarity_prev"] = sim
                        c["semantic_distance_prev"] = 1.0 - sim

                if i < len(time_buckets) - 1 and cur is not None:
                    next_emb = cell_embedding(aid, time_buckets[i + 1])
                    if next_emb is not None:
                        sim = float(cosine_similarity([cur], [next_emb])[0][0])
                        c["cosine_similarity_next"] = sim
                        c["semantic_distance_next"] = 1.0 - sim

    return {
        "granularity": granularity,
        "mode": mode,
        "agents": all_agents,
        "buckets": time_buckets,
        "time_buckets": time_buckets,
        "cells": cells,
        "max_count": max_count,
        "filters": {
            "message_types": selected_message_types,
            "text_sources": selected_text_sources,
            "visibility": visibility,
            "start_time": start_time,
            "end_time": end_time,
            "merger_only": merger_only,
            "keyword": normalized_keyword,
        },
    }


@router.get("/api/line-chart")
def line_chart(
    granularity: str = Query("daily", pattern="^(daily|hourly)$"),
    merger_only: bool = False,
    message_types: Optional[list[str]] = Query(default=None),
    message_type: str = "all",
    text_sources: Optional[list[str]] = Query(default=None),
    visibility: str = Query("all", pattern="^(all|internal|external)$"),
    start_time: str = "",
    end_time: str = "",
    keyword: str = "",
):
    time_buckets = build_time_axis(granularity, start_time, end_time)

    expr = round_bucket_expression(granularity)
    market_query = f"""
    MATCH (r:Round)
    WHERE ($start_time = '' OR r.hour >= $start_time)
      AND ($end_time = '' OR r.hour <= $end_time)
    WITH {expr} AS bucket, r
    ORDER BY r.hour
    WITH bucket,
         collect(r.stock_price_value) AS prices,
         collect(r.market_sentiment) AS sentiments
    RETURN bucket,
           [p IN prices WHERE p IS NOT NULL][-1] AS stock_price,
           [s IN sentiments WHERE s IS NOT NULL AND s <> ''][-1] AS sentiment_label
    """
    price_map: Dict[str, Optional[float]] = {}
    sentiment_label_map: Dict[str, Optional[str]] = {}
    with get_driver().session() as session:
        for rec in session.run(market_query, start_time=start_time, end_time=end_time):
            price_map[rec["bucket"]] = rec["stock_price"]
            sentiment_label_map[rec["bucket"]] = rec["sentiment_label"]

    def pct_change(cur: Optional[float], prev: Optional[float]) -> Optional[float]:
        if cur is None or prev is None or prev == 0:
            return None
        return round((cur - prev) / abs(prev) * 100.0, 2)

    series = []
    prev_price: Optional[float] = None
    for bucket in time_buckets:
        price = price_map.get(bucket)
        label = sentiment_label_map.get(bucket)
        sent_val = market_sentiment_to_value(label)
        series.append({
            "time_bucket": bucket,
            "stock_price": price,
            "stock_price_change_pct": pct_change(price, prev_price),
            "market_sentiment_label": label or None,
            "market_sentiment_value": sent_val,
        })
        if price is not None:
            prev_price = price

    return {
        "time_buckets": time_buckets,
        "series": series,
        "sentiment_scale": SENTIMENT_LABEL_TO_VALUE,
    }

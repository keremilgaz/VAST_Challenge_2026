# ============================================================
# Network / Edge messages / Ajay timeline エンドポイント
# ============================================================

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query
import numpy as np

from ..db import get_driver
from ..domain import (
    normalize_message_types,
    normalize_text_sources,
    common_where_clause,
    keyword_score_expression,
    combine_cell_texts,
    extract_ajay_quotes,
)
from ..queries import fetch_all_rows, fetch_messages_for_edge
from ..nlp import sentiment_score

router = APIRouter()


@router.get("/api/network")
def network(
    granularity: str = Query("daily", pattern="^(daily|hourly)$"),
    merger_only: bool = False,
    message_types: Optional[list[str]] = Query(default=None),
    message_type: str = "all",
    text_sources: Optional[list[str]] = Query(default=None),
    visibility: str = Query("all", pattern="^(all|internal|external)$"),
    start_time: str = "",
    end_time: str = "",
    keyword: str = "",
    include_ajay: bool = False,
):
    """
    agent間のcommunication network (reply graph) を返すAPI。

    重要:
    - Network にも Heatmap と同じ filter (merger_only / keyword / text_sources / visibility /
      message_types / time range) を反映する。
    - edge は responding_to に基づく reply graph（CrisisNet と同じ考え方）。
      返信した message の sender → 返信先 message の sender。
    - node の message_count / sentiment / merger 数も、現在の filter を反映する。
    """
    selected_message_types = normalize_message_types(message_types, message_type)
    selected_text_sources = normalize_text_sources(text_sources)
    normalized_keyword = keyword.lower().strip()

    # ノード（filter後のmessageを送ったagentベースで集計）
    node_query = f"""
    MATCH (a:Agent)-[:SENT]->(m:Message)
    WHERE true
      {common_where_clause()}
    WITH a,
         count(m) AS message_count,
         sum(CASE WHEN coalesce(m.is_merger_related, false)
                   OR coalesce(m.internal_merger_related, false) THEN 1 ELSE 0 END) AS merger_related_count
    RETURN a.agent_id AS id,
           coalesce(a.agent_label, a.agent_id) AS label,
           message_count AS message_count,
           merger_related_count AS merger_related_count
    ORDER BY id
    """

    # エッジ（reply graph: m(filter後) -REPLIES_TO-> target、両方の sender を結ぶ）
    # CrisisNet と同様、返信した message の channel ごとに edge を分割する
    # （channel 別の色付き parallel edge を frontend で描けるようにする）。
    edge_query = f"""
    MATCH (sender:Agent)-[:SENT]->(m:Message)-[:REPLIES_TO]->(target:Message)<-[:SENT]-(targetAgent:Agent)
    WHERE sender.agent_id <> targetAgent.agent_id
      {common_where_clause()}
    WITH sender.agent_id AS source, targetAgent.agent_id AS target,
         coalesce(m.channel, 'unknown') AS channel,
         count(m) AS message_count,
         sum(CASE WHEN coalesce(m.is_merger_related, false)
                   OR coalesce(m.internal_merger_related, false) THEN 1 ELSE 0 END) AS merger_related_count
    RETURN source, target, channel, message_count AS weight,
           message_count AS message_count, merger_related_count AS merger_related_count
    ORDER BY weight DESC
    """

    params = dict(
        merger_only=merger_only,
        message_types=selected_message_types,
        text_sources=selected_text_sources,
        visibility=visibility,
        start_time=start_time,
        end_time=end_time,
        keyword=normalized_keyword,
    )

    # ── 推論ノード "Ajay" ──
    # Ajay はデータ上の agent ではなく、message 本文/内部思考で言及されるだけの人物。
    # include_ajay=true のとき、各 agent の message のうち 'ajay' に言及したものを数え、
    # agent -> ajay の inferred edge として返す（recipient 記録は存在しないため mention ベース）。
    ajay_query = f"""
    MATCH (a:Agent)-[:SENT]->(m:Message)
    WHERE true
      {common_where_clause()}
      AND (toLower(coalesce(m.content, '')) CONTAINS 'ajay'
           OR toLower(coalesce(m.internal_reacting, '')) CONTAINS 'ajay'
           OR toLower(coalesce(m.internal_rationalizing, '')) CONTAINS 'ajay'
           OR toLower(coalesce(m.internal_deliberating, '')) CONTAINS 'ajay')
    WITH a.agent_id AS source,
         count(m) AS weight,
         sum(CASE WHEN coalesce(m.is_merger_related, false)
                   OR coalesce(m.internal_merger_related, false) THEN 1 ELSE 0 END) AS merger_related_count
    RETURN source, weight, merger_related_count
    ORDER BY weight DESC
    """

    with get_driver().session() as session:
        nodes = [dict(r) for r in session.run(node_query, **params)]
        edges = [dict(r) for r in session.run(edge_query, **params)]
        ajay_rows = [dict(r) for r in session.run(ajay_query, **params)] if include_ajay else []

    if include_ajay and ajay_rows:
        total_mentions = sum(r["weight"] for r in ajay_rows)
        total_merger = sum(r["merger_related_count"] for r in ajay_rows)
        # inferred ノード（frontend で「データに無く後付け」と分かる印を付ける）
        nodes.append({
            "id": "ajay",
            "label": "Ajay",
            "message_count": total_mentions,
            "merger_related_count": total_merger,
            "bert_sentiment_score": None,
            "inferred": True,
        })
        for r in ajay_rows:
            edges.append({
                "source": r["source"],
                "target": "ajay",
                "channel": "inferred",
                "weight": r["weight"],
                "message_count": r["weight"],
                "merger_related_count": r["merger_related_count"],
                "inferred": True,
            })

    # cellのsentiment同様、node単位のsentimentもBERTで計算する
    # node別にfilter後のtextを集めてsentimentを計算
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
    agent_rows: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        agent_rows.setdefault(r["agent_id"], []).append(r)

    sentiment_by_agent: Dict[str, Optional[float]] = {}
    for aid, arows in agent_rows.items():
        texts = combine_cell_texts(arows, selected_text_sources)
        scores = [s for s in (sentiment_score(t) for t in texts) if s is not None]
        sentiment_by_agent[aid] = float(np.mean(scores)) if scores else None

    for n in nodes:
        n["bert_sentiment_score"] = sentiment_by_agent.get(n["id"])

    return {
        "nodes": nodes,
        "edges": edges,
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


@router.get("/api/edge-messages")
def edge_messages(
    source: str,
    target: str,
    channel: str = "",
    merger_only: bool = False,
    message_types: Optional[list[str]] = Query(default=None),
    message_type: str = "all",
    text_sources: Optional[list[str]] = Query(default=None),
    visibility: str = Query("all", pattern="^(all|internal|external)$"),
    start_time: str = "",
    end_time: str = "",
    keyword: str = "",
):
    """
    Network graph の1本のedgeをクリックしたときに、そのedgeの裏にある実際の
    messageをHeatmapのMessage Detail Panelと同じ形で返すAPI。filterは
    /api/network と同じセットを受け付ける（同じ networkQuery をそのまま使える）。
    """
    return fetch_messages_for_edge(
        source_agent_id=source,
        target_agent_id=target,
        channel=channel,
        merger_only=merger_only,
        message_types=message_types,
        message_type=message_type,
        text_sources=text_sources,
        visibility=visibility,
        start_time=start_time,
        end_time=end_time,
        keyword=keyword,
    )


@router.get("/api/ajay-timeline")
def ajay_timeline(
    merger_only: bool = False,
    message_types: Optional[list[str]] = Query(default=None),
    message_type: str = "all",
    text_sources: Optional[list[str]] = Query(default=None),
    visibility: str = Query("all", pattern="^(all|internal|external)$"),
    start_time: str = "",
    end_time: str = "",
    keyword: str = "",
):
    """
    "Ajay's hints timeline" パネル用API。/api/network の ajay_query と同じ
    マッチ条件（content / inner thoughtに'ajay'を含む）でmessageを集め、
    集計せず時系列のmessage一覧として返す。各messageには heuristic に抽出した
    引用フレーズ（ajay_quotes）を添えて、CEOが何をほのめかしていったかを
    素早く拾い読みできるようにする。
    """
    selected_message_types = normalize_message_types(message_types, message_type)
    selected_text_sources = normalize_text_sources(text_sources)
    normalized_keyword = keyword.lower().strip()

    query = f"""
    MATCH (a:Agent)-[:SENT]->(m:Message)-[:IN_ROUND]->(r:Round)
    WHERE (toLower(coalesce(m.content, '')) CONTAINS 'ajay'
           OR toLower(coalesce(m.internal_reacting, '')) CONTAINS 'ajay'
           OR toLower(coalesce(m.internal_rationalizing, '')) CONTAINS 'ajay'
           OR toLower(coalesce(m.internal_deliberating, '')) CONTAINS 'ajay')
      {common_where_clause()}
    WITH a, m, r, {keyword_score_expression()} AS keyword_score
    RETURN m.message_id AS message_id,
           m.comm_id AS comm_id,
           m.timestamp_raw AS timestamp,
           m.agent_id AS agent_id,
           m.agent_role AS agent_role,
           m.agent_label AS agent_label,
           m.channel AS channel,
           m.message_type AS message_type,
           m.visibility AS visibility,
           m.recipients AS recipients,
           m.responding_to AS responding_to,
           m.is_merger_related AS is_merger_related,
           coalesce(m.internal_merger_related, false) AS internal_merger_related,
           coalesce(m.internal_reacting_merger_related, false) AS internal_reacting_merger_related,
           coalesce(m.internal_rationalizing_merger_related, false) AS internal_rationalizing_merger_related,
           coalesce(m.internal_deliberating_merger_related, false) AS internal_deliberating_merger_related,
           m.content AS content,
           m.internal_reacting AS internal_reacting,
           m.internal_rationalizing AS internal_rationalizing,
           m.internal_deliberating AS internal_deliberating,
           r.hour AS round_hour,
           r.event_headline AS event_headline,
           keyword_score AS keyword_score
    ORDER BY timestamp
    """
    params = dict(
        merger_only=merger_only,
        message_types=selected_message_types,
        text_sources=selected_text_sources,
        visibility=visibility,
        start_time=start_time,
        end_time=end_time,
        keyword=normalized_keyword,
    )

    with get_driver().session() as session:
        rows = [dict(r) for r in session.run(query, **params)]

    for row in rows:
        row["ajay_quotes"] = extract_ajay_quotes(
            row.get("content"),
            row.get("internal_reacting"),
            row.get("internal_rationalizing"),
            row.get("internal_deliberating"),
        )
    return rows

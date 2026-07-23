
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query
import numpy as np

from ..db import get_driver
from ..config import RECIPIENT_ROLE_TO_AGENT, AGENT_VOCATIVE_PATTERNS
from ..domain import (
    normalize_message_types,
    normalize_text_sources,
    common_where_clause,
    keyword_score_expression,
    combine_cell_texts,
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
):
    selected_message_types = normalize_message_types(message_types, message_type)
    selected_text_sources = normalize_text_sources(text_sources)
    normalized_keyword = keyword.lower().strip()

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

    edge_query = f"""
    MATCH (sender:Agent)-[:SENT]->(m:Message)-[:REPLIES_TO]->(target:Message)<-[:SENT]-(targetAgent:Agent)
    WHERE sender.agent_id <> targetAgent.agent_id
      {common_where_clause()}
    WITH sender.agent_id AS source, targetAgent.agent_id AS target,
         coalesce(m.channel, 'unknown') AS channel,
         coalesce(m.message_type, '') AS message_type,
         count(m) AS message_count,
         sum(CASE WHEN coalesce(m.is_merger_related, false)
                   OR coalesce(m.internal_merger_related, false) THEN 1 ELSE 0 END) AS merger_related_count
    RETURN source, target, channel, message_type, message_count AS weight,
           message_count AS message_count, merger_related_count AS merger_related_count
    ORDER BY weight DESC
    """

    # ── "Gelen mesaj" sayımı (unresponsive/silent agent tespiti için) ──
    # node_query yalnızca mesaj GÖNDEREN agent'ları döndürür. Bir agent belirli
    # bir zaman aralığında hiç mesaj göndermezse node tamamen kaybolur — ona
    # mesaj gelmeye devam etse bile (heatmap'te görünen "PT susuyor" durumu).
    # Bu query her agent için, mevcut filtre penceresinde BAŞKA agent'lardan
    # kendisine gelen mesajları sayar:
    #   1. recipients listesinde agent'ın role token'ı geçen mesajlar
    #      (recipients JSON string olarak saklanır, ör. '["platform_trust"]')
    #   2. agent'ın bir mesajına REPLIES_TO ile bağlanan mesajlar
    #   3. content'in başında agent'a isimle hitap eden mesajlar
    #      (ör. "Judge — SaltWind published..." / "@pr-intern: stand by").
    #      recipients=ALL + responding_to başka bir mesaj olsa bile bu bir
    #      hitaptır; Judge'ın 6/5 17:00'te "susması" ancak böyle görünür.
    # Böylece "0 gönderdi ama N aldı" olan agent'lar network'ten düşmez;
    # frontend bunları 'silent/unresponsive' olarak işaretleyebilir.
    agent_role_tokens = {agent: role for role, agent in RECIPIENT_ROLE_TO_AGENT.items()}
    received_query = f"""
    MATCH (a:Agent)
    OPTIONAL MATCH (sender:Agent)-[:SENT]->(m:Message)
    WHERE sender.agent_id <> a.agent_id
      AND (
        m.recipients CONTAINS ('"' + coalesce($agent_role_tokens[a.agent_id], '__none__') + '"')
        OR (m)-[:REPLIES_TO]->(:Message {{agent_id: a.agent_id}})
        OR coalesce(m.content, '') =~ coalesce($vocative_patterns[a.agent_id], 'a^')
      )
      {common_where_clause()}
    RETURN a.agent_id AS id,
           coalesce(a.agent_label, a.agent_id) AS label,
           count(DISTINCT m) AS received_count
    ORDER BY id
    """

    # mention edge de mesajın gerçek channel'ına göre bölünür (via_channel):
    # frontend kesikli çizgiyi via_channel'ın rengiyle boyar.
    mention_query = f"""
    MATCH (sender:Agent)-[:SENT]->(m:Message)
    MATCH (t:Agent)
    WHERE sender.agent_id <> t.agent_id
      AND coalesce(m.content, '') =~ coalesce($vocative_patterns[t.agent_id], 'a^')
      AND NOT (m)-[:REPLIES_TO]->(:Message {{agent_id: t.agent_id}})
      {common_where_clause()}
    WITH sender.agent_id AS source, t.agent_id AS target,
         coalesce(m.channel, 'unknown') AS via_channel,
         count(m) AS message_count,
         sum(CASE WHEN coalesce(m.is_merger_related, false)
                   OR coalesce(m.internal_merger_related, false) THEN 1 ELSE 0 END) AS merger_related_count
    RETURN source, target, 'mention' AS channel, via_channel, message_count AS weight,
           message_count AS message_count, merger_related_count AS merger_related_count
    ORDER BY weight DESC
    """

    #   `NOT (m)-[:REPLIES_TO]->(:Message {agent_id: t.agent_id})`
    #   unanswered_mention_count = mention_count - answered_mention_count
    mention_status_query = f"""
    MATCH (sender:Agent)-[:SENT]->(m:Message)
    MATCH (t:Agent)
    WHERE sender.agent_id <> t.agent_id
      AND coalesce(m.content, '') =~ coalesce($vocative_patterns[t.agent_id], 'a^')
      {common_where_clause()}
    OPTIONAL MATCH (t)-[:SENT]->(reply:Message)
      WHERE reply.timestamp_raw > m.timestamp_raw
        AND ($end_time = '' OR reply.timestamp_raw <= $end_time)
    WITH t, m AS mention_message, count(reply) AS reply_count
    OPTIONAL MATCH (sender2:Agent)-[:SENT]->(m:Message)
      WHERE reply_count = 0
        AND sender2.agent_id <> t.agent_id
        AND coalesce(m.content, '') =~ coalesce($vocative_patterns[t.agent_id], 'a^')
        AND m.timestamp_raw > mention_message.timestamp_raw
        AND ($end_time = '' OR m.timestamp_raw <= $end_time)
        {common_where_clause()}
    WITH t.agent_id AS id,
         coalesce(t.agent_label, t.agent_id) AS label,
         mention_message,
         reply_count,
         count(m) AS later_unanswered_mention_count
    WITH id, label,
         count(DISTINCT mention_message) AS mention_count,
         count(DISTINCT CASE WHEN reply_count > 0 OR later_unanswered_mention_count = 0
                             THEN mention_message END) AS answered_mention_count
    RETURN id, label,
           mention_count AS mention_count,
           answered_mention_count AS answered_mention_count,
           mention_count - answered_mention_count AS unanswered_mention_count
    ORDER BY id
    """

    params = dict(
        merger_only=merger_only,
        message_types=selected_message_types,
        text_sources=selected_text_sources,
        visibility=visibility,
        start_time=start_time,
        end_time=end_time,
        keyword=normalized_keyword,
        agent_role_tokens=agent_role_tokens,
        vocative_patterns=AGENT_VOCATIVE_PATTERNS,
    )

    with get_driver().session() as session:
        nodes = [dict(r) for r in session.run(node_query, **params)]
        edges = [dict(r) for r in session.run(edge_query, **params)]
        received_rows = [dict(r) for r in session.run(received_query, **params)]
        mention_rows = [dict(r) for r in session.run(mention_query, **params)]
        mention_status_rows = [dict(r) for r in session.run(mention_status_query, **params)]

    for r in mention_rows:
        r["mention"] = True
        edges.append(r)

    # received_count'u node'lara işle; hiç mesaj göndermemiş ama mesaj almış
    # agent'ları da (message_count=0) node olarak ekle ki network'ten kaybolmasınlar.
    received_by_id = {r["id"]: r for r in received_rows}
    node_ids = {n["id"] for n in nodes}
    for n in nodes:
        n["received_count"] = received_by_id.get(n["id"], {}).get("received_count", 0)
    for r in received_rows:
        if r["received_count"] > 0 and r["id"] not in node_ids:
            nodes.append({
                "id": r["id"],
                "label": r["label"],
                "message_count": 0,
                "merger_related_count": 0,
                "received_count": r["received_count"],
            })

    mention_status_by_id = {r["id"]: r for r in mention_status_rows}
    node_ids = {n["id"] for n in nodes}
    for n in nodes:
        ms = mention_status_by_id.get(n["id"], {})
        n["mention_count"] = ms.get("mention_count", 0) or 0
        n["answered_mention_count"] = ms.get("answered_mention_count", 0) or 0
        n["unanswered_mention_count"] = ms.get("unanswered_mention_count", 0) or 0
    for r in mention_status_rows:
        if r["id"] not in node_ids and (r.get("unanswered_mention_count", 0) or 0) > 0:
            nodes.append({
                "id": r["id"],
                "label": r["label"],
                "message_count": 0,
                "merger_related_count": 0,
                "received_count": received_by_id.get(r["id"], {}).get("received_count", 0),
                "mention_count": r.get("mention_count", 0) or 0,
                "answered_mention_count": r.get("answered_mention_count", 0) or 0,
                "unanswered_mention_count": r.get("unanswered_mention_count", 0) or 0,
            })
            node_ids.add(r["id"])

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
    edge_message_type: str = "",
    via_channel: str = "",
    merger_only: bool = False,
    message_types: Optional[list[str]] = Query(default=None),
    message_type: str = "all",
    text_sources: Optional[list[str]] = Query(default=None),
    visibility: str = Query("all", pattern="^(all|internal|external)$"),
    start_time: str = "",
    end_time: str = "",
    keyword: str = "",
):
    return fetch_messages_for_edge(
        source_agent_id=source,
        target_agent_id=target,
        channel=channel,
        edge_message_type=edge_message_type,
        via_channel=via_channel,
        merger_only=merger_only,
        message_types=message_types,
        message_type=message_type,
        text_sources=text_sources,
        visibility=visibility,
        start_time=start_time,
        end_time=end_time,
        keyword=keyword,
    )

@router.get("/api/node-messages")
def node_messages(
    agent_id: str,
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
    Network'te bir node'a tıklanınca, o agent'ın mevcut network filtresiyle
    gönderdiği TÜM mesajları döner — reply graph'ta edge'e dönüşmeyen
    broadcast / root mesajlar dahil (bunlar edge-messages'tan erişilemiyordu).
    reply_kind / resolved_parent_id alanları sayesinde frontend non-reply
    mesajları ayrıca işaretleyebilir. Filtre seti /api/network ile aynıdır,
    böylece networkQuery olduğu gibi kullanılabilir.
    """
    selected_message_types = normalize_message_types(message_types, message_type)
    selected_text_sources = normalize_text_sources(text_sources)
    normalized_keyword = keyword.lower().strip()

    query = f"""
    MATCH (a:Agent)-[:SENT]->(m:Message)-[:IN_ROUND]->(r:Round)
    WHERE a.agent_id = $agent_id
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
           coalesce(m.resolved_parent_id, '') AS resolved_parent_id,
           coalesce(m.reply_kind, '') AS reply_kind,
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
        agent_id=agent_id,
        merger_only=merger_only,
        message_types=selected_message_types,
        text_sources=selected_text_sources,
        visibility=visibility,
        start_time=start_time,
        end_time=end_time,
        keyword=normalized_keyword,
    )
    with get_driver().session() as session:
        return [dict(r) for r in session.run(query, **params)]

# ============================================================
# Neo4j 読み取りクエリ (read helpers)
# ============================================================
# 旧 main.py の cell/semantic/all-rows/edge/context 用の Neo4j 読み取り関数を
# そのまま移動したモジュール。Cypher は一切変更していない。

from typing import Any, Dict, List, Optional

from .db import get_driver
from .config import AGENT_VOCATIVE_PATTERNS
from .domain import (
    normalize_message_types,
    normalize_text_sources,
    bucket_expression,
    round_bucket_expression,
    common_where_clause,
    keyword_score_expression,
)


def fetch_messages_for_cell(
    agent_id: str,
    bucket: str,
    granularity: str,
    merger_only: bool = False,
    message_types: Optional[list[str]] = None,
    message_type: str = "all",
    text_sources: Optional[list[str]] = None,
    visibility: str = "all",
    start_time: str = "",
    end_time: str = "",
    keyword: str = "",
):
    # keywordと、messagesで同じソートlogicを使うために共通の関数を使う。
    selected_message_types = normalize_message_types(message_types, message_type)
    selected_text_sources = normalize_text_sources(text_sources)
    normalized_keyword = keyword.lower().strip()
    bucket_expr = bucket_expression(granularity)

    query = f"""
    MATCH (a:Agent)-[:SENT]->(m:Message)-[:IN_ROUND]->(r:Round)
    WHERE ($agent_id = 'ALL' OR a.agent_id = $agent_id)
      {common_where_clause()}
    WITH a, m, r, {bucket_expr} AS computed_bucket
    WHERE computed_bucket = $bucket
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
    ORDER BY keyword_score DESC, timestamp
    """

    with get_driver().session() as session:
        return [
            dict(r)
            for r in session.run(
                query,
                agent_id=agent_id,
                bucket=bucket,
                merger_only=merger_only,
                message_types=selected_message_types,
                text_sources=selected_text_sources,
                visibility=visibility,
                start_time=start_time,
                end_time=end_time,
                keyword=normalized_keyword,
            )
        ]


def fetch_rows_for_semantic(
    granularity: str,
    start_time: str,
    end_time: str,
) -> List[Dict[str, Any]]:
    """
    Semantic change (cosine similarity) 専用の row 取得。

    重要 (analysis correctness):
    - semantic change は「full message text」から計算する必要があるため、
      keyword / message_type / text_source / merger_only / visibility といった
      filter は一切適用しない。time range だけは反映する。
    - これにより keyword sort / message type sort / agent sort / row order は
      semantic change の値に影響しなくなる（time range のみ計算に影響する）。
    - 並びは timestamp, message_id で固定し、join順による埋め込みのブレも防ぐ。
    """
    bucket_expr = bucket_expression(granularity)
    query = f"""
    MATCH (a:Agent)-[:SENT]->(m:Message)-[:IN_ROUND]->(r:Round)
    WHERE ($start_time = '' OR m.timestamp_raw >= $start_time)
      AND ($end_time = '' OR m.timestamp_raw <= $end_time)
    WITH a, m, {bucket_expr} AS bucket
    RETURN a.agent_id AS agent_id,
           bucket AS bucket,
           m.content AS content,
           m.internal_reacting AS internal_reacting,
           m.internal_rationalizing AS internal_rationalizing,
           m.internal_deliberating AS internal_deliberating
    ORDER BY bucket, agent_id, m.timestamp, m.message_id
    """
    with get_driver().session() as session:
        return [
            dict(r)
            for r in session.run(
                query,
                start_time=start_time,
                end_time=end_time,
            )
        ]


def build_time_axis(
    granularity: str,
    start_time: str,
    end_time: str,
) -> List[str]:
    """
    HeatmapとLine Chartで共通して使う「固定time axis」を作る。
    Round.hour から全time bucketを作るので、messageが無い時間帯のbucketも残る。
    これにより、filterやkeyword searchをかけてもtime axis自体は維持される。
    """
    expr = round_bucket_expression(granularity)
    query = f"""
    MATCH (r:Round)
    WHERE ($start_time = '' OR r.hour >= $start_time)
      AND ($end_time = '' OR r.hour <= $end_time)
    WITH DISTINCT {expr} AS bucket
    RETURN bucket
    ORDER BY bucket
    """
    with get_driver().session() as session:
        return [
            r["bucket"]
            for r in session.run(query, start_time=start_time, end_time=end_time)
        ]


def fetch_all_rows(
    granularity: str,
    merger_only: bool,
    selected_message_types: List[str],
    selected_text_sources: List[str],
    visibility: str,
    start_time: str,
    end_time: str,
    normalized_keyword: str,
) -> List[Dict[str, Any]]:
    """
    現在のfilter条件に一致する全messageを、bucket付きで一括取得する。
    sentiment / semantic change を計算するために、cell単位でグルーピングして使う。
    """
    bucket_expr = bucket_expression(granularity)
    query = f"""
    MATCH (a:Agent)-[:SENT]->(m:Message)-[:IN_ROUND]->(r:Round)
    WHERE true
      {common_where_clause()}
    WITH a, m, {bucket_expr} AS bucket, {keyword_score_expression()} AS keyword_score
    RETURN a.agent_id AS agent_id,
           coalesce(a.agent_label, a.agent_id) AS agent_label,
           bucket AS bucket,
           m.content AS content,
           m.internal_reacting AS internal_reacting,
           m.internal_rationalizing AS internal_rationalizing,
           m.internal_deliberating AS internal_deliberating,
           keyword_score AS keyword_score
    ORDER BY bucket, agent_id
    """
    with get_driver().session() as session:
        return [
            dict(r)
            for r in session.run(
                query,
                merger_only=merger_only,
                message_types=selected_message_types,
                text_sources=selected_text_sources,
                visibility=visibility,
                start_time=start_time,
                end_time=end_time,
                keyword=normalized_keyword,
            )
        ]


def fetch_messages_for_edge(
    source_agent_id: str,
    target_agent_id: str,
    channel: str = "",
    merger_only: bool = False,
    message_types: Optional[list[str]] = None,
    message_type: str = "all",
    text_sources: Optional[list[str]] = None,
    visibility: str = "all",
    start_time: str = "",
    end_time: str = "",
    keyword: str = "",
):
    """
    Network の1本のedge（source agent -> target agent、channel別）の裏にある
    実際のmessageを返す。/api/network の edge_query / mention_query と同じ
    マッチ条件を使い、集計せずmessageそのものを返す点だけが違う。

    channel == 'mention' の場合は reply graph ではなく、content 冒頭の
    名前呼びかけ（"Judge — ..." など）による mention edge として扱う。
    """
    selected_message_types = normalize_message_types(message_types, message_type)
    selected_text_sources = normalize_text_sources(text_sources)
    normalized_keyword = keyword.lower().strip()

    params = dict(
        source_agent_id=source_agent_id,
        target_agent_id=target_agent_id,
        channel=channel or "",
        merger_only=merger_only,
        message_types=selected_message_types,
        text_sources=selected_text_sources,
        visibility=visibility,
        start_time=start_time,
        end_time=end_time,
        keyword=normalized_keyword,
    )

    if channel == "mention":
        # 名前呼びかけ (vocative) mention edge: source agent の message のうち、
        # content 冒頭で target agent に名前で呼びかけているもの
        # （/api/network の mention_query と同じ条件）。
        params["vocative_pattern"] = AGENT_VOCATIVE_PATTERNS.get(target_agent_id, "a^")
        query = f"""
        MATCH (a:Agent)-[:SENT]->(m:Message)-[:IN_ROUND]->(r:Round)
        WHERE a.agent_id = $source_agent_id
          AND coalesce(m.content, '') =~ $vocative_pattern
          AND NOT (m)-[:REPLIES_TO]->(:Message {{agent_id: $target_agent_id}})
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
    else:
        # 通常のreply edge: sender(source) が target agent の message に返信したもの。
        query = f"""
        MATCH (sender:Agent)-[:SENT]->(m:Message)-[:REPLIES_TO]->(target:Message)<-[:SENT]-(targetAgent:Agent)
        MATCH (m)-[:IN_ROUND]->(r:Round)
        WHERE sender.agent_id = $source_agent_id
          AND targetAgent.agent_id = $target_agent_id
          AND ($channel = '' OR coalesce(m.channel, 'unknown') = $channel)
          {common_where_clause()}
        WITH m, r, {keyword_score_expression()} AS keyword_score
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

    with get_driver().session() as session:
        return [dict(r) for r in session.run(query, **params)]


def fetch_all_messages_for_context() -> List[Dict[str, Any]]:
    """context構築に必要な全messageを Neo4j から取得（912件程度なので全件でOK）。"""
    query = """
    MATCH (m:Message)-[:IN_ROUND]->(r:Round)
    RETURN m.message_id AS message_id,
           m.comm_id AS comm_id,
           m.timestamp_raw AS timestamp,
           m.agent_id AS agent_id,
           m.agent_role AS agent_role,
           m.agent_label AS agent_label,
           m.channel AS channel,
           m.message_type AS message_type,
           m.visibility AS visibility,
           m.responding_to AS responding_to,
           m.recipients AS recipients,
           m.content AS content,
           m.internal_reacting AS internal_reacting,
           m.internal_rationalizing AS internal_rationalizing,
           m.internal_deliberating AS internal_deliberating,
           r.hour AS round_hour
    ORDER BY m.timestamp, m.message_id
    """
    with get_driver().session() as session:
        return [dict(rec) for rec in session.run(query)]

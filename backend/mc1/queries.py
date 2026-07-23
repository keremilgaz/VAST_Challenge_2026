
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
    edge_message_type: str = "",
    via_channel: str = "",
    merger_only: bool = False,
    message_types: Optional[list[str]] = None,
    message_type: str = "all",
    text_sources: Optional[list[str]] = None,
    visibility: str = "all",
    start_time: str = "",
    end_time: str = "",
    keyword: str = "",
):
    selected_message_types = normalize_message_types(message_types, message_type)
    selected_text_sources = normalize_text_sources(text_sources)
    normalized_keyword = keyword.lower().strip()

    params = dict(
        source_agent_id=source_agent_id,
        target_agent_id=target_agent_id,
        channel=channel or "",
        edge_message_type=edge_message_type or "",
        via_channel=via_channel or "",
        merger_only=merger_only,
        message_types=selected_message_types,
        text_sources=selected_text_sources,
        visibility=visibility,
        start_time=start_time,
        end_time=end_time,
        keyword=normalized_keyword,
    )

    if channel == "mention":
        params["vocative_pattern"] = AGENT_VOCATIVE_PATTERNS.get(target_agent_id, "a^")
        query = f"""
        MATCH (a:Agent)-[:SENT]->(m:Message)-[:IN_ROUND]->(r:Round)
        WHERE a.agent_id = $source_agent_id
          AND coalesce(m.content, '') =~ $vocative_pattern
          AND NOT (m)-[:REPLIES_TO]->(:Message {{agent_id: $target_agent_id}})
          AND ($via_channel = '' OR coalesce(m.channel, 'unknown') = $via_channel)
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
        query = f"""
        MATCH (sender:Agent)-[:SENT]->(m:Message)-[:REPLIES_TO]->(target:Message)<-[:SENT]-(targetAgent:Agent)
        MATCH (m)-[:IN_ROUND]->(r:Round)
        WHERE sender.agent_id = $source_agent_id
          AND targetAgent.agent_id = $target_agent_id
          AND ($channel = '' OR coalesce(m.channel, 'unknown') = $channel)
          AND ($edge_message_type = '' OR coalesce(m.message_type, '') = $edge_message_type)
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

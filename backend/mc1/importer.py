# ============================================================
# ============================================================

import json
from typing import Any, Dict, List

from .db import get_driver, wait_for_neo4j
from .domain import (
    load_json,
    parse_stock_price,
    is_merger_related,
    flatten_internal_state,
    infer_visibility,
    resolve_parent_links,
)


def reset_and_import() -> Dict[str, int]:
    wait_for_neo4j()

    data = load_json()
    rounds = data.get("rounds", [])

    message_count = 0
    agent_ids = set()
    collected_msgs: List[Dict[str, Any]] = []

    # === NEO4J GENERATION START ===

    with get_driver().session() as session:
        session.run("MATCH (n) DETACH DELETE n")

        session.run(
            "CREATE CONSTRAINT agent_id_unique IF NOT EXISTS "
            "FOR (a:Agent) REQUIRE a.agent_id IS UNIQUE"
        )
        session.run(
            "CREATE CONSTRAINT message_id_unique IF NOT EXISTS "
            "FOR (m:Message) REQUIRE m.message_id IS UNIQUE"
        )
        session.run(
            "CREATE CONSTRAINT round_hour_unique IF NOT EXISTS "
            "FOR (r:Round) REQUIRE r.hour IS UNIQUE"
        )

        for round_obj in rounds:
            hour = round_obj.get("hour")

            ctx = round_obj.get("environment_context") or {}
            market = ctx.get("market_snapshot") or {}

            headline = ctx.get("event_headline") or ""
            narrative = ctx.get("event_narrative") or ""

            news_text = json.dumps(ctx.get("news") or [], ensure_ascii=False)
            external_actions = json.dumps(
                ctx.get("external_actor_actions") or [],
                ensure_ascii=False
            )

            stock_price_value = parse_stock_price(market.get("stock_price"))

            session.run(
                """
                MERGE (r:Round {hour: $hour})
                SET r.event_headline = $headline,
                    r.event_narrative = $narrative,
                    r.stock_price = $stock_price,
                    r.stock_price_value = $stock_price_value,
                    r.percent_change = $percent_change,
                    r.market_sentiment = $market_sentiment,
                    r.social_state = $social_state,
                    r.news = $news,
                    r.external_actor_actions = $external_actor_actions,
                    r.has_merger_context = $has_merger_context
                """,
                hour=hour,
                headline=headline,
                narrative=narrative,
                stock_price=market.get("stock_price") or "",
                stock_price_value=stock_price_value,
                percent_change=market.get("percent_change") or "",
                market_sentiment=market.get("sentiment") or "",
                social_state=ctx.get("social_state") or "",
                news=news_text,
                external_actor_actions=external_actions,
                has_merger_context=is_merger_related(
                    headline,
                    narrative,
                    news_text,
                    external_actions
                ),
            )

            for p in round_obj.get("participants") or []:
                agent_ids.add(p.get("agent_id"))

                session.run(
                    """
                    MERGE (a:Agent {agent_id: $agent_id})
                    SET a.agent_role = $agent_role,
                        a.agent_label = $agent_label
                    WITH a
                    MATCH (r:Round {hour: $hour})
                    MERGE (a)-[:PARTICIPATED_IN]->(r)
                    """,
                    agent_id=p.get("agent_id"),
                    agent_role=p.get("agent_role") or "",
                    agent_label=p.get("agent_label") or p.get("agent_id") or "",
                    hour=hour,
                )

            for msg in round_obj.get("communications") or []:
                istate = flatten_internal_state(msg.get("internal_state"))

                content = msg.get("content") or ""
                channel = msg.get("channel") or ""
                message_type = msg.get("message_type") or "unknown"

                visibility = infer_visibility(channel, message_type)

                merger_flag = is_merger_related(content)

                internal_reacting_merger_flag = is_merger_related(istate["reacting"])
                internal_rationalizing_merger_flag = is_merger_related(istate["rationalizing"])
                internal_deliberating_merger_flag = is_merger_related(istate["deliberating"])

                internal_merger_flag = any([
                    internal_reacting_merger_flag,
                    internal_rationalizing_merger_flag,
                    internal_deliberating_merger_flag,
                ])

                agent_ids.add(msg.get("agent_id"))
                message_count += 1

                collected_msgs.append({
                    "message_id": msg.get("message_id"),
                    "timestamp": msg.get("timestamp"),
                    "agent_id": msg.get("agent_id"),
                    "channel": channel,
                    "responding_to": msg.get("responding_to") or "",
                    "recipients": msg.get("recipients") or [],
                })

                session.run(
                    """
                    MERGE (a:Agent {agent_id: $agent_id})
                    SET a.agent_role = $agent_role,
                        a.agent_label = $agent_label
                    WITH a
                    MATCH (r:Round {hour: $round_hour})
                    CREATE (m:Message {
                        message_id: $message_id,
                        timestamp_raw: $timestamp_raw,
                        timestamp: datetime($timestamp_raw),
                        date_bucket: substring($timestamp_raw, 0, 10),
                        hour_bucket: substring($timestamp_raw, 0, 13) + ':00:00',
                        agent_id: $agent_id,
                        agent_role: $agent_role,
                        agent_label: $agent_label,
                        channel: $channel,
                        message_type: $message_type,
                        visibility: $visibility,
                        responding_to: $responding_to,
                        recipients: $recipients,
                        content: $content,
                        internal_reacting: $internal_reacting,
                        internal_rationalizing: $internal_rationalizing,
                        internal_deliberating: $internal_deliberating,
                        is_merger_related: $is_merger_related,
                        internal_merger_related: $internal_merger_related,
                        internal_reacting_merger_related: $internal_reacting_merger_related,
                        internal_rationalizing_merger_related: $internal_rationalizing_merger_related,
                        internal_deliberating_merger_related: $internal_deliberating_merger_related
                    })
                    MERGE (a)-[:SENT]->(m)
                    MERGE (m)-[:IN_ROUND]->(r)
                    """,
                    message_id=msg.get("message_id"),
                    timestamp_raw=msg.get("timestamp"),
                    agent_id=msg.get("agent_id"),
                    agent_role=msg.get("agent_role") or "",
                    agent_label=msg.get("agent_label") or msg.get("agent_id") or "",
                    round_hour=hour,
                    channel=channel,
                    message_type=message_type,
                    visibility=visibility,
                    responding_to=msg.get("responding_to") or "",
                    recipients=json.dumps(
                        msg.get("recipients") or [],
                        ensure_ascii=False
                    ),
                    content=content,
                    internal_reacting=istate["reacting"],
                    internal_rationalizing=istate["rationalizing"],
                    internal_deliberating=istate["deliberating"],
                    is_merger_related=merger_flag,
                    internal_merger_related=internal_merger_flag,
                    internal_reacting_merger_related=internal_reacting_merger_flag,
                    internal_rationalizing_merger_related=internal_rationalizing_merger_flag,
                    internal_deliberating_merger_related=internal_deliberating_merger_flag,
                )

        # === RESOLVE PARENT LINKS (responding_to + recipients) ===
        resolve_parent_links(collected_msgs)
        session.run(
            """
            UNWIND $rows AS row
            MATCH (m:Message {message_id: row.message_id})
            SET m.resolved_parent_id = row.resolved_parent_id,
                m.reply_kind = row.reply_kind
            """,
            rows=[
                {
                    "message_id": r["message_id"],
                    "resolved_parent_id": r.get("resolved_parent_id") or "",
                    "reply_kind": r.get("reply_kind") or "root",
                }
                for r in collected_msgs
            ],
        )

        # === REPLY GRAPH GENERATION ===
        session.run(
            """
            MATCH (m:Message)
            WHERE m.resolved_parent_id <> ''
            MATCH (target:Message {message_id: m.resolved_parent_id})
            WHERE target.message_id <> m.message_id
            MERGE (m)-[:REPLIES_TO]->(target)
            """
        )

        # === SEQUENTIAL COMMUNICATION ID ===
        session.run(
            """
            MATCH (m:Message)
            WITH m ORDER BY m.timestamp, m.message_id
            WITH collect(m) AS ms
            UNWIND range(0, size(ms) - 1) AS i
            WITH ms[i] AS m, i + 1 AS cid
            SET m.comm_id = cid
            """
        )

        session.run(
            """
            MERGE (meta:Meta {key: 'schema_version'})
            SET meta.value = 'inner-thought-merger-network-v3'
            """
        )

    # === NEO4J GENERATION END ===
    return {
        "rounds": len(rounds),
        "messages": message_count,
        "agents": len([x for x in agent_ids if x])
    }

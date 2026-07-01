# ============================================================
# メタ系エンドポイント: health / admin reload / options / timeline / rounds
# ============================================================

from fastapi import APIRouter, Query

from ..db import get_driver
from ..importer import reset_and_import
from ..config import MERGER_KEYWORDS, TEXT_SOURCE_OPTIONS

router = APIRouter()


@router.get("/api/health")
def health():
    return {"ok": True}


@router.post("/admin/reload")
def admin_reload():
    """
    手動でNeo4jのデータを入れ直すためのAPI。
    """
    return reset_and_import()


@router.get("/api/options")
def options():
    """
    frontendのfilterで使う選択肢を返すAPI。
    既存の情報（merger count, total count, min/max time, merger keywords など）は維持する。
    """
    with get_driver().session() as session:
        message_types = [
            r["message_type"]
            for r in session.run(
                """
                MATCH (m:Message)
                RETURN DISTINCT m.message_type AS message_type
                ORDER BY message_type
                """
            )
        ]

        channels = [
            r["channel"]
            for r in session.run(
                """
                MATCH (m:Message)
                RETURN DISTINCT m.channel AS channel
                ORDER BY channel
                """
            )
        ]

        merger_count = session.run(
            "MATCH (m:Message {is_merger_related: true}) RETURN count(m) AS c"
        ).single()["c"]

        internal_merger_count = session.run(
            """
            MATCH (m:Message)
            WHERE coalesce(m.internal_merger_related, false) = true
            RETURN count(m) AS c
            """
        ).single()["c"]

        combined_merger_count = session.run(
            """
            MATCH (m:Message)
            WHERE coalesce(m.is_merger_related, false) = true
               OR coalesce(m.internal_merger_related, false) = true
            RETURN count(m) AS c
            """
        ).single()["c"]

        total_count = session.run(
            "MATCH (m:Message) RETURN count(m) AS c"
        ).single()["c"]

        range_record = session.run(
            """
            MATCH (m:Message)
            RETURN min(m.timestamp_raw) AS min_time,
                   max(m.timestamp_raw) AS max_time
            """
        ).single()

        agents = [
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

    return {
        "message_types": message_types,
        "text_sources": TEXT_SOURCE_OPTIONS,
        "channels": channels,
        "visibilities": ["internal", "external"],
        "agents": agents,
        "merger_count": merger_count,
        "internal_merger_count": internal_merger_count,
        "combined_merger_count": combined_merger_count,
        "total_count": total_count,
        "min_time": range_record["min_time"] or "",
        "max_time": range_record["max_time"] or "",
        "merger_keywords": MERGER_KEYWORDS,
    }


@router.get("/api/timeline")
def timeline():
    """
    クライアントの時間スライダー用に、全 round (23) を時系列で返す。
    各 round に cutoff（= その round までに含めるべき最大 timestamp_raw）を付ける。
    cutoff を heatmap/network/line-chart の end_time として使うと、
    "round N まで" を正確に（次の round を含めず）累積表示できる。
    """
    query = """
    MATCH (r:Round)
    OPTIONAL MATCH (m:Message)-[:IN_ROUND]->(r)
    WITH r,
         count(m) AS total_msgs,
         sum(CASE WHEN coalesce(m.is_merger_related, false)
                   OR coalesce(m.internal_merger_related, false) THEN 1 ELSE 0 END) AS merger_msgs,
         max(m.timestamp_raw) AS max_ts
    RETURN r.hour AS hour,
           coalesce(r.event_headline, '') AS event_headline,
           r.stock_price_value AS stock_price_value,
           coalesce(r.market_sentiment, '') AS market_sentiment,
           total_msgs AS total_msgs,
           merger_msgs AS merger_msgs,
           max_ts AS max_ts
    ORDER BY r.hour
    """
    with get_driver().session() as session:
        rows = [dict(r) for r in session.run(query)]

    out = []
    for i, r in enumerate(rows):
        cutoff = r.get("max_ts") or r.get("hour")
        out.append({
            "idx": i,
            "hour": r.get("hour"),
            "cutoff": cutoff,
            "event_headline": r.get("event_headline") or "",
            "total_msgs": r.get("total_msgs") or 0,
            "merger_msgs": r.get("merger_msgs") or 0,
            "stock_price_value": r.get("stock_price_value"),
            "market_sentiment": r.get("market_sentiment") or "",
        })
    return {"rounds": out}


@router.get("/api/rounds")
def rounds_for_bucket(
    bucket: str,
    granularity: str = Query("daily", pattern="^(daily|hourly)$")
):
    """
    時間ヘッダーをクリックしたときに、
    その日またはその時間に対応するround情報を返すAPI。
    """
    if granularity == "daily":
        where = "substring(r.hour, 0, 10) = $bucket"
    else:
        where = "substring(r.hour, 0, 13) + ':00:00' = $bucket"

    query = f"""
    MATCH (r:Round)
    WHERE {where}
    RETURN r.hour AS hour,
           r.event_headline AS event_headline,
           r.event_narrative AS event_narrative,
           r.stock_price AS stock_price,
           r.stock_price_value AS stock_price_value,
           r.percent_change AS percent_change,
           r.market_sentiment AS market_sentiment,
           r.social_state AS social_state,
           r.has_merger_context AS has_merger_context
    ORDER BY r.hour
    """

    with get_driver().session() as session:
        return [
            dict(r)
            for r in session.run(query, bucket=bucket)
        ]

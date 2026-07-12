# ============================================================
# Messages / Message Context / Keywords エンドポイント
# ============================================================

from typing import Optional

from fastapi import APIRouter, Query

from ..queries import fetch_messages_for_cell, fetch_all_messages_for_context
from ..domain import resolve_parent_links
from ..context import build_message_context, build_reply_thread, _empty_context
from ..nlp import extract_embedding_keywords

router = APIRouter()


@router.get("/api/messages")
def messages(
    agent_id: str,
    bucket: str,
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
    return fetch_messages_for_cell(
        agent_id=agent_id,
        bucket=bucket,
        granularity=granularity,
        merger_only=merger_only,
        message_types=message_types,
        message_type=message_type,
        text_sources=text_sources,
        visibility=visibility,
        start_time=start_time,
        end_time=end_time,
        keyword=keyword,
    )


@router.get("/api/messages/{message_id}/context")
def message_context(message_id: str):
    """
    1つのmessageの「文脈（関連message）」を返すAPI。
    - parent / replies / temporal_neighbors / same_channel_context /
      same_agent_context / keyword_related / all_related を含む。
    - messageが存在しない場合も 200 で安全な空shapeを返す。
    - ML modelには依存しない。
    """
    try:
        all_msgs = fetch_all_messages_for_context()
    except Exception:
        # DB接続失敗などでも shape を崩さない
        return _empty_context(message_id)
    # responding_to(@mention / id) + recipients を統合して各 message の親を解決。
    # （import 済み node にも resolved_parent_id はあるが、ここで再計算して
    #   未 reload の DB でも常に正しい会話リンクになるようにする。）
    resolve_parent_links(all_msgs)
    ctx = build_message_context(all_msgs, message_id)
    # 解決済みの会話スレッド（会話フロー popup の主役）
    ctx["thread"] = build_reply_thread(all_msgs, message_id)
    return ctx


@router.get("/api/message-id-map")
def message_id_map():
    """
    message_id → comm_id（表示用の #番号）の全体マップ。
    UI 側で responding_to（実体は message_id）を #番号 で表示するために使う。
    backend/データ側は message_id をそのまま保持する（スレッド構築などが依存するため）。
    """
    try:
        all_msgs = fetch_all_messages_for_context()
    except Exception:
        return {}
    return {m["message_id"]: m.get("comm_id") for m in all_msgs if m.get("comm_id") is not None}


@router.get("/api/messages-by-ids")
def messages_by_ids(ids: Optional[list[str]] = Query(default=None)):
    """
    指定した message_id 群の完全な message 行を、リクエスト順のまま返す。
    Sequential-flow の各イベントの「event related messages」表示に使う。
    - 既存の fetch_all_messages_for_context() を再利用（912件程度なので全件取得で十分）。
    - 存在しない id は黙って除外し、shape は /api/messages と互換のフィールドで返す。
    """
    if not ids:
        return []
    try:
        all_msgs = fetch_all_messages_for_context()
    except Exception:
        return []
    by_id = {m["message_id"]: m for m in all_msgs}
    return [by_id[i] for i in ids if i in by_id]


@router.get("/api/keywords")
def keywords(
    agent_id: str,
    bucket: str,
    granularity: str = Query("daily", pattern="^(daily|hourly)$"),
    mode: str = Query("both", pattern="^(close|far|both)$"),
    top_n: int = 10,
    merger_only: bool = False,
    message_types: Optional[list[str]] = Query(default=None),
    message_type: str = "all",
    text_sources: Optional[list[str]] = Query(default=None),
    visibility: str = Query("all", pattern="^(all|internal|external)$"),
    start_time: str = "",
    end_time: str = "",
    keyword: str = "",
):
    rows = fetch_messages_for_cell(
        agent_id=agent_id,
        bucket=bucket,
        granularity=granularity,
        merger_only=merger_only,
        message_types=message_types,
        message_type=message_type,
        text_sources=text_sources,
        visibility=visibility,
        start_time=start_time,
        end_time=end_time,
        keyword=keyword,
    )

    texts = [row["content"] for row in rows if row.get("content")]

    return extract_embedding_keywords(
        texts=texts,
        top_n=top_n,
        mode=mode,
    )

# ============================================================
# ドメインロジック / ヘルパー (pure helpers + Cypher clause builders)
# ============================================================
# 旧 main.py の「DBに触らない純粋関数」と Cypher の共通句ビルダーを集約したモジュール。
# 会話リンク解決 (resolve_parent_links) / merger・keyword フィルタ句 / text source 正規化 /
# time bucket 式 / market sentiment 変換 などが含まれる。ロジックは不変。

import json
import re
from typing import Any, Dict, List, Optional

from .config import (
    MERGER_KEYWORDS,
    TEXT_SOURCE_OPTIONS,
    RECIPIENT_ROLE_TO_AGENT,
    SENTIMENT_LABEL_TO_VALUE,
    DATA_PATH,
)


def flatten_internal_state(state: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """
    internal_stateの中身を安全に取り出す関数。
    internal_stateがNoneの場合でも、空文字として扱えるようにする。
    """
    if not state:
        return {
            "reacting": "",
            "rationalizing": "",
            "deliberating": ""
        }

    return {
        "reacting": state.get("reacting") or "",
        "rationalizing": state.get("rationalizing") or "",
        "deliberating": state.get("deliberating") or "",
    }


def infer_visibility(channel: str, message_type: str) -> str:
    """
    messageがinternalかexternalかを判定する関数。

    official_post や public_post は外部向け投稿なので external。
    それ以外は社内会話として internal。
    """
    if channel == "official_post" or message_type == "public_post":
        return "external"
    return "internal"


def is_merger_related(*texts: str) -> bool:
    # 複数のテキストを1つの長い文字列にまとめる
    # t or "" は、t が None の場合でもエラーにしないため
    # .lower() で本文全体を小文字に変換する
    haystack = " ".join(t or "" for t in texts).lower()

    # キーワード側もすべて小文字に変換する
    # これにより "ElenaMarquez" と "@elenamarquez" のような違いを吸収できる
    keywords = [k.lower() for k in MERGER_KEYWORDS]

    # 各キーワードが本文 haystack の中に含まれているかを確認する
    # 1つでも含まれていれば True を返す
    return any(k in haystack for k in keywords)


def parse_stock_price(value: Any) -> Optional[float]:
    """
    JSON内のstock priceは "$38.70" のような文字列、または None で入っている。
    これを数値に変換する。変換できない場合は None を返す。

    重要:
    - 外部APIからstock priceを取得せず、添付JSON内のstock price dataだけを使う。
    - JSON内のstock sentiment scoreは sentiment 分析には使わない（後述のBERTで計算する）。
    """
    if value is None:
        return None
    s = str(value).replace("$", "").replace(",", "").strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def load_json() -> Dict[str, Any]:
    """
    JSONファイルを読み込んでPythonのdictとして返す関数。
    """
    with DATA_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def normalize_message_types(message_types: Optional[list[str]], message_type: str = "all") -> list[str]:
    """
    frontendから来るmessage type filterを正規化する。
    空リストは「全message type」を意味する。
    """
    selected = [t for t in (message_types or []) if t and t != "all"]

    if not selected and message_type and message_type != "all":
        selected = [message_type]

    return selected


def normalize_text_sources(text_sources: Optional[list[str]]) -> list[str]:
    """
    frontendから来るtext source filterを正規化する。
    空リストは「すべてのtext source」を意味する。
    """
    return [
        source
        for source in (text_sources or [])
        if source in TEXT_SOURCE_OPTIONS
    ]


def merger_filter_clause() -> str:
    """
    Merger-related only がONのときの条件。

    selected text source が空なら、content と inner thought の両方を見る。
    content が選ばれていれば m.is_merger_related を見る。
    reacting / rationalizing / deliberating が選ばれていれば、それぞれの内部思考flagを見る。
    """
    return """
      AND (
          $merger_only = false
          OR (
              size($text_sources) = 0
              AND (
                  coalesce(m.is_merger_related, false) = true
                  OR coalesce(m.internal_merger_related, false) = true
              )
          )
          OR ('content' IN $text_sources AND coalesce(m.is_merger_related, false) = true)
          OR ('reacting' IN $text_sources AND coalesce(m.internal_reacting_merger_related, false) = true)
          OR ('rationalizing' IN $text_sources AND coalesce(m.internal_rationalizing_merger_related, false) = true)
          OR ('deliberating' IN $text_sources AND coalesce(m.internal_deliberating_merger_related, false) = true)
      )
    """


def keyword_filter_clause() -> str:
    """
    Search keyword が入力されたときの条件。

    selected text source が空なら、content / reacting / rationalizing / deliberating の全部を見る。
    selected text source があるなら、そのsourceだけを検索対象にする。
    """
    return """
      AND (
          $keyword = ''
          OR (
              (size($text_sources) = 0 OR 'content' IN $text_sources)
              AND toLower(coalesce(m.content, '')) CONTAINS $keyword
          )
          OR (
              (size($text_sources) = 0 OR 'reacting' IN $text_sources)
              AND toLower(coalesce(m.internal_reacting, '')) CONTAINS $keyword
          )
          OR (
              (size($text_sources) = 0 OR 'rationalizing' IN $text_sources)
              AND toLower(coalesce(m.internal_rationalizing, '')) CONTAINS $keyword
          )
          OR (
              (size($text_sources) = 0 OR 'deliberating' IN $text_sources)
              AND toLower(coalesce(m.internal_deliberating, '')) CONTAINS $keyword
          )
      )
    """


def keyword_score_expression() -> str:
    """
    Keyword match の強さを数値化するCypher式。

    scoreの意味:
        content        にkeywordがあれば +4
        reacting       にkeywordがあれば +3
        rationalizing  にkeywordがあれば +2
        deliberating   にkeywordがあれば +1

    Text source filter が選ばれている場合は、そのsourceだけにscoreを付ける。
    """
    return """
     CASE WHEN $keyword <> ''
            AND (size($text_sources) = 0 OR 'content' IN $text_sources)
            AND toLower(coalesce(m.content, '')) CONTAINS $keyword
          THEN 4 ELSE 0 END +
     CASE WHEN $keyword <> ''
            AND (size($text_sources) = 0 OR 'reacting' IN $text_sources)
            AND toLower(coalesce(m.internal_reacting, '')) CONTAINS $keyword
          THEN 3 ELSE 0 END +
     CASE WHEN $keyword <> ''
            AND (size($text_sources) = 0 OR 'rationalizing' IN $text_sources)
            AND toLower(coalesce(m.internal_rationalizing, '')) CONTAINS $keyword
          THEN 2 ELSE 0 END +
     CASE WHEN $keyword <> ''
            AND (size($text_sources) = 0 OR 'deliberating' IN $text_sources)
            AND toLower(coalesce(m.internal_deliberating, '')) CONTAINS $keyword
          THEN 1 ELSE 0 END
    """


def bucket_expression(granularity: str) -> str:
    """
    Heatmapの時間bucketをMessage.timestamp_rawから作る。
    Round.hourは使わない。
    """
    if granularity == "daily":
        return "substring(m.timestamp_raw, 0, 10)"
    return "substring(m.timestamp_raw, 0, 13) + ':00:00'"


def round_bucket_expression(granularity: str) -> str:
    """
    固定time axisを作るために、Round.hour から time bucket を作る式。
    Heatmapとは独立に「messageが無い時間帯」も含めた全bucketを得るために使う。
    """
    if granularity == "daily":
        return "substring(r.hour, 0, 10)"
    return "substring(r.hour, 0, 13) + ':00:00'"


def common_where_clause() -> str:
    """heatmap / messages 共通の WHERE 条件。"""
    return f"""
      {merger_filter_clause()}
      AND (size($message_types) = 0
           OR (coalesce(m.channel, '') + '|' + coalesce(m.message_type, '')) IN $message_types)
      // ↑ filter は message_channel × message_type の複合キーで行う。
      //   comms_huddle が broadcast/action に割れ、public_post が personal/official/anonymous
      //   に割れる二重の重なりを、この複合キーで漏れなく（網羅的に）表現する。
      //   互換のため wire 上の param 名は $message_types のままだが、中身は
      //   "channel|message_type"（例: "comms_huddle|broadcast", "anonymous_post|public_post"）。
      AND (
          size($text_sources) = 0
          OR ('content' IN $text_sources AND coalesce(m.content, '') <> '')
          OR ('reacting' IN $text_sources AND coalesce(m.internal_reacting, '') <> '')
          OR ('rationalizing' IN $text_sources AND coalesce(m.internal_rationalizing, '') <> '')
          OR ('deliberating' IN $text_sources AND coalesce(m.internal_deliberating, '') <> '')
      )
      AND ($visibility = 'all' OR m.visibility = $visibility)
      AND ($start_time = '' OR m.timestamp_raw >= $start_time)
      AND ($end_time = '' OR m.timestamp_raw <= $end_time)
      {keyword_filter_clause()}
    """


# ============================================================
# 会話リンク解決 (conversation-link resolution)
# ============================================================
# `responding_to` は2種類の値を持つ:
#   (a) 実在する message_id            -> その message への「直接リプライ」
#   (b) "@pr" / "@legal @pr" などの    -> 特定 message ではなく *役割宛て* の発言。
#       @role メンション                  これは recipients が持つ宛先情報と同じ語彙。
#
# 旧実装は (b) も message_id として扱っていたため解決できず、~266件（全体の約30%）の
# message が会話フロー / reply graph から欠落していた（＝「正しい返信が正しいメッセージに
# 繋がらない」原因）。
#
# ここでは `responding_to`（id or @mention）と `recipients` の両方を使って、各 message の
# 実際の親 message (resolved_parent_id) と種別 (reply_kind) を決定する。これを唯一の
# 真実として REPLIES_TO グラフ・network・会話フローの全てが参照する。
_MENTION_RE = re.compile(r"@([A-Za-z_]+)")


def _coerce_recipients(value: Any) -> List[str]:
    """recipients は JSON 文字列 or list で来る。token の list に正規化する。"""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x) for x in value]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(x) for x in parsed]
        except Exception:
            pass
        return [value] if value else []
    return []


def mention_target_agents(text: str) -> List[str]:
    """`responding_to` 内の @role メンションを agent_id に変換（順序保持・重複排除）。"""
    out: List[str] = []
    for tok in _MENTION_RE.findall(text or ""):
        agent = RECIPIENT_ROLE_TO_AGENT.get(tok.lower())
        if agent and agent not in out:
            out.append(agent)
    return out


def recipient_target_agents(recipients: Any) -> List[str]:
    """recipients の role token を agent_id に変換（ALL / 空は宛先なしとして除外）。"""
    out: List[str] = []
    for r in _coerce_recipients(recipients):
        token = (r or "").strip()
        if not token or token.upper() == "ALL":
            continue
        agent = RECIPIENT_ROLE_TO_AGENT.get(token.lower())
        if agent and agent not in out:
            out.append(agent)
    return out


def resolve_parent_links(all_msgs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    各 message に `resolved_parent_id` と `reply_kind` を付与する（in-place、同じ list を返す）。

    解決ルール（上から優先）:
      1. responding_to が実在 message_id        -> direct     : その message への直接リプライ
      2. responding_to が @role メンション       -> addressed  : 宛先 role の直近の発言へ繋ぐ
      3. responding_to 空 & recipients が特定role -> addressed  : recipients role の直近の発言へ繋ぐ
      4. それ以外（ALL broadcast / 解決不能）     -> root       : 親なし = スレッドの起点

    `addressed` の親 = 「自分より前の時刻で、宛先 agent のいずれかが送った直近の message」。
    まず同じ channel 内で探し、見つからなければ channel を問わず探す（1:1 DM が複数日に跨る等のため）。
    時系列の後ろ向き探索なので循環は構造的に発生しない。
    """
    ordered = sorted(
        all_msgs,
        key=lambda m: (m.get("timestamp") or "", m.get("message_id") or ""),
    )
    by_id = {m.get("message_id"): m for m in ordered}

    def most_recent_prior(idx: int, targets: set, channel: Optional[str]) -> Optional[Dict[str, Any]]:
        for j in range(idx - 1, -1, -1):
            cand = ordered[j]
            if cand.get("agent_id") in targets:
                if channel is None or cand.get("channel") == channel:
                    return cand
        return None

    for i, m in enumerate(ordered):
        rt = (m.get("responding_to") or "").strip()
        mid = m.get("message_id")
        channel = m.get("channel")
        parent_id = ""
        kind = "root"

        if rt and rt in by_id and rt != mid:
            # (1) 直接リプライ
            parent_id, kind = rt, "direct"
        else:
            # (2)/(3) 役割宛て: responding_to の @mention を優先、無ければ recipients
            targets = mention_target_agents(rt) if rt.startswith("@") else []
            if not targets and not rt:
                targets = recipient_target_agents(m.get("recipients"))
            if targets:
                tgt = set(targets)
                parent = (
                    most_recent_prior(i, tgt, channel)
                    or most_recent_prior(i, tgt, None)
                )
                if parent is not None:
                    parent_id = parent.get("message_id") or ""
                    kind = "addressed"
                else:
                    kind = "root"
            else:
                # (4) ALL broadcast / 解決できない外部メンション(@PropTechWatcher等)
                kind = "root"

        m["resolved_parent_id"] = parent_id
        m["reply_kind"] = kind

    return all_msgs


def combine_cell_texts(rows: List[Dict[str, Any]], selected_text_sources: List[str]) -> List[str]:
    """
    cell内のmessageから、現在のtext source filterに従ってテキストを取り出す。
    text source filterが空ならcontent + 全inner thoughtを対象にする。
    """
    use_all = len(selected_text_sources) == 0
    texts: List[str] = []
    for r in rows:
        parts = []
        if use_all or "content" in selected_text_sources:
            if r.get("content"):
                parts.append(r["content"])
        if use_all or "reacting" in selected_text_sources:
            if r.get("internal_reacting"):
                parts.append(r["internal_reacting"])
        if use_all or "rationalizing" in selected_text_sources:
            if r.get("internal_rationalizing"):
                parts.append(r["internal_rationalizing"])
        if use_all or "deliberating" in selected_text_sources:
            if r.get("internal_deliberating"):
                parts.append(r["internal_deliberating"])
        joined = " ".join(parts).strip()
        if joined:
            texts.append(joined)
    return texts


def market_sentiment_to_value(label: Optional[str]) -> Optional[float]:
    """market sentiment label を数値へ。未知ラベルや空は None。"""
    if not label:
        return None
    return SENTIMENT_LABEL_TO_VALUE.get(label.strip().lower())

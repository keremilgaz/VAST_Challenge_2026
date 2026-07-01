# JSONファイルを読み込むための標準ライブラリ
import json

# 環境変数を読むために使う
import os

# Neo4jが起動するまで待つために使う
import time

# 文字列ハッシュ（sentiment / embedding cache用）
import hashlib

# crisis keyword の word-boundary マッチ用
import re

# ファイルパスを扱いやすくするために使う
from pathlib import Path

# 型ヒント用
from typing import Any, Dict, List, Optional

# FastAPI本体と、query parameterの制約に使うQuery
from fastapi import FastAPI, Query

# Reactなど別URLのfrontendからAPIを呼べるようにするCORS設定
from fastapi.middleware.cors import CORSMiddleware

# Neo4jに接続するための公式ドライバー
from neo4j import GraphDatabase

# NLP実装のためのライブラリ 5/25
# sentence_transformers / torch / transformers はトップレベルでimportしない（起動を遅くしDLを誘発するため）。
# embedding modelは get_embedding_model() で遅延ロードし、利用不可ならfallbackする。
from sklearn.feature_extraction.text import CountVectorizer, HashingVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np


# Docker環境では環境変数からNeo4jの接続先を読む
# 環境変数がなければローカル実行用のデフォルト値を使う
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password123")

# 読み込む元データJSONの場所
DATA_PATH = Path(os.getenv("DATA_PATH", "/app/data/MC1_final_00.json"))


# merger-related 判定に使うキーワード一覧
# message content や internal_state にこれらが含まれているかを確認する
# これがひとつでも含まれていたら、merger関連ワードに判定
MERGER_KEYWORDS = [
    "merger",
    # "merge" は emergency などに誤ヒットするので外す
    "civicloom",
    "elenamarquez",  # CEO of CivicLoom
    "harborcrest",   # project name
    "embargo",
]

# frontendのinner thought filterで使う選択肢
# 空リストの場合は「すべてのtext source」を意味する
TEXT_SOURCE_OPTIONS = ["content", "reacting", "rationalizing", "deliberating"]


# FastAPIアプリを作成
app = FastAPI(title="Agent Heatmap + Network Prototype (VAST MC1)")


# CORS設定
# React frontend から FastAPI backend にアクセスできるようにする
# frontとbackのhostのパスが異なる。→　そのアクセスをエラーにならないように間に入る
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # すべてのoriginを許可
    allow_credentials=True,
    allow_methods=["*"],        # GET, POSTなどすべて許可
    allow_headers=["*"],        # すべてのheaderを許可
)


# Neo4j driverをグローバルに保持する
# 毎回新しく接続を作らないため
driver = None


def get_driver():
    """
    Neo4jに接続するdriverを返す関数。
    初回だけGraphDatabase.driverを作り、2回目以降は同じdriverを使う。
    """
    global driver
    if driver is None:
        driver = GraphDatabase.driver(
            NEO4J_URI,
            auth=(NEO4J_USER, NEO4J_PASSWORD)
        )
    return driver


def wait_for_neo4j(max_seconds: int = 90):
    """
    Neo4jが起動完了するまで待つ関数。
    Dockerではbackendの方がNeo4jより早く起動することがあるので必要。
    """
    d = get_driver()
    start = time.time()
    last_error = None

    while time.time() - start < max_seconds:
        try:
            with d.session() as session:
                session.run("RETURN 1 AS ok").single()
            return
        except Exception as exc:
            last_error = exc
            time.sleep(2)

    raise RuntimeError(f"Neo4j did not become ready: {last_error}")


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
RECIPIENT_ROLE_TO_AGENT = {
    "legal": "legal_agent",
    "pr": "pr_agent",
    "platform_trust": "quality_agent",
    "social_manager": "social_media_agent",
    "pr_intern": "pr_intern_agent",
    "intern": "intern_agent",
    "judge": "judge_agent",
}

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


def reset_and_import() -> Dict[str, int]:
    """
    Neo4jの中身を一度全部消して、
    JSONデータをNeo4jのNode / Relationshipとして入れ直す関数。
    """
    wait_for_neo4j()

    data = load_json()
    rounds = data.get("rounds", [])

    message_count = 0
    agent_ids = set()
    # resolved_parent_id を計算するために、全 message の宛先情報を集める
    collected_msgs: List[Dict[str, Any]] = []

    # === NEO4J GENERATION START ===

    with get_driver().session() as session:
        # 既存データをすべて削除
        session.run("MATCH (n) DETACH DELETE n")

        # 重複を防ぐための制約を作成
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

            # JSON内のstock price文字列を数値に変換しておく（line chart用）
            # 外部APIは使わず、JSON内のstock price dataだけを使う
            stock_price_value = parse_stock_price(market.get("stock_price"))

            # Round nodeを作成または更新
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
        # responding_to が @role メンションや空のケースを、recipients を併用して
        # 実際の親 message_id に解決する。これを各 Message node に保存し、
        # 以降の reply graph / network / 会話フローはこの resolved_parent_id を参照する。
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
        # 解決済みの resolved_parent_id を使って Message -> Message の返信関係を作る。
        # これで「@pr 宛て」などの役割宛てメッセージも正しい親に繋がり、
        # reply graph / network から約30%の edge が欠落する問題が解消する。
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
        # 全messageをtimestamp昇順（同着はmessage_id）で並べ、1始まりの連番 comm_id を付与する。
        # 元の message_id はそのまま保持する（comm_id は表示・会話フロー用の補助ID）。
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


# ============================================================
# NLP系（embedding / sentiment）
# ============================================================

# 既存のembedding model（semantic change と keyword 抽出で再利用する）。
# 重要: FastAPI起動時にmodelをload/DLしない。get_embedding_model()で遅延ロードする。
_embedding_model = None
_embedding_model_failed = False

# embedding結果をtextハッシュでcacheして再計算を減らす
_embedding_cache: Dict[str, np.ndarray] = {}

# sentiment結果をtextハッシュでcacheする
_sentiment_cache: Dict[str, float] = {}

# BERT sentiment pipelineを遅延ロードするためのグローバル
_sentiment_pipeline = None
_sentiment_pipeline_failed = False


def _text_hash(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def get_embedding_model():
    """
    SentenceTransformer("all-MiniLM-L6-v2") を遅延ロードする。
    - 初回呼び出し時にだけimport/loadする（起動時にはロードしない）。
    - sentence-transformers / torch が無い、またはmodelがDLできない環境では
      None を返し、呼び出し側はfallbackロジックに切り替える。
    """
    global _embedding_model, _embedding_model_failed
    if _embedding_model is not None or _embedding_model_failed:
        return _embedding_model
    try:
        from sentence_transformers import SentenceTransformer
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    except Exception:
        _embedding_model_failed = True
        _embedding_model = None
    return _embedding_model


# ML(sentence-transformers)が使えない環境向けの軽量 embedding fallback。
# sentiment が lexicon に degrade するのと同様に、semantic change も「空表示」では
# なく依存追加なしで動くようにする。
#
# HashingVectorizer は stateful な fit が不要（語彙を事前学習しない）ため、
# cell ごとに独立して同じ次元・同じ特徴空間のベクトルを生成でき、
# 異なる cell 間の cosine similarity をそのまま比較できる。
# 文字 n-gram を使うことで短文・固有名詞・タイポにも頑健にする。
_fallback_vectorizer = HashingVectorizer(
    n_features=512,
    analyzer="char_wb",
    ngram_range=(3, 5),
    alternate_sign=False,
    norm="l2",
)


def _fallback_embedding(text: str) -> Optional[np.ndarray]:
    """sentence-transformers が無いときの埋め込み。L2正規化済みの密ベクトルを返す。"""
    if not text or not text.strip():
        return None
    try:
        vec = _fallback_vectorizer.transform([text])
        arr = np.asarray(vec.todense()).ravel().astype(float)
        if not np.any(arr):
            return None
        return arr
    except Exception:
        return None


def get_embedding(text: str) -> Optional[np.ndarray]:
    """text を embedding に変換し、cacheする。

    sentence-transformers が使える環境では all-MiniLM-L6-v2 を、
    使えない fast mode では char n-gram HashingVectorizer の fallback を使う。
    どちらの場合も同種ベクトル同士の cosine similarity を比較する用途なので、
    semantic change ヒートマップは ML 無しでも表示できる。
    """
    key = _text_hash(text)
    if key in _embedding_cache:
        return _embedding_cache[key]

    model = get_embedding_model()
    if model is not None:
        try:
            emb = model.encode([text])[0]
            _embedding_cache[key] = emb
            return emb
        except Exception:
            # model 利用中に失敗したら fallback に切り替える
            pass

    emb = _fallback_embedding(text)
    _embedding_cache[key] = emb
    return emb


def get_sentiment_pipeline():
    """
    BERTベースのsentiment transformerを遅延ロードする。
    distilbert-base-uncased-finetuned-sst-2-english を使う（軽量なBERT系sentiment model）。

    重要:
    - JSON内のstock sentiment scoreは使わず、実際のmessage textをBERTに渡してsentimentを計算する。
    - transformers / torch が無い、またはmodelがダウンロードできない環境では、
      lexicon-based fallback に切り替えてアプリ全体が止まらないようにする。
    """
    global _sentiment_pipeline, _sentiment_pipeline_failed
    if _sentiment_pipeline is not None or _sentiment_pipeline_failed:
        return _sentiment_pipeline
    try:
        from transformers import pipeline
        _sentiment_pipeline = pipeline(
            "sentiment-analysis",
            model="distilbert-base-uncased-finetuned-sst-2-english",
            truncation=True,
        )
    except Exception:
        # modelが使えない場合はfallbackに任せる
        _sentiment_pipeline_failed = True
        _sentiment_pipeline = None
    return _sentiment_pipeline


# fallback用の簡易lexicon（BERTが使えない環境向けの保険）
_POS_WORDS = {
    "good", "great", "excellent", "positive", "confident", "calm", "agree",
    "support", "win", "success", "improve", "resolve", "safe", "clear",
    "stable", "trust", "opportunity", "progress", "approve", "strong",
}
_NEG_WORDS = {
    "bad", "worse", "worst", "negative", "concern", "concerned", "risk",
    "panic", "crisis", "fail", "failure", "lawsuit", "breach", "danger",
    "angry", "fear", "threat", "leak", "scandal", "drop", "decline", "loss",
    "critical", "embargo", "investigation", "viral", "backlash",
}


def _lexicon_sentiment(text: str) -> float:
    """transformersが無いときのfallback。-1〜1のscoreを返す。"""
    tokens = [t.strip(".,!?;:'\"()").lower() for t in text.split()]
    pos = sum(1 for t in tokens if t in _POS_WORDS)
    neg = sum(1 for t in tokens if t in _NEG_WORDS)
    if pos + neg == 0:
        return 0.0
    return (pos - neg) / (pos + neg)


def sentiment_score(text: str) -> Optional[float]:
    """
    1つのテキストのsentiment scoreを -1〜1 で返す。
    -1 = negative, 0 = neutral, 1 = positive。

    BERT(distilbert sst-2)の場合、POSITIVE/NEGATIVE + scoreを -1〜1 にマップする。
    text が空なら None を返す。
    """
    if not text or not text.strip():
        return None
    key = _text_hash(text)
    if key in _sentiment_cache:
        return _sentiment_cache[key]

    pipe = get_sentiment_pipeline()
    if pipe is not None:
        try:
            # 長すぎるtextは先頭だけ使う（modelのmax tokenを超えないように）
            res = pipe(text[:1000])[0]
            label = res.get("label", "NEUTRAL")
            score = float(res.get("score", 0.5))
            signed = score if label.upper().startswith("POS") else -score
            _sentiment_cache[key] = signed
            return signed
        except Exception:
            pass

    # fallback
    val = _lexicon_sentiment(text)
    _sentiment_cache[key] = val
    return val


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


# ============================================================
# 共通: filter付きでcellのmessageを取る（heatmap / messages / keyword / sentiment / semantic 共通基盤）
# ============================================================

def _common_where_clause() -> str:
    """heatmap / messages 共通の WHERE 条件。"""
    return f"""
      {merger_filter_clause()}
      AND (size($message_types) = 0 OR m.message_type IN $message_types)
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
      {_common_where_clause()}
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


# ============================================================
# 固定time axis + 全cell（empty cellを残す）を作る基盤
# ============================================================

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
      {_common_where_clause()}
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


@app.on_event("startup")
def startup_event():
    """
    FastAPI起動時に実行される処理。
    Neo4jにMessageがなければJSONからデータをimportする。
    """
    wait_for_neo4j()

    with get_driver().session() as session:
        count = session.run(
            "MATCH (m:Message) RETURN count(m) AS c"
        ).single()["c"]

    if count == 0:
        reset_and_import()


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/admin/reload")
def admin_reload():
    """
    手動でNeo4jのデータを入れ直すためのAPI。
    """
    return reset_and_import()


@app.get("/api/options")
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


@app.get("/api/timeline")
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


@app.get("/api/heatmap")
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
    """
    heatmap用の集計データを返すAPI。

    mode:
        count           : message数（keywordありの場合はkeyword一致数）
        sentiment       : 各cellのBERT sentiment score
        semantic_change : 各cellの前後bucketとのsemantic distance

    重要:
    - empty cells / empty time bucketsも必ず含める（time axisを固定するため）。
    - sentiment / semantic は raw data全体ではなく、現在filterされたmessagesに対してのみ計算する。
    """
    selected_message_types = normalize_message_types(message_types, message_type)
    selected_text_sources = normalize_text_sources(text_sources)
    normalized_keyword = keyword.lower().strip()

    # 固定time axisを先に作る（messageが無くてもbucketを残す）
    time_buckets = build_time_axis(granularity, start_time, end_time)

    # filter後の全rowを取得
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

    # agent一覧（全agentを残すため、optionsのagentも取り込む）
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

    # (agent_id, bucket) -> rows へグルーピング（count / sentiment 用、filter適用済み）
    grouped: Dict[tuple, List[Dict[str, Any]]] = {}
    for r in rows:
        key = (r["agent_id"], r["bucket"])
        grouped.setdefault(key, []).append(r)

    # semantic change 専用のグルーピング（time range のみ・filter非適用・順序固定）。
    # これで cosine similarity は keyword/message_type/agent sort/row order に依存しない。
    semantic_grouped: Dict[tuple, List[Dict[str, Any]]] = {}
    if mode == "semantic_change":
        for r in fetch_rows_for_semantic(granularity, start_time, end_time):
            key = (r["agent_id"], r["bucket"])
            semantic_grouped.setdefault(key, []).append(r)

    # cell embeddingを必要なときだけ計算するためのキャッシュ
    cell_embedding_cache: Dict[tuple, Optional[np.ndarray]] = {}

    def cell_embedding(agent_id: str, bucket: str) -> Optional[np.ndarray]:
        key = (agent_id, bucket)
        if key in cell_embedding_cache:
            return cell_embedding_cache[key]
        # semantic は full message text（content + 全inner thought）から計算する。
        # text source filter も無視して全文を使う（[] を渡すと全文扱い）。
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
        # cellに複数messageがある場合は平均値でcell sentiment scoreにする
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

            # BERT sentiment mode のときだけsentimentを計算する
            if mode == "sentiment" and message_count > 0:
                # merger_only等は既にfetch_all_rowsで適用済みなので、
                # ここでは現在見ているcellのmessageだけをBERTに渡している。
                cell["bert_sentiment_score"] = cell_sentiment(aid, bucket)

            cells.append(cell)

    # Semantic Change mode のときだけ、前後bucketとのcosine類似度を計算する
    if mode == "semantic_change":
        # cellを (agent_id, bucket_index) で引けるようにする
        cell_lookup = {(c["agent_id"], c["bucket"]): c for c in cells}
        for agent in all_agents:
            aid = agent["agent_id"]
            for i, bucket in enumerate(time_buckets):
                c = cell_lookup[(aid, bucket)]
                cur = cell_embedding(aid, bucket)

                # previous time bucketとの比較
                if i > 0 and cur is not None:
                    prev_emb = cell_embedding(aid, time_buckets[i - 1])
                    if prev_emb is not None:
                        sim = float(cosine_similarity([cur], [prev_emb])[0][0])
                        c["cosine_similarity_prev"] = sim
                        # cosine similarityは意味の近さなので、1から引いてsemantic distanceにする
                        c["semantic_distance_prev"] = 1.0 - sim

                # next time bucketとの比較
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
        # 既存frontend互換のため buckets も time_buckets も両方返す
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


# market_snapshot.sentiment のラベルを可視化用の数値(-1〜1)に変換するマップ。
# JSON内のmarket sentiment labelをそのまま使い、BERTでは再計算しない。
SENTIMENT_LABEL_TO_VALUE = {
    "positive": 1.0,
    "recovering": 0.5,
    "optimistic": 0.5,
    "neutral": 0.0,
    "cautious": -0.25,
    "low": -0.4,
    "negative": -0.5,
    "critical": -1.0,
}


def market_sentiment_to_value(label: Optional[str]) -> Optional[float]:
    """market sentiment label を数値へ。未知ラベルや空は None。"""
    if not label:
        return None
    return SENTIMENT_LABEL_TO_VALUE.get(label.strip().lower())


@app.get("/api/line-chart")
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
    """
    Stock Price と Market Sentiment を、Heatmapと同じtime_bucketsで返すAPI。

    重要 (analysis correctness):
    - データは Round.environment_context.market_snapshot 由来の値のみを使う。
      stock_price と sentiment はどちらも round レベルの市場データなので、
      message filter（keyword / message_type / agent sort 等）には依存しない。
      time range だけが x 軸と表示範囲に影響する。
    - sentiment は BERT で再計算しない。market_snapshot の sentiment ラベルを
      可視化用に数値(-1〜1)へマップするだけ。
    - HeatmapとLine Chartで同じ time_buckets を使い x 軸を完全に揃える。

    注: message filter 系の query parameter は後方互換のため残しているが、
    line chart の計算には使用しない。
    """
    # Heatmapと共通の固定time axis
    time_buckets = build_time_axis(granularity, start_time, end_time)

    # bucketごとに stock price と market sentiment ラベルを Round から取る。
    # bucketに複数roundがある場合は時系列で最後の値を採用する。
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
            # market_snapshot 由来の sentiment（ラベル + 可視化用の数値）
            "market_sentiment_label": label or None,
            "market_sentiment_value": sent_val,
        })
        if price is not None:
            prev_price = price

    return {
        "time_buckets": time_buckets,
        "series": series,
        # 可視化側がラベル↔数値の対応を表示できるよう凡例も返す
        "sentiment_scale": SENTIMENT_LABEL_TO_VALUE,
    }


# recipients の role token → agent_id マップは上部の
# 「会話リンク解決」セクション (RECIPIENT_ROLE_TO_AGENT) に統合済み。


@app.get("/api/network")
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
      {_common_where_clause()}
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
      {_common_where_clause()}
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
      {_common_where_clause()}
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
    実際のmessageを返す。/api/network の edge_query / ajay_query と同じ
    マッチ条件を使い、集計せずmessageそのものを返す点だけが違う。

    target_agent_id == 'ajay' の場合は reply graph ではなく、Ajay mention
    ベースの inferred edge（/api/network の ajay_query）として扱う。
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

    if target_agent_id == "ajay":
        # Ajay は実データ上のAgentではない（mention-basedのinferred node）。
        # source agentのmessageのうち、'ajay'を言及しているものを返す。
        query = f"""
        MATCH (a:Agent)-[:SENT]->(m:Message)-[:IN_ROUND]->(r:Round)
        WHERE a.agent_id = $source_agent_id
          AND (toLower(coalesce(m.content, '')) CONTAINS 'ajay'
               OR toLower(coalesce(m.internal_reacting, '')) CONTAINS 'ajay'
               OR toLower(coalesce(m.internal_rationalizing, '')) CONTAINS 'ajay'
               OR toLower(coalesce(m.internal_deliberating, '')) CONTAINS 'ajay')
          {_common_where_clause()}
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
          {_common_where_clause()}
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


@app.get("/api/edge-messages")
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


@app.get("/api/ajay-timeline")
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
      {_common_where_clause()}
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


@app.get("/api/messages")
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


# ============================================================
# Message Context / Related Messages
# ============================================================
# 1つのmessageをクリックしたときに「なぜそのmessageが重要か」を理解できるよう、
# 関連messageをまとめて返す。MLは一切不要（responding_to / channel / agent /
# timestamp / round と crisis keyword だけで関連を判定する）。

# crisisに関係する重要語。selected message と関連messageで共有されていれば
# keyword_related として扱う。word-boundaryで照合する（"GO" が "going" に
# 誤マッチしないようにするため）。
CRISIS_KEYWORDS = [
    "embargo", "CivicLoom", "HarborCrest", "SaltWind", "GO", "staged",
    "anonymous", "legal", "NHPI", "Retention Optimizer", "PR-Intern",
    "intern", "side_huddle", "official_post", "personal_post",
]
_CRISIS_PATTERNS = [
    (kw, re.compile(r"\b" + re.escape(kw) + r"\b", re.IGNORECASE))
    for kw in CRISIS_KEYWORDS
]

# same channel context を集める時間窓（分）。
_CHANNEL_WINDOW_MINUTES = 120
# same agent / temporal neighbors で前後に取る件数。
_NEIGHBOR_COUNT = 3


def _keywords_in(text: str) -> List[str]:
    """text に含まれる crisis keyword を返す（出現順・重複なし）。"""
    if not text:
        return []
    found = []
    for kw, pat in _CRISIS_PATTERNS:
        if pat.search(text) and kw not in found:
            found.append(kw)
    return found


# ============================================================
# Ajay's hints timeline
# ============================================================
# Ajay はデータ上のAgentではなく、他agentのmessage/内部思考に引用・言及される
# だけの人物（CEO）。/api/network の "Ajay" 推論nodeは mention 数だけを見せていて
# 実際に何と言われたかが見えないため、'ajay' を含むmessageから引用符付きの
# フレーズを抜き出し、時系列で読めるようにする。

# 二重引用符で囲まれた4〜240文字のフレーズを拾う。厳密な帰属判定ではなく
# （どの引用符がAjayの発言かをNLPで判定してはいない）、"ajayを含むmessageの中で
# 引用されている文言" を素早く拾い読みするための heuristic。本文全体も
# 別途表示されるので、誤って無関係な引用を拾っても実害は小さい。
_QUOTE_SPAN_PATTERN = re.compile(r'"([^"]{4,240})"')


def extract_ajay_quotes(*texts: str) -> List[str]:
    """'ajay' を含むtext群から引用符付きフレーズを抽出する（重複除去・出現順）。"""
    quotes: List[str] = []
    for t in texts:
        if not t:
            continue
        for m in _QUOTE_SPAN_PATTERN.finditer(t):
            q = m.group(1).strip()
            if q and q not in quotes:
                quotes.append(q)
    return quotes


def _project_related(m: Dict[str, Any], relation_type: str, relation_reason: str) -> Dict[str, Any]:
    """関連messageを、frontendが期待する安定したshapeに整形する。"""
    return {
        "message_id": m.get("message_id"),
        "comm_id": m.get("comm_id"),
        "timestamp": m.get("timestamp"),
        "agent_id": m.get("agent_id"),
        "agent_label": m.get("agent_label"),
        "agent_role": m.get("agent_role"),
        "channel": m.get("channel"),
        "message_type": m.get("message_type"),
        "visibility": m.get("visibility"),
        "content": m.get("content"),
        "responding_to": m.get("responding_to") or "",
        "resolved_parent_id": m.get("resolved_parent_id") or "",
        "reply_kind": m.get("reply_kind") or "",
        "recipients": m.get("recipients"),
        "round_hour": m.get("round_hour"),
        "relation_type": relation_type,
        "relation_reason": relation_reason,
    }


def build_reply_thread(
    all_msgs: List[Dict[str, Any]],
    message_id: str,
) -> List[Dict[str, Any]]:
    """
    `resolved_parent_id` に基づく「会話スレッド」を組み立てる。
    （resolved_parent_id は responding_to の message-id / @role メンション / recipients を
      統合して解決した親。resolve_parent_links() で各 message に付与済みであること。）

    - 選択 message が返信してきた連鎖を root まで遡る（ancestors）
    - 選択 message 自身
    - 選択 message に（再帰的に）返信した全 message（descendants）
    を 1 本の会話として timestamp 順に返す。
    これが会話フロー popup の主役（「この message が他のどの message と繋がっているか」）。
    """
    by_id = {m["message_id"]: m for m in all_msgs}
    sel = by_id.get(message_id)
    if sel is None:
        return []

    def parent_of(m: Dict[str, Any]) -> str:
        return m.get("resolved_parent_id") or ""

    def link_reason(m: Dict[str, Any]) -> str:
        """この message が親にどう繋がっているかを人間可読の理由にする。"""
        pid = parent_of(m)
        if not pid:
            return "started the thread"
        target = by_id.get(pid)
        tlabel = target.get("agent_label") if target else None
        kind = m.get("reply_kind") or ""
        if kind == "direct":
            return f"direct reply to {tlabel}" if tlabel else "direct reply"
        if kind == "addressed":
            return f"addressed {tlabel}" if tlabel else "addressed an earlier speaker"
        return f"replied to {tlabel}" if tlabel else "reply in thread"

    # children index: resolved_parent_id -> [そのメッセージに返信した message...]
    children: Dict[str, List[Dict[str, Any]]] = {}
    for m in all_msgs:
        pid = parent_of(m)
        if pid:
            children.setdefault(pid, []).append(m)

    seen = {message_id}

    # 1) ancestors: resolved_parent_id を root まで遡る
    chain: List[Dict[str, Any]] = []
    cur = sel
    while True:
        pid = parent_of(cur)
        if not pid or pid not in by_id or pid in seen:
            break
        parent = by_id[pid]
        chain.append(parent)
        seen.add(pid)
        cur = parent
    ancestors = list(reversed(chain))  # root が先頭

    # 2) descendants: 選択 message への返信を再帰的に（BFSで安定順）
    descendants: List[Dict[str, Any]] = []
    queue = list(children.get(message_id, []))
    while queue:
        node = queue.pop(0)
        nid = node.get("message_id")
        if nid in seen:
            continue
        seen.add(nid)
        descendants.append(node)
        queue.extend(children.get(nid, []))

    # 3) まとめて 1 本の会話に（timestamp, comm_id でソート）
    thread_msgs = ancestors + [sel] + descendants
    thread_msgs.sort(key=lambda m: (m.get("timestamp") or "", m.get("comm_id") or 0))

    ancestor_ids = {m["message_id"] for m in ancestors}
    out = []
    for m in thread_msgs:
        mid = m.get("message_id")
        if mid == message_id:
            role, reason = "self", "selected message"
        elif mid in ancestor_ids:
            role, reason = "ancestor", link_reason(m)
        else:
            role, reason = "reply", link_reason(m)
        item = _project_related(m, role, reason)
        item["is_focus"] = (mid == message_id)
        out.append(item)
    return out


def _parse_ts(value: Optional[str]):
    """timestamp_raw ('2046-05-17T09:00:00') を datetime に。失敗時 None。"""
    if not value:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(value)
    except Exception:
        return None


def _empty_context(message_id: str) -> Dict[str, Any]:
    """messageが見つからない場合でもshapeを崩さない安全な空レスポンス。"""
    return {
        "found": False,
        "selected_message": None,
        "parent_message": None,
        "replies": [],
        "temporal_neighbors": [],
        "same_channel_context": [],
        "same_agent_context": [],
        "keyword_related": [],
        "all_related": [],
        "thread": [],
        "requested_message_id": message_id,
    }


def build_message_context(
    all_msgs: List[Dict[str, Any]],
    message_id: str,
    window_minutes: int = _CHANNEL_WINDOW_MINUTES,
    neighbor_count: int = _NEIGHBOR_COUNT,
) -> Dict[str, Any]:
    """
    全messageのlist（timestamp昇順）と対象message_idから関連messageを構築する。
    Neo4jから切り離した純粋関数なのでテストしやすい。
    """
    by_id = {m["message_id"]: m for m in all_msgs}
    sel = by_id.get(message_id)
    if sel is None:
        return _empty_context(message_id)

    # timestamp + message_id で安定ソート
    ordered = sorted(all_msgs, key=lambda m: (m.get("timestamp") or "", m.get("message_id") or ""))

    round_hour = sel.get("round_hour")
    channel = sel.get("channel")
    agent_id = sel.get("agent_id")
    sel_dt = _parse_ts(sel.get("timestamp"))
    sel_keywords = _keywords_in(sel.get("content") or "")

    # 1. parent: resolved_parent_id が指すmessage（responding_to の @role / recipients も解決済み）
    parent = None
    pid = sel.get("resolved_parent_id") or ""
    if pid and pid in by_id and pid != message_id:
        kind = sel.get("reply_kind") or ""
        reason = "direct reply target" if kind == "direct" else (
            "addressed earlier speaker" if kind == "addressed" else "parent message")
        parent = _project_related(by_id[pid], "parent", reason)

    # 2. replies: resolved_parent_id == 選択message（この message に返信した全 message）
    replies = [
        _project_related(m, "reply", "direct reply" if (m.get("reply_kind") == "direct") else "addressed reply")
        for m in ordered
        if (m.get("resolved_parent_id") or "") == message_id
    ]

    # 3. temporal neighbors: 同じround内で timestamp 順に前後 neighbor_count 件
    round_msgs = [m for m in ordered if m.get("round_hour") == round_hour]
    temporal_neighbors = []
    sel_idx = next((i for i, m in enumerate(round_msgs) if m["message_id"] == message_id), None)
    if sel_idx is not None:
        nb = round_msgs[max(0, sel_idx - neighbor_count):sel_idx] + \
             round_msgs[sel_idx + 1:sel_idx + 1 + neighbor_count]
        temporal_neighbors = [_project_related(m, "temporal", "same round context") for m in nb]

    # 4. same channel context: 同じchannel かつ 時間窓内（時間が近い順に最大8件）
    same_channel_context = []
    if sel_dt is not None and channel:
        candidates = []
        for m in ordered:
            if m["message_id"] == message_id or m.get("channel") != channel:
                continue
            mdt = _parse_ts(m.get("timestamp"))
            if mdt is None:
                continue
            delta = abs((mdt - sel_dt).total_seconds())
            if delta <= window_minutes * 60:
                candidates.append((delta, m))
        # 時間が近い順に絞り、表示用に再度timestamp順へ
        candidates.sort(key=lambda x: x[0])
        nearest = [m for _, m in candidates[:8]]
        nearest.sort(key=lambda m: (m.get("timestamp") or "", m.get("message_id") or ""))
        same_channel_context = [
            _project_related(m, "same_channel", "same channel within time window")
            for m in nearest
        ]

    # 5. same agent context: 同じagentの timestamp 順 前後 neighbor_count 件
    agent_msgs = [m for m in ordered if m.get("agent_id") == agent_id]
    same_agent_context = []
    aidx = next((i for i, m in enumerate(agent_msgs) if m["message_id"] == message_id), None)
    if aidx is not None:
        an = agent_msgs[max(0, aidx - neighbor_count):aidx] + \
             agent_msgs[aidx + 1:aidx + 1 + neighbor_count]
        same_agent_context = [_project_related(m, "same_agent", "same agent nearby") for m in an]

    # 6. keyword related: 同じround内で、選択messageと共有するcrisis keywordを含むmessage
    keyword_related = []
    if sel_keywords:
        for m in round_msgs:
            if m["message_id"] == message_id:
                continue
            shared = [kw for kw in sel_keywords if _keywords_in(m.get("content") or "").count(kw)]
            if shared:
                keyword_related.append(
                    _project_related(m, "keyword", f"shared crisis keyword: {shared[0]}")
                )
        keyword_related = keyword_related[:10]

    # all_related: 優先順位順に flatten して message_id で dedupe（選択message自身は除外）
    all_related = []
    seen = {message_id}
    for group in ([parent] if parent else [], replies, temporal_neighbors,
                  keyword_related, same_channel_context, same_agent_context):
        for item in group:
            mid = item["message_id"]
            if mid in seen:
                continue
            seen.add(mid)
            all_related.append(item)
    all_related.sort(key=lambda x: (x.get("timestamp") or "", x.get("message_id") or ""))

    # selected message に "why this matters" を付与（channel / keyword / thread から生成）
    reasons = []
    if channel in ("side_huddle", "anonymous_post"):
        reasons.append(f"it occurs in {channel}")
    if sel_keywords:
        reasons.append(f"it contains {sel_keywords[0]}-related language")
    if replies:
        reasons.append(f"it received {len(replies)} repl{'y' if len(replies) == 1 else 'ies'}")
    if parent:
        reasons.append("it is part of an ongoing thread")
    if reasons:
        why = "This message matters because " + ", and ".join(reasons) + "."
    else:
        why = "No strong contextual signals were detected for this message."

    selected_message = _project_related(sel, "selected", "selected message")
    selected_message["why_matters"] = why
    # 選択message本体は internal state も見られると便利なので付ける（任意フィールド）
    selected_message["internal_reacting"] = sel.get("internal_reacting")
    selected_message["internal_rationalizing"] = sel.get("internal_rationalizing")
    selected_message["internal_deliberating"] = sel.get("internal_deliberating")

    return {
        "found": True,
        "selected_message": selected_message,
        "parent_message": parent,
        "replies": replies,
        "temporal_neighbors": temporal_neighbors,
        "same_channel_context": same_channel_context,
        "same_agent_context": same_agent_context,
        "keyword_related": keyword_related,
        "all_related": all_related,
        "requested_message_id": message_id,
    }


def _fetch_all_messages_for_context() -> List[Dict[str, Any]]:
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


@app.get("/api/messages/{message_id}/context")
def message_context(message_id: str):
    """
    1つのmessageの「文脈（関連message）」を返すAPI。
    - parent / replies / temporal_neighbors / same_channel_context /
      same_agent_context / keyword_related / all_related を含む。
    - messageが存在しない場合も 200 で安全な空shapeを返す。
    - ML modelには依存しない。
    """
    try:
        all_msgs = _fetch_all_messages_for_context()
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


@app.get("/api/rounds")
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


@app.get("/api/keywords")
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


# all-miniLM-L6-v2 を使った close / far keyword 抽出（既存ロジック）
def extract_embedding_keywords(
        texts: list[str],
        top_n: int = 10,
        mode: str = "close"
) -> dict:
    # 出力は far_keywords / close_keywords の辞書で返す。
    clean_text = []
    for text in texts:
        if text and text.strip():
            clean_text.append(text.strip())

    if not clean_text:
        return {"close_keywords": [], "far_keywords": []}

    full_text = " ".join(clean_text)

    vectorizer = CountVectorizer(
        stop_words="english",
        ngram_range=(1, 2),
        min_df=1
    )
    counts = vectorizer.fit_transform([full_text])
    candidates = vectorizer.get_feature_names_out()
    if len(candidates) == 0:
        return {"close_keywords": [], "far_keywords": []}

    model = get_embedding_model()
    if model is None:
        # ML(embedding)が使えない環境向けのfallback: CountVectorizerの単純な
        # 出現頻度でkeywordをランク付けする。similarity/distanceは頻度を
        # 0〜1に正規化した値を使い、API response shapeは維持する。
        freqs = np.asarray(counts.sum(axis=0)).flatten().astype(float)
        max_freq = float(freqs.max()) if freqs.size else 0.0
        keyword_scores = []
        for candidate, f in zip(candidates, freqs):
            norm = (f / max_freq) if max_freq > 0 else 0.0
            keyword_scores.append({
                "keyword": candidate,
                "similarity": float(norm),
                "distance": float(1.0 - norm),
            })
        close_keywords = sorted(
            keyword_scores, key=lambda x: x["similarity"], reverse=True
        )[:top_n]
        far_keywords = sorted(
            keyword_scores, key=lambda x: x["similarity"]
        )[:top_n]
        if mode == "close":
            return {"close_keywords": close_keywords, "far_keywords": []}
        if mode == "far":
            return {"close_keywords": [], "far_keywords": far_keywords}
        return {"close_keywords": close_keywords, "far_keywords": far_keywords}

    document_embedding = model.encode([full_text])
    candidate_embedding = model.encode(candidates)

    # cosine_similarityは二つのベクトルがどれだけ同じ方向を向いているかを出すもの。
    similarities = cosine_similarity(
        candidate_embedding,
        document_embedding
    ).flatten()
    # distance は 1 - similarity として計算している（意味の近さ→遠さ）

    keyword_scores = []
    for candidate, score in zip(candidates, similarities):
        keyword_scores.append({
            "keyword": candidate,
            "similarity": float(score),
            "distance": float(1 - score),
        })

    close_keywords = sorted(
        keyword_scores,
        key=lambda x: x["similarity"],
        reverse=True
    )[:top_n]

    far_keywords = sorted(
        keyword_scores,
        key=lambda x: x["similarity"]
    )[:top_n]

    if mode == "close":
        return {"close_keywords": close_keywords, "far_keywords": []}
    if mode == "far":
        return {"close_keywords": [], "far_keywords": far_keywords}
    return {"close_keywords": close_keywords, "far_keywords": far_keywords}

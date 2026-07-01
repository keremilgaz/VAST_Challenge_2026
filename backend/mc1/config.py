# ============================================================
# 設定値・定数 (constants / configuration)
# ============================================================
# 旧 main.py の先頭〜各所に散らばっていた定数を1か所に集約したモジュール。
# 値は一切変更していない。

import os
from pathlib import Path

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


# ============================================================
# 会話リンク解決で使う recipient role → agent_id マップ
# ============================================================
# `responding_to` の @role メンションや recipients の role token を
# 実際の agent_id に変換するための対応表。
RECIPIENT_ROLE_TO_AGENT = {
    "legal": "legal_agent",
    "pr": "pr_agent",
    "platform_trust": "quality_agent",
    "social_manager": "social_media_agent",
    "pr_intern": "pr_intern_agent",
    "intern": "intern_agent",
    "judge": "judge_agent",
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


# ============================================================
# Message Context / Related Messages 用の定数
# ============================================================
# crisisに関係する重要語。selected message と関連messageで共有されていれば
# keyword_related として扱う。word-boundaryで照合する（"GO" が "going" に
# 誤マッチしないようにするため）。
CRISIS_KEYWORDS = [
    "embargo", "CivicLoom", "HarborCrest", "SaltWind", "GO", "staged",
    "anonymous", "legal", "NHPI", "Retention Optimizer", "PR-Intern",
    "intern", "side_huddle", "official_post", "personal_post",
]

# same channel context を集める時間窓（分）。
CHANNEL_WINDOW_MINUTES = 120
# same agent / temporal neighbors で前後に取る件数。
NEIGHBOR_COUNT = 3

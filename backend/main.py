# ============================================================
# FastAPI エントリポイント (uvicorn main:app)
# ============================================================
# 旧 main.py（約2500行のモノリス）は mc1/ パッケージに分割した:
#   mc1/config.py     … 定数・設定値
#   mc1/db.py         … Neo4j driver
#   mc1/nlp.py        … embedding / sentiment / keyword 抽出
#   mc1/domain.py     … 純粋ヘルパー + Cypher 共通句 + 会話リンク解決
#   mc1/importer.py   … JSON -> Neo4j インポート
#   mc1/queries.py    … Neo4j 読み取りクエリ
#   mc1/context.py    … Message Context / Related Messages
#   mc1/routers/*.py  … API エンドポイント（meta / heatmap / network / messages）
#
# このファイルは app を組み立てるだけ:
#   FastAPI 生成 + CORS + startup event + include_router。
# エンドポイントの path / response shape / ロジックは一切変更していない。

# Reactなど別URLのfrontendからAPIを呼べるようにするCORS設定
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from mc1.db import get_driver, wait_for_neo4j
from mc1.importer import reset_and_import
from mc1.routers import meta, heatmap, network, messages


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


# 各機能ごとのルーターを1つのappに束ねる
app.include_router(meta.router)
app.include_router(heatmap.router)
app.include_router(network.router)
app.include_router(messages.router)


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

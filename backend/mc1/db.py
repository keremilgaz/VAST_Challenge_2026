# ============================================================
# Neo4j 接続 (database driver)
# ============================================================
# 旧 main.py の get_driver / wait_for_neo4j をそのまま移動したモジュール。

import time

# Neo4jに接続するための公式ドライバー
from neo4j import GraphDatabase

from .config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD


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

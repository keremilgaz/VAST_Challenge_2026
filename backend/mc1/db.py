
import time

from neo4j import GraphDatabase

from .config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD

driver = None

def get_driver():
    global driver
    if driver is None:
        driver = GraphDatabase.driver(
            NEO4J_URI,
            auth=(NEO4J_USER, NEO4J_PASSWORD)
        )
    return driver

def wait_for_neo4j(max_seconds: int = 90):
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

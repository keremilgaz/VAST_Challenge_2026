# ============================================================
# ============================================================
#   mc1/db.py         … Neo4j driver
#   mc1/context.py    … Message Context / Related Messages
#

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from mc1.db import get_driver, wait_for_neo4j
from mc1.importer import reset_and_import
from mc1.routers import meta, heatmap, network, messages


app = FastAPI(title="Agent Heatmap + Network Prototype (VAST MC1)")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(meta.router)
app.include_router(heatmap.router)
app.include_router(network.router)
app.include_router(messages.router)


@app.on_event("startup")
def startup_event():
    wait_for_neo4j()

    with get_driver().session() as session:
        count = session.run(
            "MATCH (m:Message) RETURN count(m) AS c"
        ).single()["c"]

    if count == 0:
        reset_and_import()

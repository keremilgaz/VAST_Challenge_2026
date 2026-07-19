# Agent Heatmap + Network (VAST Challenge MC1)

A single-screen visual analytics dashboard for the VAST Challenge MC1 multi-agent
crisis dataset. It shows, on one filtered view:

- a **heatmap** of agent activity over time (colored by message count, BERT
  sentiment, or semantic change),
- a **stock price / text-derived sentiment line chart** aligned to the same time
  buckets,
- a **communication network** built from `responding_to` reply relationships,
- a **message detail panel** that lists the messages behind any clicked cell, and
- a **Message Context / Related Messages** view that explains *why* a clicked
  message matters by surfacing its thread, neighbors, and crisis-keyword links.

## Stack

- **Frontend:** React + Vite
- **Backend:** FastAPI
- **Database:** Neo4j (data imported from `data/MC1_final_00.json` on first start)
- Orchestrated with Docker Compose.

## Run with Docker

```bash
docker compose up --build
```

On first start the backend waits for Neo4j to become healthy, then imports the
MC1 JSON into Neo4j automatically. Subsequent starts reuse the existing data.

### URLs

| Service        | URL                        |
| -------------- | -------------------------- |
| Frontend       | http://localhost:5173      |
| Backend (API)  | http://localhost:8000      |
| Backend health | http://localhost:8000/api/health |
| Neo4j Browser  | http://localhost:7474      |
| Neo4j Bolt     | bolt://localhost:7687      |

Neo4j credentials (dev default): `neo4j` / `password123`.

## Message Context / Related Messages

Click a heatmap cell to list its messages, then click any message to open its
**Context** section. The backend endpoint:

```
GET /api/messages/{message_id}/context
```

returns the selected message plus related messages grouped as:

- `parent_message` – the message referenced by `responding_to`
- `replies` – messages whose `responding_to` is the selected message
- `temporal_neighbors` – previous/next messages in the same round
- `same_channel_context` – nearby messages in the same channel (time-windowed)
- `same_agent_context` – the same agent's previous/next messages
- `keyword_related` – same-round messages sharing a crisis keyword
- `all_related` – flattened, de-duplicated union of the above

Each related item carries `relation_type` and a human-readable `relation_reason`,
and the selected message carries a heuristic `why_matters` explanation. This
feature uses only graph structure, timestamps, channels, and a fixed crisis
keyword list — **no ML model is required**.

## Fast mode vs. ML features

The default backend image is intentionally lightweight (no `torch` /
`transformers` / `sentence-transformers`). Semantic-embedding and BERT-sentiment
features **gracefully degrade** to frequency-based keywords and a lexicon
sentiment fallback. To enable the full ML features, install the optional extras
inside the backend image:

```bash
pip install -r requirements.txt -r requirements-ml.txt
```

## Known limitations

- In fast mode, semantic-change heatmap values are empty and keyword/sentiment
  use lightweight fallbacks (lower quality, identical API shapes).
- Neo4j data import runs once on first start; use `POST /admin/reload` to
  re-import after changing the source JSON.
- `same_channel_context` is capped to the nearest 8 messages and
  `keyword_related` to 10 to keep the panel readable.
- Dev-only Neo4j credentials are hard-coded in `docker-compose.yml`; change them
  before any non-local use.

## Credits

Agent identity icons use [Twemoji](https://github.com/jdecked/twemoji) graphics,
Copyright Twitter, Inc and other contributors, licensed under
[CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The SVGs are inlined as data URIs in `frontend/src/agentIcons.jsx` (no runtime
network fetch, no OS emoji-font dependency).

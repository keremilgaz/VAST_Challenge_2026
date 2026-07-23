# ============================================================
# ============================================================

import os
from pathlib import Path

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password123")

DATA_PATH = Path(os.getenv("DATA_PATH", "/app/data/MC1_final_00.json"))


MERGER_KEYWORDS = [
    "merger",
    "civicloom",
    "elenamarquez",  # CEO of CivicLoom
    "harborcrest",   # project name
    "embargo",
]

TEXT_SOURCE_OPTIONS = ["content", "reacting", "rationalizing", "deliberating"]


# ============================================================
# ============================================================
RECIPIENT_ROLE_TO_AGENT = {
    "legal": "legal_agent",
    "pr": "pr_agent",
    "platform_trust": "quality_agent",
    "social_manager": "social_media_agent",
    "pr_intern": "pr_intern_agent",
    "intern": "intern_agent",
    "judge": "judge_agent",
}


# ============================================================
# ============================================================
#   "Judge — SaltWind published the merger. ..."   (#803, 6/5 17:01)
#   "Legal, can you confirm ..."
def _vocative_pattern(*aliases: str) -> str:
    alt = "|".join(aliases)
    return rf"(?is)^\s*@?(?:{alt})\s*(?:—|–|::?|,|-{{1,2}})\s.*"


AGENT_VOCATIVE_PATTERNS = {
    "legal_agent": _vocative_pattern("legal"),
    "pr_agent": _vocative_pattern("pr"),
    "quality_agent": _vocative_pattern("platform_trust", "platform-trust", "platform trust"),
    "social_media_agent": _vocative_pattern("social_manager", "social-manager", "social manager"),
    "pr_intern_agent": _vocative_pattern("pr_intern", "pr-intern"),
    "intern_agent": _vocative_pattern("intern"),
    "judge_agent": _vocative_pattern("judge"),
}


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
# ============================================================
CRISIS_KEYWORDS = [
    "embargo", "CivicLoom", "HarborCrest", "SaltWind", "GO", "staged",
    "anonymous", "legal", "NHPI", "Retention Optimizer", "PR-Intern",
    "intern", "side_huddle", "official_post", "personal_post",
]

CHANNEL_WINDOW_MINUTES = 120
NEIGHBOR_COUNT = 3

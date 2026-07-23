
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
    if channel == "official_post" or message_type == "public_post":
        return "external"
    return "internal"

def is_merger_related(*texts: str) -> bool:
    haystack = " ".join(t or "" for t in texts).lower()

    keywords = [k.lower() for k in MERGER_KEYWORDS]

    return any(k in haystack for k in keywords)

def parse_stock_price(value: Any) -> Optional[float]:
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
    with DATA_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)

def normalize_message_types(message_types: Optional[list[str]], message_type: str = "all") -> list[str]:
    selected = [t for t in (message_types or []) if t and t != "all"]

    if not selected and message_type and message_type != "all":
        selected = [message_type]

    return selected

def normalize_text_sources(text_sources: Optional[list[str]]) -> list[str]:
    return [
        source
        for source in (text_sources or [])
        if source in TEXT_SOURCE_OPTIONS
    ]

def merger_filter_clause() -> str:
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
    if granularity == "daily":
        return "substring(m.timestamp_raw, 0, 10)"
    return "substring(m.timestamp_raw, 0, 13) + ':00:00'"

def round_bucket_expression(granularity: str) -> str:
    if granularity == "daily":
        return "substring(r.hour, 0, 10)"
    return "substring(r.hour, 0, 13) + ':00:00'"

def common_where_clause() -> str:
    return f"""
      {merger_filter_clause()}
      AND (size($message_types) = 0
           OR (coalesce(m.channel, '') + '|' + coalesce(m.message_type, '')) IN $message_types)
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

_MENTION_RE = re.compile(r"@([A-Za-z_]+)")

def _coerce_recipients(value: Any) -> List[str]:
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
    out: List[str] = []
    for tok in _MENTION_RE.findall(text or ""):
        agent = RECIPIENT_ROLE_TO_AGENT.get(tok.lower())
        if agent and agent not in out:
            out.append(agent)
    return out

def recipient_target_agents(recipients: Any) -> List[str]:
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
            parent_id, kind = rt, "direct"
        else:
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
                kind = "root"

        m["resolved_parent_id"] = parent_id
        m["reply_kind"] = kind

    return all_msgs

def combine_cell_texts(rows: List[Dict[str, Any]], selected_text_sources: List[str]) -> List[str]:
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
    if not label:
        return None
    return SENTIMENT_LABEL_TO_VALUE.get(label.strip().lower())

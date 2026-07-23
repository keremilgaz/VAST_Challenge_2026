
import hashlib
from typing import Dict, List, Optional

from sklearn.feature_extraction.text import CountVectorizer, HashingVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

_embedding_model = None
_embedding_model_failed = False

_embedding_cache: Dict[str, np.ndarray] = {}

_sentiment_cache: Dict[str, float] = {}

_sentiment_pipeline = None
_sentiment_pipeline_failed = False

def _text_hash(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()

def get_embedding_model():
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

_fallback_vectorizer = HashingVectorizer(
    n_features=512,
    analyzer="char_wb",
    ngram_range=(3, 5),
    alternate_sign=False,
    norm="l2",
)

def _fallback_embedding(text: str) -> Optional[np.ndarray]:
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
            pass

    emb = _fallback_embedding(text)
    _embedding_cache[key] = emb
    return emb

def get_sentiment_pipeline():
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
        _sentiment_pipeline_failed = True
        _sentiment_pipeline = None
    return _sentiment_pipeline

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
    tokens = [t.strip(".,!?;:'\"()").lower() for t in text.split()]
    pos = sum(1 for t in tokens if t in _POS_WORDS)
    neg = sum(1 for t in tokens if t in _NEG_WORDS)
    if pos + neg == 0:
        return 0.0
    return (pos - neg) / (pos + neg)

def sentiment_score(text: str) -> Optional[float]:
    if not text or not text.strip():
        return None
    key = _text_hash(text)
    if key in _sentiment_cache:
        return _sentiment_cache[key]

    pipe = get_sentiment_pipeline()
    if pipe is not None:
        try:
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

def extract_embedding_keywords(
        texts: list[str],
        top_n: int = 10,
        mode: str = "close"
) -> dict:
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

    similarities = cosine_similarity(
        candidate_embedding,
        document_embedding
    ).flatten()

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

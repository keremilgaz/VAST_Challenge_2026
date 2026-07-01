# ============================================================
# NLP系（embedding / sentiment / keyword 抽出）
# ============================================================
# 旧 main.py の NLP 関連（embedding model / sentiment pipeline / lexicon fallback /
# extract_embedding_keywords）をそのまま移動したモジュール。
#
# sentence_transformers / torch / transformers はトップレベルでimportしない
# （起動を遅くしDLを誘発するため）。model は get_*() で遅延ロードし、利用不可なら fallback する。

import hashlib
from typing import Dict, List, Optional

from sklearn.feature_extraction.text import CountVectorizer, HashingVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np


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

# VAST MC1 backend パッケージ。
# main.py（uvicorn main:app のエントリ）が、このパッケージ内の
# config / db / nlp / domain / queries / importer / context / routers を組み合わせて
# FastAPI app を構築する。ロジックは旧 main.py から一切変更せずに分割しただけ。

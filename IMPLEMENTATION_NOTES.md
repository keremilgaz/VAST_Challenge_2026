# VAST MC1 — 統合分析画面 / 実装メモ (Implementation Notes)

既存の React / FastAPI / Neo4j / Docker Compose ヒートマップアプリを、1画面の統合分析ビューに拡張しました。
既存のヒートマップ機能・UI・ロジック（keyword search / sorting / merger filter / text source filter / cell click → message detail）は維持しています。

## 起動方法

```bash
docker compose up --build      # 初回 / 依存変更後
docker compose up              # 通常起動
docker compose up -d           # バックグラウンド
docker compose ps
docker compose logs backend
docker compose logs frontend
docker compose logs neo4j
```

- Frontend: http://localhost:5173
- Backend (FastAPI): http://localhost:8000
- Neo4j: http://localhost:7474 (bolt 7687, neo4j / password123)

初回起動後、UI右上の **Reload DB** を押すと Neo4j に拡張スキーマ（reply graph + parsed stock price）が再構築されます。

> 注: BERT sentiment モデル (`distilbert-base-uncased-finetuned-sst-2-english`) と
> embedding モデル (`all-MiniLM-L6-v2`) は backend コンテナ初回利用時に HuggingFace から
> ダウンロードされます。ネット接続が無い環境では sentiment は自動で軽量な lexicon fallback に切り替わります。

## 追加 / 変更点の要約

- **Heatmap mode**: count / BERT sentiment / semantic change を切替（`/api/heatmap?mode=`）。
- **Empty cells / fixed time axis**: 全 agent × 全 time bucket を返し、空セル・空バケットも保持。
- **HeatmapとLine Chartのtime axis共通化**: 両方が同じ `time_buckets` を使用し、cell幅・left marginを揃えてx軸を視覚的に整列。
- **Message Detail Panel**: Heatmapの真下、collapsible、内部だけスクロール、選択セルを保持。`ORDER BY keyword_score DESC, timestamp` を維持。
- **Line Chart**: Detail Panelの下。Stock Price と BERT Text Sentiment を別チェックボックスで表示切替、%増減をhover表示。
- **Network**: CrisisNet.html のd3描画ロジックを React component (`network.jsx`) に移植（iframe不使用）。reply graph。Heatmapと同じfilterを適用。
- **Apply heatmap sorting to network** トグル: ON で network 操作をグレーアウトし heatmap sort を使用。
- **close / far keyword chips** をクリック可能にし、既存 keyword search handler (`setSearchKeyword`) を再利用。
- **Global visibility checkboxes**（最上部）で Heatmap / Line Chart / Network を表示/非表示。state は保持。

## Draft implementation notes（暫定実装にした箇所）

以下は仕様が曖昧、または JSON 構造から一意に決められなかったため、暫定的に実装した箇所です。

1. **Stock price の time bucket 対応**
   JSON の `environment_context.market_snapshot.stock_price` は round（hour）単位の文字列（例 `"$38.70"`, `null`, `"$180"`）。
   各 time bucket の株価は、そのバケットに属する round のうち **最後の non-null 値** を採用しました。
   `"$180"`（2046-06-05T11付近）は前後と桁が大きく異なるデータ由来のアーティファクト（SaltWind valuation の見出し）と判断し、フィルタせずそのまま表示しています。

2. **Stock price のパース**
   `"$38.70"` のような文字列から `$` とカンマを除去して float 化。`null` / 空 / 非数値は `None`（線は途切れる）として扱います。

3. **BERT sentiment の集約方法**
   cell / time bucket 内の各 message テキストを sentiment model に通し、その **平均値** を cell / bucket の score にしています（weighted average ではなく単純平均）。
   sentiment は `[-1, 1]` に正規化（positive 確率 → `2p - 1`）。
   JSON 内の stock sentiment score は **使用していません**（仕様通り）。

4. **BERT モデルと fallback**
   `distilbert-base-uncased-finetuned-sst-2-english` を使用。`transformers` / `torch` が利用不可の環境では、
   ポジ/ネガ語彙による簡易 lexicon スコアに自動フォールバックします（Docker イメージサイズ・オフライン耐性のため）。

5. **Semantic change の「前/次」**
   calendar day ではなく、**現在の heatmap time bucket の1つ前 / 1つ後の bucket** と比較しています。
   各 cell のテキスト（text source filter 準拠で content + inner thoughts を結合）を embedding 化し、cosine similarity を計算。
   `semantic_distance = 1 - cosine_similarity`。距離が大きいほど濃色。比較対象が空なら null（neutral 表示）。

6. **Network edge の定義**
   既存 HTML（CrisisNet）の reply ベースのグラフに合わせ、**message の `responding_to` を使った reply graph**（返信元の sender → 返信先 message の sender）として実装しました。
   edge weight = その方向の返信数。merger replies = 返信のうち merger-related な数。
   node size metric: messages / merger-related / |sentiment|。

7. **recipient role → agent_id のマッピング**
   `recipients` は role トークン（`legal`, `pr`, `platform_trust`, `social_manager`, `pr_intern`, `intern`, `judge`）で入っていたため、
   対応する agent_id（`legal_agent` 等）へマッピングしています。ただし最終的な network edge は上記 reply graph を主軸にしています。

8. **Heatmap sort キーと network への対応**
   heatmap sort key は `agent_id` / `total messages` / `mean sentiment` の3種。
   "Apply heatmap sorting to network" ON 時は、`total → node size = messages`、`sentiment → node size = sentiment`、`agent_id → messages` にマップしています
   （ネットワークは行の並びではなく node の見た目に sort 概念を反映する形）。

9. **keyword あり時の heatmap count**
   既存仕様どおり、keyword が入力されている場合 cell count は通常メッセージ数ではなく **keyword 一致メッセージ数** です。

## 確定実装（draftではない部分）

- `MERGER_KEYWORDS = ["merger", "civicloom", "elenamarquez", "harborcrest", "embargo"]`（`"merge"` は emergency 誤ヒットのため除外）を維持。
- `is_merger_related()` / `merger_filter_clause()` / `keyword_filter_clause()` / `keyword_score_expression()`（content +4 / reacting +3 / rationalizing +2 / deliberating +1）を維持。
- `merger_only` / keyword / time range / text sources / visibility / message types を Heatmap・Line Chart・Network・Sentiment・Semantic Change の全てに一貫適用。
- `/api/options` の既存フィールド（merger_count / internal_merger_count / combined_merger_count / merger_keywords / total_count / min_time / max_time など）を維持。

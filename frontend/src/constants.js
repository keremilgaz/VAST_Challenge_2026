// ============================================
// App と各コンポーネントで共有する定数
// ============================================
// 旧 main.jsx の先頭に散らばっていた共有定数を1か所に集約したモジュール。値は不変。

// FastAPIのURL。Vite環境変数があればそれを使う。
export const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// text sourceの内部名 → 表示名
export const TEXT_SOURCE_LABELS = {
  content: 'Message content',
  reacting: 'Inner thought: reacting',
  rationalizing: 'Inner thought: rationalizing',
  deliberating: 'Inner thought: deliberating',
};

// message type の visibility グループ分け。
// backend の infer_visibility と一致させる:
//   external = official_post channel もしくは public_post message_type。
//   data 上 external な message_type は public_post のみなので、それを external グループに置く。
// これにより旧「Internal / External」select を廃止し、Message types filter 1つに統合する。
export const EXTERNAL_MESSAGE_TYPES = ['public_post'];
export const visibilityGroupOf = (t) => (EXTERNAL_MESSAGE_TYPES.includes(t) ? 'external' : 'internal');

// ============================================
// Heatmap cell size (CSS変数的に1か所で管理)
// ============================================
// 既存より小さくして、より多くのtime bucketsを一画面で見られるようにする。
// 小さすぎてクリックできないサイズにはしない。
export const CELL = {
  daily: { w: 46, h: 26 },
  hourly: { w: 52, h: 26 },
};
export const LABEL_COL = 150; // agent label列の幅。Line Chartのleft marginにも使う。

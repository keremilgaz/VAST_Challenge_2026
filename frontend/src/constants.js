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

// message channel の visibility グループ分け。
// backend の infer_visibility と一致させる:
//   external = 公開投稿系 channel（personal_post / official_post / anonymous_post）。
//   （これらは message_type = public_post に対応し、backend 上も external 判定になる。）
//   それ以外（comms_huddle / one_on_one_chat / side_huddle）は internal。
// フィルタは message_type ではなく message_channel を対象にする（channel 単位で絞り込む）。
export const EXTERNAL_CHANNELS = ['personal_post', 'official_post', 'anonymous_post'];
export const visibilityGroupOf = (ch) => (EXTERNAL_CHANNELS.includes(ch) ? 'external' : 'internal');

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

// ============================================
// MC1 anlatısının çıpa olayları (event markers)
// ============================================
// Timeline / line chart / heatmap'te dikey işaret olarak gösterilir; jürinin
// "olay nerede?" diye aramasına gerek kalmaz. Zamanlar MC1 brief'inden:
// ambargo 5 Haziran 2046 18:00'de kalkacaktı, sızıntı ~17:00'de başladı.
export const EVENT_MARKERS = [
  { id: 'leak',    time: '2046-06-05T17:00:00', short: 'leak',    label: 'Leak: embargoed info appears on FleX (~17:00)', color: '#e24b4a' },
  { id: 'embargo', time: '2046-06-05T18:00:00', short: 'embargo', label: 'Embargo lifts (June 5, 18:00)',                 color: '#f59e0b' },
];

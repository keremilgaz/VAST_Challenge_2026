// ============================================
// 純粋なユーティリティ関数（時間表示 / cell色 / 数値フォーマット）
// ============================================
// 旧 main.jsx に散らばっていた純粋関数を集約したモジュール。React に依存しない。値/ロジックは不変。

// ============================================
// 時間表示を短くする
// ============================================
export function shortBucket(bucket, granularity) {
  if (!bucket) return '';
  if (granularity === 'daily') {
    const [, m, d] = bucket.split('-');
    return `${Number(m)}/${Number(d)}`;
  }
  if (granularity === 'hourly') {
    return `${bucket.slice(5, 10)} ${bucket.slice(11, 16)}`;
  }
  return bucket;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtRoundLabel(hour) {
  if (!hour) return '';
  const [date, time] = hour.split('T');
  const [, m, d] = date.split('-');
  const hh = (time || '').slice(0, 5);
  return `${MONTHS[Number(m) - 1]} ${Number(d)} · ${hh}`;
}

// ============================================
// 各heatmap modeのcell色
// ============================================
// count: メッセージ数（keywordありのときはkeyword一致数）の青系グラデーション
// 白→青の連続カラーマップ（sequential single-hue）。
// 直感的（薄い=少ない / 濃い青=多い）で、暗い背景でも低カウントが白く浮くため見分けやすい。
// 濃端は背景ネイビーに沈まない鮮やかな青で止める。空セル(0)は別の暗色にして「data無し」と区別。
const BLUES = [
  [240, 246, 255], // #f0f6ff  ほぼ白（わずかに青み）
  [200, 223, 248], // #c8dff8
  [147, 190, 236], // #93beec
  [85, 143, 216],  // #558fd8
  [26, 92, 192],   // #1a5cc0  鮮やかな青
];
export function bluesRGB(t) {
  const x = Math.max(0, Math.min(1, t)) * (BLUES.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = BLUES[i], b = BLUES[Math.min(i + 1, BLUES.length - 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function countColor(count, max) {
  if (!count || !max) return { bg: '#10202f', opacity: 1, fg: '#8fb2d8' };
  // log1p で少数の差を強調し、その値を白→青ランプに通す。
  // 白端は暗い背景から十分に浮くので floor は不要。
  const norm = Math.log1p(count) / Math.log1p(max);
  const [r, g, b] = bluesRGB(norm);
  // 薄い（白寄り）セルは白文字が見えないので、輝度で文字色を切替。
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const fg = lum > 150 ? '#10202f' : '#fff';
  return { bg: `rgb(${r},${g},${b})`, opacity: 1, fg };
}

// sentiment: -1=赤 / 0=灰 / 1=緑
export function sentimentCellColor(score) {
  if (score === null || score === undefined) return { bg: '#1a212c', opacity: 0.5 };
  // -1〜1 を色に変換
  let bg;
  if (score >= 0) {
    const t = Math.min(1, score);
    const r = Math.round(0x9a + (0x4a - 0x9a) * t);
    const g = Math.round(0xa7 + (0xde - 0xa7) * t);
    const b = Math.round(0xb5 + (0x80 - 0xb5) * t);
    bg = `rgb(${r},${g},${b})`;
  } else {
    const t = Math.min(1, -score);
    const r = Math.round(0x9a + (0xe2 - 0x9a) * t);
    const g = Math.round(0xa7 + (0x4b - 0xa7) * t);
    const b = Math.round(0xb5 + (0x4a - 0xb5) * t);
    bg = `rgb(${r},${g},${b})`;
  }
  return { bg, opacity: 1 };
}

// semantic change: 薄い色 = 意味が近い / 濃い色 = 意味が離れている
export function semanticCellColor(distance) {
  if (distance === null || distance === undefined) return { bg: '#1a212c', opacity: 0.5 };
  // distanceが大きいほど濃い紫にする
  const t = Math.max(0, Math.min(1, distance));
  const r = Math.round(0x2a + (0x9d - 0x2a) * t);
  const g = Math.round(0x33 + (0x4d - 0x33) * t);
  const b = Math.round(0x5e + (0xdd - 0x5e) * t);
  return { bg: `rgb(${r},${g},${b})`, opacity: t < 0.05 ? 0.7 : 1 };
}

// ISO zaman → heatmap/line chart bucket anahtarı (backend bucket_expression ile aynı kural)
export function timeToBucket(time, granularity) {
  if (!time) return '';
  return granularity === 'daily' ? time.slice(0, 10) : time.slice(0, 13) + ':00:00';
}

// datetime-local input変換
export function apiTimeToInputValue(value) {
  if (!value) return '';
  return value.slice(0, 16);
}
export function inputValueToApiTime(value) {
  if (!value) return '';
  return value.length === 16 ? `${value}:00` : value;
}

// recipients表示
export function formatRecipients(value) {
  if (!value) return '[]';
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.join(', ');
  } catch (_) {
    return value;
  }
  return value;
}

// %増減の表示
export function fmtPct(v) {
  if (v === null || v === undefined) return 'N/A';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

export function pctClass(v) {
  if (v === null || v === undefined) return 'pct-na';
  return v >= 0 ? 'pct-up' : 'pct-down';
}

// heatmap cell用: 符号付き2桁（+0.32 / -0.45）。null/undefinedは空文字。
export function fmtSigned(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}

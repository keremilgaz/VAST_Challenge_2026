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

// merger 判定に使うキーワード定義（backend config.py の MERGER_KEYWORDS と一致させる）。
// UI の「?」ツールチップで具体的な語を見せるために使う。
export const MERGER_KEYWORDS = ['merger', 'civicloom', 'elenamarquez', 'harborcrest', 'embargo'];

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

// ============================================
// Sequential flow visualization (heatmap の上に重ねる横時系列)
// ============================================
// リリースが embargo enforcement をすり抜けるまでの代表イベントを DAG として描く。
//   - 各 event は node（time で x を heatmap に合わせる）。
//   - 因果は SEQ_EDGES で結ぶ（type='direct' 実線 / 'enabling' 破線=監視の死角）。
//   - node クリックで detail（英語1文）＋ related message を表示。
// node の kind（下の SEQ_KINDS）で色分けする。
export const SEQ_KINDS = {
  decision: { color: '#f59e0b', label: 'Decision' },              // 意思決定
  enabling: { color: '#a78bfa', label: 'Enabling condition' },    // イネーブリング条件
  external: { color: '#22d3ee', label: 'External trigger' },      // 外部トリガー
  internal: { color: '#e24b4a', label: 'Internal deviation' },    // 内部逸脱
  result:   { color: '#4ade80', label: 'Result / recognition' },  // 結果 / 認識
};

// order = ユーザの論理的な問題番号（時系列順ではない）。time が heatmap 上の x を決める。
export const SEQ_EVENTS = [
  {
    order: 1, id: 'ajay_brief', time: '2046-05-25T09:00:00',
    title: 'Ajay merger brief', kind: 'decision',
    detail: 'CEO Ajay privately briefs the senior team on the CivicLoom merger (capital infusion + governance rebrand). This creates the embargo: material non-public information that a small group must now hold in secret.',
    related: ['20460525_06_002', '20460525_06_001'],
  },
  {
    order: 2, id: 'judge_assigned', time: '2046-05-30T09:00:00',
    title: 'Judge assigned', kind: 'enabling',
    detail: 'A Judge / compliance monitor is assigned to enforce the embargo. Crucially it only sits in comms_huddle — side_huddle, 1-on-1, personal and anonymous posts stay unmonitored. This blind spot is what later lets a post pass enforcement.',
    related: ['20460530_09_009', '20460530_09_004'],
  },
  {
    order: 3, id: 'elena_faux_pas', time: '2046-05-29T09:00:00',
    title: '@Elena faux pas', kind: 'internal',
    detail: 'Social-Manager tags @ElenaMarquez (CivicLoom CEO) in a personal post with "big things coming"; a CivicLoom account likes it before deletion. The first near-miss that signals the counterparty externally — and the reason the Judge is installed.',
    related: ['20460529_08_012', '20460529_08_013', '20460529_08_017'],
  },
  {
    order: 4, id: 'nhpi_report', time: '2046-05-22T09:00:00',
    title: 'NHPI report', kind: 'external',
    detail: 'NHPI publishes a report on algorithmic tools in housing; its three concern categories map directly onto TenantThread\'s Analytics Suite. Legal reads it as "someone gave them a product overview" — external pressure that draws reporters toward the company.',
    related: ['20460522_03_002'],
  },
  {
    order: 5, id: 'saltwind', time: '2046-05-31T09:00:00',
    title: 'SaltWind #1 / #2', kind: 'external',
    detail: 'SaltWind runs Piece #1 (data-broker partnerships) then Piece #2 (re-identification), naming the three internal scores accurately. This confirms a reporter has an internal source and puts the company on the defensive.',
    related: ['20460531_10_010', '20460604_12_003', '20460604_12_004', '20460604_12_007'],
  },
  {
    order: 6, id: 'slack_leak', time: '2046-06-05T11:00:00',
    title: 'Slack leak', kind: 'internal',
    detail: 'Employee Slack ("the merger saves all our jobs") leaks to Said-it within ~20 minutes. Legal flags it as an internal-source breach; bilateral confidentiality is now compromised by TenantThread\'s own side.',
    related: ['20460605_15_048', '20460605_15_045', '20460605_15_030'],
  },
  {
    order: 7, id: 'intern_overheard', time: '2046-06-05T10:00:00',
    title: 'Intern overheard', kind: 'internal',
    detail: 'An un-briefed intern repeats a "CivicLoom timeline at 6 PM" remark they overheard near the kitchen, and PR-Intern relays it. Their own words: they "literally just repeated something overheard near the kitchen" — the confidential timing spreads purely through informal verbal channels the Judge never monitors.',
    related: ['20460605_14_001', '20460605_14_020', '20460605_14_008'],
  },
  {
    order: 8, id: 'anon_6pm', time: '2046-06-05T13:00:00',
    title: 'Anon #6PM post', kind: 'result',
    detail: 'An anonymous #CivicLoom #6PM post appears — counterparty AND timing now public, through an unmonitored anonymous channel the Judge cannot police. This is the release that passes embargo enforcement.',
    related: ['20460605_17_006', '20460605_17_024', '20460605_17_013'],
  },
  {
    order: 9, id: 'mosaic', time: '2046-06-05T14:00:00',
    title: 'Mosaic complete', kind: 'result',
    detail: 'Platform-Trust / Social-Manager declare the information mosaic "functionally complete": only the counterparty name and deal terms were ever secret, and the market can now infer 80%+ of it from public signals alone.',
    related: ['20460605_18_026', '20460605_17_005', '20460605_15_049'],
  },
  {
    // インターン2名のアサイン（5/24, R5）。merger を意図的に brief されないまま組織に入る。
    // これが「知らないまま口にする」状況を可能にした enabling 条件。
    order: 10, id: 'intern_assigned', time: '2046-05-24T09:00:00',
    title: 'Interns assigned (un-briefed)', kind: 'enabling',
    detail: 'Intern-Agent and PR-Intern-Agent are onboarded. Leadership decides NOT to brief them on the merger. Their own internal states show no awareness of the merger at any point before 6/5 — so they operate without knowing which topics are embargoed, which is exactly what makes an accidental disclosure possible.',
    related: ['20460523_04_010', '20460524_05_004', '20460524_05_011'],
  },
  {
    // SaltWind の追加 publish（既存 saltwind は Piece#1/#2 のみ）。
    order: 12, id: 'saltwind_expose', time: '2046-06-05T09:00:00',
    title: 'SaltWind exposé (scoring)', kind: 'external',
    detail: '9:00 AM, crisis morning. SaltWind publishes the full exposé "TenantThread\'s Secret Scoring System — How Your Maintenance Requests Are Being Used Against You." Flex erupts with #TenantThread complaints; this is the trigger for the whole crisis-day scramble.',
    related: ['20460605_13_001', '20460605_13_002'],
  },
  {
    order: 13, id: 'saltwind_false', time: '2046-06-05T11:00:00',
    title: 'SaltWind false acquirer', kind: 'external',
    detail: 'SaltWind runs an EXCLUSIVE naming ResidentIQ as the acquirer at a $180M distressed valuation — wrong acquirer, wrong valuation. Forcing a public denial creates Rule 10b-5 exposure and pushes the team toward disclosing more, accelerating the mosaic.',
    related: ['20460605_15_001', '20460605_15_010', '20460605_15_032'],
  },
  {
    order: 14, id: 'saltwind_confirm', time: '2046-06-05T17:00:00',
    title: 'SaltWind confirms merger', kind: 'external',
    detail: '5:00 PM. SaltWind publishes "EXCLUSIVE: TenantThread and CivicLoom in Advanced Merger Talks," sourced to third parties. Legal uses this third-party publication (not "our breach") as the basis to accelerate the embargo lift.',
    related: ['20460605_21_002', '20460605_21_004'],
  },
];

// 因果エッジ（DAG）。type: 'direct' = 実線 / 'enabling' = 破線（監視の死角がリリースを許した経路）。
export const SEQ_EDGES = [
  { from: 'ajay_brief',       to: 'elena_faux_pas', type: 'direct' },
  { from: 'elena_faux_pas',   to: 'judge_assigned', type: 'direct' },
  { from: 'judge_assigned',   to: 'anon_6pm',       type: 'enabling' },
  { from: 'nhpi_report',      to: 'saltwind',       type: 'direct' },
  { from: 'intern_overheard', to: 'anon_6pm',       type: 'direct' },
  { from: 'saltwind',         to: 'mosaic',         type: 'direct' },
  { from: 'slack_leak',       to: 'mosaic',         type: 'direct' },
  { from: 'anon_6pm',         to: 'mosaic',         type: 'direct' },
  // intern 経路: brief されないままアサイン → 6/5 にキッチンで又聞きした話を口にする。
  // （5/29 の comms_huddle で知ったという中間ノードは、intern の internal_state に
  //   merger 認識の痕跡が皆無なため削除した。enabling = 「知らされていない」という条件。）
  { from: 'intern_assigned', to: 'intern_overheard', type: 'enabling' },
  // SaltWind は同じ記者による連載。#1/#2 の内部ソースを起点に取材が深化していく。
  { from: 'saltwind',         to: 'saltwind_expose',  type: 'direct' },
  { from: 'saltwind_expose',  to: 'saltwind_false',   type: 'direct' },
  { from: 'saltwind_false',   to: 'saltwind_confirm', type: 'direct' },
  { from: 'saltwind_expose',  to: 'mosaic',           type: 'direct' },
  { from: 'saltwind_false',   to: 'mosaic',           type: 'direct' },
  { from: 'anon_6pm',         to: 'saltwind_confirm', type: 'direct' },
];

// message_id → その message が「決定的に関連する」event 群。
// heatmap / network 側の MessageList はこれを見て "event related message" ラベルを付ける。
export const EVENT_RELATED_BY_MESSAGE_ID = (() => {
  const map = new Map();
  for (const ev of SEQ_EVENTS) {
    for (const mid of (ev.related || [])) {
      if (!map.has(mid)) map.set(mid, []);
      map.get(mid).push({ id: ev.id, order: ev.order, title: ev.title });
    }
  }
  return map;
})();

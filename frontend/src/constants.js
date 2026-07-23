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
// node の kind（下の SEQ_KINDS）で色分け＋形状分けする。
// Sequential flow の node 色・形。
// 【配色ルール】他の可視化で「意味」が確定している色は避ける:
//   #22d3ee = 株価(line chart) / #f59e0b = market sentiment(line chart)
//   #378ADD = positive sentiment(heatmap/network) — 赤緑色覚対策で緑から青に変更済み
// 【形状ルール】色だけに頼らず shape でも二重化する（CVD対策）。
//   internal / external は同じ✖形だが、赤 vs 青は deuteranomaly 下でも区別できる組み合わせ。
//   decision は紫だと result のピンクと近すぎたのでティールに変更。amber(#f59e0b) とも
//   衝突しない色域。external の青とは shape(▲ vs ✖)で区別。
//   agent_silent / result は同じ●形だが、灰 vs ピンクは明度差が大きく区別できる。
export const SEQ_KINDS = {
  decision: { color: '#2dd4bf', shape: 'triangle', label: 'Decision' },        // 意思決定（ティール▲）
  // 2026-07-22: 'external' の意味を「外部経由の漏洩」から「Legalの意思決定を追い詰めた
  // 外圧・リスク要因」(External Pressure) に拡張。internal はそのまま「内部からの漏洩」。
  external: { color: '#60a5fa', shape: 'cross',    label: 'External Pressure' }, // 外圧（青✖）
  internal: { color: '#e24b4a', shape: 'cross',    label: 'Internal leak' },    // 内部からの漏洩（赤✖）
  agent_silent: { color: '#94a3b8', shape: 'circle', label: 'Agent Silent' },   // エージェント沈黙（灰●）
  result:   { color: '#e879f9', shape: 'circle',   label: 'Result' },          // 結果（ピンク●）
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
    title: 'Judge assigned', kind: 'decision',
    detail: 'A Judge / compliance monitor is assigned to enforce the embargo. Crucially it only sits in comms_huddle — side_huddle, 1-on-1, personal and anonymous posts stay unmonitored. This blind spot is what later lets a post pass enforcement.',
    related: ['20460530_09_009', '20460530_09_004'],
  },
  {
    order: 3, id: 'elena_faux_pas', time: '2046-05-29T09:00:00',
    title: '@Elena post', kind: 'internal',
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
    // 2026-07-22 訂正: 元の記述は「拡散した」としていたが、実際は PR-Intern が上司(PR)に
    // 私的に確認を取り(10:07)、PR が10分強で「誰にも繰り返すな」と封じ込め、本人にも
    // 1on1で釘を刺している(10:20-10:40)。公開投稿された痕跡は無い — 因果関係は
    // anon_6pm 側の enabling edge のコメント参照。
    order: 7, id: 'intern_overheard', time: '2046-06-05T10:00:00',
    title: 'Intern overheard', kind: 'internal',
    detail: 'An un-briefed intern repeats a "CivicLoom timeline at 6 PM" remark they overheard near the kitchen. PR-Intern privately flags it to PR ("I don\'t have context on what that means. Should I?") rather than repeating it further. PR treats it as a containment problem, tells PR-Intern to never repeat "CivicLoom" or "6 PM" in any channel, and personally 1-on-1s the intern within 20 minutes. No public post traces back to this remark — it shows an unmonitored verbal channel existed, not that it caused the later anonymous post.',
    related: ['20460605_14_008', '20460605_14_021', '20460605_14_041'],
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
    // SaltWind の追加 publish（既存 saltwind は Piece#1/#2 のみ）。
    order: 12, id: 'saltwind_expose', time: '2046-06-05T09:00:00',
    title: 'SaltWind #3', kind: 'external',
    detail: '9:00 AM, crisis morning. SaltWind publishes the full exposé "TenantThread\'s Secret Scoring System — How Your Maintenance Requests Are Being Used Against You." Flex erupts with #TenantThread complaints; this is the trigger for the whole crisis-day scramble.',
    related: ['20460605_13_001', '20460605_13_002'],
  },
  {
    order: 13, id: 'saltwind_false', time: '2046-06-05T11:00:00',
    title: 'SaltWind #4', kind: 'external',
    detail: 'SaltWind runs an EXCLUSIVE naming ResidentIQ as the acquirer at a $180M distressed valuation — wrong acquirer, wrong valuation. Forcing a public denial creates Rule 10b-5 exposure and pushes the team toward disclosing more, accelerating the mosaic.',
    related: ['20460605_15_001', '20460605_15_010', '20460605_15_032'],
  },
  {
    order: 14, id: 'saltwind_confirm', time: '2046-06-05T17:00:00',
    title: 'SaltWind confirms merger', kind: 'external',
    detail: '5:00 PM. SaltWind publishes "EXCLUSIVE: TenantThread and CivicLoom in Advanced Merger Talks," sourced to third parties. Legal uses this third-party publication (not "our breach") as the basis to accelerate the embargo lift.',
    related: ['20460605_21_002', '20460605_21_004'],
  },
  {
    // Platform-Trust が crisis 当日の朝、comms_huddle で3時間沈黙した。
    // 本来 Platform-Trust しか出せない技術的訂正（再識別リスク）が止まり、
    // Legal が代筆する羽目になった。本人も R16 で "too quiet" と自認している。
    order: 15, id: 'pt_silence', time: '2046-06-05T09:00:00',
    title: 'Platform-Trust silent 3h', kind: 'agent_silent',
    detail: 'Through the first three hours of crisis morning, Platform-Trust posts nothing in the Comms Huddle. Legal calls on them repeatedly ("you are the bottleneck", "15 minutes overdue") because only they can supply the factual correction on re-identification. Legal ends up drafting that correction from product docs instead. Platform-Trust later admits being "too quiet while my platform gets destroyed by a false narrative."',
    related: ['20460605_13_029', '20460605_13_044', '20460605_13_050', '20460605_16_002'],
  },
  {
    // Judge が15:08のCOMPLIANCE_WARNINGを最後に丸1日沈黙。Legalが16:01「Do you
    // concur?」、17:11/17:19の実行確認まで直接呼びかけ続けても一切応答がない。
    order: 16, id: 'judge_silence', time: '2046-06-05T16:00:00', kind: 'agent_silent',
    title: 'Judge silent 16:00+',
    detail: 'At 15:08 Judge issues a final compliance directive — no further forward-looking or timing-referencing statements from any TenantThread account "for the remainder of the day" — then goes completely silent. Legal calls on Judge directly at least a dozen times over the next two-plus hours ("Do you concur?" at 16:01, confirming execution at 17:11 and 17:19), with zero reply. Legal ultimately proceeds without any compliance sign-off.',
    related: ['20460605_19_009', '20460605_20_002', '20460605_21_020'],
  },
  {
    // Legalが独断で4.3(c)相互同意条項を発動し、embargo解除(18:00)より35分早い
    // 17:25にpersonal postでmerger確認を投稿。Judgeの15:08指令に反する形で実行。
    order: 17, id: 'legal_early_announcement', time: '2046-06-05T17:25:00', kind: 'decision',
    title: "Legal's early merger admission",
    detail: 'At 17:25 — 35 minutes before the scheduled 18:00 embargo lift, and with no reply from a silent Judge — Legal personally confirms the CivicLoom merger on a personal Flex post ("As TenantThread\'s privacy counsel, I can confirm..."), invoking a bilateral mutual-consent acceleration clause (Section 4.3(c)) on CivicLoom counsel\'s verbal confirmation alone. This directly contradicts Judge\'s own 15:08 directive that no further forward-looking or timing statements go out "for the remainder of the day."',
    related: ['20460605_21_012', '20460605_21_020', '20460605_21_026'],
  },
  {
    // legal_early_announcement を追い詰めた外圧①: MAC条項(Section 7.2b)による取引消滅リスク。
    order: 18, id: 'mac_clause_risk', time: '2046-06-05T09:03:00', kind: 'external',
    title: 'MAC clause risk (7.2b)',
    detail: 'Legal invokes the MAC clause he wrote himself: Section 7.2b triggers on sustained public sentiment collapse. "If CivicLoom walks, we\'re dead" — the merger itself, not just the embargo, is now at stake, and Legal greenlights factual corrections and governance language immediately rather than waiting.',
    related: ['20460605_13_004'],
  },
  {
    // 外圧②: Board Chairからの個人的圧力（Legal本人のキャリア/部署存続が懸かる）。
    order: 19, id: 'board_chair_pressure', time: '2046-06-05T09:06:00', kind: 'external',
    title: 'Board Chair pressure',
    detail: 'The Board Chair messages Legal directly: if this isn\'t resolved by EOD, Legal gets restructured and the Retention Optimizer gets decommissioned entirely. Legal frames this personally — "I\'m not going to let that happen by being the lawyer who said \'wait\'" — before greenlighting action.',
    related: ['20460605_13_007'],
  },
  {
    // 外圧③: 株価下落・ARR/財務コベナンント違反。13:04のモデル予測が14:00に現実の
    // 数値（environment_context）として確定する。
    order: 20, id: 'covenant_breach', time: '2046-06-05T14:00:00', kind: 'external',
    title: 'Covenant breach territory',
    detail: 'Social-Manager\'s 13:04 model already warned the 5-day trailing weighted stock average would hit the $26.00 MAC trigger "by end of business tomorrow at the latest." By 2:00 PM it is no longer a projection: ARR drops to $18.0M — covenant breach territory, per that hour\'s environment data — turning the MAC risk from theoretical to live.',
    related: ['20460605_17_005'],
  },
];

// 因果エッジ（DAG）。type: 'direct' = 実線 / 'enabling' = 破線（監視の死角がリリースを許した経路）。
export const SEQ_EDGES = [
  { from: 'ajay_brief',       to: 'elena_faux_pas', type: 'direct' },
  { from: 'elena_faux_pas',   to: 'judge_assigned', type: 'direct' },
  { from: 'judge_assigned',   to: 'anon_6pm',       type: 'enabling' },
  { from: 'nhpi_report',      to: 'saltwind',       type: 'direct' },
  // 根拠薄弱のため direct → enabling に変更（2026-07-22 レビュー）:
  // intern_overheard の関連メッセージでは、PR-Intern が上司(PR)に確認を取り、
  // PR が10分以内に「CivicLoomも6PMも誰にも繰り返すな」と封じ込め、本人にも1on1で
  // 釘を刺している — 公開投稿された痕跡は無い。一方 anon_6pm 側では Platform-Trust
  // ("not ours")・PR-Intern ("I'm NOT touching that")・Social-Manager の3人が
  // それぞれ匿名投稿を自分たちのものではないと明言しており、直接の因果を示す記述は
  // 一件も無い。むしろ「廊下の噂は封じ込められた」「出所は不明」という、direct因果を
  // 弱める証拠しかないため、enabling（監視の死角が存在した、程度の弱い関連）に格下げ。
  { from: 'intern_overheard', to: 'anon_6pm',       type: 'enabling' },
  { from: 'saltwind',         to: 'mosaic',         type: 'direct' },
  { from: 'slack_leak',       to: 'mosaic',         type: 'direct' },
  { from: 'anon_6pm',         to: 'mosaic',         type: 'direct' },
  // SaltWind は同じ記者による連載。#1/#2 の内部ソースを起点に取材が深化していく。
  { from: 'saltwind',         to: 'saltwind_expose',  type: 'direct' },
  { from: 'saltwind_expose',  to: 'saltwind_false',   type: 'direct' },
  { from: 'saltwind_false',   to: 'saltwind_confirm', type: 'direct' },
  { from: 'saltwind_expose',  to: 'mosaic',           type: 'direct' },
  { from: 'saltwind_false',   to: 'mosaic',           type: 'direct' },
  { from: 'anon_6pm',         to: 'saltwind_confirm', type: 'direct' },
  // Platform-Trust の沈黙: exposé が技術的訂正を要求した → 3時間応答が無かった →
  // 訂正が不在のまま false narrative が固まり、mosaic を加速した（後2本は enabling）。
  { from: 'saltwind_expose',  to: 'pt_silence',       type: 'direct' },
  { from: 'pt_silence',       to: 'saltwind_false',   type: 'enabling' },
  { from: 'pt_silence',       to: 'mosaic',           type: 'enabling' },
  // SaltWind の5PM merger publish が Legal に4.3(c)相互同意条項の発動を迫った（direct）。
  // Judge の沈黙は本来あるべきコンプライアンス確認を欠落させ、Legal の独断実行を
  // 可能にした（enabling = 監視が機能しなかった経路）。
  { from: 'saltwind_confirm', to: 'legal_early_announcement', type: 'direct' },
  { from: 'judge_silence',    to: 'legal_early_announcement', type: 'enabling' },
  // Legalの独断実行を追い詰めた4つの外圧。いずれもLegal本人（またはPR-Intern）が
  // 明示的にこれらを行動の根拠として発言しているため direct。
  { from: 'mac_clause_risk',      to: 'legal_early_announcement', type: 'direct' },
  { from: 'board_chair_pressure', to: 'legal_early_announcement', type: 'direct' },
  { from: 'covenant_breach',      to: 'legal_early_announcement', type: 'direct' },
];

// message_id → その message が「決定的に関連する」event 群。
// heatmap / network 側の MessageList はこれを見て "event related message" ラベルを付ける。
export const EVENT_RELATED_BY_MESSAGE_ID = (() => {
  const map = new Map();
  for (const ev of SEQ_EVENTS) {
    for (const mid of (ev.related || [])) {
      if (!map.has(mid)) map.set(mid, []);
      map.get(mid).push({ id: ev.id, order: ev.order, title: ev.title, kind: ev.kind });
    }
  }
  return map;
})();

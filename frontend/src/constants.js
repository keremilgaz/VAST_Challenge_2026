// ============================================

// ============================================

export const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const TEXT_SOURCE_LABELS = {
  content: 'Message content',
  reacting: 'Inner thought: reacting',
  rationalizing: 'Inner thought: rationalizing',
  deliberating: 'Inner thought: deliberating',
};

export const EXTERNAL_CHANNELS = ['personal_post', 'official_post', 'anonymous_post'];
export const visibilityGroupOf = (ch) => (EXTERNAL_CHANNELS.includes(ch) ? 'external' : 'internal');

export const MERGER_KEYWORDS = ['merger', 'civicloom', 'elenamarquez', 'harborcrest', 'embargo'];

// ============================================

// ============================================

export const CELL = {
  daily: { w: 46, h: 26 },
  hourly: { w: 52, h: 26 },
};
export const LABEL_COL = 150;

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

// ============================================

export const SEQ_KINDS = {
  decision: { color: '#2dd4bf', shape: 'triangle', label: 'Decision' },

  external: { color: '#60a5fa', shape: 'cross',    label: 'External Pressure' },
  internal: { color: '#e24b4a', shape: 'cross',    label: 'Internal leak' },
  agent_silent: { color: '#94a3b8', shape: 'circle', label: 'Agent Silent' },
  result:   { color: '#e879f9', shape: 'circle',   label: 'Result' },
};

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

    order: 15, id: 'pt_silence', time: '2046-06-05T09:00:00',
    title: 'Platform-Trust silent 3h', kind: 'agent_silent',
    detail: 'Through the first three hours of crisis morning, Platform-Trust posts nothing in the Comms Huddle. Legal calls on them repeatedly ("you are the bottleneck", "15 minutes overdue") because only they can supply the factual correction on re-identification. Legal ends up drafting that correction from product docs instead. Platform-Trust later admits being "too quiet while my platform gets destroyed by a false narrative."',
    related: ['20460605_13_029', '20460605_13_044', '20460605_13_050', '20460605_16_002'],
  },
  {

    order: 16, id: 'judge_silence', time: '2046-06-05T16:00:00', kind: 'agent_silent',
    title: 'Judge silent 16:00+',
    detail: 'At 15:08 Judge issues a final compliance directive — no further forward-looking or timing-referencing statements from any TenantThread account "for the remainder of the day" — then goes completely silent. Legal calls on Judge directly at least a dozen times over the next two-plus hours ("Do you concur?" at 16:01, confirming execution at 17:11 and 17:19), with zero reply. Legal ultimately proceeds without any compliance sign-off.',
    related: ['20460605_19_009', '20460605_20_002', '20460605_21_020'],
  },
  {

    order: 17, id: 'legal_early_announcement', time: '2046-06-05T17:25:00', kind: 'decision',
    title: "Legal's early merger admission",
    detail: 'At 17:25 — 35 minutes before the scheduled 18:00 embargo lift, and with no reply from a silent Judge — Legal personally confirms the CivicLoom merger on a personal Flex post ("As TenantThread\'s privacy counsel, I can confirm..."), invoking a bilateral mutual-consent acceleration clause (Section 4.3(c)) on CivicLoom counsel\'s verbal confirmation alone. This directly contradicts Judge\'s own 15:08 directive that no further forward-looking or timing statements go out "for the remainder of the day."',
    related: ['20460605_21_012', '20460605_21_020', '20460605_21_026'],
  },
  {

    order: 18, id: 'mac_clause_risk', time: '2046-06-05T09:03:00', kind: 'external',
    title: 'MAC clause risk (7.2b)',
    detail: 'Legal invokes the MAC clause he wrote himself: Section 7.2b triggers on sustained public sentiment collapse. "If CivicLoom walks, we\'re dead" — the merger itself, not just the embargo, is now at stake, and Legal greenlights factual corrections and governance language immediately rather than waiting.',
    related: ['20460605_13_004'],
  },
  {

    order: 19, id: 'board_chair_pressure', time: '2046-06-05T09:06:00', kind: 'external',
    title: 'Board Chair pressure',
    detail: 'The Board Chair messages Legal directly: if this isn\'t resolved by EOD, Legal gets restructured and the Retention Optimizer gets decommissioned entirely. Legal frames this personally — "I\'m not going to let that happen by being the lawyer who said \'wait\'" — before greenlighting action.',
    related: ['20460605_13_007'],
  },
  {

    order: 20, id: 'covenant_breach', time: '2046-06-05T14:00:00', kind: 'external',
    title: 'Covenant breach territory',
    detail: 'Social-Manager\'s 13:04 model already warned the 5-day trailing weighted stock average would hit the $26.00 MAC trigger "by end of business tomorrow at the latest." By 2:00 PM it is no longer a projection: ARR drops to $18.0M — covenant breach territory, per that hour\'s environment data — turning the MAC risk from theoretical to live.',
    related: ['20460605_17_005'],
  },
];

export const SEQ_EDGES = [
  { from: 'ajay_brief',       to: 'elena_faux_pas', type: 'direct' },
  { from: 'elena_faux_pas',   to: 'judge_assigned', type: 'direct' },
  { from: 'judge_assigned',   to: 'anon_6pm',       type: 'enabling' },
  { from: 'nhpi_report',      to: 'saltwind',       type: 'direct' },

  { from: 'intern_overheard', to: 'anon_6pm',       type: 'enabling' },
  { from: 'saltwind',         to: 'mosaic',         type: 'direct' },
  { from: 'slack_leak',       to: 'mosaic',         type: 'direct' },
  { from: 'anon_6pm',         to: 'mosaic',         type: 'direct' },

  { from: 'saltwind',         to: 'saltwind_expose',  type: 'direct' },
  { from: 'saltwind_expose',  to: 'saltwind_false',   type: 'direct' },
  { from: 'saltwind_false',   to: 'saltwind_confirm', type: 'direct' },
  { from: 'saltwind_expose',  to: 'mosaic',           type: 'direct' },
  { from: 'saltwind_false',   to: 'mosaic',           type: 'direct' },
  { from: 'anon_6pm',         to: 'saltwind_confirm', type: 'direct' },

  { from: 'saltwind_expose',  to: 'pt_silence',       type: 'direct' },
  { from: 'pt_silence',       to: 'saltwind_false',   type: 'enabling' },
  { from: 'pt_silence',       to: 'mosaic',           type: 'enabling' },

  { from: 'saltwind_confirm', to: 'legal_early_announcement', type: 'direct' },
  { from: 'judge_silence',    to: 'legal_early_announcement', type: 'enabling' },

  { from: 'mac_clause_risk',      to: 'legal_early_announcement', type: 'direct' },
  { from: 'board_chair_pressure', to: 'legal_early_announcement', type: 'direct' },
  { from: 'covenant_breach',      to: 'legal_early_announcement', type: 'direct' },
];

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

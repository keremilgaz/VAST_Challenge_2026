// ============================================
// React アプリのメインファイル (VAST Challenge Mini Challenge 1)
// ============================================
// 1画面で Heatmap / Message Detail / Stock・Sentiment Line Chart / Network を統合表示する。
//
// 旧 main.jsx は肥大化していたため、純粋関数・定数・各コンポーネントを別モジュールに分割した:
//   constants.js                            … 共有定数 (API / CELL / ラベル等)
//   utils.js                                … 時間表示 / cell色 / 数値フォーマット
//   components/Collapsible.jsx              … 折りたたみ
//   components/CrisisTimeline.jsx           … 危機タイムライン slider
//   components/StockSentimentLineChart.jsx  … 株価/センチメント折れ線
//   components/messagePanels.jsx            … メッセージ一覧/詳細/関連/会話フロー/Ajayタイムライン
// このファイルには App（全体の状態管理とレイアウト）だけを残している。ロジックは不変。
// ============================================

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { RefreshCcw, Play, Pause } from 'lucide-react';
import NetworkVisualization, { AGENTS } from './network.jsx';
import './style.css';

import { API, TEXT_SOURCE_LABELS, visibilityGroupOf, CELL, LABEL_COL, EVENT_MARKERS } from './constants.js';
import {
  shortBucket, countColor, sentimentCellColor, semanticCellColor,
  apiTimeToInputValue, inputValueToApiTime, fmtSigned, fmtRoundLabel, timeToBucket,
} from './utils.js';
import { Collapsible } from './components/Collapsible.jsx';
import { CrisisTimeline } from './components/CrisisTimeline.jsx';
import { StockSentimentLineChart } from './components/StockSentimentLineChart.jsx';
import { SequentialFlow } from './components/SequentialFlow.jsx';
import { SEQ_EVENTS, MERGER_KEYWORDS } from './constants.js';
import { loadCommIdMap } from './commIdMap.js';
import {
  MessageDetailPanel, EdgeMessagesPanel, NodeMessagesPanel, ConversationFlowModal, AjayTimelineModal,
} from './components/messagePanels.jsx';


function App() {
  // ---- 共通filter state (heatmap / network / line chart 共通) ----
  const [granularity, setGranularity] = useState('hourly');
  const [mergerOnly, setMergerOnly] = useState(false);
  const [selectedCombos, setSelectedCombos] = useState([]);
  const [selectedTextSources, setSelectedTextSources] = useState([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [agentFilter, setAgentFilter] = useState([]); // 空=All

  // ---- heatmap固有 state ----
  const [heatmapMode, setHeatmapMode] = useState('count'); // count | sentiment | semantic_change
  const [semanticComparisonMode, setSemanticComparisonMode] = useState('previous'); // previous | next
  const [heatmapSort, setHeatmapSort] = useState({ key: 'agent_id', dir: 'asc' }); // key: agent_id|total|sentiment

  // ---- network固有 state ----
  const [networkLayout, setNetworkLayout] = useState('force'); // force | circle
  const [networkSort, setNetworkSort] = useState({ nodeSize: 'messages', edgeWeight: 'weight' });
  const [colorBySentiment, setColorBySentiment] = useState(false); // node を sentiment 色で塗る（size とは独立）
  const [showAjay, setShowAjay] = useState(false); // データに無い推論ノード "Ajay"（mention ベース）を表示するか
  // network の挙動を決める2つの独立したtoggle（以前は1つの3値 networkMode に
  // 詰め込んでいたが、"filterの出所"と"time windowの出所"は別々の軸なので分離した）。
  //   netMirrorsHeatmap: filter / sort / node-size を heatmap から取るか、network自前かにするか
  //   netFollowsTimeline: time window を crisis timeline から取るか、network自前の手動範囲にするか
  // 2つは互いに独立 — 4つの組み合わせすべてが有効（例: heatmapのfilterを使いつつ、
  // timeとは別に自分でtime rangeを指定する、なども可能）。
  const [netMirrorsHeatmap, setNetMirrorsHeatmap] = useState(false);
  const [netFollowsTimeline, setNetFollowsTimeline] = useState(false);
  const [selectedNetworkNode, setSelectedNetworkNode] = useState(null);
  // ---- node click → Node Messages Panel (broadcast/root mesajlar dahil) ----
  const [nodeMessages, setNodeMessages] = useState([]);
  const [isNodeDetailCollapsed, setIsNodeDetailCollapsed] = useState(false);
  // ---- network edge click → Edge Messages Panel ----
  const [selectedEdge, setSelectedEdge] = useState(null); // { key, source, target, sourceLabel, targetLabel, channel, inferred }
  const [edgeMessages, setEdgeMessages] = useState([]);
  const [isEdgeDetailCollapsed, setIsEdgeDetailCollapsed] = useState(false);

  // ---- Ajay's hints timeline (modal) ----
  const [ajayTimelineOpen, setAjayTimelineOpen] = useState(false);
  const [ajayTimelineMessages, setAjayTimelineMessages] = useState([]);
  const [ajayTimelineStatus, setAjayTimelineStatus] = useState(''); // '', 'loading', 'error'

  // network専用 filter（heatmapの計算には一切影響させない。networkだけに適用する）
  const [netCombos, setNetCombos] = useState([]);
  const [netMergerOnly, setNetMergerOnly] = useState(false);
  const [netAgentFilter, setNetAgentFilter] = useState([]); // 空=All（client側でnode絞り込み）
  const [netStartTime, setNetStartTime] = useState('');
  const [netEndTime, setNetEndTime] = useState('');

  // 左パネル全体の開閉
  // 左サイドバー（heatmap filters + network controls）を一括で開閉する。
  // 閉じると heatmap と network が全幅に広がる。
  const [filtersOpen, setFiltersOpen] = useState(true);

  // ---- 表示/非表示 ----
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showLineChart, setShowLineChart] = useState(true);
  const [showNetwork, setShowNetwork] = useState(true);
  const [showSeqFlow, setShowSeqFlow] = useState(true); // heatmap 上の sequential flow
  // side-by-side（karşılaştırma）: heatmap と network を横並びにして同時に見る。
  // この modda detaylı filtre panelleri ve line chart 非表示（üst sıra temiz karşılaştırma）。
  const [sideBySide, setSideBySide] = useState(false);
  const [showStockPriceLine, setShowStockPriceLine] = useState(true);
  // side-by-side modunda filtre panellerini ve line chart'ı gizle（layout için türetilmiş）。
  const effFiltersOpen = filtersOpen && !sideBySide;
  const effShowLineChart = showLineChart && !sideBySide;
  // side-by-side のときは line chart 同様、sequential flow も隠す。
  const effShowSeqFlow = showSeqFlow && !sideBySide;
  const [showBertSentimentLine, setShowBertSentimentLine] = useState(true);

  // ---- crisis timeline slider (CrisisNet風: round N まで累積表示) ----
  const [timeline, setTimeline] = useState([]);          // [{idx,hour,cutoff,event_headline,total_msgs,merger_msgs,...}]
  const [timelineStartIdx, setTimelineStartIdx] = useState(0); // 窓の開始 round（前から絞る handle）
  const [timelineIdx, setTimelineIdx] = useState(0);     // 窓の終了 round（先から絞る handle / play で進む）
  const [playing, setPlaying] = useState(false);

  // ---- データ ----
  const [options, setOptions] = useState({
    message_types: [], channels: [], channel_types: [], text_sources: ['content', 'reacting', 'rationalizing', 'deliberating'],
    agents: [], merger_count: 0, internal_merger_count: 0, combined_merger_count: 0,
    total_count: 0, min_time: '', max_time: '', merger_keywords: [],
  });
  const [heatmap, setHeatmap] = useState({ agents: [], buckets: [], time_buckets: [], cells: [], max_count: 0 });
  const [lineChart, setLineChart] = useState({ time_buckets: [], series: [] });
  const [network, setNetwork] = useState({ nodes: [], edges: [] });

  // ---- detail ----
  const [selected, setSelected] = useState(null); // { agent, bucket }
  const [messages, setMessages] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [keywords, setKeywords] = useState({ close_keywords: [], far_keywords: [] });
  const [isMessageDetailCollapsed, setIsMessageDetailCollapsed] = useState(false);

  // ---- single message context / related messages ----
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [messageContext, setMessageContext] = useState(null);
  const [contextStatus, setContextStatus] = useState(''); // '', 'loading', 'error'
  const [flowOpen, setFlowOpen] = useState(false); // Conversation Flow modal

  // ---- sequential flow: 選択中 event と、その「event related messages」 ----
  const [seqEventId, setSeqEventId] = useState(null);
  const [seqEventMessages, setSeqEventMessages] = useState([]);
  const [seqMsgStatus, setSeqMsgStatus] = useState(''); // '', 'loading', 'error'

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  // ============================================
  // 共通filterのquery string（heatmap mode以外の共通部分）
  // ============================================
  // crisis timeline が active のとき、全ビュー共通の時間窓 [start, end]。
  //  - end  = 終了 round の cutoff（その round までを含む）
  //  - start = 開始 round の hour（前から絞る。startIdx==0 のときは空=最初から）
  // ============================================
  const timelineEnd = (timeline.length && timeline[timelineIdx])
    ? (timeline[timelineIdx].cutoff || timeline[timelineIdx].hour || '')
    : '';
  const timelineStart = (timeline.length && timelineStartIdx > 0 && timeline[timelineStartIdx])
    ? (timeline[timelineStartIdx].hour || '')
    : '';

  const commonQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('granularity', granularity);
    p.set('merger_only', mergerOnly ? 'true' : 'false');
    selectedCombos.forEach(t => p.append('message_types', t));
    selectedTextSources.forEach(s => p.append('text_sources', s));
    // Heatmap の時間窓は crisis timeline が常に支配する（手動 time range は廃止）。
    if (timelineStart) p.set('start_time', timelineStart);
    if (timelineEnd) p.set('end_time', timelineEnd);
    if (searchKeyword.trim()) p.set('keyword', searchKeyword.trim());
    return p.toString();
  }, [granularity, mergerOnly, selectedCombos, selectedTextSources, searchKeyword, timelineStart, timelineEnd]);

  // ============================================
  // network専用のquery string（heatmapとは独立。networkだけに効く）
  // granularity は network graph 構造に影響しないが endpoint が要求するので共有する。
  // ============================================
  const networkQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('granularity', granularity);

    // --- filter context ---
    if (netMirrorsHeatmap) {
      // 'heatmap': heatmap の filter context をそのまま採用する。
      p.set('merger_only', mergerOnly ? 'true' : 'false');
      selectedCombos.forEach(t => p.append('message_types', t));
      selectedTextSources.forEach(s => p.append('text_sources', s));
      if (searchKeyword.trim()) p.set('keyword', searchKeyword.trim());
    } else {
      // 'independent' / 'timeline': network 専用 filter を使う。
      p.set('merger_only', netMergerOnly ? 'true' : 'false');
      netCombos.forEach(t => p.append('message_types', t));
    }

    // --- time window ---
    if (netFollowsTimeline) {
      // 'timeline' / 'heatmap': crisis timeline の窓に追従する（play で animate）。
      if (timelineStart) p.set('start_time', timelineStart);
      if (timelineEnd) p.set('end_time', timelineEnd);
    } else {
      // 'independent': network 専用の手動 time range（未設定なら全期間）。
      if (netStartTime) p.set('start_time', inputValueToApiTime(netStartTime));
      if (netEndTime) p.set('end_time', inputValueToApiTime(netEndTime));
    }
    if (showAjay) p.set('include_ajay', 'true');
    return p.toString();
  }, [granularity, netMirrorsHeatmap, netFollowsTimeline,
      mergerOnly, selectedCombos, selectedTextSources, searchKeyword,
      netMergerOnly, netCombos, netStartTime, netEndTime,
      timelineStart, timelineEnd, showAjay]);

  // ============================================
  // データ取得
  // ============================================
  async function loadOptions() {
    try {
      const res = await fetch(`${API}/api/options`);
      if (!res.ok) throw new Error(`options ${res.status}`);
      setOptions(await res.json());
    } catch (e) {
      setStatus('Could not load filter options (is the backend running?).');
    }
  }

  async function loadTimeline() {
    try {
      const res = await fetch(`${API}/api/timeline`);
      if (!res.ok) throw new Error(`timeline ${res.status}`);
      const data = await res.json();
      const rounds = data.rounds || [];
      setTimeline(rounds);
      // 既定では最後の round（= 全期間）を選択 → 今までと同じ「全部表示」状態
      if (rounds.length) setTimelineIdx(rounds.length - 1);
    } catch (e) {
      setTimeline([]);
    }
  }

  const loadHeatmap = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/heatmap?${commonQuery}&mode=${heatmapMode}`);
      if (!res.ok) throw new Error(`heatmap ${res.status}`);
      const data = await res.json();
      setHeatmap(data);
      // filterが変わったら選択中cellと詳細はリセット
      setSelected(null);
      setMessages([]);
      setRounds([]);
      setKeywords({ close_keywords: [], far_keywords: [] });
      setSelectedMessageId(null);
      setMessageContext(null);
      setContextStatus('');
    } catch (e) {
      setStatus('Could not load heatmap (is the backend running?).');
    } finally {
      setLoading(false);
    }
  }, [commonQuery, heatmapMode]);

  const loadLineChart = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/line-chart?${commonQuery}`);
      if (!res.ok) throw new Error(`line-chart ${res.status}`);
      setLineChart(await res.json());
    } catch (e) {
      setLineChart({ time_buckets: [], series: [] });
    }
  }, [commonQuery]);

  const loadNetwork = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/network?${networkQuery}`);
      if (!res.ok) throw new Error(`network ${res.status}`);
      setNetwork(await res.json());
    } catch (e) {
      setNetwork({ nodes: [], edges: [] });
    }
  }, [networkQuery]);

  useEffect(() => { loadOptions(); }, []);
  useEffect(() => { loadTimeline(); }, []);
  // message_id → #番号 マップを起動時に1回ロード（responding_to の表示用）。
  useEffect(() => {
    fetch(`${API}/api/message-id-map`)
      .then(r => (r.ok ? r.json() : {}))
      .then(loadCommIdMap)
      .catch(() => {});
  }, []);
  useEffect(() => { loadHeatmap(); }, [loadHeatmap]);
  useEffect(() => { loadLineChart(); }, [loadLineChart]);
  useEffect(() => { loadNetwork(); }, [loadNetwork]);

  // Seçili node'un tüm gönderdiği mesajları getir (edge'i olmayan broadcast/root
  // mesajlar dahil — bunlar edge tıklamasıyla görülemiyordu). Ajay gerçek bir
  // agent olmadığı için onun yerine "Ajay's hints timeline" kullanılır.
  useEffect(() => {
    if (!selectedNetworkNode || selectedNetworkNode === 'ajay') { setNodeMessages([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const p = new URLSearchParams(networkQuery);
        p.set('agent_id', selectedNetworkNode);
        const res = await fetch(`${API}/api/node-messages?${p.toString()}`);
        const rows = res.ok ? await res.json() : [];
        if (!cancelled) { setNodeMessages(rows); setIsNodeDetailCollapsed(false); }
      } catch (e) {
        if (!cancelled) setNodeMessages([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedNetworkNode, networkQuery]);

  // ---- crisis timeline playback (Play/Pause) ----
  useEffect(() => {
    if (!playing || timeline.length === 0) return;
    const t = setInterval(() => {
      setTimelineIdx(i => (i >= timeline.length - 1 ? i : i + 1));
    }, 1000);
    return () => clearInterval(t);
  }, [playing, timeline.length]);

  useEffect(() => {
    // 最後の round に達したら自動停止
    if (playing && timeline.length && timelineIdx >= timeline.length - 1) setPlaying(false);
  }, [timelineIdx, playing, timeline.length]);

  const togglePlay = () => {
    if (!timeline.length) return;
    // 再生開始時、終了 handle が末尾なら開始 handle まで巻き戻して窓を成長させる
    if (!playing && timelineIdx >= timeline.length - 1) setTimelineIdx(timelineStartIdx);
    setPlaying(p => !p);
  };

  // ============================================
  // cellMap (agent|bucket -> cell)
  // ============================================
  const cellMap = useMemo(() => {
    const map = new Map();
    for (const c of heatmap.cells || []) map.set(`${c.agent_id}|${c.bucket}`, c);
    return map;
  }, [heatmap]);

  // ============================================
  // agent行のsorting + agent filter
  // ============================================
  // empty cellsは消さず、行(agent)の順番だけ並び替える。
  const sortedAgents = useMemo(() => {
    let agents = (heatmap.agents || []).slice();

    // agent filter（空=All）
    if (agentFilter.length > 0) {
      agents = agents.filter(a => agentFilter.includes(a.agent_id));
    }

    // 各agentの集計を計算
    const agg = {};
    for (const a of agents) {
      let total = 0, sentSum = 0, sentN = 0;
      for (const b of (heatmap.time_buckets || [])) {
        const c = cellMap.get(`${a.agent_id}|${b}`);
        if (c) {
          total += c.message_count || 0;
          if (c.bert_sentiment_score !== null && c.bert_sentiment_score !== undefined) {
            sentSum += c.bert_sentiment_score; sentN += 1;
          }
        }
      }
      agg[a.agent_id] = { total, sentiment: sentN ? sentSum / sentN : -Infinity };
    }

    const { key, dir } = heatmapSort;
    agents.sort((x, y) => {
      let cmp = 0;
      if (key === 'agent_id') cmp = x.agent_id.localeCompare(y.agent_id);
      else if (key === 'total') cmp = agg[x.agent_id].total - agg[y.agent_id].total;
      else if (key === 'sentiment') cmp = agg[x.agent_id].sentiment - agg[y.agent_id].sentiment;
      return dir === 'asc' ? cmp : -cmp;
    });
    return agents;
  }, [heatmap, cellMap, heatmapSort, agentFilter]);

  // ============================================
  // toggles
  // ============================================
  // 「空配列 = All（全選択）」モデルの共通ヘルパ。
  //   - ある項目が有効か: 空 = 全有効。
  //   - 個別トグル: All 状態から1つ外すと「全項目選択 → その1つを除外」に展開。
  //     全選択に戻ったら空配列に正規化して、All checkbox と見た目を一致させる。
  const isInSet = (selection, item) => selection.length === 0 || selection.includes(item);
  const toggleInSet = (setter, allItems, item) => setter(prev => {
    const base = prev.length === 0 ? allItems.slice() : prev.slice();
    let next = base.includes(item) ? base.filter(x => x !== item) : [...base, item];
    if (allItems.length && allItems.every(x => next.includes(x))) next = []; // 全選択 → All
    return next;
  });
  const agentIds = () => (options.agents || []).map(a => a.agent_id);

  // ============================================================
  // Message channel × message_type の複合フィルタ選択肢を組み立てる
  // ============================================================
  // options.channel_types = [{channel, message_type, count, key}]（backend meta 由来）。
  // 1つの channel が複数 message_type を持つときだけラベルに (message_type) を付ける。
  //   例: comms_huddle は broadcast/action に割れる → "comms_huddle (broadcast)" /
  //       "comms_huddle (action)"。それ以外は channel 名のみ表示。
  // これで comms_huddle の broadcast/action も、public_post の personal/official/anonymous も
  // すべて個別に選べ、実在する7通りで全メッセージを漏れなく（網羅的に）カバーする。
  const comboOptions = useMemo(() => {
    const list = options.channel_types || [];
    const typesPerChannel = {};
    list.forEach(o => {
      (typesPerChannel[o.channel] = typesPerChannel[o.channel] || new Set()).add(o.message_type);
    });
    return list.map(o => ({
      key: o.key || `${o.channel}|${o.message_type}`,
      channel: o.channel,
      message_type: o.message_type,
      count: o.count,
      group: visibilityGroupOf(o.channel),
      label: typesPerChannel[o.channel].size > 1
        ? `${o.channel} (${o.message_type})`
        : o.channel,
    }));
  }, [options.channel_types]);
  const allComboKeys = comboOptions.map(c => c.key);
  const comboLabel = (key) => (comboOptions.find(c => c.key === key)?.label) || key;

  const toggleCombo = (t) => toggleInSet(setSelectedCombos, allComboKeys, t);
  const toggleTextSource = (s) => toggleInSet(setSelectedTextSources, options.text_sources || Object.keys(TEXT_SOURCE_LABELS), s);

  // inner thought の3ソースをまとめて on/off するためのヘルパ。
  // 個別チェックボックスは従来どおり残しつつ、1つのチェックで3つ同時に切り替えられる。
  const INNER_THOUGHT_SOURCES = ['reacting', 'rationalizing', 'deliberating'];
  const isInnerAllActive = INNER_THOUGHT_SOURCES.every(s => isInSet(selectedTextSources, s));
  const toggleInnerThoughts = () => {
    const allSources = options.text_sources || Object.keys(TEXT_SOURCE_LABELS);
    setSelectedTextSources(prev => {
      const base = prev.length === 0 ? allSources.slice() : prev.slice();
      const allOn = INNER_THOUGHT_SOURCES.every(s => base.includes(s));
      let next = allOn
        ? base.filter(s => !INNER_THOUGHT_SOURCES.includes(s))           // 3つ全 off
        : Array.from(new Set([...base, ...INNER_THOUGHT_SOURCES]));      // 3つ全 on
      if (allSources.length && allSources.every(s => next.includes(s))) next = []; // 全選択 → All
      return next;
    });
  };

  // message channel×type を visibility（internal / external）でグループ化する。
  // 空配列 = 全選択（= All）なので、グループ補助 UI もそれを踏まえて表示する。
  const combosByGroup = useMemo(() => ({
    external: comboOptions.filter(c => c.group === 'external'),
    internal: comboOptions.filter(c => c.group === 'internal'),
  }), [comboOptions]);

  // 「空配列 = All」を考慮して、ある combo が実際に有効か判定する。
  const isComboActive = (key) => selectedCombos.length === 0 || selectedCombos.includes(key);

  // グループ内の combo が全部有効か（空配列=All も全有効として扱う）。
  const isGroupAllActive = (groupCombos) => groupCombos.length > 0 && groupCombos.every(c => isComboActive(c.key));

  // グループ単位のトグル。空配列(All)状態から個別操作するときは、
  // まず全 combo を明示選択した状態に展開してから差分を適用する。
  const toggleGroup = (groupCombos) => {
    const groupKeys = groupCombos.map(c => c.key);
    setSelectedCombos(prev => {
      const base = prev.length === 0 ? allComboKeys.slice() : prev.slice();
      const allOn = groupKeys.every(k => base.includes(k));
      let next = allOn
        ? base.filter(k => !groupKeys.includes(k))       // グループ全 off
        : Array.from(new Set([...base, ...groupKeys]));   // グループ全 on
      // 結果が全 combo なら空配列(All)に正規化して見た目を揃える。
      if (allComboKeys.length && allComboKeys.every(k => next.includes(k))) next = [];
      return next;
    });
  };
  const toggleAgent = (id) => toggleInSet(setAgentFilter, agentIds(), id);

  // ============================================
  // Heatmap と Line Chart の横スクロール同期
  // ============================================
  // heatmap / line chart / sequential flow は同じ inner width（LABEL_COL + buckets * cell.w）
  // なので、あるペインの scrollLeft を他の全ペインにミラーすれば time 軸が常に一致する。
  // guard で echo ループを防ぐ。（3ペインに拡張。sequential flow も heatmap と連動する。）
  const heatmapScrollRef = useRef(null);
  const lineScrollRef = useRef(null);
  const seqScrollRef = useRef(null);
  const scrollGuardRef = useRef(false);
  const syncScroll = (srcEl) => {
    if (scrollGuardRef.current || !srcEl) return;
    const panes = [heatmapScrollRef.current, lineScrollRef.current, seqScrollRef.current];
    scrollGuardRef.current = true;
    for (const el of panes) {
      if (el && el !== srcEl && el.scrollLeft !== srcEl.scrollLeft) el.scrollLeft = srcEl.scrollLeft;
    }
    requestAnimationFrame(() => { scrollGuardRef.current = false; });
  };
  const handleHeatmapScroll = () => syncScroll(heatmapScrollRef.current);
  const handleLineScroll = () => syncScroll(lineScrollRef.current);
  const handleSeqScroll = () => syncScroll(seqScrollRef.current);

  // network専用 filter の toggle / helper（heatmapには影響しない）
  const toggleNetCombo = (t) => toggleInSet(setNetCombos, allComboKeys, t);
  // network の channel も heatmap と同じ external / internal グループで扱う。
  const isNetComboActive = (key) => netCombos.length === 0 || netCombos.includes(key);
  const isNetGroupAllActive = (groupCombos) => groupCombos.length > 0 && groupCombos.every(c => isNetComboActive(c.key));
  const toggleNetGroup = (groupCombos) => {
    const groupKeys = groupCombos.map(c => c.key);
    setNetCombos(prev => {
      const base = prev.length === 0 ? allComboKeys.slice() : prev.slice();
      const allOn = groupKeys.every(k => base.includes(k));
      let next = allOn
        ? base.filter(k => !groupKeys.includes(k))
        : Array.from(new Set([...base, ...groupKeys]));
      if (allComboKeys.length && allComboKeys.every(k => next.includes(k))) next = [];
      return next;
    });
  };
  const toggleNetAgent = (id) => toggleInSet(setNetAgentFilter, agentIds(), id);
  const useFullNetTimeRange = () => { setNetStartTime(apiTimeToInputValue(options.min_time)); setNetEndTime(apiTimeToInputValue(options.max_time)); };
  const clearNetTimeRange = () => { setNetStartTime(''); setNetEndTime(''); };

  // すべての filter を既定値に戻す（view mode = granularity / heatmap mode / layout /
  // node-edge metric は「絞り込み」ではないので保持する）。
  const clearAllFilters = () => {
    // heatmap filters
    setSearchKeyword('');
    setMergerOnly(false);
    setSelectedCombos([]);
    setSelectedTextSources([]);
    setAgentFilter([]);
    setHeatmapSort({ key: 'agent_id', dir: 'asc' });
    // network filters
    setNetMirrorsHeatmap(false);
    setNetFollowsTimeline(false);
    setNetworkSort({ nodeSize: 'messages', edgeWeight: 'weight' });
    setColorBySentiment(false);
    setShowAjay(false);
    setNetMergerOnly(false);
    setNetCombos([]);
    setNetAgentFilter([]);
    setNetStartTime('');
    setNetEndTime('');
    // crisis timeline → 全期間に戻す
    setPlaying(false);
    setTimelineStartIdx(0);
    if (timeline.length) setTimelineIdx(timeline.length - 1);
  };

  // ============================================
  // heatmap cell click → message detail
  // ============================================
  async function selectCell(agent, bucket) {
    setSelected({ agent, bucket });
    setIsMessageDetailCollapsed(false); // クリック時はパネルを開く
    // 別cellを選んだら単一message選択はリセット
    setSelectedMessageId(null);
    setMessageContext(null);
    setContextStatus('');

    const p = new URLSearchParams(commonQuery);
    p.set('agent_id', agent.agent_id);
    p.set('bucket', bucket);
    p.set('mode', 'both');
    p.set('top_n', '10');

    try {
      const [msgRes, roundRes, keywordRes] = await Promise.all([
        fetch(`${API}/api/messages?${p.toString()}`),
        fetch(`${API}/api/rounds?bucket=${encodeURIComponent(bucket)}&granularity=${granularity}`),
        fetch(`${API}/api/keywords?${p.toString()}`),
      ]);
      setMessages(msgRes.ok ? await msgRes.json() : []);
      setRounds(roundRes.ok ? await roundRes.json() : []);
      const kw = keywordRes.ok ? await keywordRes.json() : {};
      setKeywords({ close_keywords: kw.close_keywords || [], far_keywords: kw.far_keywords || [] });
    } catch (e) {
      setMessages([]);
      setRounds([]);
      setKeywords({ close_keywords: [], far_keywords: [] });
      setStatus('Could not load message details (is the backend running?).');
    }
  }

  // ============================================
  // network edge click → edge messages (同じ chat panel を再利用)
  // ============================================
  // useCallback必須: これがNetworkVisualizationのpropとしてD3描画effectの
  // dependency arrayに入っているため、毎render新しい関数参照になると
  // effect全体が再実行され、drag等で動かしたnode位置がリセットされてしまう
  // （layoutが"resetする"バグの原因だった）。networkQueryが変わらない限り
  // 同じ関数参照を保つことでeffectの不要な再実行を防ぐ。
  // node クリックで選択、同じ node を再クリックで選択解除。
  // useCallback で参照を安定させ、NetworkVisualization の描画 effect が
  // 毎 render 再実行されて drag 位置がリセットされるのを防ぐ（selectEdge と同じ理由）。
  const handleSelectNode = useCallback((id) => {
    setSelectedNetworkNode(prev => (prev === id ? null : id));
  }, []);

  const selectEdge = useCallback(async (edge) => {
    const sourceLabel = AGENTS[edge.source]?.label || edge.source;
    const targetLabel = edge.inferred ? 'Ajay' : (AGENTS[edge.target]?.label || edge.target);
    const key = `${edge.source}>${edge.target}>${edge.channel}`;
    setSelectedEdge({
      key,
      source: edge.source,
      target: edge.target,
      channel: edge.channel,
      inferred: !!edge.inferred,
      sourceLabel,
      targetLabel,
    });
    setIsEdgeDetailCollapsed(false);
    // 別edgeを選んだら単一message選択はリセット（heatmapのcell選択と同じ挙動）
    setSelectedMessageId(null);
    setMessageContext(null);
    setContextStatus('');

    const p = new URLSearchParams(networkQuery);
    p.set('source', edge.source);
    p.set('target', edge.target);
    if (!edge.inferred) p.set('channel', edge.channel || '');

    try {
      const res = await fetch(`${API}/api/edge-messages?${p.toString()}`);
      setEdgeMessages(res.ok ? await res.json() : []);
    } catch (e) {
      setEdgeMessages([]);
      setStatus('Could not load edge messages (is the backend running?).');
    }
  }, [networkQuery]);

  // ============================================
  // "Ajay's hints timeline" — Ajayを言及するmessageを時系列で開く
  // 現在のnetwork filter（networkQuery）をそのまま使う。
  // ============================================
  const openAjayTimeline = useCallback(async () => {
    setAjayTimelineOpen(true);
    setAjayTimelineStatus('loading');
    try {
      const res = await fetch(`${API}/api/ajay-timeline?${networkQuery}`);
      if (!res.ok) throw new Error(`ajay-timeline ${res.status}`);
      setAjayTimelineMessages(await res.json());
      setAjayTimelineStatus('');
    } catch (e) {
      setAjayTimelineMessages([]);
      setAjayTimelineStatus('error');
    }
  }, [networkQuery]);

  // 単一messageをクリック → 関連message(context)を取得
  async function selectMessage(messageId) {
    if (!messageId) return;
    setSelectedMessageId(messageId);
    setContextStatus('loading');
    setFlowOpen(true); // open the related-messages chat popup immediately
    try {
      const res = await fetch(`${API}/api/messages/${encodeURIComponent(messageId)}/context`);
      if (!res.ok) throw new Error(`context ${res.status}`);
      setMessageContext(await res.json());
      setContextStatus('');
    } catch (e) {
      setMessageContext(null);
      setContextStatus('error');
    }
  }

  // sequential flow: node クリックで event を選択（同じ node 再クリックで解除）。
  const handleSelectSeqEvent = useCallback((id) => {
    setSeqEventId(cur => (cur === id ? null : id));
  }, []);

  // 選択中 event の「決定的に関連する message」を id 指定でまとめて取得（順序保持）。
  useEffect(() => {
    if (!seqEventId) { setSeqEventMessages([]); setSeqMsgStatus(''); return; }
    const ev = SEQ_EVENTS.find(e => e.id === seqEventId);
    const ids = (ev && ev.related) || [];
    if (!ids.length) { setSeqEventMessages([]); setSeqMsgStatus(''); return; }
    let cancelled = false;
    setSeqMsgStatus('loading');
    (async () => {
      try {
        const p = new URLSearchParams();
        ids.forEach(i => p.append('ids', i));
        const res = await fetch(`${API}/api/messages-by-ids?${p.toString()}`);
        if (!res.ok) throw new Error(`messages-by-ids ${res.status}`);
        const rows = await res.json();
        if (!cancelled) { setSeqEventMessages(rows); setSeqMsgStatus(''); }
      } catch (e) {
        if (!cancelled) { setSeqEventMessages([]); setSeqMsgStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [seqEventId]);

  // close / far keyword クリック → 既存keyword searchを再利用
  const onKeywordClick = (kw) => {
    setSearchKeyword(kw);
  };

  async function reloadDb() {
    setStatus('Reloading Neo4j data…');
    await fetch(`${API}/admin/reload`, { method: 'POST' });
    await loadOptions();
    setStatus('Reloaded. Extended schema (reply graph + stock price) was rebuilt.');
  }

  // network に渡す実効 node-size metric。
  // 'heatmap' mode のときは heatmap の sort key を node size にマップする。
  //   sentiment -> |sentiment| サイズ、それ以外（agent_id / total）-> messages サイズ。
  //   ※ agent_id は名前順なので「大きさ」を持たない。順序は heatmap rank chip で可視化する。
  const effectiveNetworkSize = netMirrorsHeatmap
    ? ({ agent_id: 'messages', total: 'messages', sentiment: 'sentiment' }[heatmapSort.key] || 'messages')
    : networkSort.nodeSize;

  // heatmap の並び順（sortedAgents の agent_id 列）を network に渡し、
  // ノードに rank chip (#1, #2, …) を出して agent / total / sentiment いずれの
  // sort でも「heatmap の並び」が network に反映されるようにする。
  const heatmapOrder = useMemo(
    () => (sortedAgents || []).map(a => a.agent_id),
    [sortedAgents]
  );

  // Agent type filter は network 側だけで client-side に適用する（heatmap非干渉）。
  // node を絞ると、NetworkVisualization 側が dangling edge を自動的に落とす。
  const displayNetwork = useMemo(() => {
    if (netMirrorsHeatmap || !netAgentFilter.length) return network;
    const keep = new Set(netAgentFilter);
    // inferred ノード（Ajay）は agent filter から除外しない
    const nodes = (network.nodes || []).filter(n => keep.has(n.id) || n.inferred);
    const keepIds = new Set(nodes.map(n => n.id));
    const edges = (network.edges || []).filter(e => keepIds.has(e.source) && keepIds.has(e.target));
    return { ...network, nodes, edges };
  }, [network, netAgentFilter, netMirrorsHeatmap]);

  const cell = CELL[granularity];
  const buckets = heatmap.time_buckets || [];

  // Olay işaretleri (leak / embargo) → bucket eşlemesi. Heatmap kolon başlığında
  // nokta + kolon hücrelerinde renkli sol kenar olarak gösterilir.
  const markersByBucket = useMemo(() => {
    const map = new Map();
    EVENT_MARKERS.forEach(mk => {
      const b = timeToBucket(mk.time, granularity);
      if (!map.has(b)) map.set(b, []);
      map.get(b).push(mk);
    });
    return map;
  }, [granularity]);

  // 選択中cellのsummary値
  const selectedCellData = selected ? cellMap.get(`${selected.agent.agent_id}|${selected.bucket}`) : null;
  const selectedSemantic = selectedCellData ? selectedCellData.semantic_distance_prev : null; 

  return (
    <div className="app">
      <header className="compact-header">
        <h1>VAST MC1 — Agent communication analysis</h1>
        <button className="reload" onClick={reloadDb}><RefreshCcw size={16} /> Reload DB</button>
      </header>

      {/* ============================================
          Global visibility controls (画面最上部)
          ============================================ */}
      <section className="global-controls">
        <span className="gc-label">Show visualizations:</span>
        <label className="check"><input type="checkbox" checked={showSeqFlow} onChange={e => setShowSeqFlow(e.target.checked)} disabled={sideBySide} /> Event flow</label>
        <label className="check"><input type="checkbox" checked={showHeatmap} onChange={e => setShowHeatmap(e.target.checked)} /> Heatmap</label>
        <label className="check"><input type="checkbox" checked={showLineChart} onChange={e => setShowLineChart(e.target.checked)} /> Line Chart</label>
        <label className="check"><input type="checkbox" checked={showNetwork} onChange={e => setShowNetwork(e.target.checked)} /> Network</label>
        <button type="button" className={`fp-toggle gc-compare-toggle ${sideBySide ? 'on' : ''}`}
          onClick={() => setSideBySide(v => !v)}
          title="Show the heatmap and network side by side for comparison (hides filter panels and the line chart while on).">
          {sideBySide ? '◧ Side-by-side: on' : '◧ Side-by-side'}
        </button>
        <button type="button" className="fp-toggle gc-filters-toggle" disabled={sideBySide} onClick={() => setFiltersOpen(o => !o)}>
          {effFiltersOpen ? 'Hide filters' : 'Show filters'}
        </button>
        <button type="button" className="fp-toggle gc-clear-filters" onClick={clearAllFilters}
          title="Reset every filter (heatmap + network + crisis timeline) to defaults. View modes like Daily/Hourly are kept.">
          Clear all filters
        </button>
        <div className="gc-counts">
          Merger-related keyword: <b>{options.combined_merger_count}</b> / {options.total_count}
          {' · '}Content: {options.merger_count} {' · '}Inner thought: {options.internal_merger_count}
        </div>
      </section>

      {/* ============================================
          Crisis timeline slider (drives all three views)
          ============================================ */}
      <CrisisTimeline
        timeline={timeline}
        idx={timelineIdx}
        setIdx={setTimelineIdx}
        startIdx={timelineStartIdx}
        setStartIdx={setTimelineStartIdx}
        playing={playing}
        onTogglePlay={togglePlay}
        granularity={granularity}
        setGranularity={setGranularity}
      />

      {status && <div className="status">{status}</div>}

      {/* ============================================
          VISUALIZATION AREA（side-by-side のときは compare-row で横並び）
          ============================================ */}
      <div className={sideBySide ? 'compare-row' : ''}>
      {/* ============================================
          HEATMAP SECTION : filter(左) | heatmap+detail+linechart(右)
          ============================================ */}
      {(showHeatmap || effShowLineChart || effShowSeqFlow) && (
        <section className={`section heatmap-section ${effFiltersOpen ? '' : 'filters-hidden'}`}>
          {/* ---- left: heatmap filter panel (collapsed 時は描画しない=全幅) ---- */}
          {effFiltersOpen && (
          <aside className="filter-panel">
            <div className="fp-title">
              <span>Heatmap filters</span>
              <button type="button" className="fp-toggle" onClick={() => setFiltersOpen(false)}>
                Hide
              </button>
            </div>

            {(
              <div className="fp-body">
                {/* basics (常時表示・コンパクト) */}
                <div className="control-block">
                  <label>Search keyword
                    <input type="text" value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)}
                      placeholder="e.g. merger, embargo, lawsuit" />
                  </label>
                  <div className="muted small">Searches content + inner thoughts. With a keyword, cell value = matches.</div>
                </div>

                <Collapsible title="Heatmap mode" defaultOpen={true}>
                  <div className="seg seg-stack">
                    {[['count', 'Count'], ['sentiment', 'BERT sentiment'], ['semantic_change', 'Semantic change']].map(([v, l]) => (
                      <button key={v} className={`seg-btn ${heatmapMode === v ? 'on' : ''}`} onClick={() => setHeatmapMode(v)}>{l}</button>
                    ))}
                  </div>
                </Collapsible>

                <Collapsible title="Message channel" defaultOpen={false}>
                  <label className="check select-all-row"><input type="checkbox" checked={selectedCombos.length === 0} onChange={() => setSelectedCombos([])} /> All</label>

                  {combosByGroup.external.length > 0 && (
                    <div className="type-group">
                      <label className="check group-head">
                        <input
                          type="checkbox"
                          checked={isGroupAllActive(combosByGroup.external)}
                          onChange={() => toggleGroup(combosByGroup.external)}
                        />
                        External <span className="muted small">(public-facing)</span>
                      </label>
                      <div className="type-grid indent">
                        {combosByGroup.external.map(c => (
                          <label className="check" key={c.key}><input type="checkbox" checked={isComboActive(c.key)} onChange={() => toggleCombo(c.key)} /> {c.label}</label>
                        ))}
                      </div>
                    </div>
                  )}

                  {combosByGroup.internal.length > 0 && (
                    <div className="type-group">
                      <label className="check group-head">
                        <input
                          type="checkbox"
                          checked={isGroupAllActive(combosByGroup.internal)}
                          onChange={() => toggleGroup(combosByGroup.internal)}
                        />
                        Internal <span className="muted small">(in-org conversation)</span>
                      </label>
                      <div className="type-grid indent">
                        {combosByGroup.internal.map(c => (
                          <label className="check" key={c.key}><input type="checkbox" checked={isComboActive(c.key)} onChange={() => toggleCombo(c.key)} /> {c.label}</label>
                        ))}
                      </div>
                    </div>
                  )}
                </Collapsible>

                <Collapsible title="Text sources" defaultOpen={false}>
                  <label className="check select-all-row"><input type="checkbox" checked={selectedTextSources.length === 0} onChange={() => setSelectedTextSources([])} /> All</label>
                  {/* content は単独。inner thought 3つは「Inner thought」グループでまとめて切替可能 */}
                  <div className="type-grid">
                    <label className="check"><input type="checkbox" checked={isInSet(selectedTextSources, 'content')} onChange={() => toggleTextSource('content')} /> {TEXT_SOURCE_LABELS['content']}</label>
                  </div>
                  <div className="type-group">
                    <label className="check group-head">
                      <input type="checkbox" checked={isInnerAllActive} onChange={toggleInnerThoughts} />
                      Inner thought <span className="muted small">(all 3)</span>
                    </label>
                    <div className="type-grid indent">
                      {INNER_THOUGHT_SOURCES.map(s => (
                        <label className="check" key={s}><input type="checkbox" checked={isInSet(selectedTextSources, s)} onChange={() => toggleTextSource(s)} /> {TEXT_SOURCE_LABELS[s] || s}</label>
                      ))}
                    </div>
                  </div>
                </Collapsible>

                <div className="control-block">
                  <div className="merger-check-row">
                    <label className="check merger-check">
                      <input type="checkbox" checked={mergerOnly} onChange={e => setMergerOnly(e.target.checked)} />
                      Merger-related only in selected text sources
                    </label>
                    <span className="kw-help" tabIndex={0}
                      title={`Merger-related keywords: ${MERGER_KEYWORDS.join(', ')}`}
                      aria-label={`Merger-related keywords: ${MERGER_KEYWORDS.join(', ')}`}>?</span>
                  </div>
                </div>

                <Collapsible title="Agents" defaultOpen={false}>
                  <label className="check select-all-row"><input type="checkbox" checked={agentFilter.length === 0} onChange={() => setAgentFilter([])} /> All</label>
                  <div className="type-grid">
                    {(options.agents || []).map(a => (
                      <label className="check" key={a.agent_id}>
                        <input type="checkbox" checked={isInSet(agentFilter, a.agent_id)} onChange={() => toggleAgent(a.agent_id)} />
                        <span className="agent-dot" style={{ background: AGENTS[a.agent_id]?.color || '#888' }} /> {a.agent_label}
                      </label>
                    ))}
                  </div>
                </Collapsible>

                <Collapsible title="Close meaning keywords" defaultOpen={true}>
                  {!selected && <div className="muted small">Click a heatmap cell to extract keywords from its messages.</div>}
                  {keywords.close_keywords?.length > 0 && (
                    <>
                      <div className="kw-group-label">Close to meaning</div>
                      <div className="chips clickable">
                        {keywords.close_keywords.map(k => (
                          <button key={`c-${k.keyword}`} className="kw-chip" onClick={() => onKeywordClick(k.keyword)} title="Search this keyword">
                            {k.keyword} <span className="kw-score">{Number(k.similarity).toFixed(2)}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </Collapsible>
              </div>
            )}
          </aside>
          )}

          {/* ---- right: sequential flow (heatmap の上) + heatmap + detail + line chart ---- */}
          <div className="viz-col">
            {/* ---- Sequential flow（heatmap の x 軸に合わせた横時系列。スクロール連動） ---- */}
            {effShowSeqFlow && (
              <SequentialFlow
                granularity={granularity}
                buckets={buckets}
                scrollRef={seqScrollRef}
                onScroll={handleSeqScroll}
                selectedEventId={seqEventId}
                onSelectEvent={handleSelectSeqEvent}
                eventMessages={seqEventMessages}
                eventMessagesStatus={seqMsgStatus}
                selectedMessageId={selectedMessageId}
                onSelectMessage={selectMessage}
              />
            )}
            {showHeatmap && (
            <div className="heatmap-card">
              <div className="heatmap-title">
                <div>
                  <h2>{granularity === 'daily' ? 'Daily' : 'Hourly'} · {heatmapMode === 'count' ? 'message volume' : heatmapMode === 'sentiment' ? 'BERT sentiment' : 'semantic change'}</h2>
                  <p className="muted small">
                    {selectedCombos.length === 0 ? 'All channels' : selectedCombos.map(comboLabel).join(', ')}
                    {' / '}{selectedTextSources.length === 0 ? 'All text' : selectedTextSources.map(s => TEXT_SOURCE_LABELS[s] || s).join(', ')}
                    {searchKeyword.trim() ? ` / Keyword: ${searchKeyword.trim()}` : ''}
                  </p>
                </div>
                {loading && <span className="muted">Loading…</span>}
              </div>

              {/* legend */}
              <div className="legend">
                {heatmapMode === 'count' && <span className="muted small">Fewer <span className="lg-swatch" style={{ background: '#e3eefb' }} /><span className="lg-swatch" style={{ background: '#93beec' }} /><span className="lg-swatch" style={{ background: '#558fd8' }} /><span className="lg-swatch" style={{ background: '#1a5cc0' }} /> more messages · log scale · <span className="lg-swatch" style={{ background: '#10202f' }} /> empty</span>}
                {heatmapMode === 'sentiment' && <span className="muted small"><span className="lg-swatch" style={{ background: '#e24b4a' }} /> negative <span className="lg-swatch" style={{ background: '#9aa7b5' }} /> neutral <span className="lg-swatch" style={{ background: '#4ade80' }} /> positive · empty = no messages</span>}
                {heatmapMode === 'semantic_change' && <span className="muted small">Semantic distance: <span className="lg-swatch" style={{ background: '#2a335e' }} /> similar → <span className="lg-swatch" style={{ background: '#9d4ddd' }} /> different · empty = no comparable messages</span>}
              </div>

              <div className="heatmap-scroll" ref={heatmapScrollRef} onScroll={handleHeatmapScroll}>
                <div className="heatmap-grid" style={{ gridTemplateColumns: `${LABEL_COL}px repeat(${buckets.length || 1}, ${cell.w}px)`, gridAutoRows: `${cell.h}px` }}>
                  <div className="corner">Agent \ Time</div>
                  {buckets.map(b => {
                    const mks = markersByBucket.get(b);
                    return (
                      <button key={b}
                        className={`bucket-head ${mks ? 'has-marker' : ''}`}
                        style={mks ? { '--mk-color': mks[0].color } : undefined}
                        title={mks ? `${b} — ${mks.map(m => m.label).join(' · ')}` : b}
                        onClick={() => selectCell({ agent_id: 'ALL', agent_label: 'All agents' }, b)}>
                        {shortBucket(b, granularity)}{mks && <span className="mk-dot" />}
                      </button>
                    );
                  })}

                  {sortedAgents.map(agent => (
                    <React.Fragment key={agent.agent_id}>
                      {/* Görünümler arası bağlantı (brushing): satır etiketine tıklayınca
                          network'te aynı agent'ın node'u seçilir; network'te node seçilince
                          de bu satır vurgulanır. Tekrar tıklama seçimi kaldırır. */}
                      <div
                        className={`agent-label ${selectedNetworkNode === agent.agent_id ? 'row-selected' : ''}`}
                        style={{ borderLeft: `3px solid ${AGENTS[agent.agent_id]?.color || '#888'}` }}
                        onClick={() => handleSelectNode(agent.agent_id)}
                        title="Click to highlight this agent in the network (click again to deselect)"
                        role="button" tabIndex={0}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleSelectNode(agent.agent_id); }}>
                        {agent.agent_label}
                      </div>
                      {buckets.map(b => {
                        const c = cellMap.get(`${agent.agent_id}|${b}`);
                        const count = c?.message_count || 0;
                        let style;
                        let title;
                        let cellValue = '';
                        const isSel = selected && selected.agent.agent_id === agent.agent_id && selected.bucket === b;
                        if (heatmapMode === 'count') {
                          const cc = countColor(count, heatmap.max_count);
                          style = { background: cc.bg, opacity: cc.opacity, color: cc.fg };
                          title = `${agent.agent_label} ${b}: ${count}${searchKeyword.trim() ? ` matches` : ' messages'}`;
                        } else if (heatmapMode === 'sentiment') {
                          const s = c?.bert_sentiment_score;
                          const cc = sentimentCellColor(count > 0 ? s : null);
                          style = { background: cc.bg, opacity: cc.opacity };
                          title = count === 0 ? `${agent.agent_label} ${b}: No messages`
                            : `${agent.agent_label} ${b}: sentiment ${s == null ? '—' : s.toFixed(2)} (${count} msgs)`;
                          cellValue = (count > 0 && s != null) ? fmtSigned(s) : '';
                        } else {
                          const dist = c ? c.semantic_distance_prev : null;
                          const cc = semanticCellColor(dist);
                          style = { background: cc.bg, opacity: cc.opacity };
                          title = dist == null ? `${agent.agent_label} ${b}: No comparable messages`
                            : `${agent.agent_label} ${b}: semantic distance ${dist.toFixed(2)}`;
                          cellValue = dist == null ? '' : dist.toFixed(2);
                        }
                        const mks = markersByBucket.get(b);
                        return (
                          <button key={`${agent.agent_id}-${b}`}
                            className={`cell ${heatmapMode !== 'count' ? 'cell-num' : ''} ${isSel ? 'cell-selected' : ''} ${mks ? 'cell-marked' : ''}`}
                            style={mks ? { ...style, '--mk-color': mks[0].color } : style} title={title}
                            onClick={() => selectCell(agent, b)}>
                            {heatmapMode === 'count' ? (count || '') : cellValue}
                          </button>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
            )}

            {/* ---- Message Detail Panel (collapsible, directly under heatmap) ---- */}
            {showHeatmap && (
            <MessageDetailPanel
              selected={selected}
              selectedCellData={selectedCellData}
              selectedSemantic={selectedSemantic}
              semanticComparisonMode={semanticComparisonMode}
              collapsed={isMessageDetailCollapsed}
              setCollapsed={setIsMessageDetailCollapsed}
              messages={messages}
              rounds={rounds}
              selectedMessageId={selectedMessageId}
              messageContext={messageContext}
              contextStatus={contextStatus}
              onSelectMessage={selectMessage}
              onOpenFlow={() => setFlowOpen(true)}
            />
            )}

            {/* ---- Line Chart (under the detail panel, x-axis aligned with heatmap) ---- */}
            {effShowLineChart && (
              <>
                <div className="lc-series-controls">
                  <span className="control-title">Line chart series:</span>
                  <label className="check"><input type="checkbox" checked={showStockPriceLine} onChange={e => setShowStockPriceLine(e.target.checked)} /> <span className="lg-swatch" style={{ background: '#22d3ee' }} /> Stock price</label>
                  <label className="check"><input type="checkbox" checked={showBertSentimentLine} onChange={e => setShowBertSentimentLine(e.target.checked)} /> <span className="lg-swatch" style={{ background: '#f59e0b' }} /> Market sentiment</label>
                </div>
                <StockSentimentLineChart data={lineChart} granularity={granularity}
                  showStock={showStockPriceLine} showSentiment={showBertSentimentLine}
                  scrollRef={lineScrollRef} onScroll={handleLineScroll} />
              </>
            )}
          </div>
        </section>
      )}

      {/* ============================================
          NETWORK SECTION : filter(左) | network(右)
          ============================================ */}
      {showNetwork && (
        <section className={`section network-section ${effFiltersOpen ? '' : 'filters-hidden'}`}>
          {effFiltersOpen && (
          <aside className="filter-panel">
            <div className="fp-title">
              <span>Network controls</span>
              <button type="button" className="fp-toggle" onClick={() => setFiltersOpen(false)}>
                Hide
              </button>
            </div>

            {(
              <div className="fp-body">
                <div className="muted small">These filters apply to the network only — they don't change heatmap calculations.</div>

                <Collapsible title="Network filters" defaultOpen={true}>
                  {netMirrorsHeatmap && <div className="muted small">Mirroring heatmap — these network filters are taken from the heatmap.</div>}
                  <div className={netMirrorsHeatmap ? 'disabled' : ''}>
                  <div className="control-title">Message channel</div>
                  <label className="check select-all-row"><input type="checkbox" checked={netCombos.length === 0} onChange={() => setNetCombos([])} /> All</label>
                  {combosByGroup.external.length > 0 && (
                    <div className="type-group">
                      <label className="check group-head">
                        <input type="checkbox" checked={isNetGroupAllActive(combosByGroup.external)} onChange={() => toggleNetGroup(combosByGroup.external)} />
                        External <span className="muted small">(public-facing)</span>
                      </label>
                      <div className="type-grid indent">
                        {combosByGroup.external.map(c => (
                          <label className="check" key={`net-${c.key}`}><input type="checkbox" checked={isNetComboActive(c.key)} onChange={() => toggleNetCombo(c.key)} /> {c.label}</label>
                        ))}
                      </div>
                    </div>
                  )}
                  {combosByGroup.internal.length > 0 && (
                    <div className="type-group">
                      <label className="check group-head">
                        <input type="checkbox" checked={isNetGroupAllActive(combosByGroup.internal)} onChange={() => toggleNetGroup(combosByGroup.internal)} />
                        Internal <span className="muted small">(in-org conversation)</span>
                      </label>
                      <div className="type-grid indent">
                        {combosByGroup.internal.map(c => (
                          <label className="check" key={`net-${c.key}`}><input type="checkbox" checked={isNetComboActive(c.key)} onChange={() => toggleNetCombo(c.key)} /> {c.label}</label>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="control-title">Agent type</div>
                  <label className="check select-all-row"><input type="checkbox" checked={netAgentFilter.length === 0} onChange={() => setNetAgentFilter([])} /> All</label>
                  <div className="type-grid">
                    {(options.agents || []).map(a => (
                      <label className="check" key={`net-a-${a.agent_id}`}>
                        <input type="checkbox" checked={isInSet(netAgentFilter, a.agent_id)} onChange={() => toggleNetAgent(a.agent_id)} />
                        <span className="agent-dot" style={{ background: AGENTS[a.agent_id]?.color || '#888' }} /> {a.agent_label}
                      </label>
                    ))}
                  </div>
                  </div>
                </Collapsible>

                <div className="control-block">
                  {netMirrorsHeatmap && <div className="muted small">Mirroring heatmap — taken from the heatmap.</div>}
                  <div className="merger-check-row">
                    <label className={`check merger-check ${netMirrorsHeatmap ? 'disabled' : ''}`}>
                      <input type="checkbox" checked={netMergerOnly} disabled={netMirrorsHeatmap}
                        onChange={e => setNetMergerOnly(e.target.checked)} />
                      Merger-related keyword only
                    </label>
                    <span className="kw-help" tabIndex={0}
                      title={`Merger-related keywords: ${MERGER_KEYWORDS.join(', ')}`}
                      aria-label={`Merger-related keywords: ${MERGER_KEYWORDS.join(', ')}`}>?</span>
                  </div>
                </div>

                {/* networkLayout / networkSort / colorBySentiment の state は存在するのに
                    以前のリファクタで操作 UI が消えていた。ここで復元する。 */}
                <Collapsible title="Layout & metrics" defaultOpen={false}>
                  <div className="control-title">Layout</div>
                  <div className="seg">
                    {[['force', 'Default'], ['circle', 'Circle']].map(([v, l]) => (
                      <button key={v} className={`seg-btn ${networkLayout === v ? 'on' : ''}`}
                        onClick={() => setNetworkLayout(v)}>{l}</button>
                    ))}
                  </div>
                  {netMirrorsHeatmap && <div className="muted small">Mirroring heatmap — node size / edge width / color follow the heatmap.</div>}
                  <div className="control-title">Node size</div>
                  <div className={`seg seg-stack ${netMirrorsHeatmap ? 'disabled' : ''}`}>
                    {[['messages', 'Message count'], ['merger', 'Merger-related count'], ['sentiment', '|BERT sentiment|']].map(([v, l]) => (
                      <button key={v} className={`seg-btn ${networkSort.nodeSize === v ? 'on' : ''}`} disabled={netMirrorsHeatmap}
                        onClick={() => setNetworkSort(s => ({ ...s, nodeSize: v }))}>{l}</button>
                    ))}
                  </div>
                  <div className="control-title">Edge width</div>
                  <div className={`seg seg-stack ${netMirrorsHeatmap ? 'disabled' : ''}`}>
                    {[['weight', 'Reply count'], ['merger', 'Merger-related count']].map(([v, l]) => (
                      <button key={v} className={`seg-btn ${networkSort.edgeWeight === v ? 'on' : ''}`} disabled={netMirrorsHeatmap}
                        onClick={() => setNetworkSort(s => ({ ...s, edgeWeight: v }))}>{l}</button>
                    ))}
                  </div>
                  <label className={`check ${netMirrorsHeatmap ? 'disabled' : ''}`} style={{ marginTop: 6 }}>
                    <input type="checkbox" checked={colorBySentiment} disabled={netMirrorsHeatmap}
                      onChange={e => setColorBySentiment(e.target.checked)} />
                    Color nodes by BERT sentiment
                  </label>
                </Collapsible>

                <Collapsible title="Time range / sorting" defaultOpen={false}>
                  {netFollowsTimeline
                    ? <div className="muted small">Time window follows the crisis timeline — press Play above to animate. Uncheck “Follow timeline” above the graph to set a network-only range here.</div>
                    : <div className="muted small">Network-only time range. Independent of the heatmap and crisis timeline. Leave empty for the full range.</div>}
                  <div className={`time-inputs ${netFollowsTimeline ? 'disabled' : ''}`}>
                    <label>Start<input type="datetime-local" value={netStartTime} onChange={e => setNetStartTime(e.target.value)} /></label>
                    <label>End<input type="datetime-local" value={netEndTime} onChange={e => setNetEndTime(e.target.value)} /></label>
                  </div>
                  <div className={`time-actions ${netFollowsTimeline ? 'disabled' : ''}`}>
                    <button onClick={useFullNetTimeRange}>Use full range</button>
                    <button onClick={clearNetTimeRange}>Clear</button>
                  </div>
                  {netMirrorsHeatmap
                    ? <div className="follow-note">Network mirrors the heatmap's filters and sort order ({heatmapSort.key}, {heatmapSort.dir}). Node numbers #1…#N follow the heatmap row order.</div>
                    : netFollowsTimeline
                      ? <div className="muted small">“Follow timeline” keeps your own network filters while the time window tracks the crisis timeline.</div>
                      : <div className="muted small">Tip: use the mode selector above the graph to follow the timeline or mirror the heatmap.</div>}
                </Collapsible>

                <Collapsible title="Selected node" defaultOpen={true}>
                  {!selectedNetworkNode && <div className="muted small">Click a node to see its stats.</div>}
                  {selectedNetworkNode && (() => {
                    const n = (displayNetwork.nodes || []).find(x => x.id === selectedNetworkNode);
                    if (!n) return <div className="muted small">No data.</div>;
                    return (
                      <div className="node-detail">
                        <div className="nd-name" style={{ color: AGENTS[n.id]?.color }}>{n.label}</div>
                        <div className="nd-row"><span>Messages</span><b>{n.message_count}</b></div>
                        <div className="nd-row"><span>Merger-related</span><b>{n.merger_related_count}</b></div>
                        <div className="nd-row"><span>BERT sentiment</span><b>{n.bert_sentiment_score == null ? '—' : n.bert_sentiment_score.toFixed(2)}</b></div>
                      </div>
                    );
                  })()}
                </Collapsible>
              </div>
            )}
          </aside>
          )}

          <div className="viz-col">
            <div className="network-card">
              <div className="heatmap-title">
                <div className="nv-head-left">
                  <h2>Communication network (reply graph)</h2>
                  <span className="muted small">{(displayNetwork.nodes || []).filter(n => !n.inferred).length} agents{(displayNetwork.nodes || []).some(n => n.inferred) ? ' + Inferred Ajay (CEO of TenantThread) node' : ''} · {displayNetwork.edges?.length || 0} edges</span>
                </div>
                <div className="nv-head-right">
                  <label className="check ajay-toggle" title="Add 'Ajay' as an inferred node — Ajay is NOT in the data, only mentioned in messages. Edges = how often each agent mentions Ajay (in content + inner thoughts). Shown with a dashed/marked style.">
                    <input type="checkbox" checked={showAjay} onChange={e => setShowAjay(e.target.checked)} />
                    Inferred Ajay (CEO of TenantThread) node
                  </label>
                  <button type="button" className="ajay-hints-btn" onClick={openAjayTimeline}
                    title="Ajay is never the sender of a message — he's only quoted or referenced inside other agents' messages/inner thoughts. This opens those mentions in chronological order so you can read what he actually hinted at, instead of just a mention count.">
                    Ajay (CEO of TenantThread) hints timeline
                  </button>
                  <div className="netmode-toggles" role="group" aria-label="Network mode">
                    <label className="check netmode-toggle" title="Filters, sort order and node size come from the heatmap's own settings instead of network's own filters.">
                      <input type="checkbox" checked={netMirrorsHeatmap} onChange={e => setNetMirrorsHeatmap(e.target.checked)} />
                      Mirror heatmap filters
                    </label>
                    <label className="check netmode-toggle" title="Time window follows the crisis timeline (press Play above to animate) instead of a manual network-only range.">
                      <input type="checkbox" checked={netFollowsTimeline} onChange={e => setNetFollowsTimeline(e.target.checked)} />
                      Follow timeline
                    </label>
                  </div>
                </div>
              </div>
              {/* Follow timeline açıkken, network'ün üzerine mini playback HUD bindir:
                  tam ekran network izlerken bile round / tarih / headline ve Play
                  kontrolü görünür kalır (zaman akışı + graf gelişimi aynı anda). */}
              <div className="net-vis-stack">
                {netFollowsTimeline && timeline.length > 0 && (
                  <div className="net-time-hud">
                    <button className={`tl-play ${playing ? 'playing' : ''}`} onClick={togglePlay}
                      title={playing ? 'Pause' : 'Play the crisis timeline'}>
                      {playing ? <Pause size={13} /> : <Play size={13} />}
                    </button>
                    <input type="range" className="nth-range" min={0} max={timeline.length - 1} step={1}
                      value={timelineIdx}
                      onChange={e => setTimelineIdx(Math.max(Number(e.target.value), timelineStartIdx))}
                      aria-label="timeline round (network HUD)" />
                    <div className="nth-info">
                      <span className="nth-round">
                        Round {timelineStartIdx + 1}–{timelineIdx + 1} / {timeline.length}
                        <span className="nth-date">{' '}· {fmtRoundLabel(timeline[timelineIdx]?.hour)}</span>
                      </span>
                      {timeline[timelineIdx]?.event_headline && (
                        <span className="nth-headline">{timeline[timelineIdx].event_headline}</span>
                      )}
                    </div>
                  </div>
                )}
              <NetworkVisualization
                data={displayNetwork}
                layout={networkLayout}
                sizeMetric={effectiveNetworkSize}
                edgeMetric={netMirrorsHeatmap ? 'weight' : networkSort.edgeWeight}
                colorBySentiment={netMirrorsHeatmap ? heatmapSort.key === 'sentiment' : colorBySentiment}
                selectedNode={selectedNetworkNode}
                onSelectNode={handleSelectNode}
                selectedEdge={selectedEdge?.key}
                onSelectEdge={selectEdge}
                followingHeatmapSort={netMirrorsHeatmap}
                heatmapOrder={heatmapOrder}
                heatmapSortKey={heatmapSort.key}
                heatmapSortDir={heatmapSort.dir}
              />
              </div>
              {netMirrorsHeatmap && (
                <div className="muted small net-follow-note">
                  Mirroring heatmap: filters mirrored · node size = {effectiveNetworkSize} ·
                  {' '}numbered #1…#{heatmapOrder.length} by {{ agent_id: 'agent name', total: 'total messages', sentiment: 'mean sentiment' }[heatmapSort.key]} ({heatmapSort.dir})
                  {netFollowsTimeline ? ' · time window follows the crisis timeline' : " · time window is network's own manual range"}
                </div>
              )}
              {!netMirrorsHeatmap && netFollowsTimeline && (
                <div className="muted small net-follow-note">
                  Following timeline: your network filters apply · time window = current crisis-timeline round range · press Play above to animate.
                </div>
              )}

              {/* ---- Node Messages Panel: seçili node'un TÜM mesajları
                   (broadcast/root dahil — edge tıklamasıyla erişilemeyenler) ---- */}
              {selectedNetworkNode && selectedNetworkNode !== 'ajay' && (
                <NodeMessagesPanel
                  node={{ id: selectedNetworkNode, label: AGENTS[selectedNetworkNode]?.label || selectedNetworkNode }}
                  messages={nodeMessages}
                  collapsed={isNodeDetailCollapsed}
                  setCollapsed={setIsNodeDetailCollapsed}
                  selectedMessageId={selectedMessageId}
                  contextStatus={contextStatus}
                  onSelectMessage={selectMessage}
                  onOpenFlow={() => setFlowOpen(true)}
                />
              )}

              {/* ---- Edge Messages Panel (collapsible, directly under the network graph) ---- */}
              <EdgeMessagesPanel
                selectedEdge={selectedEdge}
                messages={edgeMessages}
                collapsed={isEdgeDetailCollapsed}
                setCollapsed={setIsEdgeDetailCollapsed}
                selectedMessageId={selectedMessageId}
                messageContext={messageContext}
                contextStatus={contextStatus}
                onSelectMessage={selectMessage}
                onOpenFlow={() => setFlowOpen(true)}
              />
            </div>
          </div>
        </section>
      )}
      </div>

      {/* AjayTimelineModal を先に描画: メッセージをクリックすると selectMessage が
          ConversationFlowModal を開くので、後から描画する ConversationFlowModal が
          常にその上に重なるようにする（同じ overlay の二重表示で隠れないように）。 */}
      <AjayTimelineModal
        open={ajayTimelineOpen}
        messages={ajayTimelineMessages}
        status={ajayTimelineStatus}
        onClose={() => setAjayTimelineOpen(false)}
        selectedMessageId={selectedMessageId}
        onSelectMessage={selectMessage}
      />

      <ConversationFlowModal
        open={flowOpen}
        context={messageContext}
        status={contextStatus}
        selectedMessageId={selectedMessageId}
        onClose={() => setFlowOpen(false)}
        onSelectMessage={selectMessage}
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

// ============================================

// ============================================

//

// ============================================

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { RefreshCcw, Play, Pause } from 'lucide-react';
import NetworkVisualization, { AGENTS, channelColor } from './network.jsx';

import { AgentIcon } from './agentIcons.jsx';
import './style.css';

import { API, TEXT_SOURCE_LABELS, visibilityGroupOf, CELL, LABEL_COL, EVENT_MARKERS } from './constants.js';
import {
  shortBucket, countColor, sentimentCellColor,
  fmtSigned, fmtRoundLabel, timeToBucket,
} from './utils.js';
import { Collapsible } from './components/Collapsible.jsx';
import { CrisisTimeline } from './components/CrisisTimeline.jsx';
import { StockSentimentLineChart } from './components/StockSentimentLineChart.jsx';
import { SequentialFlow } from './components/SequentialFlow.jsx';
import { SEQ_EVENTS, MERGER_KEYWORDS } from './constants.js';
import { loadCommIdMap } from './commIdMap.js';
import {
  MessageDetailPanel, EdgeMessagesPanel, NodeMessagesPanel, ConversationFlowModal,
} from './components/messagePanels.jsx';

function App() {

  const [granularity, setGranularity] = useState('hourly');
  const [mergerOnly, setMergerOnly] = useState(false);
  const [selectedCombos, setSelectedCombos] = useState([]);
  const [selectedTextSources, setSelectedTextSources] = useState([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [agentFilter, setAgentFilter] = useState([]);

  const [heatmapMode, setHeatmapMode] = useState('count'); // count | sentiment
  const [heatmapSort, setHeatmapSort] = useState({ key: 'agent_id', dir: 'asc' }); // key: agent_id|total|sentiment

  const [networkLayout, setNetworkLayout] = useState('force'); // force | circle
  const [networkSort, setNetworkSort] = useState({ nodeSize: 'messages' });

  const [colorBySentiment, setColorBySentiment] = useState(false);

  const [netMirrorsHeatmap, setNetMirrorsHeatmap] = useState(false);
  const [selectedNetworkNode, setSelectedNetworkNode] = useState(null);
  // ---- node click → Node Messages Panel (broadcast/root mesajlar dahil) ----
  const [nodeMessages, setNodeMessages] = useState([]);
  const [isNodeDetailCollapsed, setIsNodeDetailCollapsed] = useState(false);
  // ---- network edge click → Edge Messages Panel ----
  const [selectedEdge, setSelectedEdge] = useState(null); // { key, source, target, sourceLabel, targetLabel, channel, mention }
  const [edgeMessages, setEdgeMessages] = useState([]);
  const [isEdgeDetailCollapsed, setIsEdgeDetailCollapsed] = useState(false);

  const [netCombos, setNetCombos] = useState([]);
  const [netMergerOnly, setNetMergerOnly] = useState(false);
  const [netAgentFilter, setNetAgentFilter] = useState([]);

  const [filtersOpen, setFiltersOpen] = useState(true);

  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showLineChart, setShowLineChart] = useState(true);
  const [showNetwork, setShowNetwork] = useState(true);
  const [showSeqFlow, setShowSeqFlow] = useState(true);

  const [sideBySide, setSideBySide] = useState(false);
  const [showStockPriceLine, setShowStockPriceLine] = useState(true);

  const effFiltersOpen = filtersOpen && !sideBySide;
  const effShowLineChart = showLineChart && !sideBySide;

  const effShowSeqFlow = showSeqFlow && !sideBySide;
  const [showBertSentimentLine, setShowBertSentimentLine] = useState(true);

  const [timeline, setTimeline] = useState([]);          // [{idx,hour,cutoff,event_headline,total_msgs,merger_msgs,...}]
  const [timelineStartIdx, setTimelineStartIdx] = useState(0);
  const [timelineIdx, setTimelineIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

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

  const [seqEventId, setSeqEventId] = useState(null);
  const [seqEventMessages, setSeqEventMessages] = useState([]);
  const [seqMsgStatus, setSeqMsgStatus] = useState(''); // '', 'loading', 'error'

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  // ============================================

  // ============================================

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

    if (timelineStart) p.set('start_time', timelineStart);
    if (timelineEnd) p.set('end_time', timelineEnd);
    if (searchKeyword.trim()) p.set('keyword', searchKeyword.trim());
    return p.toString();
  }, [granularity, mergerOnly, selectedCombos, selectedTextSources, searchKeyword, timelineStart, timelineEnd]);

  // ============================================

  // ============================================
  const networkQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('granularity', granularity);

    // --- filter context ---
    if (netMirrorsHeatmap) {

      p.set('merger_only', mergerOnly ? 'true' : 'false');
      selectedCombos.forEach(t => p.append('message_types', t));
      selectedTextSources.forEach(s => p.append('text_sources', s));
      if (searchKeyword.trim()) p.set('keyword', searchKeyword.trim());
    } else {

      p.set('merger_only', netMergerOnly ? 'true' : 'false');
      netCombos.forEach(t => p.append('message_types', t));
    }

    if (timelineStart) p.set('start_time', timelineStart);
    if (timelineEnd) p.set('end_time', timelineEnd);
    return p.toString();
  }, [granularity, netMirrorsHeatmap,
      mergerOnly, selectedCombos, selectedTextSources, searchKeyword,
      netMergerOnly, netCombos,
      timelineStart, timelineEnd]);

  // ============================================

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
  // mesajlar dahil — bunlar edge tıklamasıyla görülemiyordu).
  useEffect(() => {
    if (!selectedNetworkNode) { setNodeMessages([]); return; }
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

    if (playing && timeline.length && timelineIdx >= timeline.length - 1) setPlaying(false);
  }, [timelineIdx, playing, timeline.length]);

  const togglePlay = () => {
    if (!timeline.length) return;

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

  // ============================================

  const sortedAgents = useMemo(() => {
    let agents = (heatmap.agents || []).slice();

    if (agentFilter.length > 0) {
      agents = agents.filter(a => agentFilter.includes(a.agent_id));
    }

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

  const isInSet = (selection, item) => selection.length === 0 || selection.includes(item);
  const toggleInSet = (setter, allItems, item) => setter(prev => {
    const base = prev.length === 0 ? allItems.slice() : prev.slice();
    let next = base.includes(item) ? base.filter(x => x !== item) : [...base, item];
    if (allItems.length && allItems.every(x => next.includes(x))) next = [];
    return next;
  });
  const agentIds = () => (options.agents || []).map(a => a.agent_id);

  // ============================================================

  // ============================================================

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

  const INNER_THOUGHT_SOURCES = ['reacting', 'rationalizing', 'deliberating'];
  const isInnerAllActive = INNER_THOUGHT_SOURCES.every(s => isInSet(selectedTextSources, s));
  const toggleInnerThoughts = () => {
    const allSources = options.text_sources || Object.keys(TEXT_SOURCE_LABELS);
    setSelectedTextSources(prev => {
      const base = prev.length === 0 ? allSources.slice() : prev.slice();
      const allOn = INNER_THOUGHT_SOURCES.every(s => base.includes(s));
      let next = allOn
        ? base.filter(s => !INNER_THOUGHT_SOURCES.includes(s))
        : Array.from(new Set([...base, ...INNER_THOUGHT_SOURCES]));
      if (allSources.length && allSources.every(s => next.includes(s))) next = [];
      return next;
    });
  };

  const combosByGroup = useMemo(() => ({
    external: comboOptions.filter(c => c.group === 'external'),
    internal: comboOptions.filter(c => c.group === 'internal'),
  }), [comboOptions]);

  const isComboActive = (key) => selectedCombos.length === 0 || selectedCombos.includes(key);

  const isGroupAllActive = (groupCombos) => groupCombos.length > 0 && groupCombos.every(c => isComboActive(c.key));

  const toggleGroup = (groupCombos) => {
    const groupKeys = groupCombos.map(c => c.key);
    setSelectedCombos(prev => {
      const base = prev.length === 0 ? allComboKeys.slice() : prev.slice();
      const allOn = groupKeys.every(k => base.includes(k));
      let next = allOn
        ? base.filter(k => !groupKeys.includes(k))
        : Array.from(new Set([...base, ...groupKeys]));

      if (allComboKeys.length && allComboKeys.every(k => next.includes(k))) next = [];
      return next;
    });
  };
  const toggleAgent = (id) => toggleInSet(setAgentFilter, agentIds(), id);

  // ============================================

  // ============================================

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

  const toggleNetCombo = (t) => toggleInSet(setNetCombos, allComboKeys, t);

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
    setNetworkSort({ nodeSize: 'messages' });
    setColorBySentiment(false);
    setNetMergerOnly(false);
    setNetCombos([]);
    setNetAgentFilter([]);

    setPlaying(false);
    setTimelineStartIdx(0);
    if (timeline.length) setTimelineIdx(timeline.length - 1);
  };

  // ============================================
  // heatmap cell click → message detail
  // ============================================
  async function selectCell(agent, bucket) {
    setSelected({ agent, bucket });
    setIsMessageDetailCollapsed(false);

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

  // ============================================

  const handleSelectNode = useCallback((id) => {
    setSelectedNetworkNode(prev => (prev === id ? null : id));
  }, []);

  const selectEdge = useCallback(async (edge) => {
    const sourceLabel = AGENTS[edge.source]?.label || edge.source;
    const targetLabel = AGENTS[edge.target]?.label || edge.target;
    // comms_huddle broadcast/action ayrı edge'ler olduğundan message_type,
    // mention edge'ler channel başına bölündüğü için via_channel da key'e girer.
    const key = `${edge.source}>${edge.target}>${edge.channel}${edge.message_type ? '>' + edge.message_type : ''}${edge.via_channel ? '>' + edge.via_channel : ''}`;
    setSelectedEdge({
      key,
      source: edge.source,
      target: edge.target,
      channel: edge.channel,
      message_type: edge.message_type || '',
      via_channel: edge.via_channel || '',
      mention: edge.channel === 'mention',
      sourceLabel,
      targetLabel,
    });
    setIsEdgeDetailCollapsed(false);

    setSelectedMessageId(null);
    setMessageContext(null);
    setContextStatus('');

    const p = new URLSearchParams(networkQuery);
    p.set('source', edge.source);
    p.set('target', edge.target);
    p.set('channel', edge.channel || '');
    if (edge.message_type) p.set('edge_message_type', edge.message_type);
    if (edge.via_channel) p.set('via_channel', edge.via_channel);

    try {
      const res = await fetch(`${API}/api/edge-messages?${p.toString()}`);
      setEdgeMessages(res.ok ? await res.json() : []);
    } catch (e) {
      setEdgeMessages([]);
      setStatus('Could not load edge messages (is the backend running?).');
    }
  }, [networkQuery]);

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

  const handleSelectSeqEvent = useCallback((id) => {
    setSeqEventId(cur => (cur === id ? null : id));
  }, []);

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

  const onKeywordClick = (kw) => {
    setSearchKeyword(kw);
  };

  async function reloadDb() {
    setStatus('Reloading Neo4j data…');
    await fetch(`${API}/admin/reload`, { method: 'POST' });
    await loadOptions();
    setStatus('Reloaded. Extended schema (reply graph + stock price) was rebuilt.');
  }

  const effectiveNetworkSize = netMirrorsHeatmap
    ? ({ agent_id: 'messages', total: 'messages', sentiment: 'sentiment' }[heatmapSort.key] || 'messages')
    : networkSort.nodeSize;

const HELP_SENTIMENT_SCALE = [
  'Sentiment is scored per message with DistilBERT (distilbert-base-uncased-finetuned-sst-2-english),',
  'a BERT-family classifier fine-tuned on SST-2.',
  "Each cell shows the mean score of that agent's messages in that time bucket.",
  '-1 = most negative, ~0 = neutral, +1 = most positive.',
  'Empty cells mean the agent sent no messages.',
].join(' ');

const HELP_NETWORK_FILTER = "These filters apply to the network only - they don't change heatmap calculations.";

const HELP_EXTERNAL_CHANNEL = 'Public posts have no recipients, so they never appear as edges - no edge color.';

  const heatmapOrder = useMemo(
    () => (sortedAgents || []).map(a => a.agent_id),
    [sortedAgents]
  );

  const displayNetwork = useMemo(() => {
    if (netMirrorsHeatmap || !netAgentFilter.length) return network;
    const keep = new Set(netAgentFilter);
    const nodes = (network.nodes || []).filter(n => keep.has(n.id));
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

  const selectedCellData = selected ? cellMap.get(`${selected.agent.agent_id}|${selected.bucket}`) : null;

  return (
    <div className="app">
      <header className="compact-header">
        <h1>VAST MC1 — Agent communication analysis</h1>
        <button className="reload" onClick={reloadDb}><RefreshCcw size={16} /> Reload DB</button>
      </header>

      <section className="global-controls">
        <span className="gc-label">Show visualizations:</span>
        <label className="check"><input type="checkbox" checked={showHeatmap} onChange={e => setShowHeatmap(e.target.checked)} /> Heatmap</label>
        <label className="check"><input type="checkbox" checked={showSeqFlow} onChange={e => setShowSeqFlow(e.target.checked)} disabled={sideBySide} /> Event flow</label>
        <label className="check"><input type="checkbox" checked={showLineChart} onChange={e => setShowLineChart(e.target.checked)} disabled={sideBySide} /> Line Chart</label>
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

      <div className={sideBySide ? 'compare-row' : ''}>
      {(showHeatmap || effShowLineChart || effShowSeqFlow) && (
        <section className={`section heatmap-section ${effFiltersOpen ? '' : 'filters-hidden'}`}>
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
                <div className="control-block">
                  <label>Search keyword
                    <input type="text" value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)}
                      placeholder="e.g. merger, embargo, lawsuit" />
                  </label>
                </div>

                <Collapsible title="Heatmap mode" defaultOpen={true}>
                  <div className="seg seg-stack">
                    {[['count', 'Count Heatmap'], ['sentiment', 'Sentiment Heatmap']].map(([v, l]) => (
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

                <Collapsible title="Agent type" defaultOpen={false}>
                  <label className="check select-all-row"><input type="checkbox" checked={agentFilter.length === 0} onChange={() => setAgentFilter([])} /> All</label>
                  <div className="type-grid">
                    {(options.agents || []).map(a => (
                      <label className="check" key={a.agent_id}>
                        <input type="checkbox" checked={isInSet(agentFilter, a.agent_id)} onChange={() => toggleAgent(a.agent_id)} />
                        <AgentIcon id={a.agent_id} size={15} /> {a.agent_label}
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

          <div className="viz-col">
            {showHeatmap && (
            <div className="heatmap-card">
              <div className="heatmap-title">
                <div>
                  <h2>{granularity === 'daily' ? 'Daily' : 'Hourly'} · {heatmapMode === 'count' ? 'message volume' : 'Sentiment Heatmap'}</h2>
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
                {heatmapMode === 'sentiment' && <span className="muted small"><span className="lg-swatch" style={{ background: '#e24b4a' }} /> −1 negative <span className="lg-swatch" style={{ background: '#9aa7b5' }} /> 0 neutral <span className="lg-swatch" style={{ background: '#378ADD' }} /> +1 positive<span className="kw-help" tabIndex={0} title={HELP_SENTIMENT_SCALE} aria-label={HELP_SENTIMENT_SCALE}>?</span></span>}
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
                        onClick={() => handleSelectNode(agent.agent_id)}
                        title="Click to highlight this agent in the network (click again to deselect)"
                        role="button" tabIndex={0}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleSelectNode(agent.agent_id); }}>
                        <AgentIcon id={agent.agent_id} size={15} />
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
                        } else {
                          const s = c?.bert_sentiment_score;
                          const cc = sentimentCellColor(count > 0 ? s : null);
                          style = { background: cc.bg, opacity: cc.opacity };
                          title = count === 0 ? `${agent.agent_label} ${b}: No messages`
                            : `${agent.agent_label} ${b}: sentiment ${s == null ? '—' : s.toFixed(2)} (${count} msgs)`;
                          cellValue = (count > 0 && s != null) ? fmtSigned(s) : '';
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

      {showNetwork && (
        <section className={`section network-section ${effFiltersOpen ? '' : 'filters-hidden'}`}>
          {effFiltersOpen && (
          <aside className="filter-panel">
            <div className="fp-title">
              <span>Network filter<span className="kw-help" tabIndex={0} title={HELP_NETWORK_FILTER} aria-label={HELP_NETWORK_FILTER}>?</span></span>
              <button type="button" className="fp-toggle" onClick={() => setFiltersOpen(false)}>
                Hide
              </button>
            </div>

            {(
              <div className="fp-body">
                {/* Heatmap filtre paneliyle aynı yapı: her filtre kendi Collapsible
                    başlığının altında, tıklayınca açılır (⑤). */}
                <Collapsible title="Message channel" defaultOpen={false}>
                  {netMirrorsHeatmap && <div className="muted small">Mirroring heatmap — these network filters are taken from the heatmap.</div>}
                  <div className={netMirrorsHeatmap ? 'disabled' : ''}>
                  <label className="check select-all-row"><input type="checkbox" checked={netCombos.length === 0} onChange={() => setNetCombos([])} /> All</label>
                  {combosByGroup.external.length > 0 && (
                    <div className="type-group">
                      <div className="merger-check-row">
                        <label className="check group-head">
                          <input type="checkbox" checked={isNetGroupAllActive(combosByGroup.external)} onChange={() => toggleNetGroup(combosByGroup.external)} />
                          External <span className="muted small">(public-facing)</span>
                        </label>
                        <span className="kw-help" tabIndex={0} title={HELP_EXTERNAL_CHANNEL} aria-label={HELP_EXTERNAL_CHANNEL}>?</span>
                      </div>
                      <div className="type-grid indent">
                        {combosByGroup.external.map(c => (
                          <label className="check" key={`net-${c.key}`}>
                            <input type="checkbox" checked={isNetComboActive(c.key)} onChange={() => toggleNetCombo(c.key)} />
                            {c.label}
                          </label>
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
                          <label className="check" key={`net-${c.key}`}>
                            <input type="checkbox" checked={isNetComboActive(c.key)} onChange={() => toggleNetCombo(c.key)} />
                            <span className="edge-swatch" style={{ background: channelColor(c.channel, c.message_type) }} /> {c.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  </div>
                </Collapsible>

                <Collapsible title="Agent type" defaultOpen={false}>
                  {netMirrorsHeatmap && <div className="muted small">Mirroring heatmap — taken from the heatmap.</div>}
                  <div className={netMirrorsHeatmap ? 'disabled' : ''}>
                  <label className="check select-all-row"><input type="checkbox" checked={netAgentFilter.length === 0} onChange={() => setNetAgentFilter([])} /> All</label>
                  <div className="type-grid">
                    {(options.agents || []).map(a => (
                      <label className="check" key={`net-a-${a.agent_id}`}>
                        <input type="checkbox" checked={isInSet(netAgentFilter, a.agent_id)} onChange={() => toggleNetAgent(a.agent_id)} />
                        <AgentIcon id={a.agent_id} size={15} /> {a.agent_label}
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
                    {[['messages', 'Message count'], ['merger', 'Merger-related count'], ['sentiment', 'Sentiment score']].map(([v, l]) => (
                      <button key={v} className={`seg-btn ${networkSort.nodeSize === v ? 'on' : ''}`} disabled={netMirrorsHeatmap}
                        onClick={() => setNetworkSort(s => ({ ...s, nodeSize: v }))}>{l}</button>
                    ))}
                  </div>
                </Collapsible>

                {netMirrorsHeatmap && (
                  <div className="follow-note">Network mirrors the heatmap's filters and sort order ({heatmapSort.key}, {heatmapSort.dir}). Node numbers #1…#N follow the heatmap row order.</div>
                )}

                <Collapsible title="Selected node" defaultOpen={true}>
                  {!selectedNetworkNode && <div className="muted small">Click a node to see its stats.</div>}
                  {selectedNetworkNode && (() => {
                    const n = (displayNetwork.nodes || []).find(x => x.id === selectedNetworkNode);
                    if (!n) return <div className="muted small">No data.</div>;
                    return (
                      <div className="node-detail">
                        <div className="nd-name">{n.label}</div>
                        <div className="nd-row"><span>Messages</span><b>{n.message_count}</b></div>
                        <div className="nd-row"><span>Merger-related</span><b>{n.merger_related_count}</b></div>
                        <div className="nd-row"><span>Sentiment score</span><b>{n.bert_sentiment_score == null ? '—' : n.bert_sentiment_score.toFixed(2)}</b></div>
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
                  <span className="muted small">{(displayNetwork.nodes || []).length} agents · {displayNetwork.edges?.length || 0} edges</span>
                </div>
                <div className="nv-head-right">
                  <div className="netmode-toggles" role="group" aria-label="Network mode">
                    <label className="check netmode-toggle" title="Filters, sort order and node size come from the heatmap's own settings instead of network's own filters.">
                      <input type="checkbox" checked={netMirrorsHeatmap} onChange={e => setNetMirrorsHeatmap(e.target.checked)} />
                      Mirror heatmap filters
                    </label>
                  </div>
                </div>
              </div>
              {/* Network her zaman crisis timeline'a bağlı: mini playback HUD ile
                  round / tarih / headline ve Play kontrolü network üzerinde görünür kalır. */}
              <div className="net-vis-stack">
                {timeline.length > 0 && (
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
                edgeMetric="weight"
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
                  {' '}· time window follows the crisis timeline
                </div>
              )}

              {/* ---- Node Messages Panel: seçili node'un TÜM mesajları
                   (broadcast/root dahil — edge tıklamasıyla erişilemeyenler) ---- */}
              {selectedNetworkNode && (
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

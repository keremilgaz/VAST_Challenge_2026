// ============================================
// Reactアプリのメインファイル (VAST Challenge Mini Challenge 1)
// ============================================
// このファイルは、ブラウザに表示される分析画面全体を作っています。
// 1つの画面で以下を比較できるように統合しています:
//
//   - Agent × Time の Heatmap (count / BERT sentiment / semantic change)
//   - Heatmapの真下に Collapsible Message Detail Panel
//   - その下に Stock Price / Text-derived BERT Sentiment Line Chart (time axisはHeatmapと揃える)
//   - 別セクションに Network Visualization (reply graph)
//
// 既存heatmapのfilter / sorting / merger / keyword logicは壊さずに維持しています。
// ============================================

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { RefreshCcw, ChevronDown, ChevronRight, Play, Pause } from 'lucide-react';
import NetworkVisualization, { AGENTS } from './network.jsx';
import './style.css';

// FastAPIのURL。Vite環境変数があればそれを使う。
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// text sourceの内部名 → 表示名
const TEXT_SOURCE_LABELS = {
  content: 'Message content',
  reacting: 'Inner thought: reacting',
  rationalizing: 'Inner thought: rationalizing',
  deliberating: 'Inner thought: deliberating',
};

// ============================================
// Heatmap cell size (CSS変数的に1か所で管理)
// ============================================
// 既存より小さくして、より多くのtime bucketsを一画面で見られるようにする。
// 小さすぎてクリックできないサイズにはしない。
const CELL = {
  daily: { w: 46, h: 26 },
  hourly: { w: 52, h: 26 },
};
const LABEL_COL = 150; // agent label列の幅。Line Chartのleft marginにも使う。

// ============================================
// 時間表示を短くする
// ============================================
function shortBucket(bucket, granularity) {
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
function fmtRoundLabel(hour) {
  if (!hour) return '';
  const [date, time] = hour.split('T');
  const [, m, d] = date.split('-');
  const hh = (time || '').slice(0, 5);
  return `${MONTHS[Number(m) - 1]} ${Number(d)} · ${hh}`;
}

// ============================================
// Crisis timeline slider (CrisisNet風)
// ============================================
// 23 round の slider + Play/Pause。選択した round までを全ビューに累積反映する。
// 下のミニ強度バーは round ごとの merger 関連メッセージ密度を示す（危機の高まりが一目でわかる）。
function CrisisTimeline({ timeline, idx, setIdx, startIdx = 0, setStartIdx, active, setActive, playing, onTogglePlay, granularity, setGranularity }) {
  if (!timeline || timeline.length === 0) return null;
  const cur = timeline[idx] || {};
  const startCur = timeline[startIdx] || {};
  const maxTotal = Math.max(1, ...timeline.map(r => r.total_msgs || 0));
  const n = timeline.length;
  const denom = Math.max(1, n - 1);

  const onStart = (v) => { setActive(true); setStartIdx && setStartIdx(Math.min(Number(v), idx)); };
  const onEnd = (v) => { setActive(true); setIdx(Math.max(Number(v), startIdx)); };

  // 選択範囲 [start, end] を 1 本のトラック上で塗る位置（%）
  const fillLeft = (startIdx / denom) * 100;
  const fillWidth = ((idx - startIdx) / denom) * 100;

  return (
    <section className="timeline-bar">
      <div className="tl-row">
        <button className={`tl-play ${playing ? 'playing' : ''}`} onClick={onTogglePlay} title={playing ? 'Pause' : 'Play the crisis (grows the window from the start handle)'}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
          {playing ? 'Pause' : 'Play'}
        </button>

        <div className="tl-slider-wrap">
          <div className="tl-ticks">
            {timeline.map((r, i) => {
              const inRange = i >= startIdx && i <= idx;
              const h = 4 + 14 * Math.sqrt((r.total_msgs || 0) / maxTotal);
              const merg = (r.total_msgs ? (r.merger_msgs || 0) / r.total_msgs : 0);
              const bg = merg > 0.02
                ? `rgba(226,75,74,${0.35 + 0.6 * Math.min(1, merg)})`
                : 'rgba(55,138,221,0.45)';
              return (
                <button key={i}
                  className={`tl-tick ${i === idx ? 'current' : ''} ${i === startIdx ? 'start' : ''} ${inRange ? 'in-range' : ''}`}
                  style={{ height: `${h}px`, background: inRange ? bg : '#1b2a3f' }}
                  title={`Round ${i + 1}/${n} · ${fmtRoundLabel(r.hour)} · ${r.total_msgs} msgs, ${r.merger_msgs} merger`}
                  onClick={() => onEnd(i)} />
              );
            })}
          </div>
          {/* 1 本のトラックに 2 つの thumb（from / to）を重ねた range slider */}
          <div className="tl-range-multi">
            <div className="tl-track" />
            <div className="tl-track-fill" style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }} />
            <input className="tl-range tl-range-start" type="range" min={0} max={n - 1} step={1}
              value={startIdx} onChange={e => onStart(e.target.value)}
              aria-label="window start (from)" />
            <input className="tl-range tl-range-end" type="range" min={0} max={n - 1} step={1}
              value={idx} onChange={e => onEnd(e.target.value)}
              aria-label="window end (to)" />
          </div>
        </div>

        {setGranularity && (
          <label className="tl-scale" title="Time bucket size for the heatmap / line chart x-axis">
            scale
            <select value={granularity} onChange={e => setGranularity(e.target.value)}>
              <option value="daily">Daily</option>
              <option value="hourly">Hourly</option>
            </select>
          </label>
        )}

        <label className="tl-toggle check" title="When on, the slider window controls the time range for the heatmap and line chart (and the network only if 'Apply heatmap sorting to network' is on).">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> drive views
        </label>
      </div>

      <div className="tl-meta">
        <span className="tl-round">Rounds {startIdx + 1}–{idx + 1} / {n}</span>
        <span className="tl-date">{fmtRoundLabel(startCur.hour)} → {fmtRoundLabel(cur.hour)}</span>
        {cur.stock_price_value != null && <span className="tl-stock">${Number(cur.stock_price_value).toFixed(2)}</span>}
        {cur.market_sentiment && <span className="tl-sent">{cur.market_sentiment}</span>}
        <span className="tl-merger">{cur.merger_msgs || 0} merger-related · {cur.total_msgs || 0} msgs (end round)</span>
        {!active && <span className="tl-off">(timeline off — heatmap shows full range; network uses its own range)</span>}
      </div>
      {cur.event_headline && <div className="tl-headline">{cur.event_headline}</div>}
    </section>
  );
}

// ============================================
// 各heatmap modeのcell色
// ============================================
// count: メッセージ数（keywordありのときはkeyword一致数）の青系グラデーション
function countColor(count, max) {
  if (!count || !max) return { bg: '#10202f', opacity: 1 };
  // perceptually lifted sequential blue: floor raised so低 values still pop on dark bg
  const t = 0.18 + 0.82 * Math.sqrt(count / max);
  // interpolate #16314d (low) -> #3aa0ff (high)
  const lerp = (a, b) => Math.round(a + (b - a) * t);
  const r = lerp(0x16, 0x3a), g = lerp(0x31, 0xa0), b = lerp(0x4d, 0xff);
  return { bg: `rgb(${r},${g},${b})`, opacity: 1 };
}

// sentiment: -1=赤 / 0=灰 / 1=緑
function sentimentCellColor(score) {
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
function semanticCellColor(distance) {
  if (distance === null || distance === undefined) return { bg: '#1a212c', opacity: 0.5 };
  // distanceが大きいほど濃い紫にする
  const t = Math.max(0, Math.min(1, distance));
  const r = Math.round(0x2a + (0x9d - 0x2a) * t);
  const g = Math.round(0x33 + (0x4d - 0x33) * t);
  const b = Math.round(0x5e + (0xdd - 0x5e) * t);
  return { bg: `rgb(${r},${g},${b})`, opacity: t < 0.05 ? 0.7 : 1 };
}

// datetime-local input変換
function apiTimeToInputValue(value) {
  if (!value) return '';
  return value.slice(0, 16);
}
function inputValueToApiTime(value) {
  if (!value) return '';
  return value.length === 16 ? `${value}:00` : value;
}

// recipients表示
function formatRecipients(value) {
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
function fmtPct(v) {
  if (v === null || v === undefined) return 'N/A';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

// ============================================
// Stock Price / BERT Sentiment Line Chart
// ============================================
// Heatmapのすぐ下（Message Detail Panelの下）に置く。
// x軸はHeatmapと同じtime_bucketsを使い、列幅とleft marginを揃えることでx軸を完全に揃える。
function StockSentimentLineChart({
  data, granularity, showStock, showSentiment, scrollRef, onScroll,
}) {
  const [hover, setHover] = useState(null);

  const buckets = data?.time_buckets || [];
  const series = data?.series || [];
  const cell = CELL[granularity];
  const plotW = buckets.length * cell.w;
  const height = 200;
  const padTop = 16, padBottom = 28;
  const innerH = height - padTop - padBottom;

  // x位置: Heatmapのcell中心に合わせる
  const xAt = (i) => LABEL_COL + i * cell.w + cell.w / 2;

  // stock priceのスケール
  const prices = series.map(s => s.stock_price).filter(v => v !== null && v !== undefined);
  const pMin = prices.length ? Math.min(...prices) : 0;
  const pMax = prices.length ? Math.max(...prices) : 1;
  const yPrice = (v) => padTop + innerH - (pMax === pMin ? 0.5 : (v - pMin) / (pMax - pMin)) * innerH;

  // sentimentのスケール (-1〜1固定)
  const ySent = (v) => padTop + innerH - ((v + 1) / 2) * innerH;

  // 折れ線のpath（nullはスキップして線を切る）
  function buildPath(accessor, yFn) {
    let d = '';
    let pen = false;
    series.forEach((s, i) => {
      const v = accessor(s);
      if (v === null || v === undefined) { pen = false; return; }
      const cmd = pen ? 'L' : 'M';
      d += `${cmd}${xAt(i)},${yFn(v)} `;
      pen = true;
    });
    return d.trim();
  }

  const stockPath = buildPath(s => s.stock_price, yPrice);
  const sentPath = buildPath(s => s.market_sentiment_value, ySent);

  const nothing = !showStock && !showSentiment;

  return (
    <div className="linechart-card">
      <div className="lc-head">
        <h3>Stock price &amp; market sentiment</h3>
        <div className="lc-legend">
          <span className="lc-key"><span className="lc-swatch" style={{ background: '#22d3ee' }} /> Stock price ($)</span>
          <span className="lc-key"><span className="lc-swatch" style={{ background: '#f59e0b' }} /> Market sentiment (−1…+1)</span>
        </div>
        <span className="muted small">From market_snapshot · x-axis aligned with the heatmap above</span>
      </div>
      <div className="lc-scroll" ref={scrollRef} onScroll={onScroll}>
        <svg width={LABEL_COL + plotW} height={height} className="lc-svg"
          onMouseLeave={() => setHover(null)}>
          {/* baseline */}
          <line x1={LABEL_COL} y1={padTop + innerH} x2={LABEL_COL + plotW} y2={padTop + innerH}
            stroke="#263244" strokeWidth="1" />
          {/* sentiment 0 line */}
          {showSentiment && (
            <line x1={LABEL_COL} y1={ySent(0)} x2={LABEL_COL + plotW} y2={ySent(0)}
              stroke="#33405580" strokeDasharray="3 3" strokeWidth="1" />
          )}

          {/* y-axis labels: left = stock price (cyan), right = sentiment scale (amber) */}
          {showStock && prices.length > 0 && (
            <g>
              <text x={LABEL_COL - 6} y={yPrice(pMax) + 3} textAnchor="end" fontSize="9" fill="#22d3ee">${pMax.toFixed(2)}</text>
              <text x={LABEL_COL - 6} y={yPrice(pMin) + 3} textAnchor="end" fontSize="9" fill="#22d3ee">${pMin.toFixed(2)}</text>
            </g>
          )}
          {showSentiment && (
            <g>
              <text x={LABEL_COL + plotW + 2} y={ySent(1) + 3} fontSize="9" fill="#f59e0b">+1 pos</text>
              <text x={LABEL_COL + plotW + 2} y={ySent(0) + 3} fontSize="9" fill="#f59e0b">0 neu</text>
              <text x={LABEL_COL + plotW + 2} y={ySent(-1) + 3} fontSize="9" fill="#f59e0b">-1 crit</text>
            </g>
          )}

          {/* hover guide + column hit areas */}
          {buckets.map((b, i) => (
            <rect key={b} x={LABEL_COL + i * cell.w} y={padTop} width={cell.w} height={innerH}
              fill={hover === i ? 'rgba(96,165,250,0.08)' : 'transparent'}
              onMouseEnter={() => setHover(i)} />
          ))}

          {nothing && (
            <text x={LABEL_COL + plotW / 2} y={height / 2} textAnchor="middle"
              fill="#5a7a9a" fontSize="13">No line selected</text>
          )}

          {/* lines */}
          {showStock && stockPath && (
            <path d={stockPath} fill="none" stroke="#22d3ee" strokeWidth="2" />
          )}
          {showSentiment && sentPath && (
            <path d={sentPath} fill="none" stroke="#f59e0b" strokeWidth="2" />
          )}

          {/* points */}
          {showStock && series.map((s, i) => s.stock_price != null && (
            <circle key={`p${i}`} cx={xAt(i)} cy={yPrice(s.stock_price)} r={hover === i ? 4 : 2.5}
              fill="#22d3ee" />
          ))}
          {showSentiment && series.map((s, i) => s.market_sentiment_value != null && (
            <circle key={`s${i}`} cx={xAt(i)} cy={ySent(s.market_sentiment_value)} r={hover === i ? 4 : 2.5}
              fill="#f59e0b" />
          ))}

          {/* x labels */}
          {buckets.map((b, i) => (
            <text key={`x${b}`} x={xAt(i)} y={height - 8} textAnchor="middle"
              fontSize="9" fill="#7a8aa0" fontFamily="monospace">
              {shortBucket(b, granularity)}
            </text>
          ))}
        </svg>
      </div>

      {/* tooltip-like summary */}
      <div className="lc-summary">
        {hover === null && <span className="muted small">Hover any column to read the stock price and market sentiment for that time bucket.</span>}
        {hover !== null && series[hover] && (
          <div className="lc-readout">
            <b>{series[hover].time_bucket}</b>
            {showStock && (
              <span>Stock price: <b>{series[hover].stock_price != null ? `$${series[hover].stock_price.toFixed(2)}` : '—'}</b>
                {' '}(<span className={pctClass(series[hover].stock_price_change_pct)}>
                  {fmtPct(series[hover].stock_price_change_pct)}</span>)</span>
            )}
            {showSentiment && (
              <span>Market sentiment: <b>{series[hover].market_sentiment_label ?? '—'}</b>
                {series[hover].market_sentiment_value != null
                  ? ` (${fmtSigned(series[hover].market_sentiment_value)})`
                  : ''}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function pctClass(v) {
  if (v === null || v === undefined) return 'pct-na';
  return v >= 0 ? 'pct-up' : 'pct-down';
}

// heatmap cell用: 符号付き2桁（+0.32 / -0.45）。null/undefinedは空文字。
function fmtSigned(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}

// ============================================
// 再利用可能な Collapsible（sort/filter topicの折りたたみ用）
// ============================================
function Collapsible({ title, defaultOpen = true, right = null, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapsible ${open ? 'is-open' : 'is-closed'}`}>
      <button type="button" className="collapsible-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="collapsible-title">{title}</span>
        {right}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

// ============================================
// App本体
// ============================================
function App() {
  // ---- 共通filter state (heatmap / network / line chart 共通) ----
  const [granularity, setGranularity] = useState('hourly');
  const [mergerOnly, setMergerOnly] = useState(false);
  const [selectedMessageTypes, setSelectedMessageTypes] = useState([]);
  const [selectedTextSources, setSelectedTextSources] = useState([]);
  const [visibility, setVisibility] = useState('all');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [agentFilter, setAgentFilter] = useState([]); // 空=All

  // ---- heatmap固有 state ----
  const [heatmapMode, setHeatmapMode] = useState('count'); // count | sentiment | semantic_change
  const [semanticComparisonMode, setSemanticComparisonMode] = useState('previous'); // previous | next
  const [heatmapSort, setHeatmapSort] = useState({ key: 'agent_id', dir: 'asc' }); // key: agent_id|total|sentiment

  // ---- network固有 state ----
  const [networkLayout, setNetworkLayout] = useState('force'); // force | circle
  const [networkSort, setNetworkSort] = useState({ nodeSize: 'messages', edgeWeight: 'weight' });
  const [isNetworkFollowingHeatmapSort, setIsNetworkFollowingHeatmapSort] = useState(false);
  const [selectedNetworkNode, setSelectedNetworkNode] = useState(null);

  // network専用 filter（heatmapの計算には一切影響させない。networkだけに適用する）
  const [netMessageTypes, setNetMessageTypes] = useState([]);
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
  const [showStockPriceLine, setShowStockPriceLine] = useState(true);
  const [showBertSentimentLine, setShowBertSentimentLine] = useState(true);

  // ---- crisis timeline slider (CrisisNet風: round N まで累積表示) ----
  const [timeline, setTimeline] = useState([]);          // [{idx,hour,cutoff,event_headline,total_msgs,merger_msgs,...}]
  const [timelineStartIdx, setTimelineStartIdx] = useState(0); // 窓の開始 round（前から絞る handle）
  const [timelineIdx, setTimelineIdx] = useState(0);     // 窓の終了 round（先から絞る handle / play で進む）
  const [timelineActive, setTimelineActive] = useState(true); // true: slider が heatmap/network/line-chart の時間窓を支配
  const [playing, setPlaying] = useState(false);

  // ---- データ ----
  const [options, setOptions] = useState({
    message_types: [], text_sources: ['content', 'reacting', 'rationalizing', 'deliberating'],
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

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  // ============================================
  // 共通filterのquery string（heatmap mode以外の共通部分）
  // ============================================
  // crisis timeline が active のとき、全ビュー共通の時間窓 [start, end]。
  //  - end  = 終了 round の cutoff（その round までを含む）
  //  - start = 開始 round の hour（前から絞る。startIdx==0 のときは空=最初から）
  // ============================================
  const timelineEnd = (timelineActive && timeline.length && timeline[timelineIdx])
    ? (timeline[timelineIdx].cutoff || timeline[timelineIdx].hour || '')
    : '';
  const timelineStart = (timelineActive && timeline.length && timelineStartIdx > 0 && timeline[timelineStartIdx])
    ? (timeline[timelineStartIdx].hour || '')
    : '';

  const commonQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('granularity', granularity);
    p.set('merger_only', mergerOnly ? 'true' : 'false');
    p.set('visibility', visibility);
    selectedMessageTypes.forEach(t => p.append('message_types', t));
    selectedTextSources.forEach(s => p.append('text_sources', s));
    // Heatmap の時間窓は crisis timeline のみが支配する（手動 time range は廃止）。
    if (timelineActive) {
      if (timelineStart) p.set('start_time', timelineStart);
      if (timelineEnd) p.set('end_time', timelineEnd);
    }
    if (searchKeyword.trim()) p.set('keyword', searchKeyword.trim());
    return p.toString();
  }, [granularity, mergerOnly, selectedMessageTypes, selectedTextSources, visibility, searchKeyword, timelineActive, timelineStart, timelineEnd]);

  // ============================================
  // network専用のquery string（heatmapとは独立。networkだけに効く）
  // granularity は network graph 構造に影響しないが endpoint が要求するので共有する。
  // ============================================
  const networkQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('granularity', granularity);

    if (isNetworkFollowingHeatmapSort) {
      // ON: heatmap の filter context を採用し、時間窓も timeline に追従する
      //（play で network のエージェント増減アニメーションが動くのはこの時だけ）。
      p.set('merger_only', mergerOnly ? 'true' : 'false');
      p.set('visibility', visibility);
      selectedMessageTypes.forEach(t => p.append('message_types', t));
      selectedTextSources.forEach(s => p.append('text_sources', s));
      if (searchKeyword.trim()) p.set('keyword', searchKeyword.trim());
      if (timelineActive) {
        if (timelineStart) p.set('start_time', timelineStart);
        if (timelineEnd) p.set('end_time', timelineEnd);
      }
    } else {
      // OFF: network は heatmap / crisis timeline から完全に独立。
      // sync を押していないときは crisis timeline の時間窓を一切適用せず、
      // network 専用の手動 time range（未設定なら全期間）だけを使う。
      p.set('merger_only', netMergerOnly ? 'true' : 'false');
      netMessageTypes.forEach(t => p.append('message_types', t));
      if (netStartTime) p.set('start_time', inputValueToApiTime(netStartTime));
      if (netEndTime) p.set('end_time', inputValueToApiTime(netEndTime));
    }
    return p.toString();
  }, [granularity, isNetworkFollowingHeatmapSort,
      mergerOnly, visibility, selectedMessageTypes, selectedTextSources, searchKeyword,
      netMergerOnly, netMessageTypes, netStartTime, netEndTime,
      timelineActive, timelineStart, timelineEnd]);

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
  useEffect(() => { loadHeatmap(); }, [loadHeatmap]);
  useEffect(() => { loadLineChart(); }, [loadLineChart]);
  useEffect(() => { loadNetwork(); }, [loadNetwork]);

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
    setTimelineActive(true);
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
  const toggleMessageType = (t) => setSelectedMessageTypes(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  const toggleTextSource = (s) => setSelectedTextSources(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
  const toggleAgent = (id) => setAgentFilter(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  // ============================================
  // Heatmap と Line Chart の横スクロール同期
  // ============================================
  // 両者は同じ inner width（LABEL_COL + buckets * cell.w）なので scrollLeft を
  // そのままミラーすれば time 軸が常に一致する。guard で echo ループを防ぐ。
  const heatmapScrollRef = useRef(null);
  const lineScrollRef = useRef(null);
  const scrollGuardRef = useRef(false);
  const mirrorScroll = (src, dst) => {
    if (scrollGuardRef.current || !src || !dst) return;
    if (dst.scrollLeft === src.scrollLeft) return;
    scrollGuardRef.current = true;
    dst.scrollLeft = src.scrollLeft;
    requestAnimationFrame(() => { scrollGuardRef.current = false; });
  };
  const handleHeatmapScroll = () => mirrorScroll(heatmapScrollRef.current, lineScrollRef.current);
  const handleLineScroll = () => mirrorScroll(lineScrollRef.current, heatmapScrollRef.current);

  // network専用 filter の toggle / helper（heatmapには影響しない）
  const toggleNetMessageType = (t) => setNetMessageTypes(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  const toggleNetAgent = (id) => setNetAgentFilter(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const useFullNetTimeRange = () => { setNetStartTime(apiTimeToInputValue(options.min_time)); setNetEndTime(apiTimeToInputValue(options.max_time)); };
  const clearNetTimeRange = () => { setNetStartTime(''); setNetEndTime(''); };

  // すべての filter を既定値に戻す（view mode = granularity / heatmap mode / layout /
  // node-edge metric は「絞り込み」ではないので保持する）。
  const clearAllFilters = () => {
    // heatmap filters
    setSearchKeyword('');
    setMergerOnly(false);
    setVisibility('all');
    setSelectedMessageTypes([]);
    setSelectedTextSources([]);
    setAgentFilter([]);
    setHeatmapSort({ key: 'agent_id', dir: 'asc' });
    // network filters
    setIsNetworkFollowingHeatmapSort(false);
    setNetMergerOnly(false);
    setNetMessageTypes([]);
    setNetAgentFilter([]);
    setNetStartTime('');
    setNetEndTime('');
    // crisis timeline → 全期間に戻す（active のまま）
    setPlaying(false);
    setTimelineStartIdx(0);
    if (timeline.length) setTimelineIdx(timeline.length - 1);
    setTimelineActive(true);
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
  // isNetworkFollowingHeatmapSort === true のときは heatmap の sort key を node size にマップする。
  //   sentiment -> |sentiment| サイズ、それ以外（agent_id / total）-> messages サイズ。
  //   ※ agent_id は名前順なので「大きさ」を持たない。順序は heatmap rank chip で可視化する。
  const effectiveNetworkSize = isNetworkFollowingHeatmapSort
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
    if (isNetworkFollowingHeatmapSort || !netAgentFilter.length) return network;
    const keep = new Set(netAgentFilter);
    const nodes = (network.nodes || []).filter(n => keep.has(n.id));
    const edges = (network.edges || []).filter(e => keep.has(e.source) && keep.has(e.target));
    return { ...network, nodes, edges };
  }, [network, netAgentFilter, isNetworkFollowingHeatmapSort]);

  const cell = CELL[granularity];
  const buckets = heatmap.time_buckets || [];

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
        <label className="check"><input type="checkbox" checked={showHeatmap} onChange={e => setShowHeatmap(e.target.checked)} /> Heatmap</label>
        <label className="check"><input type="checkbox" checked={showLineChart} onChange={e => setShowLineChart(e.target.checked)} /> Line Chart</label>
        <label className="check"><input type="checkbox" checked={showNetwork} onChange={e => setShowNetwork(e.target.checked)} /> Network</label>
        <button type="button" className="fp-toggle gc-filters-toggle" onClick={() => setFiltersOpen(o => !o)}>
          {filtersOpen ? 'Hide filters' : 'Show filters'}
        </button>
        <button type="button" className="fp-toggle gc-clear-filters" onClick={clearAllFilters}
          title="Reset every filter (heatmap + network + crisis timeline) to defaults. View modes like Daily/Hourly are kept.">
          Clear all filters
        </button>
        <button
          type="button"
          className="flow-btn gc-flow-btn"
          disabled={!selectedMessageId}
          title={selectedMessageId
            ? 'Show the reconstructed conversation flow for the selected message'
            : 'Select a message (click a heatmap cell, then a message) to view its conversation flow'}
          onClick={() => selectedMessageId && setFlowOpen(true)}
        >
          ⇄ Conversation Flow
        </button>
        <div className="gc-counts">
          Merger-related keyword: <b>{options.combined_merger_count}</b> / {options.total_count}
          {' · '}Content: {options.merger_count} {' · '}Inner thought: {options.internal_merger_count}
          {' · '}Keywords: {(options.merger_keywords || []).join(', ') || '—'}
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
        active={timelineActive}
        setActive={setTimelineActive}
        playing={playing}
        onTogglePlay={togglePlay}
        granularity={granularity}
        setGranularity={setGranularity}
      />

      {status && <div className="status">{status}</div>}

      {/* ============================================
          HEATMAP SECTION : filter(左) | heatmap+detail+linechart(右)
          ============================================ */}
      {(showHeatmap || showLineChart) && (
        <section className={`section heatmap-section ${filtersOpen ? '' : 'filters-hidden'}`}>
          {/* ---- left: heatmap filter panel (collapsed 時は描画しない=全幅) ---- */}
          {filtersOpen && (
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

                <Collapsible title="Sorting" defaultOpen={false}>
                  <div className="row">
                    <select value={heatmapSort.key} onChange={e => setHeatmapSort(s => ({ ...s, key: e.target.value }))}>
                      <option value="agent_id">Agent name</option>
                      <option value="total">Total messages</option>
                      <option value="sentiment">Mean sentiment</option>
                    </select>
                    <select value={heatmapSort.dir} onChange={e => setHeatmapSort(s => ({ ...s, dir: e.target.value }))}>
                      <option value="asc">Asc</option>
                      <option value="desc">Desc</option>
                    </select>
                  </div>
                  <div className="muted small">Sorting only changes row order, not the analysis values.</div>
                </Collapsible>

                <Collapsible title="Message types" defaultOpen={false}>
                  <div className="type-grid">
                    <label className="check"><input type="checkbox" checked={selectedMessageTypes.length === 0} onChange={() => setSelectedMessageTypes([])} /> All</label>
                    {(options.message_types || []).map(t => (
                      <label className="check" key={t}><input type="checkbox" checked={selectedMessageTypes.includes(t)} onChange={() => toggleMessageType(t)} /> {t}</label>
                    ))}
                  </div>
                </Collapsible>

                <Collapsible title="Text sources" defaultOpen={false}>
                  <div className="type-grid">
                    <label className="check"><input type="checkbox" checked={selectedTextSources.length === 0} onChange={() => setSelectedTextSources([])} /> All</label>
                    {(options.text_sources || Object.keys(TEXT_SOURCE_LABELS)).map(s => (
                      <label className="check" key={s}><input type="checkbox" checked={selectedTextSources.includes(s)} onChange={() => toggleTextSource(s)} /> {TEXT_SOURCE_LABELS[s] || s}</label>
                    ))}
                  </div>
                </Collapsible>

                <Collapsible title="Visibility & merger" defaultOpen={false}>
                  <label>Internal / external
                    <select value={visibility} onChange={e => setVisibility(e.target.value)}>
                      <option value="all">All</option>
                      <option value="internal">Internal</option>
                      <option value="external">External</option>
                    </select>
                  </label>
                  <label className="check merger-check">
                    <input type="checkbox" checked={mergerOnly} onChange={e => setMergerOnly(e.target.checked)} />
                    Merger-related only in selected text sources
                  </label>
                </Collapsible>

                <Collapsible title="Agents" defaultOpen={false}>
                  <div className="type-grid">
                    <label className="check"><input type="checkbox" checked={agentFilter.length === 0} onChange={() => setAgentFilter([])} /> All</label>
                    {(options.agents || []).map(a => (
                      <label className="check" key={a.agent_id}>
                        <input type="checkbox" checked={agentFilter.includes(a.agent_id)} onChange={() => toggleAgent(a.agent_id)} />
                        <span className="agent-dot" style={{ background: AGENTS[a.agent_id]?.color || '#888' }} /> {a.agent_label}
                      </label>
                    ))}
                  </div>
                </Collapsible>

                <Collapsible title="Close / far meaning keywords" defaultOpen={true}>
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
                  {keywords.far_keywords?.length > 0 && (
                    <>
                      <div className="kw-group-label">Far from meaning</div>
                      <div className="chips clickable">
                        {keywords.far_keywords.map(k => (
                          <button key={`f-${k.keyword}`} className="kw-chip far" onClick={() => onKeywordClick(k.keyword)} title="Search this keyword">
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

          {/* ---- right: heatmap + detail + line chart ---- */}
          <div className="viz-col">
            {showHeatmap && (
            <div className="heatmap-card">
              <div className="heatmap-title">
                <div>
                  <h2>{granularity === 'daily' ? 'Daily' : 'Hourly'} · {heatmapMode === 'count' ? 'message volume' : heatmapMode === 'sentiment' ? 'BERT sentiment' : 'semantic change'}</h2>
                  <p className="muted small">
                    {selectedMessageTypes.length === 0 ? 'All types' : selectedMessageTypes.join(', ')}
                    {' / '}{selectedTextSources.length === 0 ? 'All text' : selectedTextSources.map(s => TEXT_SOURCE_LABELS[s] || s).join(', ')}
                    {searchKeyword.trim() ? ` / Keyword: ${searchKeyword.trim()}` : ''}
                  </p>
                </div>
                {loading && <span className="muted">Loading…</span>}
              </div>

              {/* legend */}
              <div className="legend">
                {heatmapMode === 'count' && <span className="muted small">Deeper / brighter blue = more messages</span>}
                {heatmapMode === 'sentiment' && <span className="muted small"><span className="lg-swatch" style={{ background: '#e24b4a' }} /> negative <span className="lg-swatch" style={{ background: '#9aa7b5' }} /> neutral <span className="lg-swatch" style={{ background: '#4ade80' }} /> positive · empty = no messages</span>}
                {heatmapMode === 'semantic_change' && <span className="muted small">Semantic distance: <span className="lg-swatch" style={{ background: '#2a335e' }} /> similar → <span className="lg-swatch" style={{ background: '#9d4ddd' }} /> different · empty = no comparable messages</span>}
              </div>

              <div className="heatmap-scroll" ref={heatmapScrollRef} onScroll={handleHeatmapScroll}>
                <div className="heatmap-grid" style={{ gridTemplateColumns: `${LABEL_COL}px repeat(${buckets.length || 1}, ${cell.w}px)`, gridAutoRows: `${cell.h}px` }}>
                  <div className="corner">Agent \ Time</div>
                  {buckets.map(b => (
                    <button key={b} className="bucket-head" title={b}
                      onClick={() => selectCell({ agent_id: 'ALL', agent_label: 'All agents' }, b)}>
                      {shortBucket(b, granularity)}
                    </button>
                  ))}

                  {sortedAgents.map(agent => (
                    <React.Fragment key={agent.agent_id}>
                      <div className="agent-label" style={{ borderLeft: `3px solid ${AGENTS[agent.agent_id]?.color || '#888'}` }}>
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
                          style = { background: cc.bg, opacity: cc.opacity };
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
                        return (
                          <button key={`${agent.agent_id}-${b}`}
                            className={`cell ${heatmapMode !== 'count' ? 'cell-num' : ''} ${isSel ? 'cell-selected' : ''}`}
                            style={style} title={title}
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
            {showLineChart && (
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
        <section className={`section network-section ${filtersOpen ? '' : 'filters-hidden'}`}>
          {filtersOpen && (
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
                  {isNetworkFollowingHeatmapSort && <div className="muted small">Following heatmap — these network filters are taken from the heatmap.</div>}
                  <div className={isNetworkFollowingHeatmapSort ? 'disabled' : ''}>
                  <div className="control-title">Message type</div>
                  <div className="type-grid">
                    <label className="check"><input type="checkbox" checked={netMessageTypes.length === 0} onChange={() => setNetMessageTypes([])} /> All</label>
                    {(options.message_types || []).map(t => (
                      <label className="check" key={`net-${t}`}><input type="checkbox" checked={netMessageTypes.includes(t)} onChange={() => toggleNetMessageType(t)} /> {t}</label>
                    ))}
                  </div>
                  <label className="check merger-check">
                    <input type="checkbox" checked={netMergerOnly} onChange={e => setNetMergerOnly(e.target.checked)} />
                    Merger-related keyword only
                  </label>
                  <div className="control-title">Agent type</div>
                  <div className="type-grid">
                    <label className="check"><input type="checkbox" checked={netAgentFilter.length === 0} onChange={() => setNetAgentFilter([])} /> All</label>
                    {(options.agents || []).map(a => (
                      <label className="check" key={`net-a-${a.agent_id}`}>
                        <input type="checkbox" checked={netAgentFilter.includes(a.agent_id)} onChange={() => toggleNetAgent(a.agent_id)} />
                        <span className="agent-dot" style={{ background: AGENTS[a.agent_id]?.color || '#888' }} /> {a.agent_label}
                      </label>
                    ))}
                  </div>
                  </div>
                </Collapsible>

                <Collapsible title="Time range / sorting" defaultOpen={false}>
                  {isNetworkFollowingHeatmapSort
                    ? <div className="muted small">Time window comes from the heatmap / crisis timeline (network is synced). Click “Synced with heatmap” above the graph to unlink and set a network-only range here.</div>
                    : <div className="muted small">Network-only time range. Independent of the heatmap and crisis timeline. Leave empty for the full range.</div>}
                  <div className={`time-inputs ${isNetworkFollowingHeatmapSort ? 'disabled' : ''}`}>
                    <label>Start<input type="datetime-local" value={netStartTime} onChange={e => setNetStartTime(e.target.value)} /></label>
                    <label>End<input type="datetime-local" value={netEndTime} onChange={e => setNetEndTime(e.target.value)} /></label>
                  </div>
                  <div className={`time-actions ${isNetworkFollowingHeatmapSort ? 'disabled' : ''}`}>
                    <button onClick={useFullNetTimeRange}>Use full range</button>
                    <button onClick={clearNetTimeRange}>Clear</button>
                  </div>
                  {isNetworkFollowingHeatmapSort
                    ? <div className="follow-note">Network mirrors the heatmap's filters and sort order ({heatmapSort.key}, {heatmapSort.dir}) and follows the crisis timeline. Node numbers #1…#N follow the heatmap row order. Use the “Synced with heatmap” button above the graph to unlink.</div>
                    : <div className="muted small">Tip: use the “Sync with heatmap sorting” button above the graph to mirror the heatmap’s filters & order here.</div>}
                </Collapsible>

                <Collapsible title="Node & edge metrics" defaultOpen={true}>
                  <div className={isNetworkFollowingHeatmapSort ? 'disabled' : ''}>
                    <div className="control-title">Node size metric</div>
                    <div className="seg">
                      {[['messages', 'Messages'], ['merger', 'Merger'], ['sentiment', 'Sentiment']].map(([v, l]) => (
                        <button key={v} disabled={isNetworkFollowingHeatmapSort}
                          className={`seg-btn ${networkSort.nodeSize === v ? 'on' : ''}`}
                          onClick={() => setNetworkSort(s => ({ ...s, nodeSize: v }))}>{l}</button>
                      ))}
                    </div>
                    <div className="control-title">Edge weight metric</div>
                    <div className="seg">
                      {[['weight', 'Replies'], ['merger', 'Merger replies']].map(([v, l]) => (
                        <button key={v} disabled={isNetworkFollowingHeatmapSort}
                          className={`seg-btn ${networkSort.edgeWeight === v ? 'on' : ''}`}
                          onClick={() => setNetworkSort(s => ({ ...s, edgeWeight: v }))}>{l}</button>
                      ))}
                    </div>
                  </div>
                </Collapsible>

                <Collapsible title="Layout" defaultOpen={true}>
                  <div className="seg">
                    {[['force', 'Fixed'], ['circle', 'Circle']].map(([v, l]) => (
                      <button key={v} className={`seg-btn ${networkLayout === v ? 'on' : ''}`} onClick={() => setNetworkLayout(v)}>{l}</button>
                    ))}
                  </div>
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
                  <span className="muted small">{displayNetwork.nodes?.length || 0} agents · {displayNetwork.edges?.length || 0} edges</span>
                </div>
                <button
                  type="button"
                  className={`sync-btn ${isNetworkFollowingHeatmapSort ? 'on' : ''}`}
                  onClick={() => setIsNetworkFollowingHeatmapSort(v => !v)}
                  title="Apply the heatmap's sorting & filters to the network"
                >
                  {isNetworkFollowingHeatmapSort ? '✓ Synced with heatmap (click to unlink)' : '⤭ Sync with heatmap sorting'}
                </button>
              </div>
              <NetworkVisualization
                data={displayNetwork}
                layout={networkLayout}
                sizeMetric={effectiveNetworkSize}
                edgeMetric={isNetworkFollowingHeatmapSort ? 'weight' : networkSort.edgeWeight}
                selectedNode={selectedNetworkNode}
                onSelectNode={setSelectedNetworkNode}
                followingHeatmapSort={isNetworkFollowingHeatmapSort}
                heatmapOrder={heatmapOrder}
                heatmapSortKey={heatmapSort.key}
                heatmapSortDir={heatmapSort.dir}
              />
              {isNetworkFollowingHeatmapSort && (
                <div className="muted small net-follow-note">
                  Following heatmap: filters mirrored · node size = {effectiveNetworkSize} ·
                  {' '}numbered #1…#{heatmapOrder.length} by {{ agent_id: 'agent name', total: 'total messages', sentiment: 'mean sentiment' }[heatmapSort.key]} ({heatmapSort.dir})
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <ConversationFlowModal
        open={flowOpen}
        context={messageContext}
        selectedMessageId={selectedMessageId}
        onClose={() => setFlowOpen(false)}
        onSelectMessage={selectMessage}
      />
    </div>
  );
}

// ============================================
// Message Detail Panel (collapsible)
// ============================================
function MessageDetailPanel({ selected, selectedCellData, selectedSemantic, semanticComparisonMode, collapsed, setCollapsed, messages, rounds, selectedMessageId, messageContext, contextStatus, onSelectMessage, onOpenFlow }) {
  if (!selected) {
    return <div className="detail-card empty"><span className="muted">Click a heatmap cell or a time header to see its messages here.</span></div>;
  }
  const count = selectedCellData?.message_count ?? messages.length;
  const sent = selectedCellData?.bert_sentiment_score;

  return (
    <div className="detail-card">
      <div className="detail-summary" onClick={() => setCollapsed(c => !c)}>
        <button className="collapse-btn" aria-label="toggle">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <div className="ds-text">
          <b>{selected.agent.agent_label}</b>
          <span className="ds-pipe">|</span> {selected.bucket}
          <span className="ds-pipe">|</span> {count} messages
          <span className="ds-pipe">|</span> BERT: {sent == null ? '—' : sent.toFixed(2)}
          <span className="ds-pipe">|</span> Semantic Δ (vs previous): {selectedSemantic == null ? '—' : selectedSemantic.toFixed(2)}
        </div>
        <span className="ds-hint">{collapsed ? 'Expand messages' : 'Collapse'}</span>
      </div>

      {!collapsed && (
        <div className="detail-body">
          {/* event context */}
          {rounds.length > 0 && (
            <div className="rounds">
              {rounds.map(r => (
                <article className="round" key={r.hour}>
                  <div className="round-hour">{r.hour}</div>
                  <h4>{r.event_headline || '(no headline)'}</h4>
                  <p>{r.event_narrative || ''}</p>
                  <div className="chips">
                    {r.stock_price && <span>price {r.stock_price}</span>}
                    {r.percent_change && <span>{r.percent_change}</span>}
                    {r.market_sentiment && <span>{r.market_sentiment}</span>}
                    {r.has_merger_context && <span className="merger">merger context</span>}
                  </div>
                </article>
              ))}
            </div>
          )}

          <h3>Messages ({messages.length})</h3>
          {messages.length === 0 && <p className="muted">No messages matched the current filters.</p>}
          {messages.map(m => (
            <article
              className={`message clickable${m.message_id === selectedMessageId ? ' selected' : ''}`}
              key={m.message_id}
              onClick={() => onSelectMessage && onSelectMessage(m.message_id)}
              title="Click to see this message's context / related messages"
            >
              <div className="msg-meta">
                {m.comm_id != null && <span className="comm-id">#{m.comm_id}</span>}
                <b>{m.timestamp}</b>
                <span>{m.agent_label}</span>
                <span>{m.channel}</span>
                <span>{m.message_type}</span>
                <span>{m.visibility}</span>
                {m.keyword_score > 0 && <span className="keyword-score">keyword score: {m.keyword_score}</span>}
                {m.is_merger_related && <span className="merger">content merger-related</span>}
                {m.internal_merger_related && <span className="internal-merger">internal merger-related</span>}
              </div>
              <div className="sub-meta">
                Role: {m.agent_role || '-'} / Recipients: {formatRecipients(m.recipients)} / Responding to: {m.responding_to || '-'}
              </div>
              <p>{m.content}</p>
              {(m.internal_reacting || m.internal_rationalizing || m.internal_deliberating) && (
                <details onClick={e => e.stopPropagation()}>
                  <summary>internal state</summary>
                  {m.internal_reacting && <p><b>reacting:</b> {m.internal_reacting}</p>}
                  {m.internal_rationalizing && <p><b>rationalizing:</b> {m.internal_rationalizing}</p>}
                  {m.internal_deliberating && <p><b>deliberating:</b> {m.internal_deliberating}</p>}
                </details>
              )}
            </article>
          ))}

          {/* clicking any message opens the related-messages chat popup */}
          {selectedMessageId && (
            <div className="ctx-hint">
              <span className="muted">
                {contextStatus === 'loading' ? 'Loading related messages…'
                  : contextStatus === 'error' ? 'Could not load related messages.'
                  : 'Related messages open in a chat popup.'}
              </span>
              <button className="flow-btn" onClick={(e) => { e.stopPropagation(); onOpenFlow && onOpenFlow(); }}>
                Open conversation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Related Messages / Context (新規)
// ============================================
function RelatedMessages({ status, context, selectedMessageId, onSelectMessage, onOpenFlow }) {
  if (status === 'loading') {
    return <div className="context-section"><span className="muted">Loading related messages…</span></div>;
  }
  if (status === 'error') {
    return <div className="context-section"><span className="muted">Could not load related messages.</span></div>;
  }
  if (!context || !context.found) {
    return <div className="context-section"><span className="muted">No context found for this message.</span></div>;
  }

  const groups = [
    ['Parent', context.parent_message ? [context.parent_message] : []],
    ['Replies', context.replies || []],
    ['Nearby Timeline', context.temporal_neighbors || []],
    ['Same Channel', context.same_channel_context || []],
    ['Same Agent', context.same_agent_context || []],
    ['Keyword Related', context.keyword_related || []],
  ];
  const why = context.selected_message && context.selected_message.why_matters;
  const sel = context.selected_message;

  return (
    <div className="context-section" onClick={e => e.stopPropagation()}>
      <div className="ctx-header-row">
        <div className="ctx-header">Context for selected message</div>
        <button className="flow-btn" onClick={() => onOpenFlow && onOpenFlow()}>Conversation Flow</button>
      </div>
      {sel && (
        <div className="ctx-focused">
          <div className="ctx-item-meta">
            {sel.comm_id != null && <span className="comm-id">#{sel.comm_id}</span>}
            <span className="ctx-badge">{sel.channel}</span>
            <span className="ctx-agent">{sel.agent_label}</span>
            <span className="ctx-ts">{sel.timestamp}</span>
          </div>
          <div className="ctx-preview">
            {(sel.content || '').slice(0, 200)}{(sel.content || '').length > 200 ? '…' : ''}
          </div>
        </div>
      )}
      {why && <div className="why-matters"><b>Why this matters:</b> {why}</div>}
      {groups.every(([, items]) => items.length === 0) && (
        <span className="muted">No related messages for this one.</span>
      )}
      {groups.map(([label, items]) => (
        items.length > 0 && (
          <div className="ctx-group" key={label}>
            <div className="ctx-group-title">{label} ({items.length})</div>
            {items.map(it => (
              <div
                className={`ctx-item${it.message_id === selectedMessageId ? ' selected' : ''}`}
                key={`${label}-${it.message_id}`}
                onClick={() => onSelectMessage && onSelectMessage(it.message_id)}
                title="Click to focus this message"
              >
                <div className="ctx-item-meta">
                  {it.comm_id != null && <span className="comm-id">#{it.comm_id}</span>}
                  <span className="ctx-badge">{it.channel}</span>
                  <span className="ctx-agent">{it.agent_label}</span>
                  <span className="ctx-ts">{it.timestamp}</span>
                  <span className="ctx-reason">{it.relation_reason}</span>
                </div>
                <div className="ctx-preview">
                  {(it.content || '').slice(0, 160)}{(it.content || '').length > 160 ? '…' : ''}
                </div>
              </div>
            ))}
          </div>
        )
      ))}
    </div>
  );
}

// ============================================
// Conversation Flow modal (chat-history style)
// ============================================
const KIND_TAG = {
  direct: { label: 'direct reply', color: '#22c55e' },
  addressed: { label: 'addressed', color: '#f59e0b' },
  root: { label: 'thread start', color: '#7f93ad' },
};

function ConversationFlowModal({ open, context, selectedMessageId, onClose, onSelectMessage }) {
  if (!open) return null;

  // 解決済みスレッド全体（祖先 → 選択 message → 返信）を時系列で表示する。
  // 親リンクは responding_to(message-id / @role) + recipients から解決済み。
  const thread = (context && context.thread) || [];
  const selIdx = thread.findIndex(t => t.is_focus);
  const before = selIdx >= 0 ? selIdx : 0;
  const after = selIdx >= 0 ? thread.length - selIdx - 1 : 0;

  const sel = context && context.selected_message;
  const why = sel && sel.why_matters;

  const renderBubble = (item) => {
    const color = AGENTS[item.agent_id]?.color || '#5a7a9a';
    const isSelf = !!item.is_focus;
    const isReply = !isSelf && (item.reply_kind === 'direct' || item.reply_kind === 'addressed');
    const tag = KIND_TAG[item.reply_kind] || null;
    return (
      <div
        key={item.message_id}
        className={`chat-bubble${isSelf ? ' selected' : ''}${isReply ? ' is-reply' : ''}`}
        style={{ '--agent-color': color }}
        onClick={() => item.message_id !== selectedMessageId && onSelectMessage && onSelectMessage(item.message_id)}
        title={isSelf ? 'Focused message' : 'Click to focus this message'}
      >
        <div className="cb-head">
          {isReply && <span className="cb-arrow" title="reply">↳</span>}
          <span className="cb-agent" style={{ color }}>{item.agent_label}</span>
          {item.comm_id != null && <span className="comm-id">#{item.comm_id}</span>}
          <span className="cb-ch">{item.channel}</span>
          <span className="cb-ts">{item.timestamp}</span>
          {tag && <span className="cb-kind" style={{ '--kind-color': tag.color }}>{tag.label}</span>}
          <span className={`cb-reason${isSelf ? ' is-sel' : ''}`}>{isSelf ? 'selected' : item.relation_reason}</span>
        </div>
        <div className="cb-body">{item.content}</div>
      </div>
    );
  };

  return (
    <div className="flow-overlay" onClick={onClose}>
      <div className="flow-modal" onClick={e => e.stopPropagation()}>
        <div className="flow-modal-head">
          <div>
            <h3>Conversation flow</h3>
            {sel && (
              <div className="flow-sub">
                Reconstructed from <code>responding_to</code> + <code>recipients</code> ·
                {' '}{thread.length} message{thread.length === 1 ? '' : 's'}
                {' '}({before} leading up, {after} reply{after === 1 ? '' : 'ies'})
              </div>
            )}
          </div>
          <button className="flow-close" onClick={onClose}>✕</button>
        </div>

        {why && <div className="flow-why"><b>Why this matters:</b> {why}</div>}

        {(!context || !context.found) && (
          <p className="muted" style={{ padding: '8px 4px 8px 16px' }}>No message selected.</p>
        )}

        {context && context.found && thread.length <= 1 && (
          <p className="muted" style={{ padding: '8px 16px' }}>
            This message starts a thread on its own — nothing replies to it and it
            isn’t addressed to an earlier speaker.
          </p>
        )}

        <div className="flow-list">
          {thread.map(item => renderBubble(item))}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

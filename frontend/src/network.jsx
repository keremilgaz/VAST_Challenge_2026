// ============================================================
// NetworkVisualization — CrisisNet-style reply graph
// ============================================================
// CrisisNet.html の network 描画スタイルを React component として再現:
//   - 明るいpastel塗りnode + 色付きリング + inner glow + badge
//   - channel ごとに色分けされた曲線エッジ（同一ペアの複数channelは扇状に展開）
//   - glow付きエッジ、dimmed/highlighted、tt-k/tt-v tooltip、channel legend
// データは FastAPI /api/network から（edge は channel 分割で返る）。
// props / API shape は従来互換（channel が無くても動く）。
// ============================================================

import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

// CrisisNet と同じ agent config（fill は dark 背景で映える明るい pastel）
export const AGENTS = {
  legal_agent:        { label: 'Legal-Agent',    abbr: 'LA', color: '#D85A30', fill: '#FAECE7', seniority: 'Senior' },
  quality_agent:      { label: 'Platform-Trust', abbr: 'PT', color: '#7F77DD', fill: '#EEEDFE', seniority: 'Senior' },
  social_media_agent: { label: 'Social-Manager', abbr: 'SM', color: '#639922', fill: '#EAF3DE', seniority: 'Senior' },
  judge_agent:        { label: 'Judge',          abbr: 'J',  color: '#1D9E75', fill: '#E1F5EE', seniority: 'Compliance' },
  pr_agent:           { label: 'PR-Agent',       abbr: 'PR', color: '#BA7517', fill: '#FAEEDA', seniority: 'Senior' },
  pr_intern_agent:    { label: 'PR-Intern',      abbr: 'PI', color: '#D4537E', fill: '#FBEAF0', seniority: 'Junior' },
  intern_agent:       { label: 'Intern',         abbr: 'IN', color: '#888780', fill: '#F1EFE8', seniority: 'Junior' },
};

// CrisisNet と同じ channel 色（edge を channel ごとに色分け）
const CHANNELS = {
  comms_huddle:    { label: 'comms_huddle',  color: '#378ADD' },
  one_on_one_chat: { label: 'one_on_one',    color: '#7F77DD' },
  side_huddle:     { label: 'side_huddle',   color: '#1D9E75' },
  official_post:   { label: 'official_post', color: '#639922' },
  personal_post:   { label: 'personal_post', color: '#BA7517' },
  anonymous_post:  { label: 'anon_post',     color: '#E24B4A' },
};
const channelColor = (ch) => CHANNELS[ch]?.color || '#5A7A9A';
const channelLabel = (ch) => CHANNELS[ch]?.label || (ch || 'other');

// CrisisNet と同じ初期座標
const NP = {
  legal_agent:        { x: 220, y: 165 },
  quality_agent:      { x: 490, y: 138 },
  social_media_agent: { x: 595, y: 298 },
  judge_agent:        { x: 378, y: 290 },
  pr_agent:           { x: 525, y: 432 },
  pr_intern_agent:    { x: 298, y: 458 },
  intern_agent:       { x: 135, y: 335 },
};

const W = 720;
const H = 540;

function nodeRadius(value, maxValue) {
  const v = Math.max(0, value || 0);
  const norm = maxValue > 0 ? v / maxValue : 0;
  return 13 + Math.sqrt(norm) * 21;
}

function edgeWidth(w, maxW) {
  const norm = maxW > 0 ? w / maxW : 0;
  return Math.max(1.4, 1.4 + norm * 7);
}

function sentimentColor(s) {
  if (s === null || s === undefined) return '#3a4a5e';
  if (s >= 0) {
    const t = Math.min(1, s);
    return d3.interpolateRgb('#9aa7b5', '#4ade80')(t);
  }
  const t = Math.min(1, -s);
  return d3.interpolateRgb('#9aa7b5', '#e24b4a')(t);
}

export default function NetworkVisualization({
  data,
  layout = 'force',
  sizeMetric = 'messages',
  edgeMetric = 'weight',
  selectedNode,
  onSelectNode,
  followingHeatmapSort = false,
  heatmapOrder = [],
  heatmapSortKey = 'agent_id',
  heatmapSortDir = 'asc',
}) {
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);
  const simRef = useRef(null);

  useEffect(() => {
    const nodes = (data?.nodes || []).map(n => ({ ...n }));
    const rawEdges = data?.edges || [];

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const gMain = svg.append('g').attr('class', 'net-main');
    const gGrid = gMain.append('g').attr('class', 'net-grid');
    const gEdges = gMain.append('g').attr('class', 'net-edges');
    const gNodes = gMain.append('g').attr('class', 'net-nodes');

    const dots = [];
    for (let x = 20; x < W; x += 32) for (let y = 14; y < H; y += 32) dots.push({ x, y });
    gGrid.selectAll('circle').data(dots).enter().append('circle')
      .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', 1).attr('fill', '#151F2E');

    const zoom = d3.zoom().scaleExtent([0.3, 4]).on('zoom', ev => {
      gMain.attr('transform', ev.transform);
    });
    svg.call(zoom);

    if (!nodes.length) {
      gMain.append('text').attr('x', W / 2).attr('y', H / 2)
        .attr('text-anchor', 'middle').attr('fill', '#5a7a9a')
        .attr('font-size', 14).text('No agents match the current filters.');
      return;
    }

    const sizeValue = (n) => {
      if (sizeMetric === 'merger') return n.merger_related_count || 0;
      if (sizeMetric === 'sentiment') return Math.abs(n.bert_sentiment_score || 0);
      return n.message_count || 0;
    };
    const maxSize = d3.max(nodes, sizeValue) || 1;
    nodes.forEach(n => {
      n.r = nodeRadius(sizeValue(n), maxSize);
      const init = NP[n.id] || { x: W / 2, y: H / 2 };
      n.x = init.x; n.y = init.y;
    });

    if (layout === 'circle') {
      const cx = W / 2, cy = H / 2, R = 200;
      nodes.forEach((n, i) => {
        const ang = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
        n.fx = cx + Math.cos(ang) * R;
        n.fy = cy + Math.sin(ang) * R;
      });
    }

    const edgeValue = (e) => edgeMetric === 'merger' ? (e.merger_related_count || 0) : (e.weight || 0);
    let links = rawEdges
      .filter(e => nodes.find(n => n.id === e.source) && nodes.find(n => n.id === e.target))
      .map(e => ({ ...e, source: e.source, target: e.target, channel: e.channel || 'unknown', val: edgeValue(e) }))
      .filter(e => edgeMetric !== 'merger' || e.val > 0);
    const maxW = d3.max(links, e => e.val) || 1;

    // ── 有向グラフ用の offset 計算 ──
    // 同じ「向き」(source>target) の channel 別 edge は、その向きの基準オフセット周りに扇状展開する。
    // 基準オフセットは a→b 進行方向に対する垂線（常に +）なので、A→B と B→A は
    // 自動的に反対側へ弧を描き、矢印付きでも重ならず方向が読める。
    const dirTotal = {};
    links.forEach(e => {
      const k = `${e.source}>${e.target}`;
      dirTotal[k] = (dirTotal[k] || 0) + 1;
    });
    const dirSeen = {};
    links.forEach(e => {
      const k = `${e.source}>${e.target}`;
      const i = dirSeen[k] || 0;
      dirSeen[k] = i + 1;
      const n = dirTotal[k];
      const center = (n - 1) / 2;
      const base = 24;           // 向きごとの基準ふくらみ（必ず片側）
      e._off = base + (i - center) * 15;   // 同方向の複数 channel を扇状に
    });

    // ── tooltip ──
    const tt = d3.select(tooltipRef.current);
    const showTT = (ev, html) => { tt.style('display', 'block').html(html); moveTT(ev); };
    const moveTT = (ev) => {
      const rect = svgRef.current.getBoundingClientRect();
      tt.style('left', (ev.clientX - rect.left + 14) + 'px')
        .style('top', (ev.clientY - rect.top + 14) + 'px');
    };
    const hideTT = () => tt.style('display', 'none');

    // ── highlight ──
    function highlightNode(id) {
      const connected = new Set([id]);
      links.forEach(e => { if (e.source === id) connected.add(e.target); if (e.target === id) connected.add(e.source); });
      nodeSel.classed('dimmed', d => !connected.has(d.id));
      edgeSel.classed('dimmed', e => !(e.source === id || e.target === id))
        .classed('highlighted', e => e.source === id || e.target === id);
    }
    function clearHighlight() {
      nodeSel.classed('dimmed', false);
      edgeSel.classed('dimmed', false).classed('highlighted', false);
    }

    // ── EDGES ──
    const edgeSel = gEdges.selectAll('g.net-edge').data(links).enter()
      .append('g').attr('class', 'net-edge');

    edgeSel.append('path').attr('class', 'edge-glow')
      .style('fill', 'none').style('stroke-linecap', 'round')
      .style('stroke', e => channelColor(e.channel))
      .style('stroke-width', e => edgeWidth(e.val, maxW) + 6)
      .style('stroke-opacity', 0.07);

    edgeSel.append('path').attr('class', 'edge-path')
      .style('fill', 'none').style('stroke-linecap', 'round')
      .style('stroke', e => channelColor(e.channel))
      .style('stroke-width', e => edgeWidth(e.val, maxW))
      .style('stroke-opacity', 0.6);

    // 方向を示す矢印（target node の手前に置く）
    edgeSel.append('path').attr('class', 'edge-arrow')
      .style('fill', e => channelColor(e.channel))
      .style('stroke', 'none');

    edgeSel.append('path').attr('class', 'edge-hit')
      .style('fill', 'none').style('stroke', 'transparent')
      .style('stroke-width', 16).style('cursor', 'pointer')
      .on('mouseenter', function (ev, e) {
        const fa = AGENTS[e.source]?.label || e.source;
        const ta = AGENTS[e.target]?.label || e.target;
        showTT(ev, `<div class="tt-name" style="color:${channelColor(e.channel)}">${fa} &rarr; ${ta}</div>
          <div class="tt-row"><span class="tt-k">Channel</span><span class="tt-v">${channelLabel(e.channel)}</span></div>
          <div class="tt-row"><span class="tt-k">Replies</span><span class="tt-v">${e.weight}</span></div>
          <div class="tt-row"><span class="tt-k">Merger-related</span><span class="tt-v">${e.merger_related_count}</span></div>`);
      })
      .on('mousemove', moveTT)
      .on('mouseleave', hideTT);

    // weight ラベルは各 edge group の中に入れる（既定は CSS で非表示、hover/highlight 時のみ表示）
    const edgeLbl = edgeSel.append('g').attr('class', 'net-edge-lbl');
    edgeLbl.append('rect').attr('rx', 4).attr('height', 14)
      .attr('fill', '#08111E').attr('fill-opacity', 0.92);
    edgeLbl.append('text').attr('text-anchor', 'middle')
      .attr('font-family', 'monospace').attr('font-size', 9.5).attr('font-weight', 700);

    // ── NODES ──
    const isSentiment = sizeMetric === 'sentiment';
    const nodeFill = (d) => isSentiment ? sentimentColor(d.bert_sentiment_score) : (AGENTS[d.id]?.fill || '#dfe7f0');
    const nodeStroke = (d) => AGENTS[d.id]?.color || '#888';
    const abbrColor = (d) => isSentiment ? '#0a0f16' : (AGENTS[d.id]?.color || '#333');

    const nodeSel = gNodes.selectAll('g.net-node').data(nodes).enter()
      .append('g').attr('class', 'net-node').style('cursor', 'pointer')
      .on('click', (ev, n) => { ev.stopPropagation(); onSelectNode && onSelectNode(n.id); })
      .on('mouseenter', function (ev, n) {
        const a = AGENTS[n.id] || {};
        showTT(ev, `<div class="tt-name" style="color:${a.color || '#fff'}">${n.label}</div>
          <div class="tt-row"><span class="tt-k">Messages</span><span class="tt-v">${n.message_count}</span></div>
          <div class="tt-row"><span class="tt-k">Merger-related</span><span class="tt-v">${n.merger_related_count}</span></div>
          <div class="tt-row"><span class="tt-k">BERT sentiment</span><span class="tt-v">${n.bert_sentiment_score == null ? '\u2014' : n.bert_sentiment_score.toFixed(2)}</span></div>`);
        highlightNode(n.id);
        d3.select(this).select('.n-label').transition().duration(120).attr('opacity', 1);
      })
      .on('mousemove', moveTT)
      .on('mouseleave', function (ev, d) {
        hideTT();
        if (!selectedNode) clearHighlight(); else highlightNode(selectedNode);
        if (d.id !== selectedNode) d3.select(this).select('.n-label').transition().duration(120).attr('opacity', 0);
      });

    nodeSel.append('circle').attr('class', 'n-ring')
      .attr('r', d => d.r + 8).attr('fill', 'none')
      .attr('stroke', nodeStroke).attr('stroke-width', 1.2)
      .attr('stroke-opacity', 0.18).attr('stroke-dasharray', '4 3');

    nodeSel.append('circle').attr('class', 'n-glow')
      .attr('r', d => d.r + 3).attr('fill', nodeStroke).attr('fill-opacity', 0.09);

    nodeSel.append('circle').attr('class', 'n-circle')
      .attr('r', d => d.r).attr('fill', nodeFill)
      .attr('stroke', nodeStroke).attr('stroke-width', 2.5);

    nodeSel.append('circle').attr('class', 'n-inner')
      .attr('r', d => Math.max(2, d.r - 4)).attr('fill', nodeStroke).attr('fill-opacity', 0.18);

    nodeSel.append('text').attr('class', 'n-abbr')
      .attr('text-anchor', 'middle')
      .attr('font-family', 'monospace').attr('font-weight', 700)
      .attr('font-size', d => Math.max(9, Math.round(d.r * 0.56)))
      .attr('fill', abbrColor).attr('pointer-events', 'none')
      .text(d => AGENTS[d.id]?.abbr || d.id.slice(0, 2));

    nodeSel.append('text').attr('class', 'n-label')
      .attr('text-anchor', 'middle')
      .attr('font-family', 'sans-serif').attr('font-size', 11).attr('font-weight', 600)
      .attr('fill', '#cfe0f2').attr('pointer-events', 'none').attr('opacity', 0)
      .text(d => d.label);

    nodeSel.append('rect').attr('class', 'n-badge-rect').attr('rx', 6.5).attr('height', 13)
      .attr('fill', nodeStroke).attr('pointer-events', 'none');
    nodeSel.append('text').attr('class', 'n-badge-txt')
      .attr('text-anchor', 'middle').attr('font-family', 'monospace')
      .attr('font-size', 9).attr('fill', '#fff').attr('font-weight', 700)
      .attr('pointer-events', 'none').text(d => d.message_count);

    // ── heatmap rank chip（"Apply heatmap sorting to network" ON 時のみ） ──
    // heatmapOrder（heatmap の並び順 agent_id 列）から各 node の順位 #1.. を出す。
    // agent name / total / sentiment いずれの sort でも network に並び順が反映される。
    const rankById = {};
    (heatmapOrder || []).forEach((id, i) => { rankById[id] = i + 1; });
    const showRank = followingHeatmapSort && (heatmapOrder || []).length > 0;
    if (showRank) {
      nodeSel.append('circle').attr('class', 'n-rank-bg')
        .attr('r', 9).attr('fill', '#0b1626')
        .attr('stroke', nodeStroke).attr('stroke-width', 1.5)
        .attr('pointer-events', 'none');
      nodeSel.append('text').attr('class', 'n-rank-txt')
        .attr('text-anchor', 'middle').attr('font-family', 'monospace')
        .attr('font-size', 9.5).attr('font-weight', 800)
        .attr('fill', '#dbe7f5').attr('pointer-events', 'none')
        .text(d => rankById[d.id] != null ? `#${rankById[d.id]}` : '');
    }

    // ── 曲線 path + 矢印（有向）。target node の手前で止め、矢印をその先に置く ──
    function edgeGeom(a, b, off) {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      const cx = mx + (-dy / l) * off, cy = my + (dx / l) * off;
      // quadratic の b における接線方向 = (b - c)
      let tx = b.x - cx, ty = b.y - cy;
      const tl = Math.sqrt(tx * tx + ty * ty) || 1; tx /= tl; ty /= tl;
      const br = b.r || 13;
      const ex = b.x - tx * (br + 9), ey = b.y - ty * (br + 9);   // 線の終点（node 手前）
      const tipx = b.x - tx * (br + 2), tipy = b.y - ty * (br + 2); // 矢印の先端
      const aw = 4.5, alen = 8;
      const bx = tipx - tx * alen, by = tipy - ty * alen;          // 矢印の根元中心
      const px = -ty, py = tx;                                     // 垂線
      const arrow = `M${tipx},${tipy} L${bx + px * aw},${by + py * aw} L${bx - px * aw},${by - py * aw} Z`;
      const path = `M${a.x},${a.y} Q${cx},${cy} ${ex},${ey}`;
      const lx = 0.25 * a.x + 0.5 * cx + 0.25 * b.x, ly = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
      return { path, arrow, lx, ly };
    }

    function ticked() {
      edgeSel.each(function (e) {
        const a = typeof e.source === 'object' ? e.source : nodes.find(n => n.id === e.source);
        const b = typeof e.target === 'object' ? e.target : nodes.find(n => n.id === e.target);
        if (!a || !b) return;
        const gm = edgeGeom(a, b, e._off);
        const g = d3.select(this);
        g.select('.edge-glow').attr('d', gm.path);
        g.select('.edge-path').attr('d', gm.path);
        g.select('.edge-hit').attr('d', gm.path);
        g.select('.edge-arrow').attr('d', gm.arrow);
        const txt = String(e.weight);
        const rw = txt.length * 7 + 8;
        const col = channelColor(e.channel);
        const lbl = g.select('.net-edge-lbl');
        lbl.select('rect').attr('x', gm.lx - rw / 2).attr('y', gm.ly - 7).attr('width', rw)
          .attr('stroke', col).attr('stroke-opacity', 0.3).attr('stroke-width', 0.5);
        lbl.select('text').attr('x', gm.lx).attr('y', gm.ly + 4).attr('fill', col).text(txt);
      });
      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
      nodeSel.select('.n-label').attr('y', d => d.y > 380 ? -d.r - 9 : d.r + 16);
      nodeSel.select('.n-badge-rect').each(function (d) {
        const bw = String(d.message_count).length * 7 + 12;
        d3.select(this).attr('width', bw).attr('x', d.r - 2).attr('y', -d.r + 2 - 9);
      });
      nodeSel.select('.n-badge-txt').each(function (d) {
        const bw = String(d.message_count).length * 7 + 12;
        d3.select(this).attr('x', d.r - 2 + bw / 2).attr('y', -d.r + 2 + 1.5);
      });
      nodeSel.select('.n-abbr').attr('y', d => Math.max(9, Math.round(d.r * 0.56)) * 0.4);
      // rank chip を node の左上に配置（message-count badge は右上）
      nodeSel.select('.n-rank-bg').attr('cx', d => -d.r + 1).attr('cy', d => -d.r + 1);
      nodeSel.select('.n-rank-txt').attr('x', d => -d.r + 1).attr('y', d => -d.r + 1 + 3.3);
    }

    // ── レイアウト: CrisisNet と同じ静的固定配置（force simulation なし） ──
    // node を動かしても他の node は動かない（ドラッグした node だけ移動）。
    nodes.forEach(n => {
      if (layout === 'circle') { n.x = n.fx; n.y = n.fy; }
      // それ以外は NP の手調整座標をそのまま使う（既に x/y セット済み）
    });
    ticked();

    nodeSel.call(d3.drag()
      .on('start', function () { d3.select(this).raise(); })
      .on('drag', (ev, d) => { d.x = ev.x; d.y = ev.y; ticked(); }));

    if (selectedNode) highlightNode(selectedNode);

    return () => { if (simRef.current) { simRef.current.stop(); simRef.current = null; } };
  }, [data, layout, sizeMetric, edgeMetric, onSelectNode, followingHeatmapSort, heatmapOrder, heatmapSortKey, heatmapSortDir]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('g.net-node')
      .classed('selected', d => d.id === selectedNode)
      .each(function (d) {
        d3.select(this).select('.n-label').attr('opacity', d.id === selectedNode ? 1 : 0);
      });
  }, [selectedNode, data]);

  // 現在の edges に存在する channel を legend 用に集計
  const channelTotals = {};
  (data?.edges || []).forEach(e => {
    const ch = e.channel || 'unknown';
    channelTotals[ch] = (channelTotals[ch] || 0) + (e.weight || 0);
  });
  const legendChannels = Object.keys(CHANNELS).filter(ch => channelTotals[ch] > 0);

  return (
    <div className="net-wrap">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="net-svg" />
      <div ref={tooltipRef} className="net-tt" style={{ display: 'none' }} />
      <div className="net-legend">
        <span className="nl-item nl-dir">▸ arrow = reply direction (sender → recipient)</span>
        {legendChannels.length > 0 ? legendChannels.map(ch => (
          <span className="nl-item" key={ch}>
            <span className="nl-line" style={{ background: channelColor(ch) }} /> {channelLabel(ch)}
            <span className="nl-cnt">{channelTotals[ch]}</span>
          </span>
        )) : <span className="nl-item">Edge color = channel · node size = messages · hover for name</span>}
      </div>
    </div>
  );
}

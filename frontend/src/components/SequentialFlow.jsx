// ============================================
// Sequential flow visualization（heatmap の上に重ねる横時系列）
// ============================================
// リリースが embargo enforcement をすり抜けるまでの代表イベントを DAG として描く。
//   - x 軸は heatmap と同じ time_buckets / cell 幅 / LABEL_COL を使い、
//     scrollRef を共有することで heatmap の横スクロールと完全に連動する。
//   - node = event（SEQ_EVENTS）。SEQ_EDGES の因果を弧（arc）で結ぶ。
//   - 弧は「同じ tier に x が重なる弧を置かない」貪欲割り当てで重ならないようにする。
//   - node クリックで detail（英語1文）＋ 決定的に関連する message 一覧を出す。
//     message 一覧は既存 MessageList を再利用するので "event related message" ラベルも付く。
import React, { useMemo } from 'react';
import { CELL, LABEL_COL, SEQ_EVENTS, SEQ_EDGES, SEQ_KINDS } from '../constants.js';
import { timeToBucket } from '../utils.js';
import { MessageList } from './messagePanels.jsx';

export function SequentialFlow({
  granularity, buckets, scrollRef, onScroll,
  selectedEventId, onSelectEvent,
  eventMessages, eventMessagesStatus, selectedMessageId, onSelectMessage,
}) {
  const cell = CELL[granularity];
  const cols = buckets?.length || 0;
  const plotW = cols * cell.w;
  const xAt = (i) => LABEL_COL + i * cell.w + cell.w / 2;

  // 各 event を現在の time 窓の bucket index に解決（窓外なら描かない）。
  const placed = useMemo(() => {
    const arr = [];
    for (const ev of SEQ_EVENTS) {
      const bi = (buckets || []).indexOf(timeToBucket(ev.time, granularity));
      if (bi < 0) continue;
      arr.push({ ...ev, bi, x: xAt(bi), stack: 0 });
    }
    // 同じ bucket に複数 event（daily 粒度など）→ 縦に段積みして重なりを避ける。
    const byBi = new Map();
    for (const p of arr) {
      if (!byBi.has(p.bi)) byBi.set(p.bi, []);
      byBi.get(p.bi).push(p);
    }
    for (const list of byBi.values()) list.forEach((p, k) => { p.stack = k; });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, granularity]);

  const posById = useMemo(() => {
    const m = new Map();
    placed.forEach(p => m.set(p.id, p));
    return m;
  }, [placed]);

  // 因果エッジ → 弧。両端が描画されているものだけ。tier を貪欲割り当てして重ならせない。
  const arcs = useMemo(() => {
    const es = [];
    for (const e of SEQ_EDGES) {
      const a = posById.get(e.from), b = posById.get(e.to);
      if (!a || !b) continue;
      es.push({ ...e, a, b, x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x) });
    }
    es.sort((p, q) => p.x1 - q.x1);
    const tierEnd = []; // tier ごとに「最後に使った x2」
    for (const arc of es) {
      let t = 0;
      for (; t < tierEnd.length; t++) if (tierEnd[t] <= arc.x1 - 4) break;
      arc.tier = t;
      tierEnd[t] = arc.x2;
    }
    return es;
  }, [posById]);

  const maxTier = arcs.reduce((mx, a) => Math.max(mx, a.tier), -1);
  const tierH = 15;
  const arcRegionH = (maxTier + 1) * tierH + 12;
  const R = 13;
  const stackGap = 2 * R + 26;
  const nodeBaseY = arcRegionH + R + 4;
  const maxStack = placed.reduce((mx, p) => Math.max(mx, p.stack || 0), 0);
  const svgH = nodeBaseY + R + maxStack * stackGap + 26;
  const nodeY = (p) => nodeBaseY + (p.stack || 0) * stackGap;

  const selEvent = selectedEventId
    ? (posById.get(selectedEventId) || SEQ_EVENTS.find(e => e.id === selectedEventId))
    : null;
  const selKind = selEvent ? (SEQ_KINDS[selEvent.kind] || SEQ_KINDS.decision) : null;

  return (
    <div className="seqflow-card">
      <div className="seqflow-head">
        <h3>Sequence of events → the release past embargo enforcement</h3>
        <span className="muted small">
          Nodes = key events · lines = causal links (dashed = blind-spot) · x-axis aligned with the heatmap below · click a node for details
        </span>
      </div>

      <div className="seqflow-scroll" ref={scrollRef} onScroll={onScroll}>
        <svg width={LABEL_COL + plotW + 8} height={svgH} className="seqflow-svg">
          <defs>
            <marker id="seq-arrow" viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1 1 L8 5 L1 9" fill="none" stroke="context-stroke" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>

          <text x={10} y={nodeBaseY + 4} fontSize="11" fill="#7a8aa0">Flow</text>

          {/* 因果の弧（tier で高さを分けて重ならせない） */}
          {arcs.map((arc, i) => {
            const yA = nodeY(arc.a) - R;
            const yB = nodeY(arc.b) - R;
            const topY = arcRegionH - (arc.tier + 1) * tierH; // tier が高いほど上（y 小）
            const dash = arc.type === 'enabling' ? '5 4' : undefined;
            const color = arc.type === 'enabling' ? '#a78bfa' : '#8fb2d8';
            const x1 = arc.a.x, x2 = arc.b.x;
            const d = `M ${x1} ${yA} C ${x1} ${topY}, ${x2} ${topY}, ${x2} ${yB}`;
            return (
              <path key={i} d={d} fill="none" stroke={color} strokeWidth="1.6"
                strokeDasharray={dash} markerEnd="url(#seq-arrow)" opacity="0.85" />
            );
          })}

          {/* event node（番号入りの丸 + 短いタイトル） */}
          {placed.map(p => {
            const y = nodeY(p);
            const kind = SEQ_KINDS[p.kind] || SEQ_KINDS.decision;
            const sel = selectedEventId === p.id;
            return (
              <g key={p.id} style={{ cursor: 'pointer' }} onClick={() => onSelectEvent(p.id)}>
                <circle cx={p.x} cy={y} r={sel ? R + 2 : R} fill={kind.color}
                  stroke={sel ? '#ffffff' : '#0b1622'} strokeWidth={sel ? 2 : 1} />
                <text x={p.x} y={y + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#0b1622">{p.order}</text>
                <text x={p.x} y={y + R + 14} textAnchor="middle" fontSize="10"
                  fill={sel ? '#ffffff' : '#9fb2c8'} fontWeight={sel ? '700' : '400'}>{p.title}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* legend */}
      <div className="seqflow-legend">
        {Object.entries(SEQ_KINDS).map(([k, v]) => (
          <span key={k} className="sf-key"><span className="sf-dot" style={{ background: v.color }} /> {v.label}</span>
        ))}
        <span className="sf-key"><span className="sf-line" /> direct cause</span>
        <span className="sf-key"><span className="sf-line dashed" /> enabling / blind-spot</span>
      </div>

      {/* click → detail（英語1文）＋ 決定的に関連する message */}
      {selEvent && (
        <div className="seqflow-detail">
          <div className="sf-detail-head">
            <span className="sf-badge" style={{ background: selKind.color }}>{selEvent.order}</span>
            <b>{selEvent.title}</b>
            <span className="sf-kind" style={{ color: selKind.color, borderColor: selKind.color }}>{selKind.label}</span>
            <span className="muted small">{selEvent.time.replace('T', ' ')}</span>
            <span className="sf-close" role="button" title="Close" onClick={() => onSelectEvent(selEvent.id)}>✕</span>
          </div>
          <p className="sf-detail-text">{selEvent.detail}</p>
          <div className="sf-msgs-title">
            Decisively related event messages ({(selEvent.related || []).length})
          </div>
          {eventMessagesStatus === 'loading' && <span className="muted small">Loading…</span>}
          {eventMessagesStatus === 'error' && <span className="muted small">Could not load messages (is the backend running?).</span>}
          {eventMessagesStatus === '' && (
            <MessageList messages={eventMessages} selectedMessageId={selectedMessageId} onSelectMessage={onSelectMessage} />
          )}
        </div>
      )}
    </div>
  );
}

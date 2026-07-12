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
import React, { useMemo, useState } from 'react';
import { CELL, LABEL_COL, SEQ_EVENTS, SEQ_EDGES, SEQ_KINDS } from '../constants.js';
import { timeToBucket, shortBucket } from '../utils.js';
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

  // ホバー中の node（現在はラベル常時表示なので、強調用途のみ）。
  const [hoveredId, setHoveredId] = useState(null);

  const R = 9; // node 半径（小さくして縦幅を抑える）

  // 各 event を現在の time 窓の bucket index に解決（窓外なら描かない）。
  // ラベルはホバー/選択時のみ出すので、段(stack)割り当ては node の幅だけで判定する。
  // これにより縦幅が最小になる（常時ラベルだと daily で 7 段 ≒ 366px 必要だった）。
  const placed = useMemo(() => {
    const arr = [];
    for (const ev of SEQ_EVENTS) {
      const bi = (buckets || []).indexOf(timeToBucket(ev.time, granularity));
      if (bi < 0) continue;
      const x = xAt(bi);
      const w = 2 * R + 6;
      arr.push({ ...ev, bi, x, left: x - w / 2, right: x + w / 2, stack: 0 });
    }
    arr.sort((a, b) => a.left - b.left || a.bi - b.bi);
    const laneRight = [];
    for (const p of arr) {
      let lane = 0;
      for (; lane < laneRight.length; lane++) {
        if (laneRight[lane] <= p.left - 4) break;
      }
      p.stack = lane;
      laneRight[lane] = p.right;
    }
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

    // 同じ node に複数の矢印が出入りすると、始点/終点が1点に集中して矢尻が重なる。
    // → node ごとに「入ってくる弧」「出ていく弧」を左右に扇状に散らす。
    const inBy = new Map();  // nodeId -> 入ってくる arc[]
    const outBy = new Map(); // nodeId -> 出ていく arc[]
    for (const arc of es) {
      if (!outBy.has(arc.from)) outBy.set(arc.from, []);
      outBy.get(arc.from).push(arc);
      if (!inBy.has(arc.to)) inBy.set(arc.to, []);
      inBy.get(arc.to).push(arc);
    }
    const SPREAD = 3.6; // 隣り合う端点の水平間隔(px)。最多入力の mosaic(5本)でも node 内に収まる幅。
    const fan = (list, key) => {
      // 相手ノードの x 順に並べ、中央基準で左右に振り分ける
      list.sort((p, q) => (key === 'in' ? p.a.x - q.a.x : p.b.x - q.b.x));
      const n = list.length;
      list.forEach((arc, i) => {
        const off = (i - (n - 1) / 2) * SPREAD;
        if (key === 'in') arc.dxIn = off; else arc.dxOut = off;
      });
    };
    for (const list of inBy.values()) fan(list, 'in');
    for (const list of outBy.values()) fan(list, 'out');
    for (const arc of es) {
      arc.dxIn = arc.dxIn || 0;
      arc.dxOut = arc.dxOut || 0;
    }
    return es;
  }, [posById]);

  const maxTier = arcs.reduce((mx, a) => Math.max(mx, a.tier), -1);
  const tierH = 12;
  const arcRegionH = (maxTier + 1) * tierH + 10;
  const stackGap = 2 * R + 6; // node のみ（ラベルはホバー表示）なので詰められる
  const nodeBaseY = arcRegionH + R + 4;
  const maxStack = placed.reduce((mx, p) => Math.max(mx, p.stack || 0), 0);
  // 下部に time 軸（heatmap と同じ bucket）。
  // hourly のときだけ日境界の日付ラベルを軸線の上に出すので、その分の余白を確保する。
  const dayLabelPad = granularity === 'hourly' ? 16 : 4;
  const axisTop = nodeBaseY + R + maxStack * stackGap + dayLabelPad;
  const axisH = 22;
  const svgH = axisTop + axisH;
  const nodeY = (p) => nodeBaseY + (p.stack || 0) * stackGap;

  // ホバーラベル用に右端の余白を少し確保する。
  const rightPad = 12;

  const selEvent = selectedEventId
    ? (posById.get(selectedEventId) || SEQ_EVENTS.find(e => e.id === selectedEventId))
    : null;
  const selKind = selEvent ? (SEQ_KINDS[selEvent.kind] || SEQ_KINDS.decision) : null;

  return (
    <div className="seqflow-card">
      <div className="seqflow-head">
        <h3>Sequence of events → the release past embargo enforcement</h3>
        <span className="muted small seqflow-hint"
          title="Nodes = key events, positioned on the same time buckets as the heatmap below. Lines = causal links; dashed lines are enabling conditions / monitoring blind-spots rather than direct causes.">
          hover a node for its name · click for details
        </span>
      </div>

      <div className="seqflow-scroll" ref={scrollRef} onScroll={onScroll}>
        <svg width={LABEL_COL + plotW + rightPad} height={svgH} className="seqflow-svg">
          <defs>
            <marker id="seq-arrow-direct" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M1 1 L9 5 L1 9 Z" fill="#8fb2d8" />
            </marker>
            <marker id="seq-arrow-enabling" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M1 1 L9 5 L1 9 Z" fill="#a78bfa" />
            </marker>
          </defs>

          <text x={10} y={nodeBaseY + 4} fontSize="11" fill="#7a8aa0">Flow</text>

          {/* 因果の弧。tier で高さを分け、端点は node ごとに扇状に散らして矢尻の重なりを防ぐ。
              選択/ホバー中の node に繋がる弧は強調し、それ以外は淡くして経路を追えるようにする。 */}
          {arcs.map((arc, i) => {
            const focusId = hoveredId || selectedEventId;
            const isFocus = focusId && (arc.from === focusId || arc.to === focusId);
            const dimmed = focusId && !isFocus;

            const topY = arcRegionH - (arc.tier + 1) * tierH; // tier が高いほど上（y 小）
            const dash = arc.type === 'enabling' ? '5 4' : undefined;
            const color = arc.type === 'enabling' ? '#a78bfa' : '#8fb2d8';

            // 始点: 出発 node の上端（扇状オフセット）。
            const x1 = arc.a.x + arc.dxOut;
            const y1 = nodeY(arc.a) - R;
            // 終点: 到着 node の上端の少し手前で止め、矢尻が円に食い込まないようにする。
            const GAP = 4;
            const x2 = arc.b.x + arc.dxIn;
            const y2 = nodeY(arc.b) - R - GAP;

            const d = `M ${x1} ${y1} C ${x1} ${topY}, ${x2} ${topY}, ${x2} ${y2}`;
            return (
              <path key={i} d={d} fill="none" stroke={color}
                strokeWidth={isFocus ? 2.4 : 1.6}
                strokeDasharray={dash}
                markerEnd={`url(#${arc.type === 'enabling' ? 'seq-arrow-enabling' : 'seq-arrow-direct'})`}
                opacity={dimmed ? 0.18 : (isFocus ? 1 : 0.8)} />
            );
          })}

          {/* event node（ラベルはホバー/選択時のみ → 縦幅を最小化） */}
          {placed.map(p => {
            const y = nodeY(p);
            const kind = SEQ_KINDS[p.kind] || SEQ_KINDS.decision;
            const sel = selectedEventId === p.id;
            const hov = hoveredId === p.id;
            const focusId = hoveredId || selectedEventId;
            // focus 中の node に因果で繋がっている node は強調、無関係な node は淡くする。
            const connected = focusId && arcs.some(a =>
              (a.from === focusId && a.to === p.id) || (a.to === focusId && a.from === p.id));
            const dimmed = focusId && !connected && focusId !== p.id;
            return (
              <g key={p.id} style={{ cursor: 'pointer' }}
                opacity={dimmed ? 0.28 : 1}
                onClick={() => onSelectEvent(p.id)}
                onMouseEnter={() => setHoveredId(p.id)}
                onMouseLeave={() => setHoveredId(cur => (cur === p.id ? null : cur))}>
                <title>{p.title}</title>
                <circle cx={p.x} cy={y} r={sel || hov ? R + 2 : R} fill={kind.color}
                  stroke={sel || hov ? '#ffffff' : (connected ? '#c3cee0' : '#0b1622')}
                  strokeWidth={sel || hov ? 2 : (connected ? 1.5 : 1)} />
              </g>
            );
          })}

          {/* time 軸（heatmap と同じ bucket = ラウンド単位。x も heatmap と完全一致） */}
          <g className="sf-axis">
            <line x1={LABEL_COL} y1={axisTop} x2={LABEL_COL + plotW} y2={axisTop}
              stroke="#2a3a52" strokeWidth="1" />
            <text x={10} y={axisTop + 14} fontSize="11" fill="#7a8aa0">Time</text>
            {(buckets || []).map((b, i) => {
              const x = xAt(i);
              const hasEvent = placed.some(p => p.bi === i);
              // hourly は "06-05 09:00" だと隣と重なるので、軸では時刻のみ ("09:00") を出し、
              // 日付は日境界（その日の最初の bucket）にだけ2行目として出す。
              const isHourly = granularity === 'hourly';
              const label = isHourly ? shortBucket(b, granularity).slice(6) : shortBucket(b, granularity);
              const dayOf = (s) => (s || '').slice(0, 10);
              const isDayStart = isHourly && (i === 0 || dayOf(buckets[i - 1]) !== dayOf(b));
              // ラベル幅に応じて間引く（イベントのある bucket は常に表示）。
              const approxLabelW = isHourly ? 34 : 30;
              const step = Math.max(1, Math.ceil(approxLabelW / cell.w));
              const show = i % step === 0;
              return (
                <g key={b}>
                  <line x1={x} y1={axisTop} x2={x} y2={axisTop + (hasEvent ? 6 : 3)}
                    stroke={hasEvent ? '#8fb2d8' : '#2a3a52'} strokeWidth={hasEvent ? 1.5 : 1} />
                  {(show || hasEvent) && (
                    <text x={x} y={axisTop + 18} textAnchor="middle" fontSize="10"
                      fill={hasEvent ? '#c3cee0' : '#7a8aa0'} fontWeight={hasEvent ? '700' : '400'}>
                      {label}
                    </text>
                  )}
                  {isDayStart && (
                    <text x={x} y={axisTop - 4} textAnchor="middle" fontSize="10" fill="#9fb2c8" fontWeight="700">
                      {b.slice(5, 10)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* ラベル: hover(なければ selected) の node と、因果で直接つながる node を同時に表示。
              つながり先の名前も読めるので「どこからどこへ」が追える。
              ラベル同士は当たり判定で上下に逃がして重ならないようにする。 */}
          {(() => {
            const focusId = hoveredId || selectedEventId;
            if (!focusId) return null;
            const ids = new Set([focusId]);
            for (const a of arcs) {
              if (a.from === focusId) ids.add(a.to);
              if (a.to === focusId) ids.add(a.from);
            }
            const rightEdge = LABEL_COL + plotW + rightPad;
            const drawn = [];
            const boxes = [];
            // focus を先に配置（最優先の位置を取らせる）
            const order = [focusId, ...[...ids].filter(i => i !== focusId)];
            for (const id of order) {
              const p = posById.get(id);
              if (!p) continue;
              const isFocus = id === focusId;
              const y = nodeY(p);
              const w = Math.max(40, p.title.length * 6.2 + 14);
              let bx = p.x - w / 2;
              if (bx + w > rightEdge) bx = rightEdge - w;
              if (bx < 2) bx = 2;
              // 上 → 下 → さらに上 → さらに下 の順で空きを探す
              const cands = [y - R - 24, y + R + 6, y - R - 46, y + R + 28, y - R - 68];
              let by = cands[0];
              for (const c of cands) {
                if (c < 2) continue;
                const hit = drawn.some(d =>
                  !(bx + w < d.x || bx > d.x + d.w || c + 20 < d.y || c > d.y + 20));
                if (!hit) { by = c; break; }
              }
              drawn.push({ x: bx, y: by, w });
              boxes.push({ id, bx, by, w, title: p.title, isFocus });
            }
            return (
              <g pointerEvents="none">
                {boxes.map(b => (
                  <g key={b.id}>
                    <rect x={b.bx} y={b.by} width={b.w} height={20} rx={5}
                      fill="#0b1622" stroke={b.isFocus ? '#7d93ad' : '#3b4d68'}
                      strokeWidth="1" opacity={b.isFocus ? 0.98 : 0.92} />
                    <text x={b.bx + b.w / 2} y={b.by + 14} textAnchor="middle" fontSize="11"
                      fill={b.isFocus ? '#e5edf7' : '#a8b8cc'}
                      fontWeight={b.isFocus ? '700' : '400'}>{b.title}</text>
                  </g>
                ))}
              </g>
            );
          })()}
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
            <span className="sf-badge" style={{ background: selKind.color }} />
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

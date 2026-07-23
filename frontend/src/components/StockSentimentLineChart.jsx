// ============================================
// Stock Price / BERT Sentiment Line Chart
// ============================================

import React, { useState } from 'react';
import { CELL, LABEL_COL, EVENT_MARKERS } from '../constants.js';
import { shortBucket, pctClass, fmtPct, fmtSigned, timeToBucket } from '../utils.js';

// ============================================================

// ============================================================

//

//

//   substring(r.hour,0,13) + ':00:00'

const PRICE_CORRECTIONS = {

  '2046-06-05T09:00:00': {
    price: 28.98,

    reason:
      'Original stock_price was missing (null). Reconstructed from the "percent_change" field of -8%: '
      + '$31.50 x (1 - 0.08) = $28.98.  ($31.50 = last confirmed close on 6/4 09:00.)',
  },

  '2046-06-05T10:00:00': {
    price: 25.5024,

    reason:
      'Original stock_price was missing (null). Reconstructed from the "percent_change" field of -12%: '
      + '$28.98 x (1 - 0.12) = $25.5024 (applied to the corrected 9:00 price).',
  },

  '2046-06-05T11:00:00': {
    price: 27.80,

    reason:
      'The raw value was "$180" — the $180M acquisition valuation leaking into the price field. '
      + 'The event_narrative explicitly states "$27.80, down 4.2%", and the "percent_change" field '
      + 'independently confirms -4.2%. $27.80 is also consistent with the surrounding prices '
      + '($25.50 at 10:00 -> $27.20 at 12:00), whereas $180 would be a physically impossible 6x spike. '
      + 'The narrative is timestamped "10 AM", but that label is itself mislabeled (it references a '
      + '10:30 AM comment request). Based on the narrative content and its consistency with the other '
      + 'messages, $27.80 is judged to be the correct price.',
  },

  '2046-06-05T14:00:00': {
    price: 26.40,

    reason:
      'The raw value was $18.0, which does not match the internal figures. Message 20460605_18_005 '
      + 'states the hard numbers directly — "Stock $26.40, MAC trailing $27.10" — so $26.40 is used '
      + 'for this hour.',
  },

  '2046-06-05T15:00:00': {
    price: 25.80,

    reason:
      'The raw value was $18.0, which does not reflect the updated model. Message 20460605_19_030 '
      + 'explicitly states the model was rebuilt on a "$25.80 baseline", so $25.80 is used as the '
      + 'corrected price for this hour.',
  },

  '2046-06-05T16:00:00': {
    price: 35.5,

    reason:
      'Original stock_price was missing (null). Message 20460605_20_019 forecasts an after-hours '
      + 'repricing of $33–$38 if TenantThread self-announces at 4:30 with CivicLoom consent. Since the '
      + 'announcement did occur, the midpoint of that range is used as the estimate: ($33 + $38) / 2 = $35.5.',
  },

  '2046-06-05T17:00:00': {
    price: 35,

    reason:
      'Original stock_price was missing (null). Message 20460605_21_003 lays out two scenarios — a '
      + 'self-announcement at ~5:15 vs. delaying to 6:00. The announcement actually happened at 5:19–5:27, '
      + 'so the announce-scenario forecast ($33–$37) is used as a reference, taking its midpoint: '
      + '($33 + $37) / 2 = $35.',
  },

  '2046-06-05T18:00:00': {
    price: 33.05,

    reason:
      'Original stock_price was missing (null). The final daily summary (message 20460605_22_056) reports '
      + 'after-hours $TTHR at "$33.05 mid, up 5.9% from $31.20 open", so $33.05 is used for this hour.',
  },
};

export function StockSentimentLineChart({
  data, granularity, showStock, showSentiment, scrollRef, onScroll,
}) {
  const [hover, setHover] = useState(null);

  const [picked, setPicked] = useState(null); // index | null

  const buckets = data?.time_buckets || [];
  const rawSeries = data?.series || [];

  // ============================================================

  // ============================================================

  const series = React.useMemo(() => {
    const s = rawSeries.map((row) => {
      const corr = PRICE_CORRECTIONS[row.time_bucket];
      return corr
        ? { ...row, stock_price: corr.price, correction_reason: corr.reason }
        : { ...row, correction_reason: null };
    });

    let prev = null;
    for (const row of s) {
      if (row.stock_price != null) {
        row.stock_price_change_pct =
          prev != null && prev !== 0
            ? Math.round(((row.stock_price - prev) / Math.abs(prev)) * 10000) / 100
            : null;
        prev = row.stock_price;
      }
    }
    return s;
  }, [rawSeries]);

  const cell = CELL[granularity];
  const plotW = buckets.length * cell.w;

  const RIGHT_PAD = 48;
  const height = 200;
  const padTop = 16, padBottom = 28;
  const innerH = height - padTop - padBottom;

  const xAt = (i) => LABEL_COL + i * cell.w + cell.w / 2;

  // ============================================================

  const PRICE_AXIS_MAX = 38.70;
  const PRICE_AXIS_MIN = 18.00;

  const prices = series.map(s => s.stock_price).filter(v => v !== null && v !== undefined);
  const pMax = PRICE_AXIS_MAX;
  const pMin = PRICE_AXIS_MIN;
  const yPrice = (v) => padTop + innerH - ((v - pMin) / (pMax - pMin)) * innerH;

  const ySent = (v) => padTop + innerH - ((v + 1) / 2) * innerH;

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

  const CORRECTED_COLOR = '#3b82f6';

  const pickedRow = picked !== null ? series[picked] : null;

  return (
    <div className="linechart-card">
      <div className="lc-head">
        <h3>Stock price &amp; market sentiment</h3>
        <div className="lc-legend">
          <span className="lc-key"><span className="lc-swatch" style={{ background: '#22d3ee' }} /> Stock price ($)</span>
          <span className="lc-key"><span className="lc-swatch" style={{ background: '#f59e0b' }} /> Market sentiment (−1…+1)</span>
          <span className="lc-key"><span className="lc-swatch" style={{ background: CORRECTED_COLOR }} /> Corrected value (tap the dot)</span>
        </div>
        <span className="muted small">From market_snapshot · x-axis aligned with the heatmap above</span>
      </div>
      <div className="lc-scroll" ref={scrollRef} onScroll={onScroll}>
        <svg width={LABEL_COL + plotW + RIGHT_PAD} height={height} className="lc-svg"
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

          {/* olay işaretleri (leak / embargo): dikey kesikli çizgi + etiket */}
          {EVENT_MARKERS.map((mk, mi) => {
            const i = buckets.indexOf(timeToBucket(mk.time, granularity));
            if (i < 0) return null;
            return (
              <g key={mk.id}>
                <line x1={xAt(i)} y1={padTop - 4} x2={xAt(i)} y2={padTop + innerH}
                  stroke={mk.color} strokeDasharray="4 3" strokeWidth="1.5" />
                <text x={xAt(i) + 4} y={padTop + 7 + mi * 11} fontSize="9"
                  fill={mk.color} fontWeight="700">{mk.short}</text>
              </g>
            );
          })}

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

          {showStock && series.map((s, i) => {
            if (s.stock_price == null) return null;
            const corrected = !!s.correction_reason;
            const isPicked = picked === i;
            return (
              <g key={`p${i}`}>
                {corrected && (
                  <circle
                    cx={xAt(i)} cy={yPrice(s.stock_price)} r={12}
                    fill="transparent" style={{ cursor: 'pointer' }}
                    onClick={() => setPicked(isPicked ? null : i)}
                  />
                )}
                {corrected && (
                  <circle
                    cx={xAt(i)} cy={yPrice(s.stock_price)} r={isPicked ? 7 : 5.5}
                    fill="none" stroke={CORRECTED_COLOR} strokeWidth={isPicked ? 2.5 : 1.5}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setPicked(isPicked ? null : i)}
                  />
                )}
                <circle
                  cx={xAt(i)} cy={yPrice(s.stock_price)}
                  r={corrected ? 3 : (hover === i ? 4 : 2.5)}
                  fill={corrected ? CORRECTED_COLOR : '#22d3ee'}
                  style={corrected ? { cursor: 'pointer' } : undefined}
                  onClick={corrected ? () => setPicked(isPicked ? null : i) : undefined}
                />
              </g>
            );
          })}
          {/* points (sentiment) */}
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

      {pickedRow && pickedRow.correction_reason && (
        <div
          className="lc-correction-note"
          style={{
            margin: '6px 0 2px', padding: '8px 10px',
            border: `1px solid ${CORRECTED_COLOR}`,
            borderRadius: 6, background: 'rgba(59,130,246,0.10)',
            fontSize: 12, lineHeight: 1.5,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <b style={{ color: CORRECTED_COLOR }}>
              Corrected · {pickedRow.time_bucket} → ${parseFloat(pickedRow.stock_price.toFixed(4))}
            </b>
            <span
              style={{ cursor: 'pointer', color: '#7a8aa0' }}
              onClick={() => setPicked(null)}
            >✕</span>
          </div>
          <div style={{ marginTop: 4, color: '#c8d4e2' }}>{pickedRow.correction_reason}</div>
        </div>
      )}

      {/* tooltip-like summary */}
      <div className="lc-summary">
        {hover === null && !pickedRow && <span className="muted small">Hover any column to read the stock price and market sentiment for that time bucket. Tap a highlighted dot to see why that value was corrected.</span>}
        {hover !== null && series[hover] && (
          <div className="lc-readout">
            <b>{series[hover].time_bucket}</b>
            {showStock && (
              <span>Stock price: <b>{series[hover].stock_price != null ? `$${series[hover].stock_price.toFixed(2)}` : '—'}</b>
                {' '}(<span className={pctClass(series[hover].stock_price_change_pct)}>
                  {fmtPct(series[hover].stock_price_change_pct)}</span>)
                {series[hover].correction_reason ? <span style={{ color: CORRECTED_COLOR }}> · corrected</span> : ''}</span>
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

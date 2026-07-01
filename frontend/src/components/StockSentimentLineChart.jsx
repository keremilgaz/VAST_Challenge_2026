// ============================================
// Stock Price / BERT Sentiment Line Chart
// ============================================
// Heatmapのすぐ下（Message Detail Panelの下）に置く。
// x軸はHeatmapと同じtime_bucketsを使い、列幅とleft marginを揃えることでx軸を完全に揃える。
import React, { useState } from 'react';
import { CELL, LABEL_COL } from '../constants.js';
import { shortBucket, pctClass, fmtPct, fmtSigned } from '../utils.js';

export function StockSentimentLineChart({
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

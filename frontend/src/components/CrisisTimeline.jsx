// ============================================
// Crisis timeline slider (CrisisNet風)
// ============================================
// 23 round の slider + Play/Pause。選択した round までを全ビューに累積反映する。
// 下のミニ強度バーは round ごとの merger 関連メッセージ密度を示す（危機の高まりが一目でわかる）。
import React from 'react';
import { Play, Pause } from 'lucide-react';
import { fmtRoundLabel } from '../utils.js';

export function CrisisTimeline({ timeline, idx, setIdx, startIdx = 0, setStartIdx, playing, onTogglePlay, granularity, setGranularity }) {
  if (!timeline || timeline.length === 0) return null;
  const cur = timeline[idx] || {};
  const startCur = timeline[startIdx] || {};
  const maxTotal = Math.max(1, ...timeline.map(r => r.total_msgs || 0));
  // round ごとの merger 比率の最大値。sequential（白→濃い赤）ramp を全幅で使うための正規化基準。
  const maxMergRatio = Math.max(0.0001, ...timeline.map(r => (r.total_msgs ? (r.merger_msgs || 0) / r.total_msgs : 0)));
  const n = timeline.length;
  const denom = Math.max(1, n - 1);

  const onStart = (v) => { setStartIdx && setStartIdx(Math.min(Number(v), idx)); };
  const onEnd = (v) => { setIdx(Math.max(Number(v), startIdx)); };

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
              // sequential 単色 ramp: 白 (#ffffff, merger 低) → 濃い赤 (#8b0000, merger 高)。
              const t = Math.pow(Math.min(1, merg / maxMergRatio), 0.7);
              const cr = Math.round(255 + (0x8b - 255) * t);
              const cg = Math.round(255 + (0x00 - 255) * t);
              const cb = Math.round(255 + (0x00 - 255) * t);
              const bg = `rgb(${cr},${cg},${cb})`;
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
      </div>

      <div className="tl-meta">
        <span className="tl-round">Rounds {startIdx + 1}–{idx + 1} / {n}</span>
        <span className="tl-date">{fmtRoundLabel(startCur.hour)} → {fmtRoundLabel(cur.hour)}</span>
        {cur.stock_price_value != null && <span className="tl-stock">${Number(cur.stock_price_value).toFixed(2)}</span>}
        {cur.market_sentiment && <span className="tl-sent">{cur.market_sentiment}</span>}
        <span className="tl-merger">{cur.merger_msgs || 0} merger-related · {cur.total_msgs || 0} msgs (end round)</span>
      </div>
      {cur.event_headline && <div className="tl-headline">{cur.event_headline}</div>}
    </section>
  );
}

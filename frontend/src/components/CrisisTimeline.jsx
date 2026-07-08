// ============================================
// Crisis timeline slider (CrisisNet風)
// ============================================
// 23 round の slider + Play/Pause。選択した round までを全ビューに累積反映する。
// 下のミニ強度バーは round ごとの merger 関連メッセージ密度を示す（危機の高まりが一目でわかる）。
import React, { useEffect } from 'react';
import { Play, Pause } from 'lucide-react';
import { fmtRoundLabel } from '../utils.js';
import { EVENT_MARKERS } from '../constants.js';

export function CrisisTimeline({ timeline, idx, setIdx, startIdx = 0, setStartIdx, playing, onTogglePlay, granularity, setGranularity }) {
  const total = timeline ? timeline.length : 0;

  // ---- Klavye kısayolları ----
  //   ← / →            : bitiş round'unu geri/ileri al
  //   Shift + ← / →    : başlangıç round'unu geri/ileri al
  //   Space            : Play / Pause
  // Bir input/textarea/select odaktayken (ör. keyword arama) devreye girmez.
  useEffect(() => {
    if (!total) return;
    const onKeyDown = (e) => {
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) setStartIdx && setStartIdx(s => Math.min(s + 1, idx));
        else setIdx(i => Math.min(i + 1, total - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) setStartIdx && setStartIdx(s => Math.max(s - 1, 0));
        else setIdx(i => Math.max(i - 1, startIdx));
      } else if (e.key === ' ') {
        e.preventDefault(); // sayfanın scroll olmasını engelle
        onTogglePlay && onTogglePlay();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [total, idx, startIdx, setIdx, setStartIdx, onTogglePlay]);

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

  // Olay işaretlerini (leak / embargo) round index'ine çevir:
  // önce saat bazında tam eşleşme ara, yoksa marker'dan önceki son round'a düşür.
  const markers = EVENT_MARKERS.map(mk => {
    let mIdx = null;
    for (let i = 0; i < n; i++) {
      const h = timeline[i].hour || '';
      if (h.slice(0, 13) === mk.time.slice(0, 13)) { mIdx = i; break; }
      if (h <= mk.time) mIdx = i;
    }
    return { ...mk, idx: mIdx };
  });

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
          {/* olay işaretleri (leak / embargo): tick + track üzerinde dikey çizgi */}
          {markers.map(mk => mk.idx != null && (
            <div key={mk.id} className="tl-event-marker"
              style={{ left: `${(mk.idx / denom) * 100}%`, background: mk.color }}
              title={mk.label} />
          ))}
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
        {markers.filter(mk => mk.idx != null).map(mk => (
          <span key={mk.id} className="tl-event-key" style={{ color: mk.color }} title={mk.label}>
            ▍{mk.short} {mk.time.slice(11, 16)}
          </span>
        ))}
        <span className="tl-kbd-hint" title="Keyboard shortcuts: ←/→ step the end round · Shift+←/→ step the start round · Space play/pause">
          ⌨ ←→ round · Shift+←→ start · Space play
        </span>
      </div>
      {cur.event_headline && <div className="tl-headline">{cur.event_headline}</div>}
    </section>
  );
}

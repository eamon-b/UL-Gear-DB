import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Item } from '../lib/types';
import { fmtW, toUnit, type Unit } from '../lib/units';
import { fmtPrice } from '../lib/util';

interface Props {
  items: Item[];
  frontier: Set<string>;
  unit: Unit;
  refItem?: Item | null;
  selectedId?: string | null;
  onSelect: (id: string) => void;
}

const M = { l: 52, r: 14, t: 12, b: 34 };

function ticks(a: number, b: number, n = 5): number[] {
  if (!(b > a)) return [a];
  const raw = (b - a) / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export const Scatter = memo(function Scatter({ items, frontier, unit, refItem, selectedId, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [logX, setLogX] = useState(false);
  const [hover, setHover] = useState<Item | null>(null);
  const h = 260;
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => items.filter((i) => i.price_usd != null && i.price_usd > 0), [items]);
  const missing = items.length - pts.length;

  const geo = useMemo(() => {
    if (!pts.length) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.price_usd!); x1 = Math.max(x1, p.price_usd!);
      const y = toUnit(p.weight_g, unit);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const padY = (y1 - y0) * 0.08 || y1 * 0.1 || 1;
    y0 = Math.max(0, y0 - padY); y1 = y1 + padY;
    const useLog = logX && x0 > 0 && x1 / x0 > 3;
    if (!useLog) { const padX = (x1 - x0) * 0.05 || x1 * 0.1 || 1; x0 = Math.max(0, x0 - padX); x1 = x1 + padX; }
    else { x0 = x0 / 1.15; x1 = x1 * 1.15; }
    const iw = w - M.l - M.r, ih = h - M.t - M.b;
    const sx = useLog
      ? (v: number) => M.l + ((Math.log(v) - Math.log(x0)) / (Math.log(x1) - Math.log(x0))) * iw
      : (v: number) => M.l + ((v - x0) / (x1 - x0)) * iw;
    const sy = (v: number) => M.t + ih - ((v - y0) / (y1 - y0)) * ih;
    let xt: number[];
    if (useLog) {
      xt = [];
      for (let p = Math.pow(10, Math.floor(Math.log10(x0))); p <= x1; p *= 10) for (const m of [1, 2, 5]) if (p * m >= x0 && p * m <= x1) xt.push(p * m);
    } else xt = ticks(x0, x1, Math.max(3, Math.floor(iw / 90)));
    const yt = ticks(y0, y1, 4);
    const coords = pts.map((p) => ({ p, x: sx(p.price_usd!), y: sy(toUnit(p.weight_g, unit)) }));
    const front = coords.filter((c) => frontier.has(c.p.id)).sort((a, b) => a.x - b.x);
    return { sx, sy, xt, yt, coords, front, iw, ih };
  }, [pts, unit, w, logX, frontier]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!geo) return;
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best: Item | null = null, bd = 18 * 18;
    for (const c of geo.coords) {
      const d = (c.x - mx) ** 2 + (c.y - my) ** 2;
      if (d < bd) { bd = d; best = c.p; }
    }
    setHover(best);
  };

  const hc = hover && geo?.coords.find((c) => c.p.id === hover.id);
  const refC = refItem && geo?.coords.find((c) => c.p.id === refItem.id);
  const selC = selectedId && geo?.coords.find((c) => c.p.id === selectedId);

  return (
    <div className="scatter" ref={wrap}>
      <div className="scatter-head">
        <strong>Weight vs price</strong>
        <span className="legend">
          <span className="lg"><i className="dot front" /> Pareto frontier (nothing lighter for less)</span>
          <span className="lg"><i className="dot other" /> Other</span>
          {refItem && <span className="lg"><i className="dot ref" /> Current</span>}
        </span>
        <label className="tog small"><input type="checkbox" checked={logX} onChange={(e) => setLogX(e.target.checked)} /> log price</label>
        {missing > 0 && <span className="muted small">{missing} without price not shown</span>}
      </div>
      {!geo ? (
        <div className="muted pad">No priced items to plot.</div>
      ) : (
        <svg width={w} height={h} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={() => hover && onSelect(hover.id)} style={{ cursor: hover ? 'pointer' : 'default' }} role="img" aria-label="Scatter plot of weight versus price">
          {geo.yt.map((t) => (
            <g key={'y' + t}>
              <line className="grid" x1={M.l} x2={w - M.r} y1={geo.sy(t)} y2={geo.sy(t)} />
              <text className="axis" x={M.l - 6} y={geo.sy(t) + 4} textAnchor="end">{unit === 'g' ? Math.round(t) : t.toFixed(unit === 'lb' ? 1 : 0)}</text>
            </g>
          ))}
          {geo.xt.map((t) => (
            <g key={'x' + t}>
              <line className="grid" y1={M.t} y2={h - M.b} x1={geo.sx(t)} x2={geo.sx(t)} />
              <text className="axis" y={h - M.b + 14} x={geo.sx(t)} textAnchor="middle">${t >= 1000 ? `${t / 1000}k` : t}</text>
            </g>
          ))}
          <text className="axis-title" x={M.l + geo.iw / 2} y={h - 4} textAnchor="middle">Price (USD)</text>
          <text className="axis-title" transform={`translate(12 ${M.t + geo.ih / 2}) rotate(-90)`} textAnchor="middle">Weight ({unit})</text>
          {geo.front.length > 1 && (
            <polyline className="front-line" points={geo.front.map((c, i) => {
              const prev = geo.front[i - 1];
              return prev ? `${c.x},${prev.y} ${c.x},${c.y}` : `${c.x},${c.y}`;
            }).join(' ')} />
          )}
          {geo.coords.map((c) => (
            <circle key={c.p.id} cx={c.x} cy={c.y} r={frontier.has(c.p.id) ? 4.5 : 3.5} className={frontier.has(c.p.id) ? 'pt front' : 'pt other'} />
          ))}
          {refC && <circle cx={refC.x} cy={refC.y} r={6} className="pt ref" />}
          {selC && <circle cx={selC.x} cy={selC.y} r={8} className="pt-sel" />}
          {hc && <circle cx={hc.x} cy={hc.y} r={7} className="pt-hover" />}
        </svg>
      )}
      {hc && hover && (
        <div className="tip" style={{ left: Math.min(hc.x + 12, w - 220), top: Math.max(0, hc.y - 10) }}>
          <div className="tip-title">{hover.name}</div>
          <div>{fmtW(hover.weight_g, unit)} · {fmtPrice(hover.price_usd)}</div>
          <div className="muted">{hover.subcategory}{frontier.has(hover.id) ? ' · frontier' : ''}</div>
        </div>
      )}
    </div>
  );
});

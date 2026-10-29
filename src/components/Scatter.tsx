import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Item } from '../lib/types';
import { fmtW, toUnit, type Unit } from '../lib/units';
import { fmtPrice } from '../lib/util';
import { fmtMetric, metricTitle, type Metric } from '../lib/metric';

interface Props {
  items: Item[];
  frontier: Set<string>;
  unit: Unit;
  metric?: Metric | null;
  refItem?: Item | null;
  selectedId?: string | null;
  onSelect: (id: string) => void;
}

const M = { l: 56, r: 14, t: 12, b: 34 };

type AxisKey = 'price' | 'weight' | 'metric' | 'wPer' | 'pPer';
interface Axis {
  key: AxisKey;
  title: string;
  get: (it: Item) => number | null;
  tick: (v: number) => string;
}

function ticks(a: number, b: number, n = 5): number[] {
  if (!(b > a)) return [a];
  const raw = (b - a) / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

const fmtNum = (t: number) =>
  Math.abs(t) >= 1000 ? `${+(t / 1000).toFixed(1)}k` : String(+t.toFixed(Math.abs(t) < 1 ? 2 : Math.abs(t) < 10 ? 1 : 0));

function axes(unit: Unit, m: Metric | null | undefined): Axis[] {
  const out: Axis[] = [
    {
      key: 'price',
      title: 'Price (USD)',
      get: (it) => (it.price_usd != null && it.price_usd > 0 ? it.price_usd : null),
      tick: (t) => '$' + fmtNum(t),
    },
    {
      key: 'weight',
      title: `Weight (${unit})`,
      get: (it) => toUnit(it.weight_g, unit),
      tick: (t) => (unit === 'g' ? fmtNum(t) : t.toFixed(unit === 'lb' ? 1 : 0)),
    },
  ];
  if (!m) return out;
  const pos = (it: Item) => {
    const v = m.get(it);
    return v != null && v > 0 ? v : null;
  };
  const per = m.unit ? `per ${m.unit === 'person' ? 'person' : m.unit}` : `per ${m.label}`;
  out.push({ key: 'metric', title: metricTitle(m), get: m.get, tick: fmtNum });
  if (m.ratio) {
    out.push(
      {
        key: 'wPer',
        title: `Weight ${per} (${unit})`,
        get: (it) => {
          const v = pos(it);
          return v ? toUnit(it.weight_g, unit) / v : null;
        },
        tick: fmtNum,
      },
      {
        key: 'pPer',
        title: `Price ${per} (USD)`,
        get: (it) => {
          const v = pos(it);
          return v && it.price_usd ? it.price_usd / v : null;
        },
        tick: (t) => '$' + fmtNum(t),
      },
    );
  }
  return out;
}

/** 0..1 along the metric, 1 = best (darkest on light, brightest on dark). */
function colorScale(items: Item[], m: Metric | null | undefined) {
  if (!m) return null;
  const vals = items.map((it) => m.get(it)).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  const lo = Math.min(...vals),
    hi = Math.max(...vals);
  if (lo === hi) return null;
  const t = (v: number) => (m.dir === 1 ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo));
  return { lo, hi, t, best: m.dir === 1 ? hi : lo, worst: m.dir === 1 ? lo : hi };
}

const mix = (t: number) => `color-mix(in oklab, var(--seq-hi) ${Math.round(t * 100)}%, var(--seq-lo))`;

export const Scatter = memo(function Scatter({ items, frontier, unit, metric, refItem, selectedId, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [logX, setLogX] = useState(false);
  const [xKey, setXKey] = useState<AxisKey>('price');
  const [yKey, setYKey] = useState<AxisKey>('weight');
  const [hover, setHover] = useState<Item | null>(null);
  const h = 260;
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const axisList = useMemo(() => axes(unit, metric), [unit, metric]);
  // fall back to price/weight when the chosen axis disappears (metric switched off or not a ratio)
  const X = axisList.find((a) => a.key === xKey) ?? axisList[0];
  const Y = axisList.find((a) => a.key === yKey) ?? axisList[1];
  const isDefault = X.key === 'price' && Y.key === 'weight';

  const pts = useMemo(() => items.filter((i) => X.get(i) != null && Y.get(i) != null), [items, X, Y]);
  const missing = items.length - pts.length;
  const scale = useMemo(() => colorScale(pts, metric), [pts, metric]);

  const geo = useMemo(() => {
    if (!pts.length) return null;
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const p of pts) {
      const x = X.get(p)!,
        y = Y.get(p)!;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const padY = (y1 - y0) * 0.08 || Math.abs(y1) * 0.1 || 1;
    y0 = y0 >= 0 ? Math.max(0, y0 - padY) : y0 - padY;
    y1 = y1 + padY;
    const useLog = logX && x0 > 0 && x1 / x0 > 3;
    if (!useLog) {
      const padX = (x1 - x0) * 0.05 || Math.abs(x1) * 0.1 || 1;
      x0 = x0 >= 0 ? Math.max(0, x0 - padX) : x0 - padX;
      x1 = x1 + padX;
    } else {
      x0 = x0 / 1.15;
      x1 = x1 * 1.15;
    }
    const iw = w - M.l - M.r,
      ih = h - M.t - M.b;
    const sx = useLog
      ? (v: number) => M.l + ((Math.log(v) - Math.log(x0)) / (Math.log(x1) - Math.log(x0))) * iw
      : (v: number) => M.l + ((v - x0) / (x1 - x0)) * iw;
    const sy = (v: number) => M.t + ih - ((v - y0) / (y1 - y0)) * ih;
    let xt: number[];
    if (useLog) {
      xt = [];
      for (let p = Math.pow(10, Math.floor(Math.log10(x0))); p <= x1; p *= 10)
        for (const m of [1, 2, 5]) if (p * m >= x0 && p * m <= x1) xt.push(p * m);
    } else xt = ticks(x0, x1, Math.max(3, Math.floor(iw / 90)));
    const yt = ticks(y0, y1, 4);
    const coords = pts.map((p) => ({ p, x: sx(X.get(p)!), y: sy(Y.get(p)!) }));
    // draw frontier points last so they sit on top
    coords.sort((a, b) => Number(frontier.has(a.p.id)) - Number(frontier.has(b.p.id)));
    const front = coords.filter((c) => frontier.has(c.p.id)).sort((a, b) => a.x - b.x);
    return { sx, sy, xt, yt, coords, front, iw, ih };
  }, [pts, X, Y, w, logX, frontier]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!geo) return;
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;
    let best: Item | null = null,
      bd = 18 * 18;
    for (const c of geo.coords) {
      const d = (c.x - mx) ** 2 + (c.y - my) ** 2;
      if (d < bd) {
        bd = d;
        best = c.p;
      }
    }
    setHover(best);
  };

  const hc = hover && geo?.coords.find((c) => c.p.id === hover.id);
  const refC = refItem && geo?.coords.find((c) => c.p.id === refItem.id);
  const selC = selectedId && geo?.coords.find((c) => c.p.id === selectedId);
  const fill = (it: Item) => {
    if (!scale || !metric) return undefined;
    const v = metric.get(it);
    return v == null ? undefined : mix(scale.t(v));
  };
  const noMetric = metric && scale ? items.filter((it) => metric.get(it) == null).length : 0;
  const frontierLabel = metric
    ? `Pareto frontier (nothing lighter, cheaper and better on ${metric.label.toLowerCase()})`
    : 'Pareto frontier (nothing lighter for less)';

  return (
    <div className="scatter" ref={wrap}>
      <div className="scatter-head">
        {metric ? (
          <span className="axis-pick">
            <select value={Y.key} onChange={(e) => setYKey(e.target.value as AxisKey)} aria-label="Y axis">
              {axisList.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.title}
                </option>
              ))}
            </select>
            <span className="muted">vs</span>
            <select value={X.key} onChange={(e) => setXKey(e.target.value as AxisKey)} aria-label="X axis">
              {axisList.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.title}
                </option>
              ))}
            </select>
          </span>
        ) : (
          <strong>Weight vs price</strong>
        )}
        <span className="legend">
          <span className="lg">
            <i className={`dot front ${scale ? 'ring' : ''}`} /> {frontierLabel}
          </span>
          {!scale && (
            <span className="lg">
              <i className="dot other" /> Other
            </span>
          )}
          {scale && metric && (
            <span className="lg" title={`${metric.dir === 1 ? 'Higher' : 'Lower'} is better`}>
              {fmtMetric(scale.worst, metric)} <i className="ramp" /> {fmtMetric(scale.best, metric)}
            </span>
          )}
          {noMetric > 0 && (
            <span className="lg">
              <i className="dot other" /> No {metric!.label.toLowerCase()} data ({noMetric})
            </span>
          )}
          {refItem && (
            <span className="lg">
              <i className="dot ref" /> Current
            </span>
          )}
        </span>
        <label className="tog small">
          <input type="checkbox" checked={logX} onChange={(e) => setLogX(e.target.checked)} /> log x
        </label>
        {missing > 0 && <span className="muted small">{missing} not plotted (no data for these axes)</span>}
      </div>
      {!geo ? (
        <div className="muted pad">Nothing to plot on these axes.</div>
      ) : (
        <svg
          width={w}
          height={h}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={() => hover && onSelect(hover.id)}
          style={{ cursor: hover ? 'pointer' : 'default' }}
          role="img"
          aria-label={`Scatter plot of ${Y.title} versus ${X.title}`}
        >
          {geo.yt.map((t) => (
            <g key={'y' + t}>
              <line className="grid" x1={M.l} x2={w - M.r} y1={geo.sy(t)} y2={geo.sy(t)} />
              <text className="axis" x={M.l - 6} y={geo.sy(t) + 4} textAnchor="end">
                {Y.tick(t)}
              </text>
            </g>
          ))}
          {geo.xt.map((t) => (
            <g key={'x' + t}>
              <line className="grid" y1={M.t} y2={h - M.b} x1={geo.sx(t)} x2={geo.sx(t)} />
              <text className="axis" y={h - M.b + 14} x={geo.sx(t)} textAnchor="middle">
                {X.tick(t)}
              </text>
            </g>
          ))}
          <text className="axis-title" x={M.l + geo.iw / 2} y={h - 4} textAnchor="middle">
            {X.title}
          </text>
          <text className="axis-title" transform={`translate(12 ${M.t + geo.ih / 2}) rotate(-90)`} textAnchor="middle">
            {Y.title}
          </text>
          {/* the staircase only means something for the 2D weight/price frontier */}
          {!metric && isDefault && geo.front.length > 1 && (
            <polyline
              className="front-line"
              points={geo.front
                .map((c, i) => {
                  const prev = geo.front[i - 1];
                  return prev ? `${c.x},${prev.y} ${c.x},${c.y}` : `${c.x},${c.y}`;
                })
                .join(' ')}
            />
          )}
          {geo.coords.map((c) => {
            const on = frontier.has(c.p.id);
            const f = fill(c.p);
            const cls = scale ? `pt ${f ? 'seq' : 'other'} ${on ? 'front ring' : ''}` : on ? 'pt front' : 'pt other';
            return <circle key={c.p.id} cx={c.x} cy={c.y} r={on ? 5 : 3.5} className={cls} style={f ? { fill: f } : undefined} />;
          })}
          {refC && <circle cx={refC.x} cy={refC.y} r={6} className="pt ref" />}
          {selC && <circle cx={selC.x} cy={selC.y} r={8} className="pt-sel" />}
          {hc && <circle cx={hc.x} cy={hc.y} r={7} className="pt-hover" />}
        </svg>
      )}
      {hc && hover && (
        <div className="tip" style={{ left: Math.min(hc.x + 12, w - 220), top: Math.max(0, hc.y - 10) }}>
          <div className="tip-title">{hover.name}</div>
          <div>
            {fmtW(hover.weight_g, unit)} · {fmtPrice(hover.price_usd)}
            {metric && ` · ${fmtMetric(metric.get(hover), metric)}`}
          </div>
          {metric && (X.key === 'wPer' || Y.key === 'wPer' || X.key === 'pPer' || Y.key === 'pPer') && (
            <div>
              {[X, Y]
                .filter((a) => a.key === 'wPer' || a.key === 'pPer')
                .map((a) => `${a.title.replace(/ \(.*\)$/, '')}: ${a.tick(a.get(hover)!)}${a.key === 'wPer' ? ' ' + unit : ''}`)
                .join(' · ')}
            </div>
          )}
          <div className="muted">
            {hover.subcategory}
            {frontier.has(hover.id) ? ' · frontier' : ''}
          </div>
        </div>
      )}
    </div>
  );
});

import { useState } from 'react';
import { fmtW, type Unit } from '../lib/units';
import { fmtPrice } from '../lib/util';
import type { Totals } from '../lib/lists';

const SLOTS = 8;

/** Category breakdown: donut + legend table. Colors are assigned by category order of first appearance (stable). */
export function Breakdown({ t, order, unit }: { t: Totals; order: string[]; unit: Unit }) {
  const [metric, setMetric] = useState<'total' | 'base'>('total');
  const [hover, setHover] = useState<string | null>(null);
  // assign stable slot per category; overflow folds into "Other"
  const slotOf = new Map<string, number>();
  order.forEach((c, i) => slotOf.set(c, i < SLOTS - 1 || order.length <= SLOTS ? i : SLOTS - 1));
  const folded = new Map<string, { cat: string; v: number; cost: number; slot: number; n: number }>();
  for (const c of t.byCat) {
    const slot = slotOf.get(c.cat) ?? SLOTS - 1;
    const key = order.length > SLOTS && slot === SLOTS - 1 ? 'Other' : c.cat;
    const e = folded.get(key) ?? { cat: key, v: 0, cost: 0, slot, n: 0 };
    e.v += c[metric];
    e.cost += c.cost;
    e.n += c.n;
    folded.set(key, e);
  }
  const segs = [...folded.values()].filter((s) => s.v > 0).sort((a, b) => a.slot - b.slot);
  const sum = segs.reduce((s, x) => s + x.v, 0);
  const R = 62, r = 40, C = 80;
  let a0 = -Math.PI / 2;
  const gap = segs.length > 1 ? 0.025 : 0;
  const arcs = segs.map((s) => {
    const span = (s.v / sum) * Math.PI * 2;
    const a1 = a0 + span;
    const from = a0 + gap / 2, to = Math.max(from + 0.001, a1 - gap / 2);
    a0 = a1;
    return { s, d: arcPath(C, C, R, r, from, to) };
  });
  return (
    <div className="breakdown">
      <div className="bd-head">
        <strong>By category</strong>
        <div className="seg small">
          <button type="button" className={`seg-opt ${metric === 'total' ? 'on' : ''}`} onClick={() => setMetric('total')}>Total</button>
          <button type="button" className={`seg-opt ${metric === 'base' ? 'on' : ''}`} onClick={() => setMetric('base')}>Base</button>
        </div>
      </div>
      <div className="bd-body">
        <svg className="bd-donut" viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Weight by category">
          {sum === 0 && <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke="var(--line)" strokeWidth={R - r} />}
          {arcs.map(({ s, d }) => (
            <path key={s.cat} d={d} className={`slot-${s.slot}`} opacity={hover && hover !== s.cat ? 0.35 : 1}
              onMouseEnter={() => setHover(s.cat)} onMouseLeave={() => setHover(null)}>
              <title>{`${s.cat}: ${fmtW(s.v, unit)} (${((s.v / sum) * 100).toFixed(0)}%)`}</title>
            </path>
          ))}
          <text x={C} y={C - 2} textAnchor="middle" className="donut-v">{fmtW(hover ? folded.get(hover)?.v ?? 0 : sum, unit)}</text>
          <text x={C} y={C + 14} textAnchor="middle" className="donut-l">{hover ?? (metric === 'base' ? 'base' : 'total')}</text>
        </svg>
        <div className="bd-legend">
          {segs.map((s) => (
            <div key={s.cat} onMouseEnter={() => setHover(s.cat)} onMouseLeave={() => setHover(null)} className={`bd-row ${hover === s.cat ? 'hi' : ''}`}>
              <i className={`sw slot-bg-${s.slot}`} />
              <span className="bd-cat">{s.cat}</span>
              <span className="num">{fmtW(s.v, unit)}</span>
              <span className="num muted">{sum ? ((s.v / sum) * 100).toFixed(0) : 0}%</span>
              <span className="num muted">{s.cost ? fmtPrice(s.cost) : ''}</span>
            </div>
          ))}
          {!segs.length && <div className="muted">Nothing yet</div>}
        </div>
      </div>
    </div>
  );
}

function arcPath(cx: number, cy: number, R: number, r: number, a0: number, a1: number) {
  if (a1 - a0 >= Math.PI * 2 - 0.0001) a1 = a0 + Math.PI * 2 - 0.0001;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad: number, a: number) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`;
  return `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
}

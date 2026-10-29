import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { lightenPlan, type Resolved } from '../lib/lists';
import type { Item } from '../lib/types';
import { fmtW, G_PER_OZ } from '../lib/units';
import { fmtPrice, loadLS, saveLS } from '../lib/util';

export function LightenPanel({
  rs,
  onApply,
  onClose,
}: {
  rs: Resolved[];
  onApply: (s: { uid: string; item: Item }[]) => void;
  onClose: () => void;
}) {
  const { db, unit, openItem } = useStore();
  const [budget, setBudget] = useState<number>(() => loadLS('ulgdb.budget', 500));
  const [sameSub, setSameSub] = useState(true);
  const [fullPrice, setFullPrice] = useState(true);
  const [hideDisc, setHideDisc] = useState(true);
  const opts = { sameSub, fullPrice, hideDisc };
  const plan = useMemo(() => lightenPlan(rs, db, budget, opts), [rs, db, budget, sameSub, fullPrice, hideDisc]); // eslint-disable-line react-hooks/exhaustive-deps
  const unlimited = useMemo(() => lightenPlan(rs, db, Infinity, opts), [rs, db, sameSub, fullPrice, hideDisc]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = plan.picked.at(-1);
  const ref = useRef<HTMLElement>(null);
  // The panel renders below a possibly long list; bring it into view when opened.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const perOz = (perGram: number) => (perGram === 0 ? 'free' : '$' + (perGram * G_PER_OZ).toFixed(2));

  return (
    <section className="lighten" ref={ref}>
      <div className="lighten-head">
        <h2>Lighten my pack</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="row gap wrap lighten-controls">
        <label>
          Budget ${' '}
          <input
            type="number"
            min={0}
            step={25}
            value={budget}
            onChange={(e) => {
              const v = Math.max(0, Number(e.target.value) || 0);
              setBudget(v);
              saveLS('ulgdb.budget', v);
            }}
            className="budget"
            aria-label="Budget"
          />
        </label>
        <input
          type="range"
          min={0}
          max={Math.max(1000, Math.ceil((unlimited.picked.at(-1)?.cumCost ?? 0) / 50) * 50)}
          step={25}
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
          aria-label="Budget slider"
        />
        <label
          className="tog"
          title="On: only swap like for like, e.g. tent for tent, a quilt no warmer-rated than 5°F above yours, a pad with similar R-value, a pack or pot of similar volume, bear-approved for bear-approved. Off: any item in the same category."
        >
          <input type="checkbox" checked={sameSub} onChange={(e) => setSameSub(e.target.checked)} /> Like-for-like only (same type,
          comparable specs)
        </label>
        <label className="tog" title="Off = count only the price difference (assumes you sell the old item)">
          <input type="checkbox" checked={fullPrice} onChange={(e) => setFullPrice(e.target.checked)} /> Count full price
        </label>
        <label className="tog">
          <input type="checkbox" checked={hideDisc} onChange={(e) => setHideDisc(e.target.checked)} /> Skip discontinued
        </label>
      </div>
      <p className="muted small">
        Greedy pick by lowest $ per gram saved, at most one swap per item, within budget.
        {total ? (
          <>
            {' '}
            With <strong>{fmtPrice(budget)}</strong> you save <strong className="good">{fmtW(total.cumSaved, unit)}</strong> for{' '}
            {fmtPrice(total.cumCost)}.
          </>
        ) : (
          ' No swaps fit this budget.'
        )}
        {unlimited.picked.length > 0 && (
          <>
            {' '}
            Max possible: {fmtW(unlimited.picked.at(-1)!.cumSaved, unit)} for {fmtPrice(unlimited.picked.at(-1)!.cumCost)}.
          </>
        )}
      </p>
      <div className="table-wrap">
        <table className="gear">
          <thead>
            <tr>
              <th>#</th>
              <th>Replace</th>
              <th>With</th>
              <th className="num">Saves</th>
              <th className="num">Cost</th>
              <th className="num">$/oz saved</th>
              <th className="num">Cum. saved</th>
              <th className="num">Cum. cost</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plan.picked.map((p, i) => (
              <tr key={p.r.li.uid}>
                <td className="muted">{i + 1}</td>
                <td>
                  {p.r.name}
                  <div className="muted small">
                    {fmtW(p.r.weight_g, unit)}
                    {p.r.li.qty > 1 ? ` × ${p.r.li.qty}` : ''}
                  </div>
                </td>
                <td>
                  <button type="button" className="item-link" onClick={() => openItem(p.cand.id)}>
                    {p.cand.name}
                  </button>
                  <div className="muted small">
                    {fmtW(p.cand.weight_g, unit)} · {fmtPrice(p.cand.price_usd)}
                  </div>
                </td>
                <td className="num good">−{fmtW(p.saved, unit)}</td>
                <td className="num">{fmtPrice(p.cost)}</td>
                <td className="num">{perOz(p.perGram)}</td>
                <td className="num strong">{fmtW(p.cumSaved, unit)}</td>
                <td className="num">{fmtPrice(p.cumCost)}</td>
                <td>
                  <button type="button" className="btn small primary" onClick={() => onApply([{ uid: p.r.li.uid, item: p.cand }])}>
                    Swap
                  </button>
                </td>
              </tr>
            ))}
            {!plan.picked.length && (
              <tr>
                <td colSpan={9} className="muted pad center">
                  Nothing within budget. Try a bigger budget or allow other types.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {plan.picked.length > 1 && (
        <button type="button" className="btn primary" onClick={() => onApply(plan.picked.map((p) => ({ uid: p.r.li.uid, item: p.cand })))}>
          Apply all {plan.picked.length} swaps
        </button>
      )}
      {(() => {
        const rest = plan.bestPerItem.filter((b) => !plan.used.has(b.r.li.uid));
        if (!rest.length) return null;
        return (
          <details className="lighten-more">
            <summary>
              Best lighter swap for the other {rest.length} item{rest.length > 1 ? 's' : ''} (over budget)
            </summary>
            <ul className="mini-list">
              {rest.map((b) => (
                <li key={b.r.li.uid}>
                  {b.r.name} →{' '}
                  <button type="button" className="link" onClick={() => openItem(b.cand.id)}>
                    {b.cand.name}
                  </button>
                  <span className="muted">
                    {' '}
                    −{fmtW(b.saved, unit)} for {fmtPrice(b.cost)} ({perOz(b.perGram)}
                    {b.perGram ? '/oz' : ''})
                  </span>
                </li>
              ))}
            </ul>
          </details>
        );
      })()}
    </section>
  );
}

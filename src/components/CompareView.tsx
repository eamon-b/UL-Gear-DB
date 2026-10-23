import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { boolBetter, specDirection } from '../lib/filters';
import { fmtW } from '../lib/units';
import { fmtPrice, humanizeKey } from '../lib/util';
import { fmtSpec } from './GearTable';
import { href } from '../lib/router';
import type { Item } from '../lib/types';

type Row = { label: string; key: string; get: (it: Item) => unknown; fmt?: (v: unknown, it: Item) => string; dir: 1 | -1 | 0; boolBest?: boolean | null };

export function CompareView({ idsParam }: { idsParam?: string | null }) {
  const { db, compare, toggleCompare, clearCompare, unit, openItem, addToList } = useStore();
  const ids = idsParam ? idsParam.split(',').filter((id) => db.byId.has(id)) : compare;
  const items = ids.map((id) => db.byId.get(id)!).filter(Boolean);

  const rows = useMemo<Row[]>(() => {
    const base: Row[] = [
      { label: 'Category', key: 'category', get: (i) => db.catById.get(i.category)?.name ?? i.category, dir: 0 },
      { label: 'Type', key: 'subcategory', get: (i) => i.subcategory, dir: 0 },
      { label: 'Weight', key: 'weight', get: (i) => i.weight_g, fmt: (v) => fmtW(v as number, unit), dir: -1 },
      { label: 'Price', key: 'price', get: (i) => i.price_usd, fmt: (v) => fmtPrice(v as number | null), dir: -1 },
    ];
    const keys: string[] = [];
    for (const it of items) for (const k of Object.keys(it.specs)) if (!keys.includes(k)) keys.push(k);
    const spec: Row[] = keys.map((k) => ({
      label: humanizeKey(k), key: 'spec:' + k, get: (i) => i.specs[k], fmt: (v) => fmtSpec(v), dir: specDirection(k), boolBest: boolBetter(k),
    }));
    const tail: Row[] = [
      { label: 'Weight basis', key: 'basis', get: (i) => i.weight_basis, dir: 0 },
      { label: 'Weight includes', key: 'note', get: (i) => i.weight_note, dir: 0 },
      { label: 'Confidence', key: 'conf', get: (i) => i.confidence, dir: 0 },
      { label: 'Discontinued', key: 'disc', get: (i) => i.discontinued, fmt: (v) => (v ? 'Yes' : 'No'), dir: 0 },
    ];
    return [...base, ...spec, ...tail];
  }, [items, unit, db]);

  if (!items.length) {
    return (
      <div className="page">
        <h1>Compare</h1>
        <p className="muted">Tick the ⇆ checkbox on up to 6 items in <a href={href('/')}>Browse</a> to compare them side by side.</p>
      </div>
    );
  }

  const best = (r: Row): Set<number> => {
    const vals = items.map((it) => r.get(it));
    const out = new Set<number>();
    const nums = vals.map((v) => (typeof v === 'number' ? v : null));
    if (r.dir !== 0 && nums.filter((v) => v != null).length >= 2) {
      const target = r.dir === -1 ? Math.min(...(nums.filter((v) => v != null) as number[])) : Math.max(...(nums.filter((v) => v != null) as number[]));
      nums.forEach((v, i) => v === target && out.add(i));
      if (out.size === nums.filter((v) => v != null).length) out.clear(); // all equal
    } else if (r.boolBest != null && vals.some((v) => typeof v === 'boolean')) {
      vals.forEach((v, i) => v === r.boolBest && out.add(i));
      if (out.size === vals.length) out.clear();
    }
    return out;
  };

  const shareIds = items.map((i) => i.id).join(',');

  return (
    <div className="page">
      <div className="page-head row">
        <h1>Compare <span className="muted">{items.length} items</span></h1>
        <div className="row gap">
          <button type="button" className="btn" onClick={() => { navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/compare?ids=${shareIds}`); }}>Copy link</button>
          {!idsParam && <button type="button" className="btn ghost" onClick={clearCompare}>Clear all</button>}
        </div>
      </div>
      <div className="table-wrap">
        <table className="compare">
          <thead>
            <tr>
              <th />
              {items.map((it) => (
                <th key={it.id}>
                  <button type="button" className="item-link" onClick={() => openItem(it.id)}>
                    <span className="brand">{it.brand}</span><br />{it.model}{it.variant && <span className="variant"> {it.variant}</span>}
                  </button>
                  <div className="cmp-actions">
                    {it.url && <a className="icon-btn" href={it.url} target="_blank" rel="noopener noreferrer" title="Source">↗</a>}
                    <button type="button" className="icon-btn" title="Add to list" onClick={() => addToList(it.id)}>＋</button>
                    {!idsParam && <button type="button" className="icon-btn" title="Remove" onClick={() => toggleCompare(it.id)}>✕</button>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const b = best(r);
              return (
                <tr key={r.key}>
                  <th>{r.label}</th>
                  {items.map((it, i) => {
                    const v = r.get(it);
                    return <td key={it.id} className={b.has(i) ? 'best' : ''}>{v == null || v === '' ? <span className="muted">–</span> : r.fmt ? r.fmt(v, it) : String(v)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Highlighted cells are the best value in the row (lightest, cheapest, warmest, highest R-value, etc.).</p>
    </div>
  );
}

export function CompareTray() {
  const { compare, db, clearCompare } = useStore();
  if (!compare.length) return null;
  return (
    <div className="compare-tray">
      <span className="muted">Compare:</span>
      <span className="tray-names">{compare.map((id) => db.byId.get(id)?.model).join(', ')}</span>
      <a className="btn primary small" href={href('/compare')}>Compare {compare.length} →</a>
      <button type="button" className="icon-btn" onClick={clearCompare} aria-label="Clear compare">✕</button>
    </div>
  );
}

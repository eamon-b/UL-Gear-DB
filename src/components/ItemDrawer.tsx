import { useEffect, useMemo } from 'react';
import { useStore } from '../lib/store';
import { href } from '../lib/router';
import { fmtW, type Unit } from '../lib/units';
import { fmtPrice, humanizeKey } from '../lib/util';
import { fmtSpec } from './GearTable';
import type { Item } from '../lib/types';
import { activeMetric, fmtMetric } from '../lib/metric';

export function ItemDrawer() {
  const { db, openItemId, openItem, unit, compare, toggleCompare, lists, activeList, addToList } = useStore();
  const it = openItemId ? db.byId.get(openItemId) : null;
  useEffect(() => {
    if (!it) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && openItem(null);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [it, openItem]);
  const lighter = useMemo(() => {
    if (!it) return [];
    return (db.byCategory.get(it.category) ?? [])
      .filter((x) => x.subcategory === it.subcategory && x.weight_g < it.weight_g && !x.discontinued)
      .sort((a, b) => b.weight_g - a.weight_g)
      .slice(0, 5);
  }, [it, db]);
  if (!it) return null;
  const cat = db.catById.get(it.category);
  const m = activeMetric(it.category, db.byCategory.get(it.category) ?? []);
  const mv = m?.get(it);
  return (
    <div className="drawer-backdrop" onClick={() => openItem(null)}>
      <aside className="drawer" role="dialog" aria-label={it.name} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <div className="muted small">
              {cat?.name} · {it.subcategory}
            </div>
            <h2>
              {it.brand} {it.model}
            </h2>
            {it.variant && <div className="variant">{it.variant}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={() => openItem(null)} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="drawer-stats">
          <div>
            <div className="stat-v">{fmtW(it.weight_g, unit)}</div>
            <div className="stat-l">{it.weight_basis} weight</div>
          </div>
          <div>
            <div className="stat-v">{fmtPrice(it.price_usd)}</div>
            <div className="stat-l">list price</div>
          </div>
          {m && mv != null && (
            <div>
              <div className="stat-v">{fmtMetric(mv, m)}</div>
              <div className="stat-l">{m.label.toLowerCase()}</div>
            </div>
          )}
          <div>
            <div className={`stat-v conf-${it.confidence}`}>{it.confidence}</div>
            <div className="stat-l">confidence</div>
          </div>
        </div>
        {it.weight_note && (
          <p className="small">
            <strong>Weight includes:</strong> {it.weight_note}
          </p>
        )}
        {it.discontinued && <p className="warn small">Discontinued</p>}
        <div className="drawer-actions">
          <button type="button" className="btn primary" onClick={() => addToList(it.id)}>
            ＋ Add to {activeList ? `"${activeList.name}"` : 'a new list'}
          </button>
          <button type="button" className={`btn ${compare.includes(it.id) ? 'on' : ''}`} onClick={() => toggleCompare(it.id)}>
            {compare.includes(it.id) ? '✓ In compare' : 'Compare'}
          </button>
          {it.url && (
            <a className="btn" href={it.url} target="_blank" rel="noopener noreferrer">
              Source ↗
            </a>
          )}
        </div>
        {lists.length > 1 && (
          <div className="small muted">
            Add to:{' '}
            {lists.map((l) => (
              <button key={l.id} type="button" className="link" onClick={() => addToList(it.id, l.id)}>
                {l.name}
              </button>
            ))}
          </div>
        )}
        <h3>Specs</h3>
        <table className="kv">
          <tbody>
            {Object.entries(it.specs).map(([k, v]) => (
              <tr key={k}>
                <th>{humanizeKey(k)}</th>
                <td>{fmtSpec(v)}</td>
              </tr>
            ))}
            {!Object.keys(it.specs).length && (
              <tr>
                <td className="muted">No specs recorded</td>
              </tr>
            )}
            <tr>
              <th>ID</th>
              <td>
                <code>{it.id}</code>
              </td>
            </tr>
          </tbody>
        </table>
        {it.notes && (
          <>
            <h3>Notes</h3>
            <p className="small">{it.notes}</p>
          </>
        )}
        {lighter.length > 0 && <LighterList items={lighter} base={it} unit={unit} />}
        <p className="small">
          <a href={href(`/c/${it.category}`)} onClick={() => openItem(null)}>
            Browse all {cat?.name.toLowerCase()} →
          </a>
        </p>
      </aside>
    </div>
  );
}

function LighterList({ items, base, unit }: { items: Item[]; base: Item; unit: Unit }) {
  const { openItem } = useStore();
  return (
    <>
      <h3>Lighter {base.subcategory}s</h3>
      <ul className="mini-list">
        {items.map((x) => (
          <li key={x.id}>
            <button type="button" className="link" onClick={() => openItem(x.id)}>
              {x.name}
            </button>
            <span className="muted">
              {' '}
              {fmtW(x.weight_g, unit)} · {fmtPrice(x.price_usd)} · <span className="good">−{fmtW(base.weight_g - x.weight_g, unit)}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

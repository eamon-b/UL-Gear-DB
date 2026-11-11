import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { href, itemHref } from '../lib/router';
import { fmtDW, fmtW } from '../lib/units';
import { fmtPrice } from '../lib/util';
import type { DB, Item } from '../lib/types';
import { ItemDetails } from './ItemDrawer';

/**
 * Up to `n` items of the same type, nearest in weight (ties by id, so the prerender is stable).
 * Tops up from the rest of the category when the type has few others.
 */
export function similarItems(it: Item, db: DB, n = 8): Item[] {
  const pool = (db.byCategory.get(it.category) ?? []).filter((x) => x.id !== it.id);
  const near = (xs: Item[]) =>
    [...xs].sort((a, b) => Math.abs(a.weight_g - it.weight_g) - Math.abs(b.weight_g - it.weight_g) || (a.id < b.id ? -1 : 1));
  const same = near(pool.filter((x) => x.subcategory === it.subcategory)).slice(0, n);
  if (same.length >= Math.min(4, n)) return same.sort((a, b) => a.weight_g - b.weight_g || (a.id < b.id ? -1 : 1));
  const rest = near(pool.filter((x) => x.subcategory !== it.subcategory)).slice(0, n - same.length);
  return [...same, ...rest].sort((a, b) => a.weight_g - b.weight_g || (a.id < b.id ? -1 : 1));
}

export function ItemPage({ id }: { id?: string }) {
  const { db, unit } = useStore();
  const it = id ? db.byId.get(id) : undefined;
  const similar = useMemo(() => (it ? similarItems(it, db) : []), [it, db]);
  if (!it) {
    return (
      <div className="page">
        <h1>Item not found</h1>
        <p>
          There is no item with the id <code>{id}</code>. It may have been renamed or removed.
        </p>
        <p>
          <a href={href(`/search?q=${encodeURIComponent((id ?? '').replace(/-/g, ' '))}`)}>Search for it</a> or{' '}
          <a href={href('/')}>browse all categories</a>.
        </p>
      </div>
    );
  }
  const cat = db.catById.get(it.category);
  const sameType = similar.every((x) => x.subcategory === it.subcategory);
  return (
    <div className="page item-page">
      <nav className="crumbs small" aria-label="Breadcrumb">
        <a href={href('/')}>Browse</a> › <a href={href(`/c/${it.category}`)}>{cat?.name ?? it.category}</a> ›{' '}
        <span className="muted">{it.subcategory}</span>
      </nav>
      <h1>
        {it.brand} {it.model}
        {it.variant && <span className="variant"> {it.variant}</span>}
      </h1>
      <div className="item-body">
        <section className="item-main">
          <ItemDetails it={it} page />
        </section>
        {similar.length > 0 && (
          <section className="item-similar">
            <h2>{sameType ? `Similar ${it.subcategory}s` : `Similar ${cat?.name.toLowerCase() ?? 'items'}`}</h2>
            <ul className="mini-list">
              {similar.map((x) => {
                const d = x.weight_g - it.weight_g;
                return (
                  <li key={x.id}>
                    <a href={itemHref(x.id)}>{x.name}</a>
                    <span className="muted">
                      {' '}
                      {fmtW(x.weight_g, unit)} · {fmtPrice(x.price_usd)} ·{' '}
                      <span className={d < 0 ? 'good' : d > 0 ? 'bad' : ''}>{fmtDW(d, unit)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="small">
              <a href={href(`/c/${it.category}`)}>Browse all {cat?.name.toLowerCase()} →</a>
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

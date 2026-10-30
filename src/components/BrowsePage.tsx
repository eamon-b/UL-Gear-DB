import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { href, navigate } from '../lib/router';
import { fmtW } from '../lib/units';
import { BrowsePanel } from './BrowsePanel';
import type { Category } from '../lib/types';

export function groupCategories(cats: Category[]) {
  const groups: { group: string; cats: Category[] }[] = [];
  for (const c of cats) {
    let g = groups.find((x) => x.group === c.group);
    if (!g) groups.push((g = { group: c.group, cats: [] }));
    g.cats.push(c);
  }
  return groups;
}

export function BrowsePage({ catId }: { catId?: string }) {
  const { db, unit } = useStore();
  const groups = useMemo(() => groupCategories(db.categories), [db]);
  const cat = catId ? db.catById.get(catId) : undefined;

  if (!cat) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>Browse ultralight gear</h1>
          <p className="muted">
            {db.items.length.toLocaleString()} items across {db.categories.filter((c) => c.count).length} categories. Pick a category to
            filter, sort, plot, and compare.
          </p>
        </div>
        {groups.map((g) => (
          <section key={g.group} className="cat-group">
            <h2>{g.group}</h2>
            <div className="cat-cards">
              {g.cats.map((c) => {
                const items = db.byCategory.get(c.id) ?? [];
                const lightest = items.reduce<(typeof items)[number] | null>((a, b) => (!a || b.weight_g < a.weight_g ? b : a), null);
                return (
                  <a key={c.id} href={href(`/c/${c.id}`)} className={`cat-card ${c.count ? '' : 'empty'}`}>
                    <span className="cat-name">{c.name}</span>
                    <span className="cat-count">{c.count}</span>
                    <span className="cat-sub muted">{lightest ? `from ${fmtW(lightest.weight_g, unit)}` : 'no items yet'}</span>
                  </a>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="browse-layout">
      <aside className="cat-side">
        <select className="cat-select" value={cat.id} onChange={(e) => navigate(`/c/${e.target.value}`)} aria-label="Category">
          {groups.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.count})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <nav className="cat-nav">
          {groups.map((g) => (
            <div key={g.group}>
              <div className="cat-nav-group">{g.group}</div>
              {g.cats.map((c) => (
                <a key={c.id} href={href(`/c/${c.id}`)} className={`${c.id === cat.id ? 'on' : ''} ${c.count ? '' : 'empty'}`}>
                  <span>{c.name}</span>
                  <span className="muted">{c.count}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="browse-main">
        <h1 className="cat-title">
          {cat.name} <span className="muted">{cat.count} items</span>
        </h1>
        <BrowsePanel category={cat} />
      </div>
    </div>
  );
}

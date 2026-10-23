import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { searchItems } from '../lib/data';
import { sortItems, type Sort } from '../lib/filters';
import { GearTable } from './GearTable';
import { navigate } from '../lib/router';

export function SearchPage({ q }: { q: string }) {
  const { db, unit } = useStore();
  const [sort, setSort] = useState<Sort>({ key: 'relevance', dir: 1 });
  const results = useMemo(() => searchItems(db.items, q), [db, q]);
  const sorted = useMemo(() => (sort.key === 'relevance' ? results : sortItems(results, sort, () => null)), [results, sort]);
  const frontier = useMemo(() => new Set<string>(), []);
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of results) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [results]);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Search</h1>
        <input
          className="search-in big" type="search" autoFocus placeholder="Search all gear: brand, model, type…" defaultValue={q}
          onChange={(e) => navigate(`/search?q=${encodeURIComponent(e.target.value)}`, true)}
        />
        {q && <p className="muted">{results.length} results for “{q}”{cats.length > 1 && <> in {cats.map(([c, n]) => `${db.catById.get(c)?.name ?? c} (${n})`).join(', ')}</>}</p>}
      </div>
      {q && (
        <GearTable items={sorted} sort={sort} setSort={setSort} unit={unit} specCols={[]} frontier={frontier}
          valueOf={() => null} baseline={null} showCategory catById={db.catById} />
      )}
    </div>
  );
}

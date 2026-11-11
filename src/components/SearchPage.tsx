import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { search } from '../lib/search';
import { sortItems, type Sort } from '../lib/filters';
import { GearTable } from './GearTable';
import { href, navigate } from '../lib/router';

export function SearchPage({ q }: { q: string }) {
  const { db, unit } = useStore();
  const [sort, setSort] = useState<Sort>({ key: 'relevance', dir: 1 });
  // The page stays mounted while the query in the URL changes (typing here, or a new search from the
  // header), so the box follows the URL instead of keeping whatever it was first given.
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  const found = useMemo(() => search(db.items, q), [db, q]);
  const results = found.items;
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
          className="search-in big"
          type="search"
          autoFocus
          placeholder="Search all gear: brand, model, type…"
          value={text}
          aria-label="Search all gear"
          onChange={(e) => {
            setText(e.target.value);
            navigate(`/search?q=${encodeURIComponent(e.target.value)}`, true);
          }}
        />
        {q && (
          <p className="muted">
            {results.length} {results.length === 1 ? 'result' : 'results'} for “{found.corrected ?? q}”
            {found.corrected && <> (nothing matched “{q}”)</>}
            {cats.length > 1 && <> in {cats.map(([c, n]) => `${db.catById.get(c)?.name ?? c} (${n})`).join(', ')}</>}
          </p>
        )}
        {q && found.categories.length > 0 && (
          <p className="search-cats">
            Browse with filters and the weight/price plot:{' '}
            {found.categories.map((c) => (
              <a key={c} className="btn" href={href(`/c/${c}`)}>
                {db.catById.get(c)?.name ?? c} →
              </a>
            ))}
          </p>
        )}
        {q && results.length === 0 && (
          <p>
            Nothing in the database matches. Try the brand or the model alone, or a kind of gear (“quilt”, “bear can”). If it is missing,
            you can still add it to a list as a custom item.
          </p>
        )}
      </div>
      {q && results.length > 0 && (
        <GearTable
          items={sorted}
          sort={sort}
          setSort={setSort}
          unit={unit}
          specCols={[]}
          frontier={frontier}
          valueOf={() => null}
          baseline={null}
          showCategory
          catById={db.catById}
        />
      )}
    </div>
  );
}

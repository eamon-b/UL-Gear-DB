import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { navigate } from '../lib/router';
import { fmtW } from '../lib/units';
import { ImportReview } from './ImportReview';

export interface ExampleList {
  id: string;
  author: string | null;
  trail: string | null;
  year: number | null;
  season: string | null;
  trip_type: string | null;
  source_title: string | null;
  source_url: string | null;
  notes: string | null;
  lighterpack_url: string;
  title: string | null;
  fetched_at: string | null;
  items: number;
  base_g: number;
  worn_g: number;
  consumable_g: number;
  total_g: number;
  categories: { name: string; base_g: number }[];
  csv: string;
}

let cache: Promise<ExampleList[]> | null = null;
function loadExamples(): Promise<ExampleList[]> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}data/examples.json`, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} loading examples.json`);
        return r.json();
      })
      .then((d) => d.lists as ExampleList[]);
    cache.catch(() => { cache = null; });
  }
  return cache;
}

type SortKey = 'base_g' | 'total_g' | 'items' | 'year';
const label = (l: ExampleList) => l.title || `${l.trail ?? 'Gear'} list${l.author ? ` by ${l.author}` : ''}`;

export function ExamplesPage() {
  const { unit, createList, toast } = useStore();
  const [lists, setLists] = useState<ExampleList[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [trail, setTrail] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'base_g', desc: false });
  const [importing, setImporting] = useState<ExampleList | null>(null);
  useEffect(() => { loadExamples().then(setLists, (e) => setErr(String(e))); }, []);

  const trails = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lists ?? []) if (l.trail) m.set(l.trail, (m.get(l.trail) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [lists]);

  const shown = useMemo(() => {
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = (lists ?? []).filter((l) => {
      if (trail && l.trail !== trail) return false;
      const hay = [l.title, l.author, l.trail, l.season, l.trip_type, l.source_title, l.notes, l.year].join(' ').toLowerCase();
      return toks.every((t) => hay.includes(t));
    });
    const dir = sort.desc ? -1 : 1;
    return out.sort((a, b) => ((a[sort.key] ?? -Infinity) > (b[sort.key] ?? -Infinity) ? dir : (a[sort.key] ?? -Infinity) < (b[sort.key] ?? -Infinity) ? -dir : 0));
  }, [lists, trail, q, sort]);

  const th = (key: SortKey, text: string) => {
    const on = sort.key === key;
    return (
      <th
        className={`num sortable ${on ? 'sorted' : ''}`}
        aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}
        onClick={() => setSort((s) => ({ key, desc: on ? !s.desc : key === 'year' }))}
      >
        {text}
        <span className="sort-ind">{on ? (sort.desc ? '▼' : '▲') : ''}</span>
      </th>
    );
  };

  return (
    <div className="page examples">
      <div className="page-head">
        <h1>Example pack lists</h1>
        <p className="muted">
          Real gear lists that hikers have published on LighterPack, with the article or thread each one came from.
          Weights are recomputed from a snapshot of each list. Import one to see how it matches the database, then use Alternatives or Lighten my pack on it.
        </p>
      </div>
      {err && <p className="warn">Could not load example lists: {err}. Run <code>npm run data</code>.</p>}
      {!lists && !err && <div className="loading">Loading example lists…</div>}
      {lists && (
        <>
          <div className="toolbar">
            <input type="search" placeholder="Filter by trail, author, season…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter example lists" />
            <div className="row gap wrap">
              <button type="button" className={`chip ${trail === '' ? 'on' : ''}`} onClick={() => setTrail('')}>All ({lists.length})</button>
              {trails.map(([t, n]) => (
                <button key={t} type="button" className={`chip ${trail === t ? 'on' : ''}`} onClick={() => setTrail(trail === t ? '' : t)}>{t} ({n})</button>
              ))}
            </div>
          </div>
          <div className="table-wrap">
            <table className="gear examples-table">
              <thead>
                <tr>
                  <th>List</th>
                  <th>Trip</th>
                  {th('base_g', 'Base')}
                  <th className="num">Worn</th>
                  <th className="num">Consumable</th>
                  {th('total_g', 'Total')}
                  {th('items', 'Items')}
                  <th>Heaviest categories</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <a href={l.lighterpack_url} target="_blank" rel="noopener noreferrer" className="strong">{label(l)}</a>
                      <div className="muted small">
                        {l.author ? `${l.author} · ` : ''}
                        {l.source_url ? <a href={l.source_url} target="_blank" rel="noopener noreferrer">{l.source_title || 'source'}</a> : l.source_title}
                      </div>
                      {l.notes && <div className="muted small">{l.notes}</div>}
                    </td>
                    <td className="small">
                      {[l.trail, l.year].filter(Boolean).join(' ') || '—'}
                      <div className="muted">{[l.trip_type, l.season].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="num strong">{fmtW(l.base_g, unit)}</td>
                    <td className="num">{fmtW(l.worn_g, unit)}</td>
                    <td className="num">{fmtW(l.consumable_g, unit)}</td>
                    <td className="num">{fmtW(l.total_g, unit)}</td>
                    <td className="num">{l.items}</td>
                    <td className="small muted">{l.categories.slice(0, 3).map((c) => `${c.name} ${fmtW(c.base_g, unit)}`).join(' · ')}</td>
                    <td><button type="button" className="btn small" onClick={() => setImporting(l)}>Import</button></td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={9} className="muted center pad">No lists match.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Lists belong to their authors and may have changed since the snapshot date. Add a list by putting its LighterPack id and source in
            {' '}<code>data/examples/sources.json</code> and running <code>npm run fetch-examples</code>.
          </p>
        </>
      )}
      {importing && (
        <ImportReview
          text={importing.csv}
          fileName={label(importing)}
          canAppend={false}
          onClose={() => setImporting(null)}
          onDone={(items, _mode, name) => {
            const l = createList(name, items);
            setImporting(null);
            navigate(`/lists/${l.id}`);
            toast(`Imported ${items.length} items into "${name}"`);
          }}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Category, Item } from '../lib/types';
import { applyFilters, cheapestBaseline, emptyFilters, gPerDollar, paretoFrontier, sortItems, specKeys, type Filters, type Sort } from '../lib/filters';
import { useStore } from '../lib/store';
import { FilterPanel } from './FilterPanel';
import { GearTable } from './GearTable';
import { Scatter } from './Scatter';
import { activeMetric, DEFAULT_MIN_COVERAGE, metricCoverage, metricsFor, metricTitle, paretoFrontier3, saveMetricKey, type Metric } from '../lib/metric';

interface Props {
  category: Category;
  refItem?: Item | null;
  onSwap?: (it: Item) => void;
}

const MAX_SPEC_COLS = 6;

export function BrowsePanel({ category, refItem, onSwap }: Props) {
  const { db, unit, openItem } = useStore();
  const pool = useMemo(() => db.byCategory.get(category.id) ?? [], [db, category.id]);
  // Alternatives open scoped to the current item's type (tent vs tent, not tent vs tarp).
  const defaults = useCallback(
    (): Filters => (refItem ? { ...emptyFilters(), subcats: [refItem.subcategory] } : emptyFilters()),
    [refItem],
  );
  const [filters, setFilters] = useState<Filters>(defaults);
  const [sort, setSort] = useState<Sort>({ key: 'weight', dir: 1 });
  const [allSpecs, setAllSpecs] = useState(false);
  // On phones the chart pushes the table off-screen; in Alternatives the table is what you act on.
  const [showChart, setShowChart] = useState(() => !(refItem && typeof window !== 'undefined' && window.innerWidth <= 760));
  const [selected, setSelected] = useState<string | null>(null);
  const metrics = useMemo(() => metricsFor(category.id, pool), [category.id, pool]);
  const [metric, setMetricS] = useState<Metric | null>(() => activeMetric(category.id, pool));
  const setMetric = useCallback((key: string) => {
    saveMetricKey(category.id, key);
    const m = metrics.find((x) => x.key === key) ?? null;
    setMetricS(m);
    // the metric column goes away with the metric: don't leave the table sorted on it
    if (!m) setSort((s) => (s.key === 'metric' ? { key: 'weight', dir: 1 } : s));
  }, [category.id, metrics]);

  useEffect(() => {
    setFilters(defaults());
    setSort({ key: 'weight', dir: 1 });
    setSelected(null);
    setMetricS(activeMetric(category.id, pool));
  }, [category.id, refItem?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setF = useCallback((f: Filters) => {
    if (f.chip === 'value' && filters.chip !== 'value') setSort({ key: 'value', dir: -1 });
    setFilters(f);
  }, [filters.chip]);

  const filtered = useMemo(() => applyFilters(pool, filters, refItem), [pool, filters, refItem]);
  const frontier = useMemo(() => (metric ? paretoFrontier3(filtered, metric) : paretoFrontier(filtered)), [filtered, metric]);
  const shownSet = useMemo(
    () => (filters.frontierOnly ? filtered.filter((i) => frontier.has(i.id) || i.id === refItem?.id) : filtered),
    [filtered, filters.frontierOnly, frontier, refItem],
  );
  const baseline = useMemo(() => (refItem ? refItem : cheapestBaseline(shownSet)), [refItem, shownSet]);
  const valueOf = useCallback((it: Item) => gPerDollar(it, baseline), [baseline]);
  const sorted = useMemo(() => {
    const s = sortItems(shownSet, sort, valueOf, metric?.get);
    if (refItem) {
      // pin the current item on top
      const i = s.findIndex((x) => x.id === refItem.id);
      if (i > 0) s.unshift(s.splice(i, 1)[0]);
    }
    return s;
  }, [shownSet, sort, valueOf, refItem, metric]);
  // the metric gets its own column, so don't repeat its spec
  const keys = useMemo(() => specKeys(pool).filter((k) => k !== metric?.key), [pool, metric]);
  const specCols = allSpecs ? keys : keys.slice(0, MAX_SPEC_COLS);

  const onSelect = useCallback((id: string) => {
    setSelected(id);
    if (!refItem) openItem(id);
  }, [refItem, openItem]);

  return (
    <div className="browse">
      <FilterPanel category={category} pool={pool} filters={filters} setFilters={setF} unit={unit} refItem={refItem} shown={sorted.length} defaults={defaults} />
      <div className="toolbar">
        <label className="tog small"><input type="checkbox" checked={showChart} onChange={(e) => setShowChart(e.target.checked)} /> Scatter plot</label>
        {metrics.length > 0 && (
          <label className="small" title="A third dimension besides weight and price: it colors the scatter plot and joins the Pareto frontier (nothing lighter, cheaper and better on it).">
            Compare on{' '}
            <select value={metric?.key ?? ''} onChange={(e) => setMetric(e.target.value)} aria-label="Third dimension">
              <option value="">weight &amp; price only</option>
              {metrics.map((m) => {
                const cov = metricCoverage(m, pool);
                return <option key={m.key} value={m.key}>{metricTitle(m)}{cov < DEFAULT_MIN_COVERAGE ? ` · ${Math.round(cov * 100)}% have data` : ''}</option>;
              })}
            </select>
          </label>
        )}
        {keys.length > MAX_SPEC_COLS && (
          <label className="tog small"><input type="checkbox" checked={allSpecs} onChange={(e) => setAllSpecs(e.target.checked)} /> All spec columns ({keys.length})</label>
        )}
        <span className="muted small">★ = Pareto frontier{metric ? ` (weight, price, ${metric.label.toLowerCase()})` : ''} · click a column to sort</span>
      </div>
      {showChart && <Scatter items={shownSet} frontier={frontier} unit={unit} metric={metric} refItem={refItem} selectedId={selected} onSelect={onSelect} />}
      <GearTable
        items={sorted} sort={sort} setSort={setSort} unit={unit} specCols={specCols} frontier={frontier}
        valueOf={valueOf} metric={metric} baseline={baseline} refItem={refItem} onSwap={onSwap} selectedId={selected}
      />
    </div>
  );
}

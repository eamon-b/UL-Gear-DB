import { memo, useEffect, useState } from 'react';
import type { Category, Item } from '../lib/types';
import type { Sort } from '../lib/filters';
import { fmtDW, fmtW, G_PER_OZ, type Unit } from '../lib/units';
import { fmtPrice, humanizeKey } from '../lib/util';
import { useStore } from '../lib/store';
import { fmtMetric, metricTitle, type Metric } from '../lib/metric';

interface Props {
  items: Item[];
  sort: Sort;
  setSort: (s: Sort) => void;
  unit: Unit;
  specCols: string[];
  frontier: Set<string>;
  valueOf: (it: Item) => number | null;
  metric?: Metric | null;
  baseline: Item | null;
  refItem?: Item | null;
  onSwap?: (it: Item) => void;
  showCategory?: boolean;
  catById?: Map<string, Category>;
  selectedId?: string | null;
  pageSize?: number;
}

const DEFAULT_DIR: Record<string, 1 | -1> = { value: -1 };

export const GearTable = memo(function GearTable(p: Props) {
  const { items, sort, setSort, unit, specCols, frontier, valueOf, metric, refItem, onSwap, showCategory, catById, selectedId, baseline } = p;
  const { compare, toggleCompare, addToList, openItem } = useStore();
  const pageSize = p.pageSize ?? 100;
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [items]);
  useEffect(() => {
    if (!selectedId) return;
    const idx = items.findIndex((i) => i.id === selectedId);
    if (idx < 0) return;
    setPage(Math.floor(idx / pageSize));
    requestAnimationFrame(() => {
      document.querySelector(`tr[data-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const rows = items.slice(page * pageSize, (page + 1) * pageSize);

  const th = (key: string, label: string, cls = '', title?: string) => {
    const on = sort.key === key;
    return (
      <th
        className={`${cls} sortable ${on ? 'sorted' : ''}`}
        title={title}
        aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
        onClick={() => setSort({ key, dir: on ? (sort.dir === 1 ? -1 : 1) : key === 'metric' && metric ? (metric.dir === 1 ? -1 : 1) : DEFAULT_DIR[key] ?? 1 })}
      >
        {label}
        <span className="sort-ind">{on ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
      </th>
    );
  };

  const valueTitle = refItem
    ? 'Dollars per ounce saved vs the current item (lower is better). "free" = lighter and not more expensive.'
    : `Grams saved per extra dollar vs the cheapest item in view${baseline ? ` (${baseline.name}, ${fmtPrice(baseline.price_usd)})` : ''}. Higher is better.`;

  return (
    <div className="table-wrap">
      <table className="gear">
        <thead>
          <tr>
            <th className="c-cmp" title="Compare">⇆</th>
            {th('name', 'Item', 'c-name')}
            {showCategory && th('category', 'Category')}
            {th('subcategory', 'Type', 'c-type')}
            {th('weight', `Weight`, 'num')}
            {refItem && <th className="num">Δ wt</th>}
            {th('price', 'Price', 'num')}
            {refItem && <th className="num">Δ $</th>}
            {metric && th('metric', metricTitle(metric), 'num metric-col', `${metric.dir === 1 ? 'Higher' : 'Lower'} is better`)}
            {th('value', refItem ? '$/oz saved' : 'g/$', 'num', valueTitle)}
            {specCols.map((k) => th('spec:' + k, humanizeKey(k), 'spec'))}
            {th('confidence', 'Conf.')}
            <th className="c-act" />
          </tr>
        </thead>
        <tbody>
          {rows.map((it) => {
            const v = valueOf(it);
            const isRef = refItem?.id === it.id;
            const dW = refItem ? it.weight_g - refItem.weight_g : 0;
            const dP = refItem && it.price_usd != null && refItem.price_usd != null ? it.price_usd - refItem.price_usd : null;
            return (
              <tr key={it.id} className={`${isRef ? 'is-ref' : ''} ${selectedId === it.id ? 'is-sel' : ''} ${it.discontinued ? 'is-disc' : ''}`} data-id={it.id}>
                <td className="c-cmp">
                  <input type="checkbox" aria-label={`Compare ${it.name}`} checked={compare.includes(it.id)} onChange={() => toggleCompare(it.id)} />
                </td>
                <td className="c-name">
                  <button type="button" className="item-link" onClick={() => openItem(it.id)}>
                    <span className="brand">{it.brand}</span> {it.model}
                    {it.variant && <span className="variant"> {it.variant}</span>}
                  </button>
                  {frontier.has(it.id) && <span className="badge front" title={metric ? `Pareto frontier: nothing lighter, cheaper and better on ${metric.label.toLowerCase()}` : 'Pareto frontier: nothing lighter for less'}>★</span>}
                  {it.discontinued && <span className="badge disc">disc.</span>}
                  {isRef && <span className="badge ref">current</span>}
                  {onSwap && !isRef && <button type="button" className="btn small primary swap-btn" onClick={() => onSwap(it)} aria-label={`Swap to ${it.name}`}>Swap</button>}
                </td>
                {showCategory && <td className="muted">{catById?.get(it.category)?.name ?? it.category}</td>}
                <td className="muted nowrap c-type">{it.subcategory}</td>
                <td className="num strong" title={it.weight_note ?? undefined}>{fmtW(it.weight_g, unit)}{it.weight_basis !== 'manufacturer' && <sup title={it.weight_basis}>{it.weight_basis[0]}</sup>}</td>
                {refItem && <td className={`num ${dW < 0 ? 'good' : dW > 0 ? 'bad' : ''}`}>{isRef ? '' : fmtDW(dW, unit)}</td>}
                <td className="num">{fmtPrice(it.price_usd)}</td>
                {refItem && <td className={`num ${dP == null ? '' : dP < 0 ? 'good' : dP > 0 ? 'bad' : ''}`}>{isRef || dP == null ? '' : (dP > 0 ? '+' : dP < 0 ? '−' : '±') + fmtPrice(Math.abs(dP))}</td>}
                {metric && <td className="num metric-col">{metric.get(it) == null ? <span className="muted">–</span> : fmtMetric(metric.get(it), metric, false)}</td>}
                <td className="num">{fmtValue(v, !!refItem)}</td>
                {specCols.map((k) => <td key={k} className={typeof it.specs[k] === 'number' ? 'num spec' : 'spec'}>{fmtSpec(it.specs[k])}</td>)}
                <td><span className={`conf conf-${it.confidence}`} title={`Confidence: ${it.confidence}`}>{it.confidence[0].toUpperCase()}</span></td>
                <td className="c-act nowrap">
                  {it.url && <a className="icon-btn" href={it.url} target="_blank" rel="noopener noreferrer" title="Source / manufacturer page">↗</a>}
                  {/* in Alternatives, Swap sits next to the name so it's never scrolled out of view */}
                  {!onSwap && (
                    <button type="button" className="icon-btn add" title="Add to active list" aria-label={`Add ${it.name} to list`} onClick={() => addToList(it.id)}>＋</button>
                  )}
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr><td colSpan={99} className="muted pad center">No items match these filters.</td></tr>
          )}
        </tbody>
      </table>
      {pages > 1 && (
        <div className="pager">
          <button type="button" className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
          <span className="muted">Page {page + 1} of {pages} · {items.length} items</span>
          <button type="button" className="btn small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
});

export function fmtSpec(v: unknown) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'number') return Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(v);
  return String(v);
}

/** browse: g per $; ref mode: valueOf returns g/$, display as $/oz saved */
function fmtValue(v: number | null, ref: boolean) {
  if (v == null) return <span className="muted">–</span>;
  if (v === Infinity) return <span className="good" title="Lighter and not more expensive">free</span>;
  if (ref) return '$' + (G_PER_OZ / v).toFixed(2);
  return v >= 10 ? Math.round(v) : v.toFixed(1);
}

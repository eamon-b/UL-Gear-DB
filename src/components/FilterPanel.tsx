import { useMemo, useState } from 'react';
import type { Category, Item } from '../lib/types';
import { activeFilterCount, emptyFilters, specMeta, type Chip, type Filters, type SpecFilter } from '../lib/filters';
import { fmtW, toUnit, type Unit } from '../lib/units';
import { fmtPrice, humanizeKey } from '../lib/util';
import { DualRange } from './DualRange';
import { MultiSelect } from './MultiSelect';

interface Props {
  category: Category | null;
  pool: Item[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  unit: Unit;
  refItem?: Item | null;
  shown: number;
  /** what Reset returns to (alternatives: same type as the current item) */
  defaults?: () => Filters;
}

const CHIPS: { id: Exclude<Chip, null>; label: string }[] = [
  { id: 'lighter', label: 'Lighter' },
  { id: 'cheaper', label: 'Cheaper' },
  { id: 'both', label: 'Lighter & cheaper' },
  { id: 'value', label: 'Best g saved per $' },
];

export function FilterPanel({ category, pool, filters: f, setFilters, unit, refItem, shown, defaults = emptyFilters }: Props) {
  const [open, setOpen] = useState(() => !refItem && typeof window !== 'undefined' && window.innerWidth > 720);
  const meta = useMemo(() => specMeta(pool), [pool]);
  const brands = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of pool) m.set(it.brand, (m.get(it.brand) ?? 0) + 1);
    return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([v, n]) => ({ v, n }));
  }, [pool]);
  const subcats = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of pool) m.set(it.subcategory, (m.get(it.subcategory) ?? 0) + 1);
    const order = category?.subcategories ?? [];
    return [...m].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([v, n]) => ({ v, n }));
  }, [pool, category]);
  const wExt = useMemo(() => extent(pool.map((i) => i.weight_g)), [pool]);
  const pExt = useMemo(() => extent(pool.map((i) => i.price_usd).filter((p): p is number => p != null)), [pool]);

  const up = (patch: Partial<Filters>) => setFilters({ ...f, ...patch });
  const setSpec = (k: string, sf: SpecFilter | null) => {
    const specs = { ...f.specs };
    if (sf) specs[k] = sf;
    else delete specs[k];
    up({ specs });
  };
  const refSub = refItem?.subcategory ?? null;
  const sameTypeOnly = !!refSub && f.subcats.length === 1 && f.subcats[0] === refSub;
  // the default "same type" scope is not counted as an active filter
  const n = activeFilterCount(f) - (sameTypeOnly ? 1 : 0);
  const subCount = (s: string) => subcats.find((x) => x.v === s)?.n ?? 0;

  return (
    <div className="filters">
      <div className="filter-row">
        <input
          className="search-in"
          type="search"
          placeholder={`Search ${category ? category.name.toLowerCase() : 'items'}…`}
          value={f.q}
          onChange={(e) => up({ q: e.target.value })}
          aria-label="Search brand or model"
        />
        {subcats.length > 1 && <MultiSelect label="Type" options={subcats} value={f.subcats} onChange={(v) => up({ subcats: v })} />}
        <MultiSelect label="Brand" options={brands} value={f.brands} onChange={(v) => up({ brands: v })} />
        <button type="button" className={`btn ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Hide' : 'More'} filters{n ? ` (${n})` : ''}
        </button>
        {n > 0 && (
          <button type="button" className="btn ghost" onClick={() => setFilters(defaults())}>
            Reset
          </button>
        )}
        <span className="muted count">
          {shown} / {pool.length} items
        </span>
      </div>
      {refItem && refSub && subcats.length > 1 && (
        <div className="filter-row scope" role="group" aria-label="Compare against">
          <span className="muted">Compare with:</span>
          <div className="seg">
            <button
              type="button"
              className={`seg-opt ${sameTypeOnly ? 'on' : ''}`}
              aria-pressed={sameTypeOnly}
              onClick={() => up({ subcats: [refSub] })}
            >
              Same type: {refSub} <span className="muted">{subCount(refSub)}</span>
            </button>
            <button
              type="button"
              className={`seg-opt ${f.subcats.length === 0 ? 'on' : ''}`}
              aria-pressed={f.subcats.length === 0}
              onClick={() => up({ subcats: [] })}
            >
              All {category ? category.name.toLowerCase() : 'types'} <span className="muted">{pool.length}</span>
            </button>
          </div>
        </div>
      )}
      {refItem && (
        <div className="filter-row chips">
          <span className="muted">Quick:</span>
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip ${f.chip === c.id ? 'on' : ''}`}
              onClick={() => up({ chip: f.chip === c.id ? null : c.id })}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="filter-grid">
          <div className="fg">
            <div className="fg-label">Weight</div>
            <DualRange
              label="Weight"
              min={wExt[0]}
              max={wExt[1]}
              lo={f.wMin}
              hi={f.wMax}
              step={1}
              onChange={(lo, hi) => up({ wMin: lo, wMax: hi })}
              format={(v) => fmtW(v, unit)}
            />
          </div>
          {pExt[1] > pExt[0] && (
            <div className="fg">
              <div className="fg-label">Price</div>
              <DualRange
                label="Price"
                min={pExt[0]}
                max={pExt[1]}
                lo={f.pMin}
                hi={f.pMax}
                step={1}
                onChange={(lo, hi) => up({ pMin: lo, pMax: hi })}
                format={(v) => fmtPrice(v)}
              />
            </div>
          )}
          <div className="fg">
            <div className="fg-label">Options</div>
            <label className="tog">
              <input type="checkbox" checked={f.hideDisc} onChange={(e) => up({ hideDisc: e.target.checked })} /> Hide discontinued
            </label>
            <label className="tog">
              <input type="checkbox" checked={f.hideNoPrice} onChange={(e) => up({ hideNoPrice: e.target.checked })} /> Hide unknown price
            </label>
            <label className="tog">
              <input type="checkbox" checked={f.frontierOnly} onChange={(e) => up({ frontierOnly: e.target.checked })} /> Pareto frontier
              only
            </label>
          </div>
          <div className="fg">
            <div className="fg-label">Confidence</div>
            <div className="seg">
              {(['high', 'medium', 'low'] as const).map((c) => (
                <label key={c} className={`seg-opt ${f.confidence.includes(c) ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={f.confidence.includes(c)}
                    onChange={() =>
                      up({ confidence: f.confidence.includes(c) ? f.confidence.filter((x) => x !== c) : [...f.confidence, c] })
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
          </div>
          {meta.map((m) => {
            const cur = f.specs[m.key];
            if (m.type === 'number') {
              const isW = /_g$/.test(m.key);
              return (
                <div className="fg" key={m.key}>
                  <div className="fg-label">{humanizeKey(m.key)}</div>
                  <DualRange
                    label={humanizeKey(m.key)}
                    min={m.min}
                    max={m.max}
                    lo={cur?.type === 'range' && cur.min > m.min ? cur.min : null}
                    hi={cur?.type === 'range' && cur.max < m.max ? cur.max : null}
                    onChange={(lo, hi) =>
                      setSpec(m.key, lo == null && hi == null ? null : { type: 'range', min: lo ?? m.min, max: hi ?? m.max })
                    }
                    format={(v) => (isW ? `${Math.round(toUnit(v, 'g'))} g` : fmtNum(v))}
                  />
                </div>
              );
            }
            if (m.type === 'boolean') {
              const val = cur?.type === 'bool' ? cur.value : null;
              return (
                <div className="fg" key={m.key}>
                  <div className="fg-label">{humanizeKey(m.key)}</div>
                  <div className="seg">
                    {([null, true, false] as const).map((v) => (
                      <button
                        key={String(v)}
                        type="button"
                        className={`seg-opt ${val === v ? 'on' : ''}`}
                        onClick={() => setSpec(m.key, v == null ? null : { type: 'bool', value: v })}
                      >
                        {v == null ? 'Any' : v ? 'Yes' : 'No'}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <div className="fg" key={m.key}>
                <div className="fg-label">{humanizeKey(m.key)}</div>
                <MultiSelect
                  label=""
                  options={m.values}
                  value={cur?.type === 'set' ? cur.values : []}
                  onChange={(v) => setSpec(m.key, v.length ? { type: 'set', values: v } : null)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function extent(xs: number[]): [number, number] {
  if (!xs.length) return [0, 0];
  let a = Infinity,
    b = -Infinity;
  for (const x of xs) {
    if (x < a) a = x;
    if (x > b) b = x;
  }
  return [Math.floor(a), Math.ceil(b)];
}
const fmtNum = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 100) / 100));

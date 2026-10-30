import { useMemo, useState } from 'react';
import { useStore, newListItem } from '../lib/store';
import { resolve, totals, type Resolved } from '../lib/lists';
import type { Item, ListItem, PackList } from '../lib/types';
import { fmtW, fromUnit, toUnit, type Unit } from '../lib/units';
import { fmtPrice, uid } from '../lib/util';
import { searchItems } from '../lib/data';
import { Breakdown } from './Donut';
import { EditNum, EditText } from './Editable';
import { AlternativesPanel } from './AlternativesPanel';
import { LightenPanel } from './LightenPanel';

interface Props {
  list: PackList;
  readOnly?: boolean;
  onChange?: (fn: (l: PackList) => PackList) => void;
}

export function ListEditor({ list, readOnly, onChange }: Props) {
  const { db, unit } = useStore();
  const [altFor, setAltFor] = useState<string | null>(null);
  const [showLighten, setShowLighten] = useState(false);
  const rs = useMemo(() => list.items.map((li) => resolve(li, db)), [list.items, db]);
  const t = useMemo(() => totals(rs), [rs]);
  const order = useMemo(() => {
    const o: string[] = [];
    for (const r of rs) if (!o.includes(r.cat)) o.push(r.cat);
    return o;
  }, [rs]);
  const groups = useMemo(() => order.map((cat) => ({ cat, rows: rs.filter((r) => r.cat === cat) })), [order, rs]);

  const edit = (fn: (items: ListItem[]) => ListItem[]) => onChange?.((l) => ({ ...l, items: fn(l.items) }));
  const patch = (u: string, p: Partial<ListItem>) => edit((items) => items.map((li) => (li.uid === u ? { ...li, ...p } : li)));
  const remove = (u: string) => edit((items) => items.filter((li) => li.uid !== u));
  const move = (u: string, d: -1 | 1) =>
    edit((items) => {
      const i = items.findIndex((x) => x.uid === u);
      const cat = rs.find((r) => r.li.uid === u)?.cat;
      // move to previous/next item in the same category section
      let j = i + d;
      while (j >= 0 && j < items.length && resolve(items[j], db).cat !== cat) j += d;
      if (j < 0 || j >= items.length) return items;
      const c = items.slice();
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  const altRow = altFor ? rs.find((r) => r.li.uid === altFor) : null;
  const catOptions = useMemo(() => [...new Set([...order, ...db.categories.map((c) => c.name)])], [order, db]);

  return (
    <div className="list-editor">
      <TotalsBar t={t} unit={unit} />
      <div className="list-grid">
        <div className="list-main">
          {!readOnly && <AddBar onAdd={(li) => edit((items) => [...items, li])} catOptions={catOptions} />}
          <datalist id="cat-options">
            {catOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div className="table-wrap">
            <table className={`list-table ${readOnly ? 'ro' : ''}`}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Weight ({unit})</th>
                  <th className="num">Qty</th>
                  <th title="Worn (one unit counts as worn)">Worn</th>
                  <th title="Consumable (food, fuel, water)">Cons.</th>
                  <th className="num">Price</th>
                  <th className="num">Subtotal</th>
                  {!readOnly && <th />}
                </tr>
              </thead>
              {groups.map((g) => {
                const sub = g.rows.reduce((s, r) => s + r.weight_g * r.li.qty, 0);
                return (
                  <tbody key={g.cat}>
                    <tr className="cat-row">
                      <th colSpan={6}>{g.cat}</th>
                      <th className="num">{fmtW(sub, unit)}</th>
                      {!readOnly && <th />}
                    </tr>
                    {g.rows.map((r) => (
                      <Row
                        key={r.li.uid}
                        r={r}
                        unit={unit}
                        readOnly={readOnly}
                        patch={patch}
                        remove={remove}
                        move={move}
                        onAlt={() => setAltFor(r.li.uid)}
                      />
                    ))}
                  </tbody>
                );
              })}
              {!rs.length && (
                <tbody>
                  <tr>
                    <td colSpan={8} className="muted pad center">
                      Empty list. Search the database above, add a custom item, or import a LighterPack CSV.
                    </td>
                  </tr>
                </tbody>
              )}
            </table>
          </div>
        </div>
        <div className="list-side">
          <Breakdown t={t} order={order} unit={unit} />
          {!readOnly && rs.some((r) => r.item) && (
            <button type="button" className="btn wide" onClick={() => setShowLighten((s) => !s)}>
              {showLighten ? 'Hide' : '⚖ Lighten my pack'}
            </button>
          )}
        </div>
      </div>
      {showLighten && !readOnly && (
        <LightenPanel
          rs={rs}
          onApply={(swaps) =>
            edit((items) =>
              items.map((li) => {
                const s = swaps.find((x) => x.uid === li.uid);
                return s ? swapLi(li, s.item) : li;
              }),
            )
          }
          onClose={() => setShowLighten(false)}
        />
      )}
      {altRow && altRow.item && (
        <AlternativesPanel
          current={altRow.item}
          listItem={altRow.li}
          onClose={() => setAltFor(null)}
          onSwap={(it) => {
            patch(altRow.li.uid, swapPatch(it));
            setAltFor(null);
          }}
        />
      )}
    </div>
  );
}

export function swapPatch(it: Item): Partial<ListItem> {
  return { dbId: it.id, custom: undefined, weight_g: undefined, price_usd: undefined };
}
export function swapLi(li: ListItem, it: Item): ListItem {
  const n = { ...li, ...swapPatch(it) };
  delete n.weight_g;
  delete n.price_usd;
  delete n.custom;
  return n;
}

function Row({
  r,
  unit,
  readOnly,
  patch,
  remove,
  move,
  onAlt,
}: {
  r: Resolved;
  unit: Unit;
  readOnly?: boolean;
  patch: (u: string, p: Partial<ListItem>) => void;
  remove: (u: string) => void;
  move: (u: string, d: -1 | 1) => void;
  onAlt: () => void;
}) {
  const { openItem } = useStore();
  const li = r.li;
  const wDisp = round(toUnit(r.weight_g, unit), unit);
  const overridden = !!r.item && (li.weight_g != null || li.price_usd !== undefined);
  // A "missing" row (dbId no longer in the DB) has no `custom` yet: start from what is displayed.
  const customBase = () => li.custom ?? { name: r.name, category: r.cat, weight_g: r.weight_g, price_usd: r.price_usd };
  const setWeight = (v: number | null) => {
    const g = v == null ? 0 : Math.round(fromUnit(v, unit) * 10) / 10;
    if (r.item) patch(li.uid, { weight_g: v == null ? undefined : g });
    else patch(li.uid, { custom: { ...customBase(), weight_g: g }, weight_g: undefined });
  };
  const setPrice = (v: number | null) => {
    if (r.item) patch(li.uid, { price_usd: v });
    else patch(li.uid, { custom: { ...customBase(), price_usd: v }, price_usd: undefined });
  };
  return (
    <tr
      className={`${li.worn ? 'worn' : ''} ${li.consumable ? 'cons' : ''} ${li.qty > 0 ? '' : 'zero'}`}
      data-uid={li.uid}
      title={li.qty > 0 ? undefined : 'Qty 0: kept in the list but not counted in totals'}
    >
      <td className="c-name">
        <div className="name-line">
          <span className="name-main">
            {r.item ? (
              <button type="button" className="item-link" onClick={() => openItem(r.item!.id)}>
                {r.name}
              </button>
            ) : readOnly ? (
              <span>{r.name}</span>
            ) : (
              <EditText value={r.name} ariaLabel="Item name" onCommit={(v) => patch(li.uid, { custom: { ...customBase(), name: v } })} />
            )}
          </span>
          <span className="name-tags">
            {r.missing && (
              <span className="badge disc" title="Item not found in the database">
                missing
              </span>
            )}
            {overridden && !readOnly && (
              <button
                type="button"
                className="badge link"
                title="Weight/price edited for this list. Click to reset to DB values."
                onClick={() => patch(li.uid, { weight_g: undefined, price_usd: undefined })}
              >
                edited ↺
              </button>
            )}
            {r.url && (
              <a
                className="icon-btn tiny"
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                title="Source"
                aria-label={`Source page for ${r.name}`}
              >
                ↗
              </a>
            )}
          </span>
        </div>
        {!readOnly && (
          <div className="row-cat">
            <EditText
              value={r.cat}
              list="cat-options"
              ariaLabel="Category"
              className="cat-in"
              onCommit={(v) => patch(li.uid, { cat: v.trim() || undefined })}
            />
            {!r.item && !r.missing && <span className="badge">custom</span>}
          </div>
        )}
      </td>
      <td className="num c-w" data-label={unit}>
        {readOnly ? fmtW(r.weight_g, unit, false) : <EditNum value={wDisp} onCommit={setWeight} min={0} ariaLabel="Weight" />}
      </td>
      <td className="num c-qty" data-label="×">
        {readOnly ? (
          li.qty
        ) : (
          <EditNum
            value={li.qty}
            onCommit={(v) => patch(li.uid, { qty: Math.max(0, Math.round(v ?? 1)) })}
            min={0}
            className="qty"
            ariaLabel="Quantity"
          />
        )}
      </td>
      <td className="center c-flag" data-label="Worn">
        <input
          type="checkbox"
          checked={li.worn}
          disabled={readOnly}
          aria-label="Worn"
          onChange={(e) => patch(li.uid, { worn: e.target.checked, consumable: e.target.checked ? false : li.consumable })}
        />
      </td>
      <td className="center c-flag" data-label="Cons.">
        <input
          type="checkbox"
          checked={li.consumable}
          disabled={readOnly}
          aria-label="Consumable"
          onChange={(e) => patch(li.uid, { consumable: e.target.checked, worn: e.target.checked ? false : li.worn })}
        />
      </td>
      <td className="num c-price" data-label="$">
        {readOnly ? fmtPrice(r.price_usd) : <EditNum value={r.price_usd} onCommit={setPrice} min={0} className="price" ariaLabel="Price" />}
      </td>
      <td className="num strong c-sub">{fmtW(r.weight_g * li.qty, unit)}</td>
      {!readOnly && (
        <td className="c-act nowrap">
          {r.item && (
            <button type="button" className="btn small" onClick={onAlt} title="Find lighter or cheaper alternatives">
              Alternatives
            </button>
          )}
          <button type="button" className="icon-btn tiny" onClick={() => move(li.uid, -1)} title="Move up" aria-label="Move up">
            ↑
          </button>
          <button type="button" className="icon-btn tiny" onClick={() => move(li.uid, 1)} title="Move down" aria-label="Move down">
            ↓
          </button>
          <button type="button" className="icon-btn tiny danger" onClick={() => remove(li.uid)} title="Remove" aria-label="Remove">
            ✕
          </button>
        </td>
      )}
    </tr>
  );
}

const round = (v: number, u: Unit) => (u === 'g' ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);

export function TotalsBar({ t, unit }: { t: ReturnType<typeof totals>; unit: Unit }) {
  const cell = (label: string, v: string, hint: string, cls = '') => (
    <div className={`tot ${cls}`} title={hint}>
      <div className="tot-v">{v}</div>
      <div className="tot-l">{label}</div>
    </div>
  );
  return (
    <div className="totals">
      {cell('Base weight', fmtW(t.base, unit), 'Everything carried in the pack except worn and consumables', 'primary')}
      {cell('Worn', fmtW(t.worn, unit), 'Worn items (one unit of each worn line)')}
      {cell('Consumable', fmtW(t.consumable, unit), 'Food, fuel, water')}
      {cell('Pack weight', fmtW(t.pack, unit), 'Base + consumables (what is on your back)')}
      {cell('Skin-out total', fmtW(t.total, unit), 'Everything: base + worn + consumable')}
      {cell('Cost', fmtPrice(t.cost) + (t.costKnown ? '' : '+'), t.costKnown ? 'Total list price' : 'Some items have no price')}
      {cell('Items', String(t.count), 'Total quantity')}
    </div>
  );
}

function AddBar({ onAdd, catOptions }: { onAdd: (li: ListItem) => void; catOptions: string[] }) {
  const { db, unit } = useStore();
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState(false);
  const res = useMemo(() => (q.trim().length >= 2 ? searchItems(db.items, q, 10) : []), [db, q]);
  return (
    <div className="addbar">
      <div className="row gap wrap">
        <input
          className="search-in"
          type="search"
          placeholder="Add from database: search brand / model…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Add item from database"
        />
        <button type="button" className={`btn ${custom ? 'on' : ''}`} onClick={() => setCustom((c) => !c)}>
          ＋ Custom item
        </button>
      </div>
      {res.length > 0 && (
        <div className="add-results">
          {res.map((it) => (
            <button
              key={it.id}
              type="button"
              className="add-res"
              onClick={() => {
                onAdd(newListItem(it.id));
                setQ('');
              }}
            >
              <span>＋ {it.name}</span>
              <span className="muted small">
                {db.catById.get(it.category)?.name} · {fmtW(it.weight_g, unit)} · {fmtPrice(it.price_usd)}
              </span>
            </button>
          ))}
        </div>
      )}
      {custom && (
        <CustomForm
          catOptions={catOptions}
          onAdd={(li) => {
            onAdd(li);
          }}
        />
      )}
    </div>
  );
}

function CustomForm({ onAdd, catOptions }: { onAdd: (li: ListItem) => void; catOptions: string[] }) {
  const { unit } = useStore();
  const [name, setName] = useState('');
  const [cat, setCat] = useState(catOptions[0] ?? 'Misc');
  const [w, setW] = useState('');
  const [p, setP] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const wg = Math.round(fromUnit(parseFloat(w) || 0, unit) * 10) / 10;
    const price = p.trim() ? parseFloat(p) : null;
    onAdd({
      uid: uid(),
      qty: 1,
      worn: false,
      consumable: false,
      custom: {
        name: name.trim(),
        category: cat.trim() || 'Misc',
        weight_g: wg,
        price_usd: Number.isFinite(price as number) ? price : null,
      },
    });
    setName('');
    setW('');
    setP('');
  };
  return (
    <form className="custom-form" onSubmit={submit}>
      <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Custom item name" required />
      <input
        placeholder="Category"
        value={cat}
        onChange={(e) => setCat(e.target.value)}
        list="cat-options"
        aria-label="Custom item category"
      />
      <input
        placeholder={`Weight (${unit})`}
        inputMode="decimal"
        value={w}
        onChange={(e) => setW(e.target.value)}
        aria-label="Custom item weight"
      />
      <input placeholder="Price $" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} aria-label="Custom item price" />
      <button type="submit" className="btn primary">
        Add
      </button>
    </form>
  );
}

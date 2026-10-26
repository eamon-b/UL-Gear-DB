import Papa from 'papaparse';
import type { DB, Item, ListItem, PackList } from './types';
import { resolve } from './lists';
import { fromUnit, toUnit, type Unit } from './units';
import { safeUrl, uid } from './util';

export const LP_COLUMNS = ['Item Name', 'Category', 'desc', 'qty', 'weight', 'unit', 'url', 'price', 'worn', 'consumable'];

export interface LPRow {
  name: string;
  category: string;
  desc: string;
  qty: number;
  weight_g: number;
  url: string;
  price: number | null;
  worn: boolean;
  consumable: boolean;
}

const UNIT_G: Record<string, number> = {
  g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.3495, ounce: 28.3495, ounces: 28.3495, lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
};
const truthy = (v: unknown) => {
  const s = String(v ?? '').trim().toLowerCase();
  return !!s && !['0', 'false', 'no', 'n', 'off'].includes(s);
};
const num = (v: unknown) => {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function parseLighterPackCSV(text: string): { rows: LPRow[]; errors: string[] } {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
  const errors = res.errors.slice(0, 5).map((e) => `Row ${e.row}: ${e.message}`);
  const fields = (res.meta.fields ?? []).map((f) => f.toLowerCase());
  const pick = (r: Record<string, string>, ...names: string[]) => {
    for (const n of names) {
      const k = Object.keys(r).find((x) => x.trim().toLowerCase() === n);
      if (k && r[k] != null) return String(r[k]).trim();
    }
    return '';
  };
  if (!fields.includes('item name') && !fields.includes('name')) errors.unshift('Missing "Item Name" column: is this a LighterPack CSV?');
  const rows: LPRow[] = [];
  for (const r of res.data) {
    const name = pick(r, 'item name', 'name');
    if (!name) continue;
    const unit = pick(r, 'unit').toLowerCase() || 'oz';
    const w = num(pick(r, 'weight')) ?? 0;
    const qty = num(pick(r, 'qty', 'quantity'));
    rows.push({
      name,
      category: pick(r, 'category') || 'Uncategorized',
      desc: pick(r, 'desc', 'description'),
      qty: qty == null ? 1 : Math.max(0, qty),
      weight_g: Math.round(w * (UNIT_G[unit] ?? 28.3495) * 10) / 10,
      url: safeUrl(pick(r, 'url')) ?? '',
      // LighterPack exports 0 for an unset price, so 0 means unknown, not free.
      price: num(pick(r, 'price')) || null,
      worn: truthy(pick(r, 'worn')),
      consumable: truthy(pick(r, 'consumable')),
    });
  }
  return { rows, errors };
}

const UNIT_LABEL: Record<Unit, string> = { g: 'g', oz: 'oz', lb: 'lb' };

export function exportLighterPackCSV(l: PackList, db: DB, unit: Unit): string {
  const data = l.items.map((li) => {
    const r = resolve(li, db);
    const w = toUnit(r.weight_g, unit);
    return [
      r.name,
      r.cat,
      li.custom?.desc ?? (r.item ? r.item.weight_note ?? '' : ''),
      li.qty,
      unit === 'g' ? Math.round(w) : Math.round(w * 100) / 100,
      UNIT_LABEL[unit],
      r.url ?? '',
      r.price_usd ?? '',
      li.worn ? 'Worn' : '',
      li.consumable ? 'Consumable' : '',
    ];
  });
  return Papa.unparse({ fields: LP_COLUMNS, data });
}

// ---------------- fuzzy matching ----------------
const STOP = new Set(['the', 'and', 'with', 'for', 'a', 'of', 'in', 'by', 'ul', 'ultralight', 'my', 'new', 'old', 'w', 'x']);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/°/g, '')
    .replace(/['’`]/g, '')
    .replace(/(\d)([a-z])/g, '$1 $2') // "55l" -> "55 l", "lt5" stays split below
    .replace(/([a-z])(\d)/g, '$1 $2')
    .split(/[^a-z0-9.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t && !STOP.has(t) && !/^[a-z]$/.test(t));
}

/** "Hyperlite Mountain Gear" -> "hmg" */
function acronym(brand: string) {
  const w = brand.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return w.length >= 2 ? w.map((x) => x[0]).join('') : null;
}

interface Indexed {
  it: Item;
  brand: string[];
  model: string[];
  variant: string[];
  joined: string;
  acr: string | null;
}

const indexCache = new WeakMap<DB, { list: Indexed[]; byTok: Map<string, Indexed[]> }>();
function getIndex(db: DB) {
  let ix = indexCache.get(db);
  if (!ix) {
    const list: Indexed[] = db.items.map((it) => {
      const brand = tokens(it.brand), model = tokens(it.model), variant = tokens(it.variant ?? '');
      return { it, brand, model, variant, joined: [...brand, ...model].join(''), acr: acronym(it.brand) };
    });
    const byTok = new Map<string, Indexed[]>();
    for (const e of list) {
      for (const t of new Set([...e.brand, ...e.model])) {
        const k = t.slice(0, 3);
        if (!byTok.has(k)) byTok.set(k, []);
        byTok.get(k)!.push(e);
      }
      if (e.acr) {
        const k = e.acr.slice(0, 3);
        if (!byTok.has(k)) byTok.set(k, []);
        byTok.get(k)!.push(e);
      }
    }
    ix = { list, byTok };
    indexCache.set(db, ix);
  }
  return ix;
}

function tokScore(t: string, qs: string[], qJoined: string): number {
  if (qs.includes(t)) return 1;
  // plural / prefix tolerance ("xlite" vs "xlites", "neo" prefix of "neoair")
  for (const q of qs) {
    if (q.length >= 3 && t.length >= 3 && (q.startsWith(t) || t.startsWith(q))) return 0.75;
  }
  if (t.length >= 3 && qJoined.includes(t)) return 0.7; // "x-mid" vs "xmid"
  return 0;
}

export interface Match {
  item: Item;
  score: number; // 0..1
}

/** Score an item name (+desc) against the DB. Brand + model token coverage, with a weight-proximity nudge. */
export function matchItem(name: string, desc: string, weightG: number | null, db: DB, top = 6): Match[] {
  const qs = tokens(`${name} ${desc}`);
  const qName = tokens(name);
  if (!qs.length) return [];
  const qJoined = qs.join('');
  const { byTok, list } = getIndex(db);
  const cands = new Set<Indexed>();
  for (const t of qs) for (const e of byTok.get(t.slice(0, 3)) ?? []) cands.add(e);
  if (cands.size === 0 && list.length < 400) list.forEach((e) => cands.add(e));
  const out: Match[] = [];
  for (const e of cands) {
    if (!e.model.length) continue;
    let bCov = e.brand.length ? e.brand.reduce((s, t) => s + tokScore(t, qs, qJoined), 0) / e.brand.length : 0;
    if (e.acr && qs.includes(e.acr)) bCov = 1;
    const mCov = e.model.reduce((s, t) => s + tokScore(t, qs, qJoined), 0) / e.model.length;
    if (mCov === 0) continue;
    const firstModel = tokScore(e.model[0], qs, qJoined);
    const vCov = e.variant.length ? e.variant.reduce((s, t) => s + tokScore(t, qs, qJoined), 0) / e.variant.length : 0;
    // fraction of the user's name tokens explained by this item
    const itemToks = [...e.brand, ...e.model, ...e.variant];
    if (e.acr) itemToks.push(e.acr);
    const explained = qName.length ? qName.filter((q) => itemToks.some((t) => t === q || (q.length >= 3 && t.length >= 3 && (t.startsWith(q) || q.startsWith(t))))).length / qName.length : 0;
    let s = 0.35 * mCov + 0.25 * explained + 0.2 * bCov + 0.12 * firstModel + 0.08 * vCov;
    if (e.joined.length >= 5 && qJoined.includes(e.joined)) s += 0.05;
    if (weightG && weightG > 0) {
      const ratio = Math.abs(e.it.weight_g - weightG) / Math.max(weightG, e.it.weight_g);
      s += ratio < 0.05 ? 0.06 : ratio < 0.15 ? 0.03 : ratio > 0.6 ? -0.1 : 0;
    }
    out.push({ item: e.it, score: s });
  }
  out.sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length);
  return out.slice(0, top).map((m) => ({ ...m, score: Math.max(0, Math.min(1, m.score)) }));
}

export const MATCH_THRESHOLD = 0.6;

export interface ReviewRow {
  row: LPRow;
  matches: Match[];
  choice: string; // item id or '' = custom
  keepWeight: boolean;
}

export function buildReview(rows: LPRow[], db: DB): ReviewRow[] {
  return rows.map((row) => {
    const matches = matchItem(row.name, row.desc, row.weight_g || null, db);
    const best = matches[0];
    return { row, matches, choice: best && best.score >= MATCH_THRESHOLD ? best.item.id : '', keepWeight: false };
  });
}

export function reviewToItems(rev: ReviewRow[]): ListItem[] {
  return rev.map(({ row, choice, keepWeight }) => {
    const base = { uid: uid(), qty: row.qty, worn: row.worn, consumable: row.consumable, cat: row.category };
    if (choice) {
      const li: ListItem = { ...base, dbId: choice };
      if (keepWeight && row.weight_g > 0) li.weight_g = Math.round(row.weight_g);
      return li;
    }
    return {
      ...base,
      custom: {
        name: row.name, category: row.category, weight_g: Math.round(row.weight_g), price_usd: row.price,
        ...(row.url ? { url: row.url } : {}), ...(row.desc ? { desc: row.desc } : {}),
      },
    };
  });
}

export { fromUnit };

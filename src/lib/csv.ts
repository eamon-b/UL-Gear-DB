import Papa from 'papaparse';
import type { DB, ListItem, PackList } from './types';
import { resolve } from './lists';
import { fromUnit, toUnit, type Unit } from './units';
import { safeUrl, uid } from './util';
import { matchItem, MATCH_THRESHOLD, type Match } from './match';

export { matchItem, MATCH_THRESHOLD, type Match };

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
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
  pounds: 453.592,
};
const truthy = (v: unknown) => {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return !!s && !['0', 'false', 'no', 'n', 'off'].includes(s);
};
const num = (v: unknown) => {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function parseLighterPackCSV(text: string): { rows: LPRow[]; errors: string[] } {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
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
      li.custom?.desc ?? (r.item ? (r.item.weight_note ?? '') : ''),
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
        name: row.name,
        category: row.category,
        weight_g: Math.round(row.weight_g),
        price_usd: row.price,
        ...(row.url ? { url: row.url } : {}),
        ...(row.desc ? { desc: row.desc } : {}),
      },
    };
  });
}

export { fromUnit };

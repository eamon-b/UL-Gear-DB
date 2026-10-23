export type SpecValue = number | string | boolean;
export type Confidence = 'high' | 'medium' | 'low';

export interface Category {
  id: string;
  name: string;
  group: string;
  subcategories: string[];
  count: number;
}

export interface Item {
  id: string;
  category: string;
  subcategory: string;
  brand: string;
  model: string;
  variant: string | null;
  weight_g: number;
  weight_basis: 'manufacturer' | 'measured' | 'estimate';
  weight_note: string | null;
  price_usd: number | null;
  specs: Record<string, SpecValue>;
  url: string | null;
  discontinued: boolean;
  confidence: Confidence;
  notes: string | null;
  /** derived */
  name: string;
  search: string;
}

export interface DB {
  generated_at: string;
  sample: boolean;
  categories: Category[];
  catById: Map<string, Category>;
  items: Item[];
  byId: Map<string, Item>;
  byCategory: Map<string, Item[]>;
}

export interface CustomItem {
  name: string;
  category: string;
  weight_g: number;
  price_usd: number | null;
  url?: string;
  desc?: string;
}

export interface ListItem {
  uid: string;
  dbId?: string;
  custom?: CustomItem;
  qty: number;
  worn: boolean;
  consumable: boolean;
  /** user section/category override (LighterPack style); defaults to DB category name */
  cat?: string;
  /** per-list overrides for DB items */
  weight_g?: number;
  price_usd?: number | null;
  note?: string;
}

export interface PackList {
  id: string;
  name: string;
  items: ListItem[];
  created: number;
  updated: number;
}

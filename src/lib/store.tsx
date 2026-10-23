import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DB, ListItem, PackList } from './types';
import type { Unit } from './units';
import { loadLS, saveLS, uid } from './util';

export type Theme = 'auto' | 'light' | 'dark';
export const MAX_COMPARE = 6;

interface ListsState {
  lists: PackList[];
  activeId: string | null;
}

interface Store {
  db: DB;
  unit: Unit;
  setUnit: (u: Unit) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  compare: string[];
  toggleCompare: (id: string) => void;
  clearCompare: () => void;
  lists: PackList[];
  activeList: PackList | null;
  setActiveList: (id: string) => void;
  createList: (name?: string, items?: ListItem[]) => PackList;
  updateList: (id: string, fn: (l: PackList) => PackList) => void;
  deleteList: (id: string) => void;
  addToList: (dbId: string, listId?: string) => void;
  toast: (msg: string) => void;
  openItem: (id: string | null) => void;
  openItemId: string | null;
}

const Ctx = createContext<Store | null>(null);

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('store missing');
  return s;
}

export function newListItem(dbId: string, extra: Partial<ListItem> = {}): ListItem {
  return { uid: uid(), dbId, qty: 1, worn: false, consumable: false, ...extra };
}

export function StoreProvider({ db, children }: { db: DB; children: ReactNode }) {
  const [unit, setUnitS] = useState<Unit>(() => loadLS<Unit>('ulgdb.unit', 'g'));
  const [theme, setThemeS] = useState<Theme>(() => loadLS<Theme>('ulgdb.themeMode', 'auto'));
  const [compare, setCompare] = useState<string[]>(() => loadLS<string[]>('ulgdb.compare', []).filter((id) => db.byId.has(id)));
  const [ls, setLs] = useState<ListsState>(() => loadLS<ListsState>('ulgdb.lists', { lists: [], activeId: null }));
  const [toasts, setToasts] = useState<{ id: string; msg: string }[]>([]);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const setUnit = useCallback((u: Unit) => { setUnitS(u); saveLS('ulgdb.unit', u); }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeS(t);
    saveLS('ulgdb.themeMode', t);
    try {
      if (t === 'auto') localStorage.removeItem('ulgdb.theme');
      else localStorage.setItem('ulgdb.theme', t);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => saveLS('ulgdb.compare', compare), [compare]);
  useEffect(() => saveLS('ulgdb.lists', ls), [ls]);
  // keep tabs in sync
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === 'ulgdb.lists' && e.newValue) {
        try { setLs(JSON.parse(e.newValue)); } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);

  const toast = useCallback((msg: string) => {
    const id = uid();
    setToasts((t) => [...t.slice(-3), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const toggleCompare = useCallback((id: string) => {
    setCompare((c) => {
      if (c.includes(id)) return c.filter((x) => x !== id);
      if (c.length >= MAX_COMPARE) {
        toast(`Compare holds up to ${MAX_COMPARE} items`);
        return c;
      }
      return [...c, id];
    });
  }, [toast]);

  const lsRef = useRef(ls);
  lsRef.current = ls;

  const createList = useCallback((name?: string, items: ListItem[] = []) => {
    const now = Date.now();
    const l: PackList = { id: uid(), name: name || `My list ${lsRef.current.lists.length + 1}`, items, created: now, updated: now };
    setLs((s) => ({ lists: [...s.lists, l], activeId: l.id }));
    return l;
  }, []);

  const updateList = useCallback((id: string, fn: (l: PackList) => PackList) => {
    setLs((s) => ({ ...s, lists: s.lists.map((l) => (l.id === id ? { ...fn(l), updated: Date.now() } : l)) }));
  }, []);

  const deleteList = useCallback((id: string) => {
    setLs((s) => {
      const lists = s.lists.filter((l) => l.id !== id);
      return { lists, activeId: s.activeId === id ? lists[0]?.id ?? null : s.activeId };
    });
  }, []);

  const setActiveList = useCallback((id: string) => setLs((s) => ({ ...s, activeId: id })), []);

  const addToList = useCallback((dbId: string, listId?: string) => {
    const s = lsRef.current;
    let target = s.lists.find((l) => l.id === (listId ?? s.activeId)) ?? s.lists[0];
    const item = db.byId.get(dbId);
    if (!target) {
      target = createList('My first list', [newListItem(dbId)]);
    } else {
      const existing = target.items.find((li) => li.dbId === dbId);
      const tid = target.id;
      setLs((st) => ({
        activeId: st.activeId ?? tid,
        lists: st.lists.map((l) =>
          l.id !== tid
            ? l
            : {
                ...l,
                updated: Date.now(),
                items: existing
                  ? l.items.map((li) => (li.uid === existing.uid ? { ...li, qty: li.qty + 1 } : li))
                  : [...l.items, newListItem(dbId)],
              },
        ),
      }));
    }
    toast(`Added ${item?.name ?? dbId} to "${target.name}"`);
  }, [db, createList, toast]);

  const activeList = ls.lists.find((l) => l.id === ls.activeId) ?? ls.lists[0] ?? null;

  const value = useMemo<Store>(() => ({
    db, unit, setUnit, theme, setTheme, compare, toggleCompare, clearCompare: () => setCompare([]),
    lists: ls.lists, activeList, setActiveList, createList, updateList, deleteList, addToList, toast,
    openItem: setOpenItemId, openItemId,
  }), [db, unit, setUnit, theme, setTheme, compare, toggleCompare, ls.lists, activeList, setActiveList, createList, updateList, deleteList, addToList, toast, openItemId]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>
    </Ctx.Provider>
  );
}

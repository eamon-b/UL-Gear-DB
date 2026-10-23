import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type Theme } from '../lib/store';
import { href, navigate } from '../lib/router';
import { searchItems } from '../lib/data';
import { fmtW, type Unit } from '../lib/units';
import { fmtPrice } from '../lib/util';

export function Header({ section }: { section: string }) {
  const { unit, setUnit, theme, setTheme, lists } = useStore();
  const next: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };
  return (
    <header className="topbar">
      <a className="logo" href={href('/')}>
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden><path d="M1 14 6 4l3 5 2-3 4 8z" fill="currentColor" /></svg>
        <span>UL Gear DB</span>
      </a>
      <nav className="mainnav">
        <a href={href('/')} className={section === 'browse' ? 'on' : ''}>Browse</a>
        <a href={href('/lists')} className={section === 'lists' ? 'on' : ''}>Lists{lists.length ? <span className="pill">{lists.length}</span> : null}</a>
        <a href={href('/compare')} className={section === 'compare' ? 'on' : ''}>Compare</a>
        <a href={href('/about')} className={section === 'about' ? 'on' : ''}>About</a>
      </nav>
      <QuickSearch />
      <div className="seg unit-seg" role="group" aria-label="Weight unit">
        {(['g', 'oz', 'lb'] as Unit[]).map((u) => (
          <button key={u} type="button" className={`seg-opt ${unit === u ? 'on' : ''}`} onClick={() => setUnit(u)}>{u}</button>
        ))}
      </div>
      <button type="button" className="icon-btn theme-btn" onClick={() => setTheme(next[theme])} title={`Theme: ${theme} (click to change)`} aria-label={`Theme: ${theme}`}>
        <ThemeIcon t={theme} />
      </button>
    </header>
  );
}

function QuickSearch() {
  const { db, unit, openItem } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const res = useMemo(() => (q.trim().length >= 2 ? searchItems(db.items, q, 8) : []), [db, q]);
  useEffect(() => setHi(0), [q]);
  useEffect(() => {
    const on = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        ref.current?.querySelector('input')?.focus();
      }
    };
    document.addEventListener('mousedown', on);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', key); };
  }, []);
  const go = () => { setOpen(false); navigate(`/search?q=${encodeURIComponent(q)}`); };
  return (
    <div className="qsearch" ref={ref}>
      <input
        type="search" placeholder="Search all gear  ( / )" value={q} aria-label="Search all gear"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, res.length)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === 'Enter') {
            if (hi < res.length && res[hi]) { openItem(res[hi].id); setOpen(false); setQ(''); } else go();
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && res.length > 0 && (
        <div className="qs-pop">
          {res.map((it, i) => (
            <button key={it.id} type="button" className={`qs-item ${i === hi ? 'hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => { openItem(it.id); setOpen(false); setQ(''); }}>
              <span>{it.name}</span>
              <span className="muted small">{db.catById.get(it.category)?.name} · {fmtW(it.weight_g, unit)} · {fmtPrice(it.price_usd)}</span>
            </button>
          ))}
          <button type="button" className={`qs-item all ${hi === res.length ? 'hi' : ''}`} onClick={go}>See all results for “{q}” →</button>
        </div>
      )}
    </div>
  );
}

function ThemeIcon({ t }: { t: Theme }) {
  if (t === 'light')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" />
      </svg>
    );
  if (t === 'dark')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="currentColor">
        <path d="M13.5 10.5A6 6 0 0 1 5.5 2.5a6 6 0 1 0 8 8z" />
      </svg>
    );
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
    </svg>
  );
}

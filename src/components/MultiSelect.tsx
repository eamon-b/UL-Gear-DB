import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  label: string;
  options: { v: string; n?: number }[];
  value: string[];
  onChange: (v: string[]) => void;
}

export function MultiSelect({ label, options, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [open]);
  const shown = useMemo(() => {
    const t = q.toLowerCase();
    return t ? options.filter((o) => o.v.toLowerCase().includes(t)) : options;
  }, [options, q]);
  const set = new Set(value);
  const toggle = (v: string) => onChange(set.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="ms" ref={ref}>
      <button type="button" className={`ms-btn ${value.length ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ms-label">{label}</span>
        <span className="ms-val">{value.length === 0 ? 'Any' : value.length === 1 ? value[0] : `${value.length} selected`}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="ms-pop">
          {options.length > 8 && (
            <input className="ms-search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          )}
          <div className="ms-actions">
            <button type="button" className="link" onClick={() => onChange([])}>
              Clear
            </button>
            {shown.length > 1 && (
              <button type="button" className="link" onClick={() => onChange([...new Set([...value, ...shown.map((o) => o.v)])])}>
                All shown
              </button>
            )}
          </div>
          <div className="ms-list">
            {shown.map((o) => (
              <label key={o.v} className="ms-opt">
                <input type="checkbox" checked={set.has(o.v)} onChange={() => toggle(o.v)} />
                <span>{o.v}</span>
                {o.n != null && <span className="muted">{o.n}</span>}
              </label>
            ))}
            {!shown.length && <div className="muted pad">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

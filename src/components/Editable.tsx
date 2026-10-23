import { useEffect, useState } from 'react';

/** Inline text/number input that commits on blur or Enter. */
export function EditText({ value, onCommit, className, placeholder, list, ariaLabel }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string; list?: string; ariaLabel?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className={`inline ${className ?? ''}`} value={v} placeholder={placeholder} list={list} aria-label={ariaLabel}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value); } }}
    />
  );
}

export function EditNum({ value, onCommit, className, step, min, ariaLabel, title }: { value: number | null; onCommit: (v: number | null) => void; className?: string; step?: number; min?: number; ariaLabel?: string; title?: string }) {
  const s = value == null ? '' : String(value);
  const [v, setV] = useState(s);
  useEffect(() => setV(s), [s]);
  const commit = () => {
    if (v === s) return;
    if (v.trim() === '') return onCommit(null);
    const n = parseFloat(v);
    if (Number.isFinite(n)) onCommit(min != null ? Math.max(min, n) : n);
    else setV(s);
  };
  return (
    <input
      className={`inline num ${className ?? ''}`} inputMode="decimal" value={v} step={step} aria-label={ariaLabel} title={title}
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(s); }}
    />
  );
}

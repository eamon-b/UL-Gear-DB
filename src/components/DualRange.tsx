import { useEffect, useState } from 'react';

interface Props {
  min: number;
  max: number;
  step?: number;
  lo: number | null;
  hi: number | null;
  onChange: (lo: number | null, hi: number | null) => void;
  format: (v: number) => string;
  label?: string;
}

/** Two overlaid native range inputs. null = unbounded on that side. */
export function DualRange({ min, max, step, lo, hi, onChange, format, label }: Props) {
  const st = step ?? niceStep(min, max);
  const [a, setA] = useState(lo ?? min);
  const [b, setB] = useState(hi ?? max);
  useEffect(() => {
    setA(lo ?? min);
    setB(hi ?? max);
  }, [lo, hi, min, max]);
  if (!(max > min)) return null;
  const commit = (na: number, nb: number) => {
    onChange(na <= min ? null : na, nb >= max ? null : nb);
  };
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  return (
    <div className="dual-range">
      <div className="dr-values">
        <span>{format(a)}</span>
        <span>{format(b)}</span>
      </div>
      <div className="dr-track">
        <div className="dr-fill" style={{ left: `${pct(a)}%`, right: `${100 - pct(b)}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={st}
          value={a}
          aria-label={`${label ?? ''} minimum`}
          onChange={(e) => {
            const v = Math.min(Number(e.target.value), b);
            setA(v);
            commit(v, b);
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={st}
          value={b}
          aria-label={`${label ?? ''} maximum`}
          onChange={(e) => {
            const v = Math.max(Number(e.target.value), a);
            setB(v);
            commit(a, v);
          }}
        />
      </div>
    </div>
  );
}

function niceStep(min: number, max: number) {
  const span = max - min;
  if (span <= 1) return 0.05;
  if (span <= 10) return 0.1;
  if (span <= 100) return 1;
  return Math.max(1, Math.round(span / 200));
}

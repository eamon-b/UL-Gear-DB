import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { buildReview, MATCH_THRESHOLD, parseLighterPackCSV, reviewToItems, type ReviewRow } from '../lib/csv';
import type { ListItem } from '../lib/types';
import { fmtW } from '../lib/units';
import { fmtPrice } from '../lib/util';

interface Props {
  text: string;
  fileName: string;
  canAppend: boolean;
  onDone: (items: ListItem[], mode: 'new' | 'append', name: string) => void;
  onClose: () => void;
}

export function ImportReview({ text, fileName, canAppend, onDone, onClose }: Props) {
  const { db, unit } = useStore();
  const parsed = useMemo(() => parseLighterPackCSV(text), [text]);
  const [rows, setRows] = useState<ReviewRow[]>(() => buildReview(parsed.rows, db));
  const [name, setName] = useState(fileName.replace(/\.csv$/i, '') || 'Imported list');
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  const matched = rows.filter((r) => r.choice).length;
  const set = (i: number, p: Partial<ReviewRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const setAll = (fn: (r: ReviewRow) => Partial<ReviewRow>) => setRows((rs) => rs.map((r) => ({ ...r, ...fn(r) })));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-label="Review LighterPack import" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <div className="muted small">LighterPack CSV import · {fileName}</div>
            <h2>Review matches <span className="muted">{matched} of {rows.length} matched to the database</span></h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="modal-body">
          {parsed.errors.length > 0 && <div className="warn small">{parsed.errors.map((e) => <div key={e}>{e}</div>)}</div>}
          <div className="row gap wrap">
            <label>List name <input value={name} onChange={(e) => setName(e.target.value)} aria-label="List name" /></label>
            <button type="button" className="btn small" onClick={() => setAll((r) => ({ choice: r.matches[0] && r.matches[0].score >= MATCH_THRESHOLD ? r.matches[0].item.id : '' }))}>Auto (≥{Math.round(MATCH_THRESHOLD * 100)}%)</button>
            <button type="button" className="btn small" onClick={() => setAll(() => ({ choice: '' }))}>All custom</button>
            <button type="button" className="btn small" onClick={() => setAll((r) => ({ keepWeight: !!r.choice }))}>Keep my weights for all</button>
          </div>
          <div className="table-wrap">
            <table className="gear import">
              <thead>
                <tr><th>Your item</th><th>Category</th><th className="num">Your wt</th><th>Match</th><th className="num">Score</th><th className="num">DB wt</th><th title="Keep the weight from the CSV instead of the DB weight">Keep my wt</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const chosen = r.matches.find((m) => m.item.id === r.choice);
                  const score = chosen?.score ?? r.matches[0]?.score ?? 0;
                  return (
                    <tr key={i} className={r.choice ? '' : 'is-custom'}>
                      <td>{r.row.name}{r.row.desc && <div className="muted small">{r.row.desc}</div>}<div className="muted small">qty {r.row.qty}{r.row.worn ? ' · worn' : ''}{r.row.consumable ? ' · consumable' : ''}</div></td>
                      <td className="muted">{r.row.category}</td>
                      <td className="num">{fmtW(r.row.weight_g, unit)}</td>
                      <td>
                        <select value={r.choice} onChange={(e) => set(i, { choice: e.target.value })} aria-label={`Match for ${r.row.name}`}>
                          <option value="">Keep as custom item</option>
                          {r.matches.map((m) => (
                            <option key={m.item.id} value={m.item.id}>{m.item.name} ({Math.round(m.score * 100)}%) · {fmtW(m.item.weight_g, unit)} · {fmtPrice(m.item.price_usd)}</option>
                          ))}
                        </select>
                      </td>
                      <td className="num"><span className={`score ${score >= 0.8 ? 'hi' : score >= MATCH_THRESHOLD ? 'mid' : 'lo'}`}>{r.matches.length ? Math.round(score * 100) + '%' : '–'}</span></td>
                      <td className="num">{chosen ? fmtW(chosen.item.weight_g, unit) : ''}</td>
                      <td className="center"><input type="checkbox" disabled={!r.choice} checked={r.keepWeight && !!r.choice} onChange={(e) => set(i, { keepWeight: e.target.checked })} aria-label="Keep my weight" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          {canAppend && <button type="button" className="btn" onClick={() => onDone(reviewToItems(rows), 'append', name)}>Append to current list</button>}
          <button type="button" className="btn primary" disabled={!rows.length} onClick={() => onDone(reviewToItems(rows), 'new', name)}>Import as new list</button>
        </footer>
      </div>
    </div>
  );
}

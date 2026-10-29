import { useEffect } from 'react';
import { useStore } from '../lib/store';
import type { Item, ListItem } from '../lib/types';
import { fmtW } from '../lib/units';
import { fmtPrice } from '../lib/util';
import { BrowsePanel } from './BrowsePanel';

export function AlternativesPanel({
  current,
  listItem,
  onClose,
  onSwap,
}: {
  current: Item;
  listItem: ListItem;
  onClose: () => void;
  onSwap: (it: Item) => void;
}) {
  const { db, unit, toast } = useStore();
  const cat = db.catById.get(current.category);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', on);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);
  if (!cat) return null;
  const curW = listItem.weight_g ?? current.weight_g;
  const curP = listItem.price_usd !== undefined ? listItem.price_usd : current.price_usd;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-label={`Alternatives to ${current.name}`} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <div className="muted small">Alternatives in {cat.name}</div>
            <h2>
              {current.name}{' '}
              <span className="muted">
                {fmtW(curW, unit)} · {fmtPrice(curP)}
              </span>
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <BrowsePanel
            category={cat}
            refItem={current}
            onSwap={(it) => {
              const d = it.weight_g - curW;
              onSwap(it);
              toast(`Swapped to ${it.name} (${d <= 0 ? '−' : '+'}${fmtW(Math.abs(d), unit)})`);
            }}
          />
        </div>
      </div>
    </div>
  );
}

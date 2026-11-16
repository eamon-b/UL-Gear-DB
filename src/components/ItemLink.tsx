import type { MouseEvent, ReactNode } from 'react';
import { useStore } from '../lib/store';
import { isPlainClick, itemHref } from '../lib/router';

/**
 * An item name: a real link to /item/<id> (crawlers, open in new tab, modifier clicks),
 * while a plain click opens the quick-look drawer as before.
 */
export function ItemLink({ id, className = 'item-link', children }: { id: string; className?: string; children: ReactNode }) {
  const { openItem } = useStore();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    openItem(id);
  };
  return (
    <a className={className} href={itemHref(id)} onClick={onClick}>
      {children}
    </a>
  );
}

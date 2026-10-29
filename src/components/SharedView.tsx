import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { decodeList } from '../lib/lists';
import { navigate, href } from '../lib/router';
import { uid } from '../lib/util';
import { ListEditor } from './ListEditor';

export function SharedView({ data }: { data: string }) {
  const { createList, toast } = useStore();
  const list = useMemo(() => decodeList(data), [data]);
  if (!list) {
    return (
      <div className="page">
        <h1>Shared list</h1>
        <p className="warn">This share link is invalid or truncated.</p>
        <a href={href('/lists')}>Go to my lists</a>
      </div>
    );
  }
  return (
    <div className="page">
      <div className="list-head">
        <div>
          <div className="muted small">Shared list · read-only</div>
          <h1 className="list-title-ro">{list.name}</h1>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            const l = createList(
              list.name,
              list.items.map((i) => ({ ...i, uid: uid() })),
            );
            toast(`Copied "${list.name}" to your lists`);
            navigate(`/lists/${l.id}`);
          }}
        >
          Copy to my lists
        </button>
      </div>
      <ListEditor list={list} readOnly />
    </div>
  );
}

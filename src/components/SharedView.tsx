import { useEffect, useMemo, useState } from 'react';
import { sanitizeLists, useStore } from '../lib/store';
import { decodeList } from '../lib/lists';
import { api, ApiError } from '../lib/api';
import { navigate, href } from '../lib/router';
import { uid } from '../lib/util';
import type { PackList } from '../lib/types';
import { ListEditor } from './ListEditor';

/** `/share#<data>`: the whole list is in the link. */
export function SharedView({ data }: { data: string }) {
  const list = useMemo(() => decodeList(data), [data]);
  if (!list) return <Problem text="This share link is invalid or truncated." />;
  return <Shared list={list} note="Shared list · read-only" />;
}

/** `/l/<id>`: a short link; the list comes from the server. */
export function SharedLinkView({ id }: { id: string }) {
  const [state, setState] = useState<{ id: string; list?: PackList; live?: boolean; error?: string } | null>(null);
  useEffect(() => {
    let stale = false;
    api.shared(id).then(
      (s) => {
        // untrusted, like a list decoded from a link
        const [list] = sanitizeLists({ lists: [{ id: 'shared', name: s.name, items: s.items, updated: s.updated }] }).lists;
        if (!stale) setState(list ? { id, list, live: s.live } : { id, error: 'This shared list could not be read.' });
      },
      (e) => {
        const gone = e instanceof ApiError && e.status === 404;
        if (!stale)
          setState({
            id,
            error: gone
              ? 'This shared list does not exist. The owner may have stopped sharing it.'
              : e instanceof ApiError && e.code === 'no_backend'
                ? 'Short share links are not available on this copy of the site.'
                : 'Could not load the shared list. Check your connection and try again.',
          });
      },
    );
    return () => {
      stale = true;
    };
  }, [id]);
  if (state?.id !== id) return <div className="loading">Loading shared list…</div>;
  if (!state.list) return <Problem text={state.error ?? ''} />;
  return <Shared list={state.list} note={state.live ? 'Shared list · read-only · shows the current version' : 'Shared list · read-only'} />;
}

function Problem({ text }: { text: string }) {
  return (
    <div className="page">
      <h1>Shared list</h1>
      <p className="warn">{text}</p>
      <a href={href('/lists')}>Go to my lists</a>
    </div>
  );
}

function Shared({ list, note }: { list: PackList; note: string }) {
  const { createList, toast } = useStore();
  return (
    <div className="page">
      <div className="list-head">
        <div>
          <div className="muted small">{note}</div>
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

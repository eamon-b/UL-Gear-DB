import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { shareUrl } from '../lib/lists';
import { shareLinkUrl, summarize, useAccount } from '../lib/account';
import { api } from '../lib/api';
import { useSyncLine } from './AccountMenu';
import { exportLighterPackCSV } from '../lib/csv';
import { download, loadLS, saveLS, uid } from '../lib/util';
import { href, navigate } from '../lib/router';
import { ListEditor } from './ListEditor';
import { ImportReview } from './ImportReview';
import { EditText } from './Editable';

export function ListsPage({ listId }: { listId?: string }) {
  const { db, unit, lists, activeList, setActiveList, createList, updateList, deleteList, toast } = useStore();
  const [importing, setImporting] = useState<{ text: string; name: string } | null>(null);
  const account = useAccount();
  const syncLine = useSyncLine();
  const [shared, setShared] = useState<{ listId: string; url: string; kind: 'long' | 'snapshot' | 'live' } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(() => loadLS('ulgdb.listsSideCollapsed', false));
  const toggleSide = () =>
    setSideCollapsed((c) => {
      saveLS('ulgdb.listsSideCollapsed', !c);
      return !c;
    });
  const fileRef = useRef<HTMLInputElement>(null);
  const list = (listId && lists.find((l) => l.id === listId)) || activeList;
  useEffect(() => {
    if (list && activeList?.id !== list.id) setActiveList(list.id);
  }, [list, activeList, setActiveList]);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    f.text().then((text) => setImporting({ text, name: f.name }));
    if (fileRef.current) fileRef.current.value = '';
  };

  const share = async () => {
    if (!list) return;
    // Best link available: a live one for a signed-in user, a short snapshot when there is a
    // server, and the self-contained long link otherwise (or when the server can't be reached).
    let url: string | null = null;
    let kind: 'long' | 'snapshot' | 'live' = 'long';
    setSharing(true);
    if (account.user) {
      try {
        url = await account.publish(list.id);
        kind = 'live';
      } catch {
        /* fall through */
      }
    }
    if (!url && account.backend) {
      try {
        url = shareLinkUrl((await api.share(list.name, list.items, summarize(list, db))).id);
        kind = 'snapshot';
      } catch {
        /* fall through */
      }
    }
    setSharing(false);
    url ??= shareUrl(list);
    setShared({ listId: list.id, url, kind });
    try {
      await navigator.clipboard.writeText(url);
      toast('Share link copied to clipboard');
    } catch {
      toast('Share link ready below');
    }
  };
  const stopSharing = async () => {
    if (!list) return;
    try {
      await account.unpublish(list.id);
      setShared(null);
      toast('Stopped sharing: the link no longer works');
    } catch {
      toast('Could not stop sharing. Try again.');
    }
  };
  // The box belongs to the list it was made for. A list that is already published shows its link.
  const liveId = list ? account.shares[list.id] : undefined;
  const shareBox = shared && shared.listId === list?.id && (shared.kind !== 'live' || liveId) ? shared : null;

  return (
    <div className={`lists-layout ${sideCollapsed ? 'side-collapsed' : ''}`}>
      <aside className={`lists-side ${sideCollapsed ? 'collapsed' : ''}`}>
        <div className="row side-head">
          <button
            type="button"
            className="icon-btn tiny side-toggle"
            onClick={toggleSide}
            title={sideCollapsed ? 'Show lists' : 'Hide lists'}
            aria-label={sideCollapsed ? 'Show lists' : 'Hide lists'}
            aria-expanded={!sideCollapsed}
          >
            {sideCollapsed ? '»' : '«'}
          </button>
          <strong>My lists</strong>
          <button
            type="button"
            className="btn small primary"
            onClick={() => {
              const l = createList();
              navigate(`/lists/${l.id}`);
            }}
          >
            ＋ New
          </button>
        </div>
        <nav className="list-nav">
          {lists.map((l) => (
            <a key={l.id} href={href(`/lists/${l.id}`)} className={list?.id === l.id ? 'on' : ''} onClick={() => setActiveList(l.id)}>
              <span>{l.name}</span>
              <span className="muted">{l.items.length}</span>
            </a>
          ))}
          {!lists.length && <div className="muted small pad">No lists yet.</div>}
        </nav>
        <label className="btn small wide file-btn">
          Import LighterPack CSV
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0])}
            hidden
            data-testid="csv-input"
          />
        </label>
        <a className="btn small wide" href={href('/examples')}>
          Browse example lists
        </a>
        {account.user ? (
          <p className="muted small" data-testid="lists-where">
            {syncLine}. Signed in as {account.user.email}.
          </p>
        ) : (
          <p className="muted small" data-testid="lists-where">
            Lists are stored in this browser (localStorage). Use Share or Export to back them up
            {account.canSignIn ? (
              <>
                , or{' '}
                <button type="button" className="link" onClick={() => account.setSignInOpen(true)}>
                  sign in
                </button>{' '}
                to sync them across your devices.
              </>
            ) : (
              '.'
            )}
          </p>
        )}
      </aside>
      <div className="lists-main">
        {!list ? (
          <div className="empty-state">
            <h1>Pack lists</h1>
            <p className="muted">
              Build a gear list from the database, track base / worn / consumable weight, find lighter swaps, and share it with a link.
            </p>
            <div className="row gap">
              <button type="button" className="btn primary" onClick={() => createList()}>
                Create a list
              </button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                Import LighterPack CSV
              </button>
              <a className="btn" href={href('/examples')}>
                Start from an example
              </a>
            </div>
          </div>
        ) : (
          <>
            <div className="list-head">
              <EditText
                value={list.name}
                className="list-title"
                ariaLabel="List name"
                onCommit={(v) => updateList(list.id, (l) => ({ ...l, name: v.trim() || l.name }))}
              />
              <div className="row gap wrap">
                <button type="button" className="btn primary" onClick={share} disabled={sharing}>
                  Share link
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => download(`${list.name.replace(/[^\w-]+/g, '_')}.csv`, exportLighterPackCSV(list, db, unit), 'text/csv')}
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const l = createList(
                      `${list.name} (copy)`,
                      list.items.map((i) => ({ ...i, uid: uid() })),
                    );
                    navigate(`/lists/${l.id}`);
                  }}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="btn ghost danger"
                  onClick={() => {
                    if (confirm(`Delete "${list.name}"?`)) {
                      deleteList(list.id);
                      navigate('/lists');
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
            {shareBox && (
              <div className="share-wrap">
                <div className="share-box">
                  <input
                    readOnly
                    value={shareBox.url}
                    onFocus={(e) => e.target.select()}
                    aria-label="Share link"
                    data-testid="share-link"
                  />
                  <a className="btn small" href={shareBox.url} target="_blank" rel="noopener noreferrer">
                    Open
                  </a>
                  {shareBox.kind === 'live' && (
                    <button type="button" className="btn small" onClick={stopSharing}>
                      Stop sharing
                    </button>
                  )}
                  <button type="button" className="icon-btn" onClick={() => setShared(null)} aria-label="Close">
                    ✕
                  </button>
                </div>
                {shareBox.kind === 'live' && (
                  <p className="muted small" data-testid="share-note">
                    Anyone with this link sees the list as it is now, including changes you make later.
                  </p>
                )}
                {shareBox.kind === 'snapshot' && (
                  <p className="muted small" data-testid="share-note">
                    This link shows the list as it is right now. Later changes need a new link
                    {account.canSignIn ? (
                      <>
                        ;{' '}
                        <button type="button" className="link" onClick={() => account.setSignInOpen(true)}>
                          sign in
                        </button>{' '}
                        to share one link that stays up to date.
                      </>
                    ) : (
                      '.'
                    )}
                  </p>
                )}
              </div>
            )}
            <ListEditor list={list} onChange={(fn) => updateList(list.id, fn)} />
          </>
        )}
      </div>
      {importing && (
        <ImportReview
          text={importing.text}
          fileName={importing.name}
          canAppend={!!list}
          onClose={() => setImporting(null)}
          onDone={(items, mode, name) => {
            if (mode === 'append' && list) {
              updateList(list.id, (l) => ({ ...l, items: [...l.items, ...items] }));
              toast(`Appended ${items.length} items`);
            } else {
              const l = createList(name, items);
              navigate(`/lists/${l.id}`);
              toast(`Imported ${items.length} items into "${name}"`);
            }
            setImporting(null);
          }}
        />
      )}
    </div>
  );
}

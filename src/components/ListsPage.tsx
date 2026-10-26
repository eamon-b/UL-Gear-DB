import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { shareUrl } from '../lib/lists';
import { exportLighterPackCSV } from '../lib/csv';
import { download, loadLS, saveLS, uid } from '../lib/util';
import { href, navigate } from '../lib/router';
import { ListEditor } from './ListEditor';
import { ImportReview } from './ImportReview';
import { EditText } from './Editable';

export function ListsPage({ listId }: { listId?: string }) {
  const { db, unit, lists, activeList, setActiveList, createList, updateList, deleteList, toast } = useStore();
  const [importing, setImporting] = useState<{ text: string; name: string } | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [sideCollapsed, setSideCollapsed] = useState(() => loadLS('ulgdb.listsSideCollapsed', false));
  const toggleSide = () => setSideCollapsed((c) => { saveLS('ulgdb.listsSideCollapsed', !c); return !c; });
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
    const url = shareUrl(list);
    setShareLink(url);
    try {
      await navigator.clipboard.writeText(url);
      toast('Share link copied to clipboard');
    } catch {
      toast('Share link ready below');
    }
  };

  return (
    <div className={`lists-layout ${sideCollapsed ? 'side-collapsed' : ''}`}>
      <aside className={`lists-side ${sideCollapsed ? 'collapsed' : ''}`}>
        <div className="row side-head">
          <button type="button" className="icon-btn tiny side-toggle" onClick={toggleSide} title={sideCollapsed ? 'Show lists' : 'Hide lists'} aria-label={sideCollapsed ? 'Show lists' : 'Hide lists'} aria-expanded={!sideCollapsed}>{sideCollapsed ? '»' : '«'}</button>
          <strong>My lists</strong>
          <button type="button" className="btn small primary" onClick={() => { const l = createList(); navigate(`/lists/${l.id}`); }}>＋ New</button>
        </div>
        <nav className="list-nav">
          {lists.map((l) => (
            <a key={l.id} href={href(`/lists/${l.id}`)} className={list?.id === l.id ? 'on' : ''} onClick={() => setActiveList(l.id)}>
              <span>{l.name}</span><span className="muted">{l.items.length}</span>
            </a>
          ))}
          {!lists.length && <div className="muted small pad">No lists yet.</div>}
        </nav>
        <label className="btn small wide file-btn">
          Import LighterPack CSV
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} hidden data-testid="csv-input" />
        </label>
        <a className="btn small wide" href={href('/examples')}>Browse example lists</a>
        <p className="muted small">Lists are stored in this browser (localStorage). Use Share or Export to back them up.</p>
      </aside>
      <div className="lists-main">
        {!list ? (
          <div className="empty-state">
            <h1>Pack lists</h1>
            <p className="muted">Build a gear list from the database, track base / worn / consumable weight, find lighter swaps, and share it with a link.</p>
            <div className="row gap">
              <button type="button" className="btn primary" onClick={() => createList()}>Create a list</button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Import LighterPack CSV</button>
              <a className="btn" href={href('/examples')}>Start from an example</a>
            </div>
          </div>
        ) : (
          <>
            <div className="list-head">
              <EditText value={list.name} className="list-title" ariaLabel="List name" onCommit={(v) => updateList(list.id, (l) => ({ ...l, name: v.trim() || l.name }))} />
              <div className="row gap wrap">
                <button type="button" className="btn primary" onClick={share}>Share link</button>
                <button type="button" className="btn" onClick={() => download(`${list.name.replace(/[^\w-]+/g, '_')}.csv`, exportLighterPackCSV(list, db, unit), 'text/csv')}>Export CSV</button>
                <button type="button" className="btn" onClick={() => { const l = createList(`${list.name} (copy)`, list.items.map((i) => ({ ...i, uid: uid() }))); navigate(`/lists/${l.id}`); }}>Duplicate</button>
                <button type="button" className="btn ghost danger" onClick={() => { if (confirm(`Delete "${list.name}"?`)) { deleteList(list.id); navigate('/lists'); } }}>Delete</button>
              </div>
            </div>
            {shareLink && (
              <div className="share-box">
                <input readOnly value={shareLink} onFocus={(e) => e.target.select()} aria-label="Share link" data-testid="share-link" />
                <a className="btn small" href={shareLink.slice(shareLink.indexOf('#'))} target="_blank" rel="noopener noreferrer">Open</a>
                <button type="button" className="icon-btn" onClick={() => setShareLink(null)} aria-label="Close">✕</button>
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

import { useEffect, useState, type FormEvent } from 'react';
import { shareLinkUrl, useAccount } from '../lib/account';
import { api, ApiError, type ShareLink } from '../lib/api';
import { currentRoute } from '../lib/router';
import { useStore } from '../lib/store';

/** "just now", "5 min ago", "3 h ago", or a date */
export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

/** One line on where the lists are, for the header menu and the lists sidebar. */
export function useSyncLine(): string {
  const { status, problem, lastSync } = useAccount();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (status === 'syncing') return 'Syncing…';
  if (problem) return problem;
  return lastSync ? `Synced ${ago(lastSync)}` : 'Synced to your account';
}

/** The header's account button. Renders nothing on a static host or when no sign-in method is set up. */
export function AccountButton() {
  const { user, canSignIn, status, signInOpen, setSignInOpen } = useAccount();
  const [open, setOpen] = useState(false);
  if (!canSignIn && !user) return null;
  return (
    <>
      {user ? (
        <button
          type="button"
          className="btn small account-btn"
          onClick={() => setOpen(true)}
          title={`Signed in as ${user.email}`}
          data-testid="account-btn"
        >
          <span className={`sync-dot ${status}`} aria-hidden />
          <span className="account-name">{user.name || user.email.split('@')[0]}</span>
        </button>
      ) : (
        <button type="button" className="btn small account-btn" onClick={() => setSignInOpen(true)} data-testid="sign-in-btn">
          Sign in
        </button>
      )}
      {signInOpen && !user && <SignInDialog onClose={() => setSignInOpen(false)} />}
      {open && user && <AccountDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal narrow" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body account-body">{children}</div>
      </div>
    </div>
  );
}

function SignInDialog({ onClose }: { onClose: () => void }) {
  const { me, refresh } = useAccount();
  const { lists, toast } = useStore();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // come back to the page the user was on
  const r = currentRoute();
  const q = r.query.toString();
  const ret = r.pathname + (q ? `?${q}` : '');
  const has = (p: 'google' | 'email') => !!me?.providers.includes(p);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  const sendLink = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.emailStart(email.trim(), ret);
      setSent(true);
    });
  };
  const devLogin = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.devLogin(email.trim());
      await refresh();
      toast('Signed in');
      onClose();
    });
  };

  return (
    <Dialog title="Sign in" onClose={onClose}>
      <ul className="account-why">
        <li>Your lists follow you to your phone and other computers.</li>
        <li>They are backed up, so clearing this browser does not lose them.</li>
        <li>A shared list keeps one short link that always shows the current version.</li>
      </ul>
      <p className="muted small">
        {lists.length
          ? `The ${lists.length === 1 ? 'list' : `${lists.length} lists`} in this browser will be added to your account.`
          : 'Lists you make are saved to your account.'}{' '}
        Everything on the site works the same without signing in.
      </p>
      {sent ? (
        <p className="account-sent" role="status">
          Check <strong>{email.trim()}</strong> for a sign-in link. It works once and expires in 15 minutes.
        </p>
      ) : (
        <>
          {has('google') && (
            // a real navigation: Google's page, then back to `ret`
            <a className="btn primary wide" href={api.googleUrl(ret)} target="_self" data-testid="google-sign-in">
              Continue with Google
            </a>
          )}
          {has('email') && (
            <form onSubmit={sendLink} className="account-form">
              <label htmlFor="signin-email">{has('google') ? 'Or get a sign-in link by email' : 'Get a sign-in link by email'}</label>
              <div className="row gap">
                <input
                  id="signin-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button type="submit" className={`btn ${has('google') ? '' : 'primary'}`} disabled={busy}>
                  Email me a link
                </button>
              </div>
              <span className="muted small">No password to remember.</span>
            </form>
          )}
          {me?.dev && (
            <form onSubmit={devLogin} className="account-form">
              <label htmlFor="dev-email">Local development sign-in</label>
              <div className="row gap">
                <input
                  id="dev-email"
                  type="email"
                  required
                  placeholder="dev@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="dev-email"
                />
                <button type="submit" className="btn" disabled={busy} data-testid="dev-sign-in">
                  Sign in
                </button>
              </div>
            </form>
          )}
        </>
      )}
      {err && <p className="warn">{err}</p>}
    </Dialog>
  );
}

function AccountDialog({ onClose }: { onClose: () => void }) {
  const { user, syncNow, signOut, deleteAccount, status } = useAccount();
  const { lists, toast } = useStore();
  const line = useSyncLine();
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    api.shares().then(setLinks, () => setLinks([]));
  }, []);
  if (!user) return null;

  const removeLink = async (l: ShareLink) => {
    try {
      await api.deleteShare(l.id);
      setLinks((ls) => ls?.filter((x) => x.id !== l.id) ?? null);
      // a live link is part of the synced list: let the sync state catch up
      if (l.live) syncNow();
    } catch {
      toast('Could not remove the link');
    }
  };

  return (
    <Dialog title="Account" onClose={onClose}>
      <p>
        Signed in as <strong>{user.email}</strong>
      </p>
      <div className="row gap wrap account-sync">
        <span className={`sync-dot ${status}`} aria-hidden />
        <span data-testid="sync-line">
          {lists.length} {lists.length === 1 ? 'list' : 'lists'} · {line}
        </span>
        <button type="button" className="btn small" onClick={syncNow} disabled={status === 'syncing'}>
          Sync now
        </button>
      </div>

      <h3>Shared links</h3>
      {links == null ? (
        <p className="muted small">Loading…</p>
      ) : links.length === 0 ? (
        <p className="muted small">Nothing shared yet. Use Share on a list.</p>
      ) : (
        <ul className="account-links">
          {links.map((l) => (
            <li key={l.id}>
              <a href={shareLinkUrl(l.id)} target="_blank" rel="noopener noreferrer">
                {l.name || 'Pack list'}
              </a>
              <span className="muted small">{l.live ? 'live' : `snapshot · ${new Date(l.created).toLocaleDateString()}`}</span>
              <button type="button" className="btn small ghost danger" onClick={() => void removeLink(l)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>Sign out</h3>
      <div className="row gap wrap">
        <button
          type="button"
          className="btn"
          data-testid="sign-out"
          onClick={() => {
            onClose();
            void signOut(false);
          }}
        >
          Sign out
        </button>
        <button
          type="button"
          className="btn"
          title="For a shared or public computer"
          onClick={() => {
            onClose();
            void signOut(true);
          }}
        >
          Sign out and remove my lists from this browser
        </button>
      </div>
      <p className="muted small">
        Signing out leaves your lists in this browser unless you choose to remove them. They stay in your account.
      </p>

      <h3>Delete account</h3>
      {confirmDelete ? (
        <div className="row gap wrap">
          <span className="small">
            This deletes your account, synced lists and shared links from the server. Lists in this browser stay.
          </span>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              onClose();
              deleteAccount().catch(() => toast('Could not delete the account'));
            }}
          >
            Delete my account
          </button>
          <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="btn ghost danger" onClick={() => setConfirmDelete(true)}>
          Delete account…
        </button>
      )}
    </Dialog>
  );
}

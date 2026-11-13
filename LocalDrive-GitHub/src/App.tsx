import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, Check, ChevronRight, Clock3, Copy, Download,
  File, FileArchive, FileAudio2, FileImage, FileText, FileVideo2, Folder, FolderOpen, HardDrive,
  Heart, Info, LayoutGrid, List, LoaderCircle, LogOut, Menu, MonitorPlay, MoreHorizontal, Moon, Plus,
  RefreshCw, Search, Settings, ShieldCheck, Sun, Trash2, Upload, X,
} from 'lucide-react';

type Drive = { id: string; name: string; mount: string; total: number; used: number; available: number };
type Entry = { name: string; path: string; kind: 'file' | 'folder'; size: number; modified: string; extension: string };
type Place = { name: string; driveId: string; path: string };
type Transfer = { id: string; name: string; direction: 'upload' | 'download'; percent: number; speed: number; remaining: number; state: 'active' | 'done' | 'failed' | 'cancelled'; error?: string };
type SavedEntry = Entry & { driveId: string; savedAt: number };
type Conflict = { name: string; resolve: (choice: 'overwrite' | 'rename' | 'cancel') => void };
type Dialog = { kind: 'folder' | 'rename' | 'delete' | 'info' | 'destination'; title: string; entry?: Entry; info?: Record<string, unknown> };
type Location = { driveId: string; path: string };
type CastSession = { code: string; token: string; expiresAt: number };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};
const createTransferId = () => typeof globalThis.crypto?.randomUUID === 'function'
  ? globalThis.crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const readSaved = <T,>(key: string): T[] => {
  try { return JSON.parse(localStorage.getItem(key) || '[]') as T[]; } catch { return []; }
};

function IconFor({ entry, size = 20 }: { entry: Entry; size?: number }) {
  if (entry.kind === 'folder') return <Folder size={size} className="file-icon folder-icon" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(entry.extension)) return <FileImage size={size} className="file-icon image-icon" />;
  if (['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(entry.extension)) return <FileVideo2 size={size} className="file-icon video-icon" />;
  if (['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(entry.extension)) return <FileAudio2 size={size} className="file-icon audio-icon" />;
  if (['zip', '7z', 'rar', 'tar', 'gz'].includes(entry.extension)) return <FileArchive size={size} className="file-icon archive-icon" />;
  if (['txt', 'pdf', 'doc', 'docx', 'md', 'rtf'].includes(entry.extension)) return <FileText size={size} className="file-icon text-icon" />;
  return <File size={size} className="file-icon generic-icon" />;
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [theme, setTheme] = useState(localStorage.getItem('localdrive.theme') || 'system');
  const [accent, setAccent] = useState(localStorage.getItem('localdrive.accent') || 'green');
  useEffect(() => {
    api<{ authenticated: boolean }>('/api/auth/session').then((result) => setAuthenticated(result.authenticated)).catch(() => setAuthenticated(false));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('localdrive.theme', theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    localStorage.setItem('localdrive.accent', accent);
  }, [accent]);

  if (authenticated === null) return <div className="boot-screen"><div className="brand-mark"><FolderOpen size={24} /></div><LoaderCircle className="spin" size={18} /></div>;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return <FileManager theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} onLogout={() => setAuthenticated(false)} />;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setBusy(true);
    try { await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }); onLogin(); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  }
  return (
    <main className="login-shell">
      <div className="login-backdrop" aria-hidden="true"><div className="light-arc arc-one" /><div className="light-arc arc-two" /><div className="grain" /></div>
      <section className="login-panel">
        <div className="login-brand"><div className="brand-mark"><FolderOpen size={25} strokeWidth={1.8} /></div><span>LocalDrive</span></div>
        <div className="login-copy"><p className="eyebrow">PRIVATE FILE SPACE</p><h1>Welcome to<br />LocalDrive.</h1><p>Your files. Your devices. One local network.</p></div>
        <form className="login-form" onSubmit={submit}>
          <label>Username<input autoComplete="username" autoFocus value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Enter your username" required /></label>
          <label>Password<div className="password-field"><input autoComplete="current-password" type={visible ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required /><button type="button" className="text-button" onClick={() => setVisible(!visible)}>{visible ? 'Hide' : 'Show'}</button></div></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button sign-in-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : null}Sign In <ArrowRight size={17} /></button>
        </form>
        <div className="login-foot"><ShieldCheck size={14} /> Files stay on this computer and local network</div>
      </section>
      <div className="login-caption">LOCAL NETWORK · PRIVATE BY DESIGN</div>
    </main>
  );
}

function FileManager({ theme, setTheme, accent, setAccent, onLogout }: { theme: string; setTheme: (theme: string) => void; accent: string; setAccent: (accent: string) => void; onLogout: () => void }) {
  const [drives, setDrives] = useState<Drive[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [driveId, setDriveId] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [section, setSection] = useState('All Drives');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [ascending, setAscending] = useState(true);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [favorites, setFavorites] = useState<SavedEntry[]>(() => readSaved<SavedEntry>('localdrive.favorites'));
  const [recent, setRecent] = useState<SavedEntry[]>(() => readSaved<SavedEntry>('localdrive.recent'));
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [destinationDrive, setDestinationDrive] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [context, setContext] = useState<{ x: number; y: number; entry: Entry } | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [network, setNetwork] = useState({ host: '', port: 3000, sessionDays: 14, version: '1.0.0' });
  const [backStack, setBackStack] = useState<Location[]>([]);
  const [forwardStack, setForwardStack] = useState<Location[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const uploadRequests = useRef(new Map<string, XMLHttpRequest>());
  const conflictQueue = useRef<Conflict[]>([]);
  const conflictVisible = useRef(false);
  const activeDrive = drives.find((drive) => drive.id === driveId);
  const selectedEntries = entries.filter((entry) => selected.includes(entry.path));

  useEffect(() => {
    api<Drive[]>('/api/drives').then((items) => { setDrives(items); setDriveId((current) => current || items[0]?.id || ''); }).catch((error) => notify(String(error)));
    api<Place[]>('/api/places').then(setPlaces).catch(() => undefined);
    api<typeof network>('/api/settings').then(setNetwork).catch(() => undefined);
    const timer = window.setInterval(() => api<Drive[]>('/api/drives').then(setDrives).catch(() => undefined), 120000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!driveId) { setEntries([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      setBusy(true);
      const endpoint = search.trim()
        ? `/api/fs/search?driveId=${encodeURIComponent(driveId)}&path=${encodeURIComponent(currentPath)}&q=${encodeURIComponent(search.trim())}`
        : `/api/fs/list?driveId=${encodeURIComponent(driveId)}&path=${encodeURIComponent(currentPath)}`;
      api<Entry[]>(endpoint).then((items) => { if (active) setEntries(items); }).catch((error) => { if (active) { setEntries([]); notify(String(error)); } }).finally(() => { if (active) setBusy(false); });
    }, search.trim() ? 220 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [driveId, currentPath, search]);

  useEffect(() => { localStorage.setItem('localdrive.favorites', JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem('localdrive.recent', JSON.stringify(recent.slice(0, 40))); }, [recent]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3500); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const close = () => setContext(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  function notify(message: string) { setNotice(message); }
  function currentLocation(): Location { return { driveId, path: currentPath }; }
  function navigate(nextDrive: string, nextPath = '') {
    if (driveId) setBackStack((items) => [...items, currentLocation()]);
    setForwardStack([]); setDriveId(nextDrive); setCurrentPath(nextPath); setSearch(''); setSelected([]); setSection('All Drives'); setNavOpen(false);
  }
  function goBack() {
    const previous = backStack.at(-1);
    if (!previous) return;
    setBackStack((items) => items.slice(0, -1)); setForwardStack((items) => [...items, currentLocation()]);
    setDriveId(previous.driveId); setCurrentPath(previous.path); setSelected([]);
  }
  function goForward() {
    const next = forwardStack.at(-1);
    if (!next) return;
    setForwardStack((items) => items.slice(0, -1)); setBackStack((items) => [...items, currentLocation()]);
    setDriveId(next.driveId); setCurrentPath(next.path); setSelected([]);
  }
  function openEntry(entry: Entry, entryDrive = driveId) {
    const item = { ...entry, driveId: entryDrive, savedAt: Date.now() };
    setRecent((items) => [item, ...items.filter((value) => !(value.driveId === item.driveId && value.path === item.path))].slice(0, 40));
    if (entry.kind === 'folder') navigate(entryDrive, entry.path);
    else downloadEntry(entry, entryDrive);
  }
  function selectEntry(entry: Entry, event: MouseEvent) {
    setSelected((items) => event.ctrlKey || event.metaKey
      ? items.includes(entry.path) ? items.filter((item) => item !== entry.path) : [...items, entry.path]
      : [entry.path]);
  }
  function openSaved(item: SavedEntry) {
    const parent = item.kind === 'folder' ? item.path : item.path.split('/').slice(0, -1).join('/');
    navigate(item.driveId, parent);
    if (item.kind === 'file') window.setTimeout(() => downloadEntry(item, item.driveId), 100);
  }
  function toggleFavorite() {
    const entry = selectedEntries[0];
    if (!entry) return;
    const exists = favorites.some((item) => item.driveId === driveId && item.path === entry.path);
    setFavorites(exists ? favorites.filter((item) => !(item.driveId === driveId && item.path === entry.path)) : [{ ...entry, driveId, savedAt: Date.now() }, ...favorites]);
    notify(exists ? 'Removed from Favorites.' : 'Added to Favorites.');
  }
  async function refresh() {
    try {
      const items = await api<Drive[]>('/api/drives'); setDrives(items);
      if (driveId) setEntries(await api<Entry[]>(`/api/fs/list?driveId=${encodeURIComponent(driveId)}&path=${encodeURIComponent(currentPath)}`));
    } catch (error) { notify(String(error)); }
  }
  function updateTransfer(id: string, patch: Partial<Transfer>) { setTransfers((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item)); }

  function askConflict(name: string): Promise<'overwrite' | 'rename' | 'cancel'> {
    return new Promise((resolve) => {
      const request = { name, resolve };
      if (conflictVisible.current) conflictQueue.current.push(request);
      else { conflictVisible.current = true; setConflict(request); }
    });
  }
  function answerConflict(choice: 'overwrite' | 'rename' | 'cancel') {
    if (!conflict) return;
    conflict.resolve(choice);
    const next = conflictQueue.current.shift();
    setConflict(next || null);
    conflictVisible.current = Boolean(next);
  }
  function uploadOne(file: File, relativeName = file.name, chosen = ''): Promise<void> {
    return new Promise((resolve) => {
      const id = createTransferId();
      const transfer: Transfer = { id, name: relativeName, direction: 'upload', percent: 0, speed: 0, remaining: 0, state: 'active' };
      setTransfers((items) => [transfer, ...items]);
      const started = Date.now();
      const xhr = new XMLHttpRequest(); uploadRequests.current.set(id, xhr);
      xhr.open('POST', '/api/fs/upload');
      const form = new FormData();
      form.append('driveId', driveId); form.append('path', currentPath); form.append('relativeName', relativeName); form.append('file', file, relativeName);
      if (chosen) form.append('conflict', chosen);
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.round(event.loaded / event.total * 100);
        const elapsed = Math.max(0.1, (Date.now() - started) / 1000);
        const speed = event.loaded / elapsed;
        updateTransfer(id, { percent, speed, remaining: speed ? (event.total - event.loaded) / speed : 0 });
      };
      xhr.onload = async () => {
        uploadRequests.current.delete(id);
        if (xhr.status === 409) {
          const response = JSON.parse(xhr.responseText || '{}') as { conflict?: boolean; name?: string; error?: string };
          if (response.conflict) {
            const choice = await askConflict(response.name || file.name);
            if (choice !== 'cancel') { updateTransfer(id, { state: 'cancelled' }); await uploadOne(file, relativeName, choice); resolve(); return; }
          } else if (response.error) notify(response.error);
          updateTransfer(id, { state: 'cancelled' }); resolve(); return;
        }
        if (xhr.status >= 200 && xhr.status < 300) { updateTransfer(id, { percent: 100, state: 'done' }); resolve(); }
        else { let message = 'Upload failed.'; try { message = JSON.parse(xhr.responseText).error || message; } catch { /* Keep fallback. */ } updateTransfer(id, { state: 'failed', error: message }); notify(message); resolve(); }
      };
      xhr.onerror = () => { uploadRequests.current.delete(id); updateTransfer(id, { state: 'failed', error: 'Network interrupted.' }); resolve(); };
      xhr.onabort = () => { uploadRequests.current.delete(id); updateTransfer(id, { state: 'cancelled' }); resolve(); };
      xhr.send(form);
    });
  }
  async function uploadFiles(files: FileList | File[]) {
    if (!driveId) return notify('Choose a destination drive first.');
    const tasks = Array.from(files).map((file) => uploadOne(file, (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name));
    await Promise.all(tasks); await refresh();
  }
  function cancelTransfer(transfer: Transfer) {
    uploadRequests.current.get(transfer.id)?.abort();
    updateTransfer(transfer.id, { state: 'cancelled' });
  }
  function downloadEntry(entry: Entry, entryDrive = driveId) {
    if (entry.kind === 'folder') return downloadArchive([{ driveId: entryDrive, path: entry.path }]);
    const link = document.createElement('a');
    link.href = `/api/fs/download?driveId=${encodeURIComponent(entryDrive)}&path=${encodeURIComponent(entry.path)}`;
    link.download = entry.name; document.body.append(link); link.click(); link.remove();
    setTransfers((items) => [{ id: createTransferId(), name: entry.name, direction: 'download', percent: 100, speed: 0, remaining: 0, state: 'done' }, ...items]);
  }
  function downloadArchive(items: { driveId: string; path: string }[]) {
    const form = document.createElement('form'); form.method = 'POST'; form.action = '/api/fs/archive'; form.style.display = 'none';
    const input = document.createElement('input'); input.name = 'items'; input.value = JSON.stringify(items); form.append(input); document.body.append(form); form.submit(); form.remove();
    setTransfers((current) => [{ id: createTransferId(), name: items.length === 1 ? items[0].path.split('/').at(-1) || 'Archive' : `${items.length} selected items`, direction: 'download', percent: 100, speed: 0, remaining: 0, state: 'done' }, ...current]);
  }
  function downloadSelected() {
    if (selectedEntries.length === 1) downloadEntry(selectedEntries[0]);
    else if (selectedEntries.length) downloadArchive(selectedEntries.map((entry) => ({ driveId, path: entry.path })));
  }
  async function performDialog(event: FormEvent) {
    event.preventDefault();
    if (!dialog) return;
    try {
      if (dialog.kind === 'folder') await api('/api/fs/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driveId, path: currentPath, name: dialogValue }) });
      if (dialog.kind === 'rename' && dialog.entry) await api('/api/fs/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driveId, path: dialog.entry.path, name: dialogValue }) });
      if (dialog.kind === 'delete') await api('/api/fs/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driveId, items: selectedEntries.map((entry) => ({ path: entry.path })) }) });
      if (dialog.kind === 'destination') {
        const item = selectedEntries[0]; if (!item) return;
        await api(`/api/fs/${dialog.title === 'Move to' ? 'move' : 'copy'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceDriveId: driveId, sourcePath: item.path, destinationDriveId: destinationDrive, destinationPath }) });
      }
      setDialog(null); setSelected([]); await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : 'The operation failed.'); }
  }
  async function showInfo(entry: Entry) {
    try {
      const info = await api<Record<string, unknown>>(`/api/fs/info?driveId=${encodeURIComponent(driveId)}&path=${encodeURIComponent(entry.path)}`);
      setDialog({ kind: 'info', title: 'File information', entry, info });
    } catch (error) { notify(String(error)); }
  }
  function navigateSection(name: string) {
    setSection(name); setNavOpen(false); setSelected([]); setSearch('');
    if (name === 'All Drives') { if (driveId) { setCurrentPath(''); setBackStack([]); setForwardStack([]); } return; }
    if (['Desktop', 'Documents', 'Downloads'].includes(name)) {
      const place = places.find((item) => item.name === name);
      if (place) navigate(place.driveId, place.path); else notify(`${name} is not available on this computer.`);
    }
  }
  function rowAction(action: string, entry?: Entry) {
    if (entry && !selected.includes(entry.path)) setSelected([entry.path]);
    if (action === 'rename' && entry) { setDialogValue(entry.name); setDialog({ kind: 'rename', title: 'Rename item', entry }); }
    if (action === 'delete') setDialog({ kind: 'delete', title: 'Delete permanently?' });
    if (action === 'info' && entry) void showInfo(entry);
    if (action === 'download' && entry) downloadEntry(entry);
    if (action === 'copy' || action === 'move') { setDestinationDrive(driveId); setDestinationPath(currentPath); setDialog({ kind: 'destination', title: action === 'copy' ? 'Copy to' : 'Move to' }); }
    setContext(null);
  }
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) { if (event.target.files?.length) void uploadFiles(event.target.files); event.target.value = ''; }
  const sortedEntries = [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    let order = 0;
    if (sort === 'size') order = a.size - b.size;
    else if (sort === 'date') order = Date.parse(a.modified) - Date.parse(b.modified);
    else if (sort === 'type') order = a.extension.localeCompare(b.extension) || a.name.localeCompare(b.name);
    else order = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    return ascending ? order : -order;
  });
  const segments = currentPath ? currentPath.split('/') : [];
  const activeUploads = transfers.filter((item) => item.state === 'active').length;

  return (
    <main className="workspace" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files); }}>
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setNavOpen(true)}><Menu size={19} /></button>
        <div className="top-brand"><div className="brand-mark small"><FolderOpen size={17} /></div><span>LocalDrive</span><span className="brand-divider" /><span className="brand-location">{activeDrive?.mount || 'Local file space'}</span></div>
        <div className="top-actions">
          <button className="icon-button top-transfer" aria-label="Transfer activity" title="Transfer activity" onClick={() => setTransferOpen(true)}><ArrowDown size={17} />{activeUploads > 0 && <span className="activity-dot" />}</button>
          <button className="icon-button" aria-label="Settings" title="Settings" onClick={() => setSection('Settings')}><Settings size={17} /></button>
          <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined); onLogout(); }}><LogOut size={17} /></button>
        </div>
      </header>

      <div className="app-layout">
        <aside className={`sidebar ${navOpen ? 'sidebar-open' : ''}`}>
          <div className="mobile-sidebar-head"><span>Browse</span><button className="icon-button" onClick={() => setNavOpen(false)} aria-label="Close navigation"><X size={18} /></button></div>
          <div className="sidebar-scroll">
            <p className="sidebar-label">LIBRARY</p>
            <nav className="nav-group">
              <NavButton icon={<HardDrive size={17} />} label="All Drives" active={section === 'All Drives'} onClick={() => navigateSection('All Drives')} />
              <NavButton icon={<Clock3 size={17} />} label="Recent Files" active={section === 'Recent Files'} onClick={() => navigateSection('Recent Files')} />
              <NavButton icon={<Heart size={17} />} label="Favorites" active={section === 'Favorites'} onClick={() => navigateSection('Favorites')} />
              <NavButton icon={<MonitorPlay size={17} />} label="Screen Mirror" active={section === 'Screen Mirror'} onClick={() => navigateSection('Screen Mirror')} />
            </nav>
            <p className="sidebar-label sidebar-label-spaced">PLACES</p>
            <nav className="nav-group">
              <NavButton icon={<Download size={17} />} label="Downloads" active={section === 'Downloads'} onClick={() => navigateSection('Downloads')} />
              <NavButton icon={<Folder size={17} />} label="Desktop" active={section === 'Desktop'} onClick={() => navigateSection('Desktop')} />
              <NavButton icon={<FileText size={17} />} label="Documents" active={section === 'Documents'} onClick={() => navigateSection('Documents')} />
            </nav>
            <div className="drive-heading"><p className="sidebar-label">LOCATIONS</p><button className="tiny-button" onClick={() => void refresh()} aria-label="Refresh drives" title="Refresh drives"><RefreshCw size={13} /></button></div>
            <div className="drive-list">
              {drives.map((drive) => <button key={drive.id} className={`drive-nav ${driveId === drive.id && section === 'All Drives' ? 'active' : ''}`} onClick={() => navigate(drive.id)}>
                <HardDrive size={17} /><span className="drive-nav-copy"><strong>{drive.name}</strong><small>{drive.mount}</small></span><ChevronRight size={14} className="drive-chevron" />
              </button>)}
              {drives.length === 0 && <p className="sidebar-empty">No mounted drives found</p>}
            </div>
            <button className={`nav-button settings-nav ${section === 'Settings' ? 'active' : ''}`} onClick={() => navigateSection('Settings')}><Settings size={17} /><span>Settings</span></button>
          </div>
          <div className="sidebar-footer"><div className="privacy-mark"><ShieldCheck size={14} /><span>Private network</span></div><div className="user-chip"><div className="user-avatar">R</div><div><strong>root</strong><small>Local account</small></div><button className="tiny-button" title="Sign out" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined); onLogout(); }}><LogOut size={15} /></button></div></div>
        </aside>
        {navOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}

        <section className="main-panel">
          {section === 'Screen Mirror' ? <ScreenMirrorPage /> : section === 'Settings' ? <SettingsPage drives={drives} network={network} theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} onLogout={onLogout} /> : section === 'Recent Files' || section === 'Favorites' ? (
            <SavedView title={section} items={section === 'Recent Files' ? recent : favorites} onOpen={openSaved} onRemove={section === 'Favorites' ? (item) => setFavorites((items) => items.filter((saved) => !(saved.driveId === item.driveId && saved.path === item.path))) : undefined} />
          ) : (
            <>
              <div className="toolbar">
                <div className="history-controls"><button className="icon-button" disabled={!backStack.length} onClick={goBack} aria-label="Go back" title="Back"><ArrowLeft size={17} /></button><button className="icon-button" disabled={!forwardStack.length} onClick={goForward} aria-label="Go forward" title="Forward"><ArrowRight size={17} /></button></div>
                <div className="breadcrumb"><button onClick={() => navigate(driveId)}>{activeDrive?.mount || 'Drive'}</button>{segments.map((segment, index) => <span className="crumb-part" key={`${segment}-${index}`}><ChevronRight size={13} /><button onClick={() => navigate(driveId, segments.slice(0, index + 1).join('/'))}>{segment}</button></span>)}</div>
                <div className="toolbar-actions">
                  <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this drive" /><kbd>/</kbd></label>
                  <span className="toolbar-separator" />
                  <button className="tool-button" onClick={() => fileInput.current?.click()}><Upload size={16} /><span>Upload</span></button>
                  <button className="icon-button folder-upload-button" onClick={() => folderInput.current?.click()} title="Upload folder" aria-label="Upload folder"><FolderOpen size={16} /></button>
                  <button className="tool-button" onClick={() => { setDialogValue(''); setDialog({ kind: 'folder', title: 'New folder' }); }}><Plus size={17} /><span>New folder</span></button>
                  <button className="icon-button" disabled={!selected.length} onClick={downloadSelected} title="Download selected" aria-label="Download selected"><Download size={17} /></button>
                  <button className="icon-button" onClick={() => void refresh()} title="Refresh" aria-label="Refresh"><RefreshCw size={16} /></button>
                  <span className="toolbar-separator view-divider" />
                  <div className="view-toggle"><button className={view === 'list' ? 'chosen' : ''} onClick={() => setView('list')} title="List view" aria-label="List view"><List size={16} /></button><button className={view === 'grid' ? 'chosen' : ''} onClick={() => setView('grid')} title="Grid view" aria-label="Grid view"><LayoutGrid size={16} /></button></div>
                </div>
              </div>
              <div className="content-heading"><div><p className="eyebrow">{section === 'All Drives' ? 'YOUR LIBRARY' : section.toUpperCase()}</p><h1>{segments.at(-1) || activeDrive?.name || 'All Drives'}</h1></div><div className="heading-meta">{selected.length ? <span>{selected.length} selected</span> : <span>{entries.length} items</span>}<button className={`icon-button favorite-action ${selectedEntries.some((entry) => favorites.some((item) => item.driveId === driveId && item.path === entry.path)) ? 'is-favorite' : ''}`} onClick={toggleFavorite} disabled={!selected.length} title="Add to Favorites" aria-label="Add to Favorites"><Heart size={17} /></button><button className="icon-button" onClick={() => setTransferOpen(true)} title="Transfers" aria-label="Transfers"><ArrowDown size={17} /></button></div></div>
              {activeDrive && <div className="storage-strip"><div className="storage-icon"><HardDrive size={16} /></div><div className="storage-copy"><strong>{activeDrive.name}</strong><span>{formatBytes(activeDrive.available)} available of {formatBytes(activeDrive.total)}</span></div><div className="storage-meter"><span style={{ width: `${activeDrive.total ? Math.min(100, activeDrive.used / activeDrive.total * 100) : 0}%` }} /></div><span className="storage-percent">{activeDrive.total ? Math.round(activeDrive.used / activeDrive.total * 100) : 0}% used</span></div>}
              <div className={`file-area ${dragging ? 'is-dragging' : ''}`}>
                {dragging && <div className="drop-overlay"><div><Upload size={29} /><strong>Drop files to upload</strong><span>Destination: {activeDrive?.mount}{currentPath ? `/${currentPath}` : ''}</span></div></div>}
                {view === 'list' ? <div className="file-table-wrap"><table className="file-table"><thead><tr><th><button onClick={() => { setSelected(selected.length === entries.length ? [] : entries.map((entry) => entry.path)); }}>Name</button></th><th><SortButton label="Date modified" value="date" sort={sort} setSort={setSort} ascending={ascending} setAscending={setAscending} /></th><th><SortButton label="Size" value="size" sort={sort} setSort={setSort} ascending={ascending} setAscending={setAscending} /></th><th><SortButton label="Kind" value="type" sort={sort} setSort={setSort} ascending={ascending} setAscending={setAscending} /></th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
                  {sortedEntries.map((entry) => <tr key={entry.path} className={selected.includes(entry.path) ? 'selected-row' : ''} onClick={(event) => selectEntry(entry, event)} onDoubleClick={() => openEntry(entry)} onContextMenu={(event) => { event.preventDefault(); setSelected([entry.path]); setContext({ x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 250), entry }); }}><td><div className="file-name-cell"><IconFor entry={entry} /><span className="file-name-text">{entry.name}</span></div></td><td className="muted-cell">{formatDate(entry.modified)}</td><td className="muted-cell">{entry.kind === 'folder' ? '—' : formatBytes(entry.size)}</td><td className="muted-cell">{entry.kind === 'folder' ? 'Folder' : entry.extension ? `${entry.extension.toUpperCase()} file` : 'File'}</td><td><button className="row-more" aria-label={`More options for ${entry.name}`} onClick={(event) => { event.stopPropagation(); setSelected([entry.path]); setContext({ x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 250), entry }); }}><MoreHorizontal size={17} /></button></td></tr>)}
                  </tbody></table>{!busy && sortedEntries.length === 0 && <EmptyState search={search} onUpload={() => fileInput.current?.click()} />}{busy && <div className="loading-line"><LoaderCircle className="spin" size={17} /> Loading files</div>}</div> : <div className="file-grid">{sortedEntries.map((entry) => <button key={entry.path} className={`grid-item ${selected.includes(entry.path) ? 'selected-grid' : ''}`} onClick={(event) => selectEntry(entry, event)} onDoubleClick={() => openEntry(entry)} onContextMenu={(event) => { event.preventDefault(); setSelected([entry.path]); setContext({ x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 250), entry }); }}><IconFor entry={entry} size={34} /><span>{entry.name}</span><small>{entry.kind === 'folder' ? 'Folder' : formatBytes(entry.size)}</small></button>)}{!busy && sortedEntries.length === 0 && <EmptyState search={search} onUpload={() => fileInput.current?.click()} />}</div>}
                <input ref={fileInput} hidden type="file" multiple onChange={handleFileChange} /><input ref={folderInput} hidden type="file" multiple onChange={handleFileChange} {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />
              </div>
              <footer className="statusbar"><span>{selected.length ? `${selected.length} selected` : `${sortedEntries.length} items`}</span><span className="status-right"><span><span className="status-dot" /> Connected</span><button onClick={() => setTransferOpen(true)}>Transfers{activeUploads ? ` · ${activeUploads} active` : ''}</button></span></footer>
            </>
          )}
        </section>
      </div>

      {context && <div className="context-menu" style={{ left: context.x, top: context.y }} onClick={(event) => event.stopPropagation()}><button onClick={() => openEntry(context.entry)}><FolderOpen size={15} />{context.entry.kind === 'folder' ? 'Open' : 'Download'}</button>{context.entry.kind === 'file' && <button onClick={() => rowAction('download', context.entry)}><Download size={15} />Download</button>}<button onClick={() => rowAction('rename', context.entry)}><FileText size={15} />Rename</button><button onClick={() => rowAction('copy', context.entry)}><Copy size={15} />Copy to…</button><button onClick={() => rowAction('move', context.entry)}><ArrowRight size={15} />Move to…</button><button onClick={() => rowAction('info', context.entry)}><Info size={15} />Get info</button><div className="menu-rule" /><button className="danger-action" onClick={() => rowAction('delete', context.entry)}><Trash2 size={15} />Delete</button></div>}

      {transferOpen && <div className="panel-scrim" onClick={() => setTransferOpen(false)}><aside className="transfer-panel" onClick={(event) => event.stopPropagation()}><div className="panel-title"><div><p className="eyebrow">ACTIVITY</p><h2>Transfers</h2></div><button className="icon-button" onClick={() => setTransferOpen(false)} aria-label="Close transfers"><X size={18} /></button></div><div className="transfer-list">{transfers.length === 0 ? <div className="transfer-empty"><ArrowDown size={22} /><span>No transfers yet</span></div> : transfers.map((item) => <div className="transfer-item" key={item.id}><div className={`transfer-icon ${item.direction}`}><>{item.direction === 'upload' ? <Upload size={16} /> : <Download size={16} />}</></div><div className="transfer-detail"><div className="transfer-name-line"><strong title={item.name}>{item.name}</strong><span>{item.state === 'active' ? `${item.percent}%` : item.state}</span></div>{item.state === 'active' ? <><div className="transfer-progress"><i style={{ width: `${item.percent}%` }} /></div><small>{formatBytes(item.speed)}/s · {Math.ceil(item.remaining)} sec left</small></> : item.error ? <small className="error-text">{item.error}</small> : <small>{item.direction === 'upload' ? 'Uploaded to this device' : 'Sent to browser downloads'}</small>}</div>{item.state === 'active' && <button className="tiny-button cancel-transfer" onClick={() => cancelTransfer(item)} title="Cancel transfer" aria-label="Cancel transfer"><X size={15} /></button>}</div>)}</div><button className="clear-transfers" onClick={() => setTransfers((items) => items.filter((item) => item.state === 'active'))}>Clear completed</button></aside></div>}

      {dialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><form className="modal" onSubmit={dialog.kind === 'info' ? (event) => { event.preventDefault(); setDialog(null); } : performDialog}>
        <div className="modal-heading"><div><p className="eyebrow">LOCALDRIVE</p><h2>{dialog.title}</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setDialog(null)}><X size={18} /></button></div>
        {dialog.kind === 'folder' && <label className="modal-label">Folder name<input autoFocus value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} placeholder="New folder" required /></label>}
        {dialog.kind === 'rename' && <label className="modal-label">New name<input autoFocus value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} required /></label>}
        {dialog.kind === 'delete' && <p className="modal-copy">This permanently deletes {selected.length === 1 ? 'the selected item' : `${selected.length} selected items`} from the drive. This action cannot be undone.</p>}
        {dialog.kind === 'destination' && <><label className="modal-label">Destination drive<select value={destinationDrive} onChange={(event) => setDestinationDrive(event.target.value)}>{drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.mount} · {drive.name}</option>)}</select></label><label className="modal-label">Folder path<input value={destinationPath} onChange={(event) => setDestinationPath(event.target.value)} placeholder="Leave blank for drive root" /></label><p className="modal-hint">The item will keep its current name. Existing items are never replaced.</p></>}
        {dialog.kind === 'info' && dialog.info && <div className="info-grid">{Object.entries(dialog.info).map(([key, value]) => <div key={key}><span>{key === 'isDirectory' ? 'Kind' : key}</span><strong>{key === 'size' ? formatBytes(Number(value)) : key === 'isDirectory' ? value ? 'Folder' : 'File' : typeof value === 'string' && key !== 'name' ? formatDate(value) : String(value)}</strong></div>)}</div>}
        <div className="modal-actions">{dialog.kind === 'delete' && <button type="button" className="secondary-button" onClick={() => setDialog(null)}>Cancel</button>}{dialog.kind !== 'info' && <button type="button" className="secondary-button" onClick={() => setDialog(null)}>Cancel</button>}<button className={dialog.kind === 'delete' ? 'danger-button' : 'primary-button'}>{dialog.kind === 'info' ? 'Done' : dialog.kind === 'delete' ? 'Delete' : dialog.kind === 'folder' ? 'Create folder' : dialog.kind === 'destination' ? dialog.title : 'Save'}</button></div>
      </form></div>}

      {conflict && <div className="modal-backdrop"><div className="modal"><div className="modal-heading"><div><p className="eyebrow">UPLOAD CONFLICT</p><h2>File already exists</h2></div><button className="icon-button" onClick={() => answerConflict('cancel')} aria-label="Cancel upload"><X size={18} /></button></div><p className="modal-copy"><strong>{conflict.name}</strong> already exists in this folder. Choose how to continue.</p><div className="conflict-actions"><button className="secondary-button" onClick={() => answerConflict('cancel')}>Cancel upload</button><button className="secondary-button" onClick={() => answerConflict('rename')}>Keep both</button><button className="primary-button" onClick={() => answerConflict('overwrite')}>Replace</button></div></div></div>}
      {notice && <div className="toast" role="status"><Info size={16} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
    </main>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function SortButton({ label, value, sort, setSort, ascending, setAscending }: { label: string; value: string; sort: string; setSort: (value: string) => void; ascending: boolean; setAscending: (value: boolean) => void }) {
  return <button onClick={() => { if (sort === value) setAscending(!ascending); else { setSort(value); setAscending(true); } }}>{label}{sort === value && <span>{ascending ? ' ↑' : ' ↓'}</span>}</button>;
}

function EmptyState({ search, onUpload }: { search: string; onUpload: () => void }) {
  return <div className="empty-state"><div className="empty-icon"><Folder size={24} /></div><h3>{search ? 'No matching files' : 'Nothing here yet'}</h3><p>{search ? 'Try another name or check a different folder.' : 'Add something to this folder to see it here.'}</p>{!search && <button className="secondary-button" onClick={onUpload}><Upload size={15} />Upload files</button>}</div>;
}

function SavedView({ title, items, onOpen, onRemove }: { title: string; items: SavedEntry[]; onOpen: (item: SavedEntry) => void; onRemove?: (item: SavedEntry) => void }) {
  return <div className="saved-view"><div className="content-heading"><div><p className="eyebrow">YOUR LIBRARY</p><h1>{title}</h1></div><span className="heading-count">{items.length} items</span></div>{items.length ? <div className="saved-list">{items.map((item) => <div className="saved-row" key={`${item.driveId}:${item.path}`}><button className="saved-open" onClick={() => onOpen(item)}><IconFor entry={item} /><span><strong>{item.name}</strong><small>{item.path || item.driveId}</small></span></button><span className="muted-cell">{item.kind === 'folder' ? 'Folder' : formatBytes(item.size)}</span><button className="icon-button" title={onRemove ? 'Remove favorite' : 'Open'} onClick={() => onRemove ? onRemove(item) : onOpen(item)}>{onRemove ? <X size={16} /> : <ChevronRight size={16} />}</button></div>)}</div> : <div className="empty-state saved-empty"><div className="empty-icon">{title === 'Favorites' ? <Heart size={22} /> : <Clock3 size={22} />}</div><h3>{title === 'Favorites' ? 'No favorites yet' : 'No recent files'}</h3><p>Items you open will appear here.</p></div>}</div>;
}

function ScreenMirrorPage() {
  const [room, setRoom] = useState<CastSession | null>(null);
  const [status, setStatus] = useState<'idle' | 'starting' | 'waiting' | 'connected' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [frameCount, setFrameCount] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const roomRef = useRef<CastSession | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => () => {
    socket.current?.close();
    const active = roomRef.current;
    if (active) void fetch('/api/cast/session', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: active.token }) });
  }, []);

  async function start() {
    setStatus('starting'); setMessage(''); setFrameCount(0);
    try {
      const created = await api<CastSession>('/api/cast/session', { method: 'POST' });
      setRoom(created); roomRef.current = created;
      const address = new URL('/api/cast/ws', window.location.href);
      address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
      address.searchParams.set('role', 'viewer'); address.searchParams.set('token', created.token);
      const connection = new WebSocket(address);
      socket.current = connection; connection.binaryType = 'arraybuffer';
      connection.onopen = () => setStatus('waiting');
      connection.onmessage = async (event) => {
        if (typeof event.data === 'string') {
          const notice = JSON.parse(event.data) as { type?: string };
          if (notice.type === 'peer-connected') setStatus('connected');
          if (notice.type === 'peer-disconnected') setStatus('waiting');
          return;
        }
        if (drawing.current || !canvas.current) return;
        drawing.current = true;
        try {
          const bitmap = await createImageBitmap(new Blob([event.data], { type: 'image/jpeg' }));
          const target = canvas.current;
          if (target) {
            target.width = bitmap.width; target.height = bitmap.height;
            target.getContext('2d')?.drawImage(bitmap, 0, 0);
            setFrameCount((count) => count + 1);
          }
          bitmap.close();
        } catch { setMessage('A screen frame could not be decoded.'); }
        finally { drawing.current = false; }
      };
      connection.onerror = () => { setStatus('error'); setMessage('The local screen-share connection failed. Check that the iPhone is on the same Wi-Fi.'); };
      connection.onclose = () => { if (roomRef.current) { setStatus('error'); setMessage('The pairing expired or the connection closed. Start a new session.'); } };
    } catch (error) {
      setStatus('error'); setMessage(error instanceof Error ? error.message : 'Could not create a screen-share session.');
    }
  }

  async function stop() {
    const active = roomRef.current;
    socket.current?.close(); socket.current = null;
    roomRef.current = null; setRoom(null); setStatus('idle'); setFrameCount(0);
    const context = canvas.current?.getContext('2d');
    if (canvas.current && context) context.clearRect(0, 0, canvas.current.width, canvas.current.height);
    if (active) await fetch('/api/cast/session', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: active.token }) }).catch(() => undefined);
  }

  return <div className="cast-page"><div className="content-heading"><div><p className="eyebrow">LOCAL NETWORK</p><h1>Screen Mirror</h1></div><span className={`cast-state ${status}`}><i />{status === 'connected' ? 'iPhone connected' : status === 'waiting' ? 'Waiting for iPhone' : status === 'starting' ? 'Preparing' : status === 'error' ? 'Connection issue' : 'Not streaming'}</span></div><div className="cast-layout"><div className="cast-stage"><canvas ref={canvas} aria-label="Mirrored iPhone screen" className={frameCount ? 'has-frame' : ''} />{!frameCount && <div className="cast-placeholder"><div className="cast-placeholder-icon"><MonitorPlay size={27} /></div><h2>{status === 'connected' ? 'Waiting for the first frame' : 'Your iPhone screen will appear here'}</h2><p>Frames travel directly over your local Wi-Fi and are not saved.</p></div>}<div className="cast-stage-footer"><span>{frameCount ? `${frameCount} frames received` : 'Private local stream'}</span>{room && <span>Code expires in 3 minutes</span>}</div></div><aside className="cast-setup"><div className="cast-setup-icon"><MonitorPlay size={20} /></div><p className="eyebrow">IPHONE BROADCAST</p><h2>Connect your iPhone</h2><p className="cast-explanation">Start a session, enter its code in the LocalDrive Cast iPhone app, then start the iOS screen broadcast.</p>{room ? <div className="pair-code"><span>PAIRING CODE</span><strong>{room.code}</strong></div> : <button className="primary-button cast-start" onClick={() => void start()} disabled={status === 'starting'}>{status === 'starting' ? <LoaderCircle className="spin" size={16} /> : <MonitorPlay size={16} />}Start screen-share session</button>}{room && <button className="danger-button cast-stop" onClick={() => void stop()}>End session</button>}{message && <p className="cast-error" role="alert">{message}</p>}<div className="cast-requirement"><strong>iOS app required</strong><span>Safari cannot broadcast the iPhone system screen. The companion app uses Apple ReplayKit; source and Mac build steps are in <a href="/ios/README.md" target="_blank" rel="noreferrer">the iOS setup guide</a>.</span></div></aside></div></div>;
}

function SettingsPage({ drives, network, theme, setTheme, accent, setAccent, onLogout }: { drives: Drive[]; network: { host: string; port: number; sessionDays: number; version: string }; theme: string; setTheme: (value: string) => void; accent: string; setAccent: (value: string) => void; onLogout: () => void }) {
  const accents = [['green', 'Green', '#2c806c'], ['blue', 'Blue', '#477ab4'], ['purple', 'Purple', '#8055a6'], ['pink', 'Pink', '#bb5279'], ['red', 'Red', '#bd4d47'], ['orange', 'Orange', '#c16a2b'], ['teal', 'Teal', '#268b8b'], ['slate', 'Slate', '#64748b']];
  return <div className="settings-page"><div className="content-heading"><div><p className="eyebrow">PREFERENCES</p><h1>Settings</h1></div><div className="server-state"><span className="status-dot" />Server running</div></div><section className="settings-section"><div className="settings-section-title"><h2>Appearance</h2><p>Choose the theme and accent color for this browser.</p></div><div className="appearance-settings"><div className="appearance-options">{[['light', <Sun size={18} />, 'Light'], ['dark', <Moon size={18} />, 'Dark'], ['system', <Settings size={18} />, 'System']].map(([value, icon, label]) => <button key={String(value)} className={`appearance-choice ${theme === value ? 'selected' : ''}`} onClick={() => setTheme(String(value))}>{icon as ReactNode}<span>{label as string}</span>{theme === value && <Check size={15} />}</button>)}</div><div className="accent-options" role="group" aria-label="Accent color">{accents.map(([value, label, color]) => <button key={value} type="button" className={`accent-choice ${accent === value ? 'selected' : ''}`} style={{ '--swatch': color } as React.CSSProperties} aria-label={`${label} accent color`} aria-pressed={accent === value} title={label} onClick={() => setAccent(value)}><span />{accent === value && <Check size={13} />}</button>)}</div></div></section><section className="settings-section"><div className="settings-section-title"><h2>Server</h2><p>Available to devices on this private network.</p></div><div className="settings-rows"><div><span>Network address</span><strong>{network.host ? `http://${network.host}:${network.port}` : 'Detecting address…'}</strong></div><div><span>Port</span><strong>{network.port}</strong></div><div><span>Session expires after</span><strong>{network.sessionDays} days</strong></div><div><span>Application version</span><strong>{network.version}</strong></div></div></section><section className="settings-section"><div className="settings-section-title"><h2>Available drives</h2><p>Volumes currently accessible to LocalDrive.</p></div><div className="settings-drive-list">{drives.map((drive) => <div className="settings-drive" key={drive.id}><HardDrive size={19} /><div><strong>{drive.name}</strong><small>{drive.mount}</small></div><span>{formatBytes(drive.available)} free of {formatBytes(drive.total)}</span><div className="mini-meter"><i style={{ width: `${drive.total ? drive.used / drive.total * 100 : 0}%` }} /></div></div>)}</div></section><section className="settings-section"><div className="settings-section-title"><h2>Account</h2><p>Signed in as root.</p></div><button className="secondary-button sign-out-setting" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined); onLogout(); }}><LogOut size={15} />Sign out</button></section><div className="settings-security"><ShieldCheck size={18} /><p>LocalDrive is bound to this computer's private network address. Keep your Windows network profile set to Private and allow Node.js only on private networks in Windows Firewall.</p></div></div>;
}

export default App;
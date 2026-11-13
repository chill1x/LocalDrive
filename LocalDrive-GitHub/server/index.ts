import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import multer from 'multer';
import FileStoreFactory from 'session-file-store';
import yazl from 'yazl';
import { CastHub } from './cast-hub.js';
import { copyTree, listDirectory, listDrives, safeName, safePath, searchFiles, uniqueName, zipPath } from './fs-service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });
const dataDirectory = path.join(projectRoot, 'data');
const uploadDirectory = path.join(dataDirectory, 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });
fs.mkdirSync(path.join(dataDirectory, 'sessions'), { recursive: true });

function privateAddress(): string {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      const [a, b] = address.address.split('.').map(Number);
      if (a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31) return address.address;
    }
  }
  return '127.0.0.1';
}

function persistentSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(dataDirectory, 'session.secret');
  try { return fs.readFileSync(file, 'utf8').trim(); }
  catch {
    const secret = crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(file, secret, { mode: 0o600, flag: 'wx' });
    return secret;
  }
}

function verifyPassword(password: string): boolean {
  const [scheme, nText, rText, pText, saltText, hashText] = (process.env.PASSWORD_HASH ?? '').split('$');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, 'base64url');
    const actual = crypto.scryptSync(password, Buffer.from(saltText, 'base64url'), expected.length, { N: Number(nText), r: Number(rText), p: Number(pText), maxmem: 64 * 1024 * 1024 });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

const app = express();
const FileStore = FileStoreFactory(session);
const sessionDays = Math.min(30, Math.max(1, Number(process.env.SESSION_DAYS) || 14));
const sessionStore = new FileStore({ path: path.join(dataDirectory, 'sessions'), ttl: sessionDays * 86400, retries: 0 });
const sessionWriteQueues = new Map<string, Promise<void>>();
const persistSession = sessionStore.set.bind(sessionStore);
sessionStore.set = (sessionId, sessionData, callback) => {
  const previous = sessionWriteQueues.get(sessionId) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(() => new Promise<void>((resolve, reject) => {
    persistSession(sessionId, sessionData, (error) => error ? reject(error) : resolve());
  }));
  sessionWriteQueues.set(sessionId, write);
  void write.then(
    () => { if (sessionWriteQueues.get(sessionId) === write) sessionWriteQueues.delete(sessionId); callback?.(); },
    (error) => { if (sessionWriteQueues.get(sessionId) === write) sessionWriteQueues.delete(sessionId); callback?.(error as Error); },
  );
};
sessionStore.touch = (_sessionId, _session, callback) => callback?.();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'self'"], baseUri: ["'self'"], formAction: ["'self'"], scriptSrc: ["'self'"], scriptSrcAttr: ["'none'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"] } },
  crossOriginResourcePolicy: { policy: 'same-site' },
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(session({
  name: 'localdrive.sid',
  secret: persistentSecret(),
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: false, maxAge: sessionDays * 86400 * 1000 },
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } });
const castLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many screen-share sessions. Try again later.' } });
const upload = multer({ dest: uploadDirectory, limits: { fileSize: Number.MAX_SAFE_INTEGER, files: 1 } });
const castHub = new CastHub();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Please sign in to continue.' });
}

function fail(res: Response, error: unknown) {
  const isMulterError = error instanceof multer.MulterError;
  const status = Number((error as { status?: number })?.status) || (isMulterError ? 413 : 500);
  const message = isMulterError && error.code === 'LIMIT_FILE_SIZE'
    ? 'This file exceeds the upload limit.'
    : status >= 500 ? 'The operation could not be completed. Check access permissions and available space.' : (error as Error).message;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: message });
}

app.get('/api/auth/session', (req, res) => res.json({ authenticated: Boolean(req.session.authenticated) }));
app.post('/api/auth/login', loginLimiter, (req, res, next) => {
  const username = String(req.body?.username ?? '');
  const password = String(req.body?.password ?? '');
  if (username.length > 128 || password.length > 1024) return res.status(401).json({ error: 'That username or password is not correct.' });
  if (username !== (process.env.LOCALDRIVE_USERNAME || 'root') || !verifyPassword(password)) return res.status(401).json({ error: 'That username or password is not correct.' });
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.authenticated = true;
    req.session.save((saveError) => saveError ? next(saveError) : res.json({ authenticated: true }));
  });
});
app.post('/api/auth/logout', requireAuth, (req, res, next) => req.session.destroy((error) => {
  if (error) return next(error);
  res.clearCookie('localdrive.sid', { httpOnly: true, sameSite: 'strict' });
  res.json({ authenticated: false });
}));

app.use('/api', (req, res, next) => req.path.startsWith('/auth/') ? next() : requireAuth(req, res, next));
app.post('/api/cast/session', castLimiter, (_req, res) => res.status(201).json(castHub.createSession()));
app.delete('/api/cast/session', (req, res) => {
  const token = String(req.body?.token ?? '');
  castHub.closeSession(token);
  res.status(204).end();
});

app.get('/api/drives', async (_req, res) => {
  try { res.json(await listDrives()); } catch (error) { fail(res, error); }
});
app.get('/api/places', async (_req, res) => {
  const home = process.env.USERPROFILE || os.homedir();
  const candidates = ['Desktop', 'Documents', 'Downloads'].map((name) => ({ name, absolute: path.join(home, name) }));
  const places = [];
  try {
    const drives = await listDrives();
    for (const candidate of candidates) {
      const drive = drives.find((item) => {
        const relative = path.relative(item.mount, candidate.absolute);
        return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
      });
      if (!drive) continue;
      const relative = path.relative(drive.mount, candidate.absolute).replace(/\\/g, '/');
      try { await safePath(drive.id, relative); places.push({ name: candidate.name, driveId: drive.id, path: relative }); }
      catch { /* The folder may not exist on this Windows profile. */ }
    }
    res.json(places);
  } catch (error) { fail(res, error); }
});
app.get('/api/fs/list', async (req, res) => {
  try { res.json(await listDirectory(String(req.query.driveId ?? ''), String(req.query.path ?? ''))); } catch (error) { fail(res, error); }
});
app.get('/api/fs/search', async (req, res) => {
  const term = String(req.query.q ?? '').trim();
  if (!term) return res.json([]);
  try { res.json(await searchFiles(String(req.query.driveId ?? ''), String(req.query.path ?? ''), term)); } catch (error) { fail(res, error); }
});
app.get('/api/fs/info', async (req, res) => {
  try {
    const { absolute } = await safePath(String(req.query.driveId ?? ''), String(req.query.path ?? ''));
    const stats = await fsp.stat(absolute);
    res.json({ name: path.basename(absolute), isDirectory: stats.isDirectory(), size: stats.size, created: stats.birthtime.toISOString(), modified: stats.mtime.toISOString(), accessed: stats.atime.toISOString() });
  } catch (error) { fail(res, error); }
});
app.post('/api/fs/folder', async (req, res) => {
  try {
    const parent = await safePath(String(req.body.driveId ?? ''), String(req.body.path ?? ''));
    await fsp.mkdir(path.join(parent.absolute, safeName(String(req.body.name ?? ''))));
    res.json({ ok: true });
  } catch (error) { fail(res, error); }
});
app.post('/api/fs/rename', async (req, res) => {
  try {
    const source = await safePath(String(req.body.driveId ?? ''), String(req.body.path ?? ''));
    if (!source.relative) throw Object.assign(new Error('A drive root cannot be renamed.'), { status: 400 });
    const destination = path.join(path.dirname(source.absolute), safeName(String(req.body.name ?? '')));
    if (fs.existsSync(destination)) throw Object.assign(new Error('A file with that name already exists.'), { status: 409 });
    await fsp.rename(source.absolute, destination);
    res.json({ ok: true });
  } catch (error) { fail(res, error); }
});
app.post('/api/fs/delete', async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [req.body];
    for (const item of items) {
      const target = await safePath(String(item.driveId ?? req.body.driveId ?? ''), String(item.path ?? ''));
      if (!target.relative) throw Object.assign(new Error('A drive root cannot be deleted.'), { status: 400 });
      await fsp.rm(target.absolute, { recursive: true, force: false });
    }
    res.json({ ok: true });
  } catch (error) { fail(res, error); }
});
app.post('/api/fs/copy', async (req, res) => {
  try {
    const source = await safePath(String(req.body.sourceDriveId ?? req.body.driveId ?? ''), String(req.body.sourcePath ?? ''));
    const destination = await safePath(String(req.body.destinationDriveId ?? req.body.driveId ?? ''), String(req.body.destinationPath ?? ''));
    if (!source.relative) throw Object.assign(new Error('A drive root cannot be copied.'), { status: 400 });
    const relativeDestination = path.relative(source.absolute, destination.absolute);
    if (source.drive.id === destination.drive.id && relativeDestination && !relativeDestination.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeDestination)) {
      throw Object.assign(new Error('A folder cannot be copied into itself.'), { status: 400 });
    }
    const target = path.join(destination.absolute, path.basename(source.absolute));
    if (fs.existsSync(target)) throw Object.assign(new Error('A file with that name already exists in the destination.'), { status: 409 });
    try { await copyTree(source.absolute, target); }
    catch (error) { await fsp.rm(target, { recursive: true, force: true }).catch(() => undefined); throw error; }
    res.json({ ok: true });
  } catch (error) { fail(res, error); }
});
app.post('/api/fs/move', async (req, res) => {
  try {
    const source = await safePath(String(req.body.sourceDriveId ?? req.body.driveId ?? ''), String(req.body.sourcePath ?? ''));
    const destination = await safePath(String(req.body.destinationDriveId ?? req.body.driveId ?? ''), String(req.body.destinationPath ?? ''));
    if (!source.relative) throw Object.assign(new Error('A drive root cannot be moved.'), { status: 400 });
    const relativeDestination = path.relative(source.absolute, destination.absolute);
    if (source.drive.id === destination.drive.id && relativeDestination && !relativeDestination.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeDestination)) {
      throw Object.assign(new Error('A folder cannot be moved into itself.'), { status: 400 });
    }
    const target = path.join(destination.absolute, path.basename(source.absolute));
    if (fs.existsSync(target)) throw Object.assign(new Error('A file with that name already exists.'), { status: 409 });
    try { await fsp.rename(source.absolute, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      try { await copyTree(source.absolute, target); }
      catch (copyError) { await fsp.rm(target, { recursive: true, force: true }).catch(() => undefined); throw copyError; }
      await fsp.rm(source.absolute, { recursive: true });
    }
    res.json({ ok: true });
  } catch (error) { fail(res, error); }
});
app.post('/api/fs/upload', upload.single('file'), async (req, res) => {
  const temporary = req.file?.path;
  let stagedPath: string | undefined;
  try {
    if (!req.file) throw Object.assign(new Error('Choose a file to upload.'), { status: 400 });
    const destination = await safePath(String(req.body.driveId ?? ''), String(req.body.path ?? ''));
    const relativeName = String(req.body.relativeName || req.file.originalname).replace(/\\/g, '/');
    if (relativeName.startsWith('/') || /^[a-zA-Z]:/.test(relativeName)) throw Object.assign(new Error('Invalid upload path.'), { status: 400 });
    const parts = relativeName.split('/').filter(Boolean);
    if (parts.some((part: string) => part === '.' || part === '..')) throw Object.assign(new Error('Invalid upload path.'), { status: 400 });
    const original = safeName(parts.pop() || req.file.originalname);
    let targetRelative = destination.relative;
    let targetFolder = destination.absolute;
    for (const part of parts) {
      targetRelative = path.join(targetRelative, safeName(part));
      const nested = await safePath(String(req.body.driveId ?? ''), targetRelative, true);
      targetFolder = nested.absolute;
      try {
        const stats = await fsp.lstat(targetFolder);
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw Object.assign(new Error('Upload folders must be real directories.'), { status: 403 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await fsp.mkdir(targetFolder);
      }
    }
    const conflict = String(req.body.conflict ?? '');
    const originalTarget = path.join(targetFolder, original);
    const exists = fs.existsSync(originalTarget);
    if (exists && conflict === 'cancel') return res.status(409).json({ error: 'Upload cancelled because the file already exists.' });
    if (exists && !['overwrite', 'rename'].includes(conflict)) return res.status(409).json({ conflict: true, name: original });
    const name = conflict === 'rename' ? uniqueName(targetFolder, original) : original;
    const target = path.join(targetFolder, name);
    const staged = path.join(targetFolder, `.localdrive-${crypto.randomUUID()}.uploading`);
    stagedPath = staged;
    await new Promise<void>((resolve, reject) => {
      const input = fs.createReadStream(req.file!.path);
      const output = fs.createWriteStream(staged, { flags: 'wx' });
      input.on('error', reject);
      output.on('error', reject);
      output.on('finish', resolve);
      input.pipe(output);
    });
    try {
      if (conflict === 'overwrite' && exists) {
        const current = await fsp.lstat(target);
        if (current.isSymbolicLink() || current.isDirectory()) throw Object.assign(new Error('Only regular files can be replaced.'), { status: 403 });
        await fsp.rm(target);
        await fsp.rename(staged, target);
      } else {
        try { await fsp.link(staged, target); }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(code || '')) throw error;
          await fsp.copyFile(staged, target, fs.constants.COPYFILE_EXCL);
        }
        await fsp.rm(staged, { force: true });
      }
    } catch (error) {
      await fsp.rm(staged, { force: true }).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Object.assign(new Error('A file with that name already exists.'), { status: 409 });
      throw error;
    }
    res.json({ ok: true, name });
  } catch (error) { fail(res, error); }
  finally {
    if (temporary) await fsp.rm(temporary, { force: true }).catch(() => undefined);
    if (stagedPath) await fsp.rm(stagedPath, { force: true }).catch(() => undefined);
  }
});
app.get('/api/fs/download', async (req, res) => {
  try {
    const target = await safePath(String(req.query.driveId ?? ''), String(req.query.path ?? ''));
    const stat = await fsp.stat(target.absolute);
    if (!stat.isFile()) return res.status(400).json({ error: 'Choose a file to download.' });
    res.download(target.absolute, path.basename(target.absolute));
  } catch (error) { fail(res, error); }
});
app.post('/api/fs/archive', async (req, res) => {
  let items = Array.isArray(req.body.items) ? req.body.items : [];
  if (typeof req.body.items === 'string') {
    try { items = JSON.parse(req.body.items); } catch { return res.status(400).json({ error: 'Invalid archive selection.' }); }
  }
  if (items.length === 0) return res.status(400).json({ error: 'Select at least one item.' });
  const archive = new yazl.ZipFile();
  try {
    for (const item of items) {
      const target = await safePath(String(item.driveId ?? ''), String(item.path ?? ''));
      await zipPath(archive, target.absolute, path.basename(target.absolute));
    }
  } catch (error) { archive.end(); fail(res, error); return; }
  res.attachment(items.length === 1 ? `${path.basename(String(items[0].path))}.zip` : 'LocalDrive-download.zip');
  archive.outputStream.on('error', (error) => { console.error(error); res.destroy(error); });
  archive.outputStream.pipe(res);
  archive.end();
});
app.get('/api/settings', async (_req, res) => {
  try { res.json({ host: process.env.HOST || privateAddress(), port: Number(process.env.PORT) || 3000, sessionDays, version: '1.0.0', drives: await listDrives() }); }
  catch (error) { fail(res, error); }
});

const webDirectory = path.join(projectRoot, 'dist');
if (fs.existsSync(webDirectory)) {
  app.use(express.static(webDirectory));
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(webDirectory, 'index.html'));
  });
}
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => fail(res, error));

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || privateAddress();
const server = createServer(app);
castHub.attach(server);
server.listen(port, host, () => console.log(`LocalDrive is available at http://${host}:${port}`));

declare module 'express-session' {
  interface SessionData { authenticated?: boolean }
}
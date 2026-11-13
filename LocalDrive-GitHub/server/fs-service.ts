import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export type DriveInfo = {
  id: string;
  name: string;
  mount: string;
  total: number;
  used: number;
  available: number;
};

export type FileEntry = {
  name: string;
  path: string;
  kind: 'file' | 'folder';
  size: number;
  modified: string;
  extension: string;
};

const rootKey = (mount: string) => Buffer.from(path.resolve(mount).toLowerCase()).toString('base64url');
let driveCache: DriveInfo[] = [];
let driveCacheAt = 0;
const driveCacheTtl = Math.max(5_000, Number(process.env.DRIVE_CACHE_TTL_MS) || 60_000);
const listConcurrency = Math.max(2, Math.min(32, Number(process.env.FS_LIST_CONCURRENCY) || 8));

async function mapWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function consume() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(listConcurrency, items.length) }, () => consume()));
  return results;
}

function allowedMount(mount: string): boolean {
  const allowed = (process.env.ALLOWED_ROOTS ?? '').split(';').map((item) => item.trim()).filter(Boolean);
  return allowed.length === 0 || allowed.some((item) => path.resolve(item).toLowerCase() === path.resolve(mount).toLowerCase());
}

export async function listDrives(): Promise<DriveInfo[]> {
  if (Date.now() - driveCacheAt < driveCacheTtl) return driveCache;
  const drives: DriveInfo[] = [];
  if (process.platform === 'win32') {
    for (let code = 67; code <= 90; code += 1) {
      const letter = String.fromCharCode(code);
      const mount = `${letter}:\\`;
      if (!allowedMount(mount)) continue;
      try { await fs.stat(mount); } catch { continue; }
      let total = 0;
      let available = 0;
      try {
        const stats = await fs.statfs(mount);
        total = Number(stats.blocks * stats.bsize) || 0;
        available = Number(stats.bavail * stats.bsize) || 0;
      } catch {
        // Some removable and network volumes do not report filesystem capacity.
      }
      drives.push({ id: rootKey(mount), name: `${letter}: Drive`, mount, total, available, used: Math.max(0, total - available) });
    }
  }
  driveCache = drives;
  driveCacheAt = Date.now();
  return driveCache;
}

export async function getDrive(id: string): Promise<DriveInfo> {
  const drive = (await listDrives()).find((item) => item.id === id);
  if (!drive) throw Object.assign(new Error('Drive is not available or is not allowed.'), { status: 404 });
  return drive;
}

function cleanRelative(input: string): string {
  if (input.includes('\0') || path.isAbsolute(input) || /^[a-zA-Z]:/.test(input)) {
    throw Object.assign(new Error('Invalid path.'), { status: 400 });
  }
  const normalized = input.replace(/[\\/]+/g, path.sep);
  if (normalized.split(path.sep).some((part) => part === '..')) {
    throw Object.assign(new Error('Invalid path.'), { status: 400 });
  }
  return normalized === '.' ? '' : normalized;
}

export async function safePath(driveId: string, relativeInput = '', allowMissing = false): Promise<{ drive: DriveInfo; absolute: string; relative: string }> {
  const drive = await getDrive(driveId);
  const relative = cleanRelative(relativeInput);
  const root = path.resolve(drive.mount);
  const absolute = path.resolve(root, relative);
  const relation = path.relative(root, absolute);
  if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw Object.assign(new Error('Path is outside the selected drive.'), { status: 400 });
  }
  let cursor = root;
  const parts = relative ? relative.split(path.sep) : [];
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    try {
      const stat = await fs.lstat(cursor);
      if (stat.isSymbolicLink()) throw Object.assign(new Error('Symbolic links are not available in LocalDrive.'), { status: 403 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissing && index === parts.length - 1) break;
      throw error;
    }
  }
  return { drive, absolute, relative };
}

export function safeName(input: string): string {
  const name = input.trim();
  if (!name || name === '.' || name === '..' || /[\\/:<>"|?*\x00-\x1f]/.test(name)) {
    throw Object.assign(new Error('Choose a valid file name.'), { status: 400 });
  }
  return name;
}

export async function listDirectory(driveId: string, relative = ''): Promise<FileEntry[]> {
  const { absolute } = await safePath(driveId, relative);
  const children = await fs.readdir(absolute, { withFileTypes: true });
  const entries = await mapWithConcurrency(children, async (child) => {
    if (child.isSymbolicLink()) return null;
    const childPath = path.join(relative, child.name).replace(/\\/g, '/');
    const stats = await fs.stat(path.join(absolute, child.name)).catch(() => null);
    if (!stats) return null;
    return {
      name: child.name,
      path: childPath,
      kind: child.isDirectory() ? 'folder' as const : 'file' as const,
      size: child.isDirectory() ? 0 : stats.size,
      modified: stats.mtime.toISOString(),
      extension: child.isDirectory() ? '' : path.extname(child.name).slice(1).toLowerCase(),
    };
  });
  return entries.filter((entry): entry is FileEntry => entry !== null);
}

export async function searchFiles(driveId: string, relative: string, term: string): Promise<FileEntry[]> {
  const { absolute } = await safePath(driveId, relative);
  const needle = term.toLocaleLowerCase();
  const found: FileEntry[] = [];
  let visited = 0;
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 12 || found.length >= 250 || visited >= 50000) return;
    let children;
    try { children = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const child of children) {
      visited += 1;
      if (visited > 50000) return;
      if (child.isSymbolicLink()) continue;
      const absoluteChild = path.join(directory, child.name);
      const relativeChild = path.relative(absolute, absoluteChild).replace(/\\/g, '/');
      if (child.name.toLocaleLowerCase().includes(needle)) {
        const stats = await fs.stat(absoluteChild).catch(() => null);
        if (stats) found.push({ name: child.name, path: path.posix.join(relative, relativeChild), kind: child.isDirectory() ? 'folder' : 'file', size: child.isDirectory() ? 0 : stats.size, modified: stats.mtime.toISOString(), extension: child.isDirectory() ? '' : path.extname(child.name).slice(1).toLowerCase() });
      }
      if (child.isDirectory() && found.length < 250) await visit(absoluteChild, depth + 1);
    }
  };
  await visit(absolute, 0);
  return found;
}

export async function copyTree(source: string, destination: string): Promise<void> {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw Object.assign(new Error('Copying symbolic links is not supported.'), { status: 403 });
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: false });
    for (const name of await fs.readdir(source)) await copyTree(path.join(source, name), path.join(destination, name));
  } else {
    await fs.copyFile(source, destination, fsSync.constants.COPYFILE_EXCL);
  }
}

export async function zipPath(archive: import('yazl').ZipFile, absolute: string, archiveName: string): Promise<void> {
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink()) throw Object.assign(new Error('Symbolic links cannot be added to downloads.'), { status: 403 });
  if (stat.isDirectory()) {
    const children = await fs.readdir(absolute);
    if (children.length === 0) archive.addEmptyDirectory(archiveName);
    for (const name of children) await zipPath(archive, path.join(absolute, name), path.posix.join(archiveName, name));
  } else {
    archive.addFile(absolute, archiveName);
  }
}

export function uniqueName(folder: string, original: string): string {
  const extension = path.extname(original);
  const stem = path.basename(original, extension);
  let index = 1;
  let candidate = original;
  while (fsSync.existsSync(path.join(folder, candidate))) candidate = `${stem} (${index++})${extension}`;
  return candidate;
}
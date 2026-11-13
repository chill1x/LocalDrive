import { randomUUID } from 'node:crypto';

const baseUrl = process.env.LOCALDRIVE_URL;
if (!baseUrl) throw new Error('Set LOCALDRIVE_URL to the address printed by LocalDrive, for example http://192.168.1.20:3000.');

let cookie = '';
let testFolder = '';
let testDrive = '';
let testFolderCreated = false;

async function request(route, options = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(new URL(route, baseUrl), { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';', 1)[0];
  return response;
}

async function json(route, method, value) {
  const response = await request(route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`);
  return response.json();
}

const unauthenticated = await fetch(new URL('/api/drives', baseUrl));
if (unauthenticated.status !== 401) throw new Error(`Unauthenticated drive access returned ${unauthenticated.status}, expected 401.`);
console.log('PASS unauthenticated file API is protected');

const login = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: process.env.LOCALDRIVE_TEST_USERNAME || 'root', password: process.env.LOCALDRIVE_TEST_PASSWORD || '' }),
});
if (!login.ok) throw new Error(`Sign-in failed: ${login.status} ${await login.text()}`);
console.log('PASS authenticated sign-in');

const drives = await json('/api/drives', 'GET');
if (!drives.length) throw new Error('No authorized drives were detected.');
console.log(`PASS drive discovery (${drives.length} volume${drives.length === 1 ? '' : 's'})`);

const places = await json('/api/places', 'GET');
const downloads = places.find((place) => place.name === 'Downloads');
if (!downloads) throw new Error('The host Downloads folder is unavailable; no test files were created.');
testDrive = downloads.driveId;
testFolder = `${downloads.path ? `${downloads.path}/` : ''}.localdrive-smoke-${randomUUID()}`;

try {
  await json('/api/fs/folder', 'POST', { driveId: testDrive, path: downloads.path, name: testFolder.split('/').at(-1) });
  testFolderCreated = true;
  const listed = await json(`/api/fs/list?driveId=${encodeURIComponent(testDrive)}&path=${encodeURIComponent(testFolder)}`, 'GET');
  if (!Array.isArray(listed) || listed.length !== 0) throw new Error('The new test folder did not list as empty.');
  console.log('PASS authorized folder browsing and creation');

  const payload = `LocalDrive smoke test ${randomUUID()}`;
  const form = new FormData();
  form.append('driveId', testDrive);
  form.append('path', testFolder);
  form.append('relativeName', 'smoke-test.txt');
  form.append('file', new Blob([payload], { type: 'text/plain' }), 'smoke-test.txt');
  const uploaded = await request('/api/fs/upload', { method: 'POST', body: form });
  if (!uploaded.ok) throw new Error(`Upload failed: ${uploaded.status} ${await uploaded.text()}`);
  console.log('PASS streamed upload');

  const download = await request(`/api/fs/download?driveId=${encodeURIComponent(testDrive)}&path=${encodeURIComponent(`${testFolder}/smoke-test.txt`)}`);
  if (!download.ok || await download.text() !== payload) throw new Error('Downloaded file did not match the uploaded content.');
  console.log('PASS file download content');

  const zipped = await request('/api/fs/archive', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ driveId: testDrive, path: `${testFolder}/smoke-test.txt` }] }),
  });
  const zipHeader = Buffer.from(await zipped.arrayBuffer()).subarray(0, 2);
  if (!zipped.ok || zipHeader[0] !== 0x50 || zipHeader[1] !== 0x4b) throw new Error('ZIP download did not return a ZIP archive.');
  console.log('PASS streamed ZIP download');

  await json('/api/fs/rename', 'POST', { driveId: testDrive, path: `${testFolder}/smoke-test.txt`, name: 'renamed.txt' });
  await json('/api/fs/delete', 'POST', { driveId: testDrive, items: [{ path: `${testFolder}/renamed.txt` }] });
  console.log('PASS rename and delete');
} finally {
  if (testFolderCreated) {
    const cleanup = await request('/api/fs/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ driveId: testDrive, items: [{ path: testFolder }] }) });
    if (!cleanup.ok) console.error(`Cleanup failed for ${testFolder}: ${cleanup.status}`);
  }
}
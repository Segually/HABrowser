import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

export const MAX_BYTES = 128 * 1024 * 1024;
export function unityDataPath(url) { return new URL('.', url).href.replace(/\/$/, ''); }
const STORE = 'FILE_DATA', GENERAL = 'General/general_';
function request(req) { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
function completed(tx) { return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error('Save transaction failed')); }); }
export async function openSaves(factory = indexedDB) {
  const req = factory.open('/idbfs', 21);
  req.onupgradeneeded = () => {
    const db = req.result;
    const store = db.objectStoreNames.contains(STORE) ? req.transaction.objectStore(STORE) : db.createObjectStore(STORE);
    if (!store.indexNames.contains('timestamp')) store.createIndex('timestamp', 'timestamp', { unique: false });
  };
  return request(req);
}
export async function readSaves(db) {
  const tx = db.transaction(STORE, 'readonly'), done = completed(tx), rows = [];
  await new Promise((resolve, reject) => {
    const req = tx.objectStore(STORE).openCursor();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const cursor = req.result; if (!cursor) return resolve(); rows.push({ key: cursor.key, value: cursor.value }); cursor.continue(); };
  });
  await done; return rows;
}
export function saveRoot(rows, expected) {
  const roots = [...new Set(rows.map(r => typeof r.key === 'string' && r.key.match(/^\/idbfs\/([^/]+)/)?.[0]).filter(Boolean))];
  if (roots.includes(expected)) return expected;
  if (roots.length > 1) throw new Error('Multiple game save folders found. Open the game from this site first.');
  return roots[0] || expected;
}
function validPath(p) { return typeof p === 'string' && p.length > 0 && p.length < 1024 && !p.startsWith('/') && !p.includes('\\') && !p.includes('\0') && p.split('/').every(s => s && s !== '.' && s !== '..'); }
export function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
export async function makeBackup(rows, root, scope) {
  if (!['all', 'general'].includes(scope)) throw new Error('Invalid backup scope');
  const files = Object.create(null), entries = []; let total = 0;
  for (const { key, value } of rows) {
    if (typeof key !== 'string' || !key.startsWith(root + '/')) continue;
    const relative = key.slice(root.length + 1);
    if (scope === 'general' && relative !== GENERAL) continue;
    if (!validPath(relative)) throw new Error('Invalid save path');
    const type = value.mode & 0xf000;
    if (![0x4000, 0x8000].includes(type)) throw new Error('Unsupported save entry');
    const entry = { path: relative, mode: value.mode, directory: type === 0x4000 };
    if (!entry.directory) {
      const contents = value.contents instanceof Blob ? new Uint8Array(await value.contents.arrayBuffer()) : new Uint8Array(value.contents);
      total += contents.length; if (total > MAX_BYTES) throw new Error('Save exceeds the 128 MB transfer limit');
      files['data/' + relative] = contents;
    }
    entries.push(entry);
  }
  if (!entries.some(e => !e.directory)) throw new Error('No saved files found for this selection. Play and save first.');
  files['manifest.json'] = strToU8(JSON.stringify({ format: 'ha-browser-save', version: 1, scope, entries }));
  const archive = zipSync(files, { level: 0 });
  if (archive.length > MAX_BYTES || entries.length > 20000 || files['manifest.json'].length > 4 * 1024 * 1024) throw new Error('Save exceeds the transfer limit');
  return archive;
}

// Inspect central directory limits before decompression, then verify CRCs.
function inspectZip(bytes) {
  if (bytes.length > MAX_BYTES || bytes.length < 22) throw new Error('Invalid ZIP or ZIP exceeds 128 MB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error('Invalid ZIP directory');
  const count = view.getUint16(end + 10, true), centralSize = view.getUint32(end + 12, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count > 20000 || count === 65535) throw new Error('Unsupported ZIP');
  let offset = view.getUint32(end + 16, true), total = 0;
  const start = offset, entries = new Map();
  if (start + centralSize !== end) throw new Error('Invalid ZIP bounds');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 24, true), nameLength = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > end || flags & 1 || ![0, 8].includes(method)) throw new Error('Unsupported ZIP entry');
    const name = strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!validPath(name) || entries.has(name)) throw new Error('Unsafe or duplicate ZIP path');
    total += size; if (total > MAX_BYTES) throw new Error('Expanded ZIP exceeds 128 MB');
    entries.set(name, { size, crc: view.getUint32(offset + 16, true) }); offset = next;
  }
  if (offset !== end) throw new Error('Invalid ZIP directory size');
  return entries;
}
export function parseBackup(bytes) {
  const expected = inspectZip(bytes), files = unzipSync(bytes);
  for (const [name, info] of expected) {
    if (!files[name] || files[name].length !== info.size || crc32(files[name]) !== info.crc) throw new Error('ZIP integrity check failed');
  }
  if (!files['manifest.json'] || files['manifest.json'].length > 4 * 1024 * 1024) throw new Error('Not a Hybrid Animals browser backup');
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  if (manifest.format !== 'ha-browser-save' || manifest.version !== 1 || !['all', 'general'].includes(manifest.scope) || !Array.isArray(manifest.entries) || manifest.entries.length > 20000) throw new Error('Unsupported backup format');
  const seen = new Set();
  const rows = manifest.entries.map(entry => {
    const { path, mode, directory } = entry;
    if (!validPath(path) || seen.has(path) || !Number.isInteger(mode) || typeof directory !== 'boolean' || (mode & 0xf000) !== (directory ? 0x4000 : 0x8000)) throw new Error('Invalid backup entry');
    if (manifest.scope === 'general' && (path !== GENERAL || directory)) throw new Error('General backup contains other files');
    seen.add(path);
    const contents = files['data/' + path];
    if (!directory && !contents) throw new Error('Backup is missing file contents');
    return { path, value: { mode, ...(!directory && { contents }), timestamp: new Date() } };
  });
  const byPath = new Map(rows.map(row => [row.path, row]));
  for (const row of rows) {
    const parts = row.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const ancestor = byPath.get(parts.slice(0, i).join('/'));
      if (ancestor && (ancestor.value.mode & 0xf000) !== 0x4000) throw new Error('Backup has conflicting file and directory paths');
    }
  }
  if (!rows.some(r => r.value.contents)) throw new Error('Backup has no saved files');
  return { scope: manifest.scope, rows };
}
export async function restoreBackup(db, backup, root) {
  if (!/^\/idbfs\/[^/]+$/.test(root)) throw new Error('Invalid destination folder');
  const tx = db.transaction(STORE, 'readwrite'), done = completed(tx), store = tx.objectStore(STORE);
  // Keep unrelated worlds and cached data. All writes commit together or abort.
  const directories = new Set([root]);
  for (const row of backup.rows) {
    let parent = root;
    for (const part of row.path.split('/').slice(0, -1)) { parent += '/' + part; directories.add(parent); }
  }
  for (const dir of directories) store.put({ mode: 0x41ff, timestamp: new Date() }, dir);
  for (const row of backup.rows) store.put(row.value, root + '/' + row.path);
  await done;
}

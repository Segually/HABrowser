import { openSaves, readSaves, saveRoot, makeBackup, parseBackup, restoreBackup, unityDataPath, MAX_BYTES } from './save-core.js';

const status = document.querySelector('#save-status');
const selectedScope = () => document.querySelector('input[name="save-scope"]:checked').value;
const exportButton = document.querySelector('#export-save'), input = document.querySelector('#import-save');
const importButton = document.querySelector('#import-trigger');
importButton.addEventListener('click', () => input.click());
const confirmButton = document.querySelector('#confirm-import'), cancelButton = document.querySelector('#cancel-import');
let pending;
const expectedRoot = () => '/idbfs/' + window.md5(unityDataPath(location.href));
const say = message => { status.textContent = message; };
function clearImport() { pending = undefined; input.value = ''; confirmButton.hidden = cancelButton.hidden = true; }
async function withDB(work) { const db = await openSaves(); try { return await work(db); } finally { db.close(); } }
async function inventory() {
  await withDB(async db => {
    const rows = await readSaves(db), root = saveRoot(rows, expectedRoot());
    const saved = rows.filter(r => typeof r.key === 'string' && r.key.startsWith(root + '/') && (r.value.mode & 0xf000) === 0x8000);
    say(saved.length ? `${saved.length} saved files found. general_: ${saved.some(r => r.key === root + '/General/general_') ? 'available' : 'not saved yet'}.` : 'No saved data yet. Play and save before exporting.');
  });
}
exportButton.addEventListener('click', async () => {
  clearImport(); exportButton.disabled = true; say('Preparing ZIP…');
  const scope = selectedScope();
  try {
    const bytes = await withDB(async db => { const rows = await readSaves(db); return makeBackup(rows, saveRoot(rows, expectedRoot()), scope); });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const link = document.createElement('a'); link.href = url; link.download = `hybrid-animals-${scope}-${new Date().toISOString().slice(0, 10)}.zip`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    say(`Exported ${scope === 'general' ? 'general_ (login and purchases)' : 'all game data'} as ZIP.`);
  } catch (error) { say(error.message); } finally { exportButton.disabled = false; }
});
input.addEventListener('change', async () => {
  const file = input.files[0]; if (!file) return;
  pending = undefined; confirmButton.hidden = cancelButton.hidden = true;
  try {
    if (file.size > MAX_BYTES) throw new Error('ZIP exceeds 128 MB');
    say('Checking ZIP…'); pending = parseBackup(new Uint8Array(await file.arrayBuffer()));
    const count = pending.rows.filter(r => r.value.contents).length;
    say(`Ready to import ${count} ${count === 1 ? 'file' : 'files'} (${pending.scope === 'general' ? 'general_: login and purchases only' : 'all game data'}). Matching saved files will be replaced. Close all game tabs first.`);
    confirmButton.hidden = cancelButton.hidden = false;
  } catch (error) { clearImport(); say(error.message); }
});
confirmButton.addEventListener('click', async () => {
  if (!pending) return; const backup = pending;
  confirmButton.disabled = cancelButton.disabled = input.disabled = importButton.disabled = exportButton.disabled = true;
  try {
    await withDB(async db => { const rows = await readSaves(db); await restoreBackup(db, backup, saveRoot(rows, expectedRoot())); });
    clearImport(); say('Imported successfully. Open Play to load the imported data.');
  } catch (error) { say(`Import failed; saved data was not changed. ${error.message}`); }
  finally { confirmButton.disabled = cancelButton.disabled = input.disabled = importButton.disabled = exportButton.disabled = false; }
});
cancelButton.addEventListener('click', () => { clearImport(); inventory().catch(error => say(error.message)); });
inventory().catch(error => say(`Save storage unavailable: ${error.message}`));

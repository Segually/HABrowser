import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.argv[2] || path.join(root, '../Builds/HA_WASM'));
await mkdir(path.join(root, 'public'), { recursive: true });
// Keep the tracked stylesheet, including the splash page, across Unity builds.
await cp(source, path.join(root, 'public'), {
  recursive: true,
  filter: file => path.relative(source, file) !== 'style.css'
});
console.log(`Copied ${source} into WorkingServer/public`);

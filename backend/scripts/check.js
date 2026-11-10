import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
function visit(path) { return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? visit(join(path, entry.name)) : entry.name.endsWith('.js') ? [join(path, entry.name)] : []); }
for (const file of ['src', 'public', 'scripts', 'test'].flatMap(visit)) { const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }); if (r.status !== 0) { console.error(r.stderr); process.exit(1); } }
console.log('All JavaScript syntax checks passed.');

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PublicDataService } from '../src/adapters/public-data.js';
const config = JSON.parse(readFileSync(new URL('../config/data-sources.json',import.meta.url),'utf8'));
const service = new PublicDataService({ config, directory: fileURLToPath(new URL('../data/real-sources/',import.meta.url)) });
const result = await service.refresh({ force: true });
for (const source of result.sources) console.log(`${source.id}: ${source.status} ${source.snapshotId ?? ''} ${source.lastError?.message ?? ''}`);
if (result.sources.some(x => x.status !== 'available')) process.exitCode = 1;
await service.stop();

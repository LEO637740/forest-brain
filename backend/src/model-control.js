import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { invariant } from './errors.js';

// Validation scripts keep results outside the application DB, but still obey
// its persisted paid-model switch. Read only; never create or migrate that DB.
export function assertPersistedModelEnabled(dbPath) {
  if (!existsSync(dbPath)) return;
  const db = new DatabaseSync(dbPath, {readOnly:true});
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='model_control'").get()) return;
    const state = db.prepare('SELECT paused FROM model_control WHERE id=1').get();
    invariant(!state?.paused,'MODEL_PAUSED','模型调用已暂停，付费验证脚本也已阻止；需先在页面显式恢复模型调用',409);
  } finally { db.close(); }
}

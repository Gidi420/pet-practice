// backup.js — export/import a JSON backup of settings, history and answer files
// (never the PDFs).

import * as db from './db.js';
import { getSettings, saveSettings } from './config.js';

export async function buildBackup() {
  const [attempts, sims, answerSheets, reviewState, seen, best] = await Promise.all([
    db.getAllAttempts(), db.getAllSimResults(), db.getAllAnswerSheets(),
    db.kvGet('reviewState', {}), db.kvGet('seen', {}), db.kvGet('simBest', {}),
  ]);
  return {
    type: 'pet-practice-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    answerSheets,
    attempts,
    sims,
    kv: { reviewState, seen, simBest: best },
  };
}

export async function exportBackup() {
  const data = await buildBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url; a.download = `pet-backup-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function importBackup(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data.type !== 'pet-practice-backup') throw new Error('קובץ גיבוי לא תקין');

  if (data.settings) saveSettings(data.settings);

  // answer sheets
  if (Array.isArray(data.answerSheets)) {
    for (const s of data.answerSheets) { const { importedAt, ...sheet } = s; await db.putAnswerSheet(sheet); }
  }
  // history (replace to avoid duplicates)
  await db.clearAttempts();
  if (Array.isArray(data.attempts)) await db.importAttempts(data.attempts);
  await db.clearSimResults();
  if (Array.isArray(data.sims)) await db.importSimResults(data.sims);
  // kv
  if (data.kv) {
    if (data.kv.reviewState) await db.kvSet('reviewState', data.kv.reviewState);
    if (data.kv.seen) await db.kvSet('seen', data.kv.seen);
    if (data.kv.simBest) await db.kvSet('simBest', data.kv.simBest);
  }
  return {
    tests: data.answerSheets?.length || 0,
    attempts: data.attempts?.length || 0,
    sims: data.sims?.length || 0,
  };
}

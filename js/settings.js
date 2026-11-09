// settings.js — Settings screen, Tests management (import/validate/match), backup.

import { h, clear, toast, confirmDialog, sheet, segmented, haptic } from './ui.js';
import { t, getSettings, saveSettings, APP_VERSION } from './config.js';
import * as db from './db.js';
import { importAnswerFiles, matchPdf, storePdf, listTests, deleteTest, parseTestId } from './tests.js';
import { loadPdfjs } from './pdfview.js';
import { exportBackup, importBackup } from './backup.js';
import { resetStats } from './stats.js';
import { applyAppearance } from './app.js';

// ---- Settings screen -------------------------------------------------------

export async function renderSettings(root) {
  const s = getSettings();
  const wrap = h('div', { class: 'screen settings' });
  wrap.appendChild(h('h1', { class: 'screen-title', text: t('set.title') }));

  // Tests
  wrap.appendChild(card(t('set.tests'), [
    h('a', { class: 'row-link', href: '#/tests' },
      h('div', {}, h('div', { text: t('set.tests') }), h('div', { class: 'muted small', text: t('set.testsDesc') })),
      h('span', { class: 'chev', text: '‹' }),
    ),
  ]));

  // Appearance
  wrap.appendChild(card(t('set.appearance'), [
    settingRow(t('set.language'), segmented(
      [{ value: 'he', label: 'עברית' }, { value: 'en', label: 'English' }], s.lang,
      (v) => { saveSettings({ lang: v }); renderSettings(root); })),
    settingRow(t('set.theme'), segmented(
      [{ value: 'auto', label: t('set.theme.auto') }, { value: 'light', label: t('set.theme.light') }, { value: 'dark', label: t('set.theme.dark') }],
      s.theme, (v) => { saveSettings({ theme: v }); renderSettings(root); })),
    toggleRow(t('set.invertPdf'), s.invertPdfInDark, (v) => saveSettings({ invertPdfInDark: v })),
  ]));

  // Timing
  wrap.appendChild(card(t('set.timings'), [
    numberRow(t('set.timeVerbal'), s.timePerVerbal, 10, 300, (v) => saveSettings({ timePerVerbal: v })),
    numberRow(t('set.timeQuant'), s.timePerQuant, 10, 300, (v) => saveSettings({ timePerQuant: v })),
    toggleRow(t('set.weakWeight'), s.weakTopicWeighting, (v) => saveSettings({ weakTopicWeighting: v })),
  ]));

  // Exam date
  wrap.appendChild(card(t('stats.examCountdown'), [
    settingRow(t('set.examDate'), h('input', {
      type: 'date', class: 'date-input', value: s.examDate,
      onchange: (e) => saveSettings({ examDate: e.target.value }),
    })),
  ]));

  // Data
  const storageLine = h('div', { class: 'muted small', text: '…' });
  showStorage(storageLine);
  wrap.appendChild(card(t('set.data'), [
    h('p', { class: 'muted small', text: t('set.exportDesc') }),
    h('button', { class: 'btn btn-secondary wide', text: t('set.export'), onclick: () => exportBackup() }),
    fileButton(t('set.import'), '.json,application/json', false, async (files) => {
      if (!files[0]) return;
      const ok = await confirmDialog('ייבוא גיבוי יחליף את ההיסטוריה הנוכחית. להמשיך?', { okText: t('set.import') });
      if (!ok) return;
      try {
        const r = await importBackup(files[0]);
        applyAppearance();
        toast(`יובא: ${r.tests} מבחנים, ${r.attempts} רשומות`);
        renderSettings(root);
      } catch (e) { toast('שגיאה בייבוא: ' + (e.message || e)); }
    }),
    h('button', { class: 'btn btn-danger-ghost wide', text: t('stats.resetStats'), onclick: async () => {
      const ok = await confirmDialog(t('stats.resetConfirm'), { okText: t('stats.resetStats'), danger: true });
      if (ok) { await resetStats(); toast('הסטטיסטיקה אופסה'); }
    }}),
    storageLine,
  ]));

  // About
  const installSlot = h('div', {});
  const renderInstall = () => {
    clear(installSlot);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const desktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (standalone) {
      if (desktop) installSlot.appendChild(h('p', { class: 'muted small', text: '✓ ' + t('set.installed') }));
    } else if (window.__installPrompt) {
      installSlot.appendChild(h('button', { class: 'btn btn-secondary wide', text: '⤓ ' + t('set.install'), onclick: async () => {
        const p = window.__installPrompt;
        if (!p) return;
        p.prompt();
        try { await p.userChoice; } catch {}
        window.__installPrompt = null;
        renderInstall();
      }}));
    } else if (desktop) {
      installSlot.appendChild(h('p', { class: 'muted small', text: t('set.installHint') }));
    }
  };
  renderInstall();
  document.addEventListener('install-available', renderInstall);

  wrap.appendChild(card(t('set.about'), [
    settingRow(t('set.version'), h('span', { class: 'muted', text: APP_VERSION })),
    installSlot,
  ]));

  clear(root).appendChild(wrap);
  return { destroy() { document.removeEventListener('install-available', renderInstall); } };
}

async function showStorage(el) {
  const est = await db.storageEstimate();
  if (est && est.usage != null) {
    const mb = (est.usage / 1048576).toFixed(1);
    const quota = est.quota ? (est.quota / 1048576).toFixed(0) : '?';
    el.textContent = `${t('set.storage')}: ${mb}MB / ${quota}MB`;
  } else {
    el.textContent = '';
  }
}

// ---- Tests management ------------------------------------------------------

export async function renderTests(root) {
  const wrap = h('div', { class: 'screen tests-screen' });
  wrap.appendChild(h('div', { class: 'screen-head' },
    h('a', { class: 'back-link', href: '#/settings', text: '‹ ' + t('common.back') }),
    h('h1', { class: 'screen-title', text: t('tests.title') }),
  ));

  wrap.appendChild(h('div', { class: 'ob-note small', text: t('onboard.note') }));

  const actions = h('div', { class: 'import-actions' },
    fileButton(t('tests.importAnswers'), '.json,application/json', true, (files) => doImportAnswers(root, files)),
    fileButton(t('tests.importPdfs'), 'application/pdf,.pdf', true, (files) => doImportPdfs(root, files)),
  );
  wrap.appendChild(actions);

  const listEl = h('div', { class: 'tests-list' });
  wrap.appendChild(listEl);
  await renderTestList(listEl, root);

  clear(root).appendChild(wrap);
  return { destroy() {} };
}

async function renderTestList(listEl, root) {
  const [rows, best] = await Promise.all([listTests(), db.kvGet('simBest', {})]);
  clear(listEl);
  if (!rows.length) { listEl.appendChild(h('p', { class: 'muted', text: t('tests.empty') })); return; }
  for (const r of rows) {
    let status, cls;
    if (r.ready) { status = '✅ ' + t('tests.ready'); cls = 'ready'; }
    else if (!r.hasPdf) { status = '⚠️ ' + t('tests.pdfMissing'); cls = 'warn'; }
    else { status = '⚠️ ' + t('tests.answersMissing'); cls = 'warn'; }

    const tb = best[r.id] || {};
    const bestChips = Object.entries(tb).map(([secId, b]) =>
      h('span', { class: 'mini-chip', text: `${secId.startsWith('verbal') ? 'מ' : 'כ'}${secId.endsWith('-2') ? '2' : '1'} ${Math.round(b.pct * 100)}%` }));

    listEl.appendChild(h('div', { class: 'test-row ' + cls },
      h('div', { class: 'test-row-main' },
        h('div', { class: 'test-row-title', text: r.title || r.id }),
        h('div', { class: 'test-row-sub' },
          h('span', { class: 'status-badge ' + cls, text: status }),
          r.hasPdf ? h('span', { class: 'muted tiny', text: ` · ${(r.pdfSize / 1048576).toFixed(1)}MB` }) : null,
          r.hasExpl ? h('span', { class: 'muted tiny', text: ` · 💡 ${t('tests.hasExpl')}` }) : null,
        ),
        bestChips.length ? h('div', { class: 'best-chips' }, ...bestChips) : null,
      ),
      h('button', { class: 'icon-btn del', 'aria-label': t('common.delete'), text: '🗑', onclick: async () => {
        const ok = await confirmDialog(t('tests.deleteConfirm'), { okText: t('common.delete'), danger: true });
        if (ok) { await deleteTest(r.id); renderTestList(listEl, root); }
      }}),
    ));
  }
}

async function doImportAnswers(root, files) {
  const res = await importAnswerFiles(files);
  await db.requestPersistent();
  let msg = `${t('tests.importedN')}: ${res.imported.length}`;
  if (res.rejected.length) msg += ` · ${t('tests.rejected')}: ${res.rejected.length}`;
  toast(msg);
  if (res.rejected.length) {
    showRejected(res.rejected);
  }
  renderTests(root);
}

function showRejected(rejected) {
  sheet((close) => {
    const panel = h('div', { class: 'reject-sheet' });
    panel.appendChild(h('h3', { text: t('tests.rejected') }));
    for (const r of rejected) {
      panel.appendChild(h('div', { class: 'reject-row' },
        h('b', { text: r.name }),
        h('ul', {}, ...r.errors.map((e) => h('li', { text: e }))),
      ));
    }
    panel.appendChild(h('button', { class: 'btn btn-ghost', text: t('common.close'), onclick: close }));
    return panel;
  });
}

async function pdfPageCount(arrayBuffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
  const n = doc.numPages;
  try { doc.destroy(); } catch {}
  return n;
}

async function doImportPdfs(root, files) {
  await db.requestPersistent();
  const sheets = await db.getAllAnswerSheets();
  let imported = 0, warned = 0;
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      let pageCount = null;
      try { pageCount = await pdfPageCount(buf); } catch {}
      const m = matchPdf(file.name, pageCount, sheets);
      let testId = m.testId;
      if (!testId) {
        testId = await askWhichTest(file.name, sheets);
        if (!testId) continue; // skipped
      }
      await storePdf(testId, file.name, buf, pageCount);
      imported++;
      if (m.pageMismatch) { warned++; toast(t('tests.pageCountWarn')); }
    } catch (e) {
      toast('שגיאה: ' + file.name);
    }
  }
  toast(`${t('tests.importedN')}: ${imported}`);
  renderTests(root);
}

function askWhichTest(fileName, sheets) {
  return new Promise((resolve) => {
    const close = sheet((closeFn) => {
      const panel = h('div', { class: 'match-sheet' });
      panel.appendChild(h('h3', { text: t('tests.matchPrompt') }));
      panel.appendChild(h('p', { class: 'muted small', text: fileName }));
      const list = h('div', { class: 'match-list' });
      for (const s of sheets) {
        list.appendChild(h('button', { class: 'btn btn-ghost wide', text: s.title,
          onclick: () => { closeFn(); resolve(s.id); } }));
      }
      panel.appendChild(list);
      panel.appendChild(h('button', { class: 'btn btn-ghost wide', text: t('common.cancel'),
        onclick: () => { closeFn(); resolve(null); } }));
      return panel;
    });
  });
}

// ---- small building blocks -------------------------------------------------

function card(title, children) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-title', text: title }),
    ...children.filter(Boolean),
  );
}
function settingRow(label, control) {
  return h('div', { class: 'setting-row' }, h('span', { class: 'setting-label', text: label }), control);
}
function toggleRow(label, value, onChange) {
  const input = h('input', { type: 'checkbox', class: 'switch', checked: value, onchange: (e) => { haptic('light'); onChange(e.target.checked); } });
  return h('label', { class: 'setting-row toggle' }, h('span', { class: 'setting-label', text: label }), input);
}
function numberRow(label, value, min, max, onChange) {
  return settingRow(label, h('input', {
    type: 'number', class: 'num-input', value, min, max, inputmode: 'numeric',
    onchange: (e) => { let v = parseInt(e.target.value, 10); if (isNaN(v)) v = value; v = Math.max(min, Math.min(max, v)); e.target.value = v; onChange(v); },
  }));
}
function fileButton(label, accept, multiple, onFiles) {
  const input = h('input', { type: 'file', accept, multiple, class: 'hidden-file',
    onchange: (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) onFiles(files); } });
  const btn = h('label', { class: 'btn btn-primary wide file-btn' }, label, input);
  return btn;
}

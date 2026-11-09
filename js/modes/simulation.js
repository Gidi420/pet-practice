// modes/simulation.js — timed section / full-test simulation with free
// navigation, a question grid, continuous save/resume, and scored results.

import { h, clear, confirmDialog, sheet as bottomSheet, haptic, toast, pct, bindKeys, answerKey } from '../ui.js';
import { t, domainLabel, topicLabel, getSettings } from '../config.js';
import { getReadyTests, questionsForSheet, getExplanation } from '../tests.js';
import * as db from '../db.js';
import { PageViewer } from '../pdfview.js';
import { Countdown, Stopwatch, formatClock, formatDuration } from '../timer.js';
import { estimateFromRaw } from '../scoring.js';
import { logAttempt, newSessionId } from '../stats.js';
const addSimResult = db.addSimResult;

const STATE_KEY = 'simState';
const BEST_KEY = 'simBest';

function sectionNumber(id) { return id.endsWith('-2') ? 2 : 1; }
function sectionLabel(sheet, id) {
  const sec = sheet.sections.find((s) => s.id === id);
  return `${domainLabel(sec.domain)} ${sectionNumber(id)}`;
}
function topicOf(section, n) {
  const b = (section.topics || []).find((tp) => n >= tp.from && n <= tp.to);
  return b ? b.topic : 'unknown';
}

// ---- entry: router dispatch -------------------------------------------------

export async function renderSimulation(root, params) {
  const saved = await db.kvGet(STATE_KEY, null);
  if (params && params.run) {
    if (saved) return runSimulation(root, saved);
    location.hash = '#/sim';
    return { destroy() {} };
  }
  return renderSimHome(root, saved);
}

// ---- home: resume banner + test/section picker -----------------------------

async function renderSimHome(root, saved) {
  const tests = await getReadyTests();
  const best = (await db.kvGet(BEST_KEY, {})) || {};
  const wrap = h('div', { class: 'screen sim-home' });
  wrap.appendChild(h('h1', { class: 'screen-title', text: t('sim.title') }));

  if (saved) {
    const sh = tests.find((x) => x.id === saved.testId);
    wrap.appendChild(h('div', { class: 'resume-card' },
      h('div', {},
        h('b', { text: t('sim.resume') }),
        h('p', { class: 'muted', text: sh ? sh.title : saved.testId }),
      ),
      h('div', { class: 'resume-actions' },
        h('button', { class: 'btn btn-primary', text: t('sim.resume'), onclick: () => { location.hash = '#/sim/run'; } }),
        h('button', { class: 'btn btn-ghost', text: t('sim.discard'), onclick: async () => { await db.kvDelete(STATE_KEY); renderSimHome(root, null); } }),
      ),
    ));
  }

  if (!tests.length) {
    wrap.appendChild(h('div', { class: 'empty-state' },
      h('p', { text: t('q.noQuestions') }),
      h('a', { class: 'btn btn-primary', href: '#/tests', text: t('onboard.cta') })));
    clear(root).appendChild(wrap);
    return { destroy() {} };
  }

  wrap.appendChild(h('p', { class: 'section-label', text: t('sim.pickTest') }));
  const list = h('div', { class: 'test-pick-list' });
  for (const test of tests) {
    const tb = best[test.id] || {};
    const card = h('div', { class: 'test-pick' });
    card.appendChild(h('div', { class: 'test-pick-head', text: test.title }));
    const secRow = h('div', { class: 'sec-pick-row' });
    for (const secId of ['verbal-1', 'verbal-2', 'quant-1', 'quant-2']) {
      const b = tb[secId];
      secRow.appendChild(h('button', { class: 'sec-pick' + (b ? ' done' : ''),
        onclick: () => startSimulation(root, test.id, [secId], 'section') },
        h('span', { text: secLabelShort(secId) }),
        b ? h('span', { class: 'sec-best', text: `${t('tests.bestScore')} ${Math.round(b.pct * 100)}%` }) : null,
      ));
    }
    card.appendChild(secRow);
    card.appendChild(h('button', { class: 'btn btn-primary full-btn', text: t('sim.fullTest'),
      onclick: () => startSimulation(root, test.id, ['verbal-1', 'verbal-2', 'quant-1', 'quant-2'], 'full') }));
    list.appendChild(card);
  }
  wrap.appendChild(list);
  clear(root).appendChild(wrap);
  return { destroy() {} };
}

function secLabelShort(id) {
  const dom = id.startsWith('verbal') ? 'מילולי' : 'כמותי';
  return `${dom} ${sectionNumber(id)}`;
}

// ---- start a fresh simulation ----------------------------------------------

async function startSimulation(root, testId, sections, mode) {
  const sheets = await getReadyTests();
  const sheet = sheets.find((s) => s.id === testId);
  if (!sheet) { toast('מבחן לא נמצא'); return; }
  const now = Date.now();
  const firstSec = sheet.sections.find((s) => s.id === sections[0]);
  const state = {
    testId, mode, sections, currentIndex: 0, phase: 'running',
    sessionId: newSessionId(), startedAt: now,
    perSection: {},
  };
  state.perSection[sections[0]] = freshSection(firstSec, now);
  await db.kvSet(STATE_KEY, state);
  location.hash = '#/sim/run';
}

function freshSection(section, now) {
  return {
    endTime: now + section.minutes * 60 * 1000,
    answers: {}, flags: {}, timeMsPerQ: {}, currentQ: 1,
    submitted: false, startedAt: now,
  };
}

// ---- running screen ---------------------------------------------------------

async function runSimulation(root, state) {
  const sheets = await getReadyTests();
  const sheet = sheets.find((s) => s.id === state.testId);
  if (!sheet) { await db.kvDelete(STATE_KEY); location.hash = '#/sim'; return { destroy() {} }; }

  if (state.phase === 'break') return renderBreak(root, sheet, state);

  const secId = state.sections[state.currentIndex];
  const section = sheet.sections.find((s) => s.id === secId);
  const ps = state.perSection[secId];

  const descriptors = questionsForSheet(sheet).filter((q) => q.sectionId === secId);
  const qById = new Map(descriptors.map((q) => [q.n, q]));

  let currentQ = ps.currentQ || 1;
  const qStopwatch = new Stopwatch();
  let countdown = null;
  let viewer = null;
  let destroyed = false;

  // ---- DOM
  const screen = h('div', { class: 'sim-run' });
  const timerEl = h('div', { class: 'sim-timer' });
  const secLabel = h('div', { class: 'sim-seclabel', text: sectionLabel(sheet, secId) });
  const gridBtn = h('button', { class: 'sim-gridbtn', text: '▦ ' + t('sim.grid'), onclick: openGrid });
  const submitBtn = h('button', { class: 'sim-submit', text: t('sim.submit'), onclick: () => doSubmit(false) });
  const topbar = h('div', { class: 'sim-topbar' }, timerEl, secLabel, gridBtn, submitBtn);

  const posEl = h('div', { class: 'sim-pos' });
  const viewerEl = h('div', { class: 'q-viewer' });
  const navPrevPage = h('button', { class: 'q-pagebtn q-prev', text: '‹', onclick: () => viewer && viewer.prev() });
  const navNextPage = h('button', { class: 'q-pagebtn q-next', text: '›', onclick: () => viewer && viewer.next() });
  const viewerWrap = h('div', { class: 'q-viewerwrap' }, viewerEl, navPrevPage, navNextPage);

  const answersEl = h('div', { class: 'q-answers' });
  const answerBtns = [1, 2, 3, 4].map((n) => h('button', { class: 'ansbtn', text: String(n), onclick: () => selectAnswer(n) }));
  answerBtns.forEach((b) => answersEl.appendChild(b));

  const flagBtn = h('button', { class: 'act-btn', onclick: toggleFlag }, '⚑ ' + t('q.flag'));
  const prevQBtn = h('button', { class: 'act-btn', text: '← ' + t('q.question'), onclick: () => gotoQ(currentQ - 1) });
  const nextQBtn = h('button', { class: 'act-btn act-next', text: t('q.question') + ' →', onclick: () => gotoQ(currentQ + 1) });
  const actions = h('div', { class: 'q-actions sim-actions' }, prevQBtn, flagBtn, nextQBtn);
  const bottom = h('div', { class: 'q-bottom' }, answersEl, actions, h('div', { class: 'kbd-hint', text: t('kbd.sim') }));

  screen.append(topbar, posEl, viewerWrap, bottom);

  // desktop keyboard shortcuts
  const unbindKeys = bindKeys((e) => {
    if (destroyed) return false;
    const n = answerKey(e);
    if (n) { selectAnswer(n); return true; }
    if (e.key === 'Enter') { gotoQ(currentQ + (e.shiftKey ? -1 : 1)); return true; }
    if (e.code === 'KeyF') { toggleFlag(); return true; }
    if (e.code === 'KeyG') { openGrid(); return true; }
    if (viewer && viewer.handleKey(e)) return true;
    return false;
  });
  clear(root).appendChild(screen);

  // ---- timer (endTime based)
  function startTimer() {
    countdown = new Countdown({
      endTime: ps.endTime,
      onTick: (rem) => {
        timerEl.textContent = formatClock(rem);
        timerEl.classList.toggle('low', rem < 3 * 60 * 1000);
        timerEl.classList.toggle('crit', rem < 60 * 1000);
      },
      onExpire: () => { if (!destroyed) { toast(t('sim.timeUp')); doSubmit(true); } },
    }).start();
  }

  function wantInvert() {
    const s = getSettings();
    return s.invertPdfInDark && document.documentElement.getAttribute('data-theme') === 'dark';
  }

  async function showQuestion(n, { accrue = true } = {}) {
    if (accrue) accrueTime();
    currentQ = Math.max(1, Math.min(n, section.questionCount));
    ps.currentQ = currentQ;
    const q = qById.get(currentQ);
    if (!viewer) {
      viewer = new PageViewer(viewerEl, { invert: wantInvert(), onPageChange: updatePos });
    }
    viewer.setInvert(wantInvert());
    await viewer.setSource(q.testId, { first: q.pdfFirst, last: q.pdfLast, page: q.page });
    renderAnswerState();
    updatePos();
    qStopwatch.reset().start();
    persist();
  }

  function updatePos() {
    posEl.innerHTML = `<span class="q-chip">${t('q.question')} ${currentQ}/${section.questionCount}</span>` +
      `<span class="muted">${t('q.page')} ${viewer ? viewer.page : ''} · ${topicLabel(topicOf(section, currentQ))}</span>`;
    navPrevPage.disabled = !(viewer && viewer.canPrev());
    navNextPage.disabled = !(viewer && viewer.canNext());
    flagBtn.classList.toggle('flagged', !!ps.flags[currentQ]);
    prevQBtn.disabled = currentQ <= 1;
    nextQBtn.disabled = currentQ >= section.questionCount;
  }

  function renderAnswerState() {
    const sel = ps.answers[currentQ];
    answerBtns.forEach((b, i) => { b.className = 'ansbtn' + (sel === i + 1 ? ' chosen' : ''); b.disabled = false; });
  }

  function selectAnswer(n) {
    haptic('light');
    if (ps.answers[currentQ] === n) delete ps.answers[currentQ]; // tap again to clear
    else ps.answers[currentQ] = n;
    renderAnswerState();
    persist();
  }

  function toggleFlag() {
    haptic('light');
    if (ps.flags[currentQ]) delete ps.flags[currentQ]; else ps.flags[currentQ] = true;
    updatePos();
    persist();
  }

  function gotoQ(n) {
    if (n < 1 || n > section.questionCount) return;
    showQuestion(n);
  }

  function accrueTime() {
    const ms = qStopwatch.elapsedMs;
    if (ms > 0) ps.timeMsPerQ[currentQ] = (ps.timeMsPerQ[currentQ] || 0) + ms;
    qStopwatch.reset();
  }

  let persistT = null;
  function persist() {
    clearTimeout(persistT);
    persistT = setTimeout(() => { db.kvSet(STATE_KEY, state); }, 150);
  }

  function openGrid() {
    bottomSheet((close) => {
      const panel = h('div', { class: 'grid-sheet' });
      panel.appendChild(h('div', { class: 'grid-legend' },
        h('span', {}, h('i', { class: 'lg lg-ans' }), ' ' + t('sim.answered')),
        h('span', {}, h('i', { class: 'lg lg-unans' }), ' ' + t('sim.unanswered')),
        h('span', {}, h('i', { class: 'lg lg-flag' }), ' ' + t('q.flagged')),
      ));
      const grid = h('div', { class: 'qgrid' });
      for (let n = 1; n <= section.questionCount; n++) {
        const cls = ['qcell'];
        if (ps.answers[n]) cls.push('answered');
        if (ps.flags[n]) cls.push('flagged');
        if (n === currentQ) cls.push('current');
        grid.appendChild(h('button', { class: cls.join(' '), text: String(n),
          onclick: () => { close(); gotoQ(n); } }));
      }
      panel.appendChild(grid);
      return panel;
    });
  }

  async function doSubmit(auto) {
    if (destroyed) return;
    if (!auto) {
      const ok = await confirmDialog(t('sim.submitConfirm'), { okText: t('sim.submit') });
      if (!ok) return;
    }
    accrueTime();
    if (countdown) countdown.stop();
    cleanup();
    await finalizeSection(root, sheet, state, secId);
  }

  function onVisibility() {
    if (document.hidden) { accrueTime(); }
    else { qStopwatch.reset().start(); }
  }
  document.addEventListener('visibilitychange', onVisibility);

  function cleanup() {
    destroyed = true;
    unbindKeys();
    document.removeEventListener('visibilitychange', onVisibility);
    if (countdown) countdown.stop();
    if (viewer) viewer.destroy();
  }

  // auto-submit if resumed after time already expired
  if (ps.endTime <= Date.now()) {
    await showQuestion(currentQ, { accrue: false });
    startTimer();
    toast(t('sim.timeUp'));
    doSubmit(true);
    return { destroy: cleanup };
  }

  await showQuestion(currentQ, { accrue: false });
  startTimer();
  return { destroy: cleanup };
}

// ---- finalize a section ----------------------------------------------------

function computeSectionResult(sheet, secId, ps) {
  const section = sheet.sections.find((s) => s.id === secId);
  const rows = [];
  let correct = 0, answeredCount = 0, totalTime = 0;
  for (let i = 0; i < section.questionCount; i++) {
    const n = i + 1;
    const selected = ps.answers[n] ?? null;
    const correctAns = section.answers[i];
    const ok = selected === correctAns;
    if (selected != null) answeredCount++;
    if (ok) correct++;
    const timeMs = ps.timeMsPerQ[n] || 0;
    totalTime += timeMs;
    rows.push({ n, selected, correct: correctAns, ok, topic: topicOf(section, n), timeMs, page: section.questionPages[i] });
  }
  const perTopic = {};
  for (const r of rows) {
    const g = perTopic[r.topic] || (perTopic[r.topic] = { topic: r.topic, total: 0, correct: 0, timeMs: 0 });
    g.total++; if (r.ok) g.correct++; g.timeMs += r.timeMs;
  }
  return {
    secId, domain: section.domain, name: section.name,
    raw: correct, questionCount: section.questionCount,
    answeredCount, pct: correct / section.questionCount,
    timeUsedMs: totalTime, avgMs: totalTime / section.questionCount,
    perTopic: Object.values(perTopic),
    rows,
  };
}

async function finalizeSection(root, sheet, state, secId) {
  const ps = state.perSection[secId];
  const result = computeSectionResult(sheet, secId, ps);
  ps.submitted = true;

  // log answered attempts to global stats
  for (const r of result.rows) {
    if (r.selected != null) {
      await logAttempt({
        questionId: `${sheet.id}/${secId}/${r.n}`,
        testId: sheet.id, domain: result.domain, topic: r.topic,
        mode: 'sim', selected: r.selected, correct: r.ok, timedOut: false,
        timeMs: r.timeMs, sessionId: state.sessionId,
      });
    }
  }

  // update best score per section
  const best = (await db.kvGet(BEST_KEY, {})) || {};
  const tb = best[sheet.id] || (best[sheet.id] = {});
  if (!tb[secId] || result.pct > tb[secId].pct) tb[secId] = { pct: result.pct, raw: result.raw, date: Date.now() };
  await db.kvSet(BEST_KEY, best);

  state.results = state.results || [];
  state.results.push(result);

  const isFull = state.mode === 'full';
  const hasMore = state.currentIndex < state.sections.length - 1;

  if (isFull && hasMore) {
    state.currentIndex++;
    state.phase = 'break';
    await db.kvSet(STATE_KEY, state);
    location.hash = '#/sim/run';
    renderSimulation(root, { run: true });
    return;
  }

  // done — build final record
  await db.kvDelete(STATE_KEY);
  const record = await buildFinalRecord(sheet, state);
  await addSimResult(record);
  renderResults(root, sheet, record);
}

async function buildFinalRecord(sheet, state) {
  const results = state.results || [];
  const record = {
    testId: sheet.id, title: sheet.title, mode: state.mode,
    finishedAt: Date.now(), sections: results,
  };
  if (state.mode === 'full') {
    const rawVerbal = results.filter((r) => r.domain === 'verbal').reduce((s, r) => s + r.raw, 0);
    const rawQuant = results.filter((r) => r.domain === 'quant').reduce((s, r) => s + r.raw, 0);
    record.rawVerbal = rawVerbal; record.rawQuant = rawQuant;
    record.estimate = estimateFromRaw(sheet.scoring, rawVerbal, rawQuant);
  }
  return record;
}

// ---- break screen ----------------------------------------------------------

function renderBreak(root, sheet, state) {
  const nextSecId = state.sections[state.currentIndex];
  const wrap = h('div', { class: 'screen break-screen' });
  wrap.append(
    h('div', { class: 'break-emoji', text: '☕' }),
    h('h1', { text: t('sim.break') }),
    h('p', { class: 'muted', text: t('sim.breakBody') }),
    h('p', { class: 'next-sec', text: sectionLabel(sheet, nextSecId) }),
    h('button', { class: 'btn btn-primary', text: t('sim.startNext'), onclick: async () => {
      const section = sheet.sections.find((s) => s.id === nextSecId);
      state.perSection[nextSecId] = freshSection(section, Date.now());
      state.phase = 'running';
      await db.kvSet(STATE_KEY, state);
      renderSimulation(root, { run: true });
    }}),
  );
  clear(root).appendChild(wrap);
  return { destroy() {} };
}

// ---- results screen --------------------------------------------------------

export async function renderResults(root, sheet, record) {
  const lang = getSettings().lang;
  const wrap = h('div', { class: 'screen results' });
  wrap.appendChild(h('h1', { class: 'screen-title', text: t('res.title') }));
  wrap.appendChild(h('p', { class: 'muted', text: sheet.title }));

  for (const sec of record.sections) {
    const card = h('div', { class: 'result-card' });
    card.appendChild(h('div', { class: 'result-head', text: sec.name }));
    const stats = h('div', { class: 'result-stats' },
      stat(t('res.raw'), `${sec.raw}/${sec.questionCount}`),
      stat(t('res.percent'), pct(sec.pct)),
      stat(t('res.timeUsed'), formatDuration(sec.timeUsedMs, lang)),
      stat(t('res.avgTime'), formatClock(sec.avgMs)),
    );
    card.appendChild(stats);

    // per-topic
    const topicWrap = h('div', { class: 'topic-breakdown' });
    topicWrap.appendChild(h('div', { class: 'section-label', text: t('res.byTopic') }));
    for (const g of sec.perTopic) {
      topicWrap.appendChild(h('div', { class: 'topic-row' },
        h('span', { text: topicLabel(g.topic) }),
        h('span', { class: 'muted', text: `${g.correct}/${g.total}` }),
      ));
    }
    card.appendChild(topicWrap);

    // review list (collapsible)
    const reviewWrap = h('div', { class: 'review-list' });
    reviewWrap.appendChild(h('div', { class: 'section-label', text: t('res.review') }));
    for (const r of sec.rows) {
      const cls = r.selected == null ? 'skipped' : (r.ok ? 'ok' : 'bad');
      reviewWrap.appendChild(h('button', { class: 'review-item ' + cls, onclick: () => showQuestionPage(sheet, sec.secId, r) },
        h('span', { class: 'ri-n', text: '#' + r.n }),
        h('span', { class: 'ri-ans', text: `${t('res.yourAnswer')}: ${r.selected ?? '—'} · ${t('q.correctIs')}: ${r.correct}` }),
        h('span', { class: 'ri-time muted', text: formatClock(r.timeMs) }),
      ));
    }
    card.appendChild(reviewWrap);
    wrap.appendChild(card);
  }

  // full-test score estimates
  if (record.mode === 'full' && record.estimate) {
    const e = record.estimate;
    const est = h('div', { class: 'estimate-card' });
    est.appendChild(h('div', { class: 'section-label', text: t('res.general') + ' · ' + t('res.estimate') }));
    est.appendChild(h('div', { class: 'scaled-row' },
      stat(t('res.scaledV'), String(e.V)),
      stat(t('res.scaledQ'), String(e.Q)),
    ));
    est.appendChild(h('div', { class: 'general-row' },
      stat(t('res.genTwoDomain'), String(e.general.twoDomain)),
      stat(t('res.genVerbal'), String(e.general.verbalEmphasis)),
      stat(t('res.genQuant'), String(e.general.quantEmphasis)),
    ));
    est.appendChild(h('p', { class: 'tiny muted', text: t('res.writingNote') }));
    wrap.appendChild(est);
  }

  // practise the wrong ones
  const wrongIds = record.sections.flatMap((sec) =>
    sec.rows.filter((r) => !r.ok).map((r) => `${sheet.id}/${sec.secId}/${r.n}`));
  if (wrongIds.length) {
    wrap.appendChild(h('button', { class: 'btn btn-primary wide', text: `${t('res.practiceWrong')} (${wrongIds.length})`,
      onclick: () => startPractiseWrong(root, sheet, wrongIds) }));
  }
  wrap.appendChild(h('a', { class: 'btn btn-ghost wide', href: '#/sim', text: t('common.done') }));

  clear(root).appendChild(wrap);
  return { destroy() {} };
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-value', text: value }), h('div', { class: 'stat-label', text: label }));
}

// show a single question page with the correct answer marked
function showQuestionPage(sheet, secId, row) {
  const section = sheet.sections.find((s) => s.id === secId);
  sheet_viewer(sheet.id, { first: section.pdfPages.first, last: section.pdfPages.last, page: row.page },
    `#${row.n} · ${t('q.correctIs')}: ${row.correct} · ${t('res.yourAnswer')}: ${row.selected ?? '—'}`,
    { testId: sheet.id, sectionId: secId, n: row.n });
}

function sheet_viewer(testId, range, caption, q = null) {
  bottomSheet((close) => {
    const panel = h('div', { class: 'viewer-sheet' });
    panel.appendChild(h('div', { class: 'viewer-caption', text: caption }));
    if (q) {
      const explEl = h('div', { class: 'q-expl hidden' });
      panel.appendChild(explEl);
      getExplanation(q).then((text) => {
        if (!text) return;
        explEl.append(h('div', { class: 'q-expl-title', text: '💡 ' + t('q.explanation') }), h('div', { class: 'q-expl-body', text }));
        explEl.classList.remove('hidden');
      });
    }
    const host = h('div', { class: 'q-viewer sheet-viewer' });
    const wrap = h('div', { class: 'q-viewerwrap' }, host,
      h('button', { class: 'q-pagebtn q-prev', text: '‹', onclick: () => v && v.prev() }),
      h('button', { class: 'q-pagebtn q-next', text: '›', onclick: () => v && v.next() }));
    panel.appendChild(wrap);
    panel.appendChild(h('button', { class: 'btn btn-ghost', text: t('common.close'), onclick: close }));
    const v = new PageViewer(host, {
      invert: getSettings().invertPdfInDark && document.documentElement.getAttribute('data-theme') === 'dark',
    });
    v.setSource(testId, range);
    return panel;
  });
}

async function startPractiseWrong(root, sheet, wrongIds) {
  const descriptors = new Map(questionsForSheet(sheet).map((q) => [q.questionId, q]));
  const queue = wrongIds.map((id) => descriptors.get(id)).filter(Boolean);
  let i = 0;
  const { mountQuestionRunner } = await import('../question.js');
  const source = { async next() { return i < queue.length ? queue[i++] : null; } };
  mountQuestionRunner(root, { mode: 'practice', source, doneMessage: t('review.empty') });
}

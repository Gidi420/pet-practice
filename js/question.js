// question.js — shared single-question runner for Practice / Timed / Review.
// Handles the PDF viewer, answer buttons, feedback, flag, timing and logging.

import { h, clear, haptic, bindKeys, answerKey } from './ui.js';
import { PageViewer } from './pdfview.js';
import { t, domainLabel, topicLabel, getSettings } from './config.js';
import { logAttempt, newSessionId } from './stats.js';
import { Countdown, Stopwatch, formatClock } from './timer.js';
import { getExplanation } from './tests.js';

function chapterLabel(q) {
  const num = q.sectionId.endsWith('-2') ? 2 : 1;
  return `${domainLabel(q.domain)} ${num}`;
}

export function mountQuestionRunner(root, config) {
  const { mode, source, timed = false, topbar = null } = config;
  const sessionId = newSessionId();
  const sess = { answered: 0, correct: 0, streak: 0 };

  let current = null;       // current question descriptor
  let viewer = null;
  let stopwatch = new Stopwatch();
  let countdown = null;
  let answered = false;
  let loadToken = 0;

  const screen = h('div', { class: 'qscreen' });

  const topbarSlot = h('div', { class: 'q-topbar' });
  if (topbar) topbarSlot.appendChild(topbar);

  const qLabel = h('span', { class: 'q-label' });
  const counter = h('span', { class: 'q-counter' });
  const header = h('div', { class: 'q-header' }, qLabel, counter);

  const timerFill = h('div', { class: 'q-timerfill' });
  const timerText = h('span', { class: 'q-timertext' });
  const timerBar = h('div', { class: 'q-timerbar hidden' }, timerFill, timerText);

  const qChip = h('span', { class: 'q-chip' });
  const backBtn = h('button', { class: 'q-ctxbtn hidden', text: t('q.backToQuestion'),
    onclick: () => viewer && viewer.showPage(current.page) });
  const passageBtn = h('button', { class: 'q-ctxbtn hidden', onclick: () => {
    if (!current) return;
    const atPassage = viewer.page === current.passageStartPage;
    viewer.showPage(atPassage ? current.page : current.passageStartPage);
  }});
  const context = h('div', { class: 'q-context' }, qChip, passageBtn, backBtn);

  const viewerEl = h('div', { class: 'q-viewer' });
  const navPrev = h('button', { class: 'q-pagebtn q-prev', 'aria-label': 'prev', text: '‹',
    onclick: () => viewer && viewer.prev() });
  const navNext = h('button', { class: 'q-pagebtn q-next', 'aria-label': 'next', text: '›',
    onclick: () => viewer && viewer.next() });
  const viewerWrap = h('div', { class: 'q-viewerwrap' }, viewerEl, navPrev, navNext);

  const answersEl = h('div', { class: 'q-answers' });
  const answerBtns = [1, 2, 3, 4].map((n) => h('button', {
    class: 'ansbtn', text: String(n), onclick: () => onAnswer(n),
  }));
  answerBtns.forEach((b) => answersEl.appendChild(b));

  const feedback = h('div', { class: 'q-feedback hidden' });
  const flagBtn = h('button', { class: 'act-btn', onclick: toggleFlag }, '⚑ ' + t('q.flag'));
  const nextBtn = h('button', { class: 'act-btn act-next', text: t('common.next'), onclick: loadNext, disabled: true });
  const actions = h('div', { class: 'q-actions' }, flagBtn, feedback, nextBtn);

  const explEl = h('div', { class: 'q-expl hidden' });
  const kbdHint = h('div', { class: 'kbd-hint', text: t('kbd.practice') });
  const bottom = h('div', { class: 'q-bottom' }, answersEl, actions, explEl, kbdHint);

  screen.append(topbarSlot, header, timerBar, context, viewerWrap, bottom);
  clear(root).appendChild(screen);

  updateCounter();

  function updateCounter() {
    counter.innerHTML =
      `<b>${sess.answered}</b> ${t('sess.answered')} · <b>${sess.correct}</b> ${t('sess.correct')} · <b>${sess.streak}</b> ${t('sess.streak')}`;
  }

  function updateLabel() {
    if (!current) return;
    qLabel.textContent = `${t('q.chapter')} ${chapterLabel(current)} · ${t('q.question')} ${current.n} · ${t('q.page')} ${viewer ? viewer.page : current.page}`;
    qChip.textContent = `${t('q.question')} ${current.n}`;
    const away = viewer && viewer.page !== current.page;
    backBtn.classList.toggle('hidden', !away);
    if (current.isPassage) {
      passageBtn.classList.remove('hidden');
      passageBtn.textContent = viewer && viewer.page === current.passageStartPage ? t('q.goToQuestion') : t('q.showPassage');
    } else {
      passageBtn.classList.add('hidden');
    }
  }

  function toggleFlag() {
    flagBtn.classList.toggle('flagged');
    haptic('light');
  }

  async function loadNext() {
    answered = false;
    feedback.classList.add('hidden');
    explEl.classList.add('hidden');
    nextBtn.disabled = true;
    answerBtns.forEach((b) => { b.className = 'ansbtn'; b.disabled = false; });
    flagBtn.classList.remove('flagged');
    if (countdown) { countdown.stop(); countdown = null; }

    const token = ++loadToken;
    const q = await source.next();
    if (token !== loadToken) return;
    if (!q) { showDone(); return; }
    current = q;

    if (!viewer) {
      viewer = new PageViewer(viewerEl, {
        invert: wantInvert(),
        onPageChange: () => { updateLabel(); updateNav(); },
      });
    }
    viewer.setInvert(wantInvert());
    const startPage = q.isPassage ? q.passageStartPage : q.page;
    await viewer.setSource(q.testId, { first: q.pdfFirst, last: q.pdfLast, page: startPage });
    if (token !== loadToken) return; // a newer loadNext() took over (e.g. a filter changed)
    updateLabel(); updateNav();

    stopwatch.reset().start();
    if (timed) startCountdown(q);
  }

  function updateNav() {
    navPrev.disabled = !viewer.canPrev();
    navNext.disabled = !viewer.canNext();
  }

  function startCountdown(q) {
    const s = getSettings();
    const secs = q.domain === 'quant' ? s.timePerQuant : s.timePerVerbal;
    timerBar.classList.remove('hidden');
    countdown = new Countdown({
      endTime: Date.now() + secs * 1000,
      onTick: (rem) => {
        const frac = Math.max(0, rem / (secs * 1000));
        timerFill.style.width = (frac * 100) + '%';
        timerText.textContent = formatClock(rem);
        timerBar.classList.toggle('low', frac < 0.33);
        timerBar.classList.toggle('crit', frac < 0.12);
      },
      onExpire: () => onTimeout(),
    }).start();
  }

  function onTimeout() {
    if (answered) return;
    answered = true;
    haptic('warn');
    stopwatch.pause();
    revealAnswer(null, true);
    record(null, false, true);
  }

  function onAnswer(n) {
    if (answered) return;
    answered = true;
    stopwatch.pause();
    if (countdown) { countdown.stop(); countdown = null; }
    const correct = n === current.answer;
    haptic(correct ? 'medium' : 'warn');
    revealAnswer(n, false);
    record(n, correct, false);
  }

  function revealAnswer(selected, timedOut) {
    answerBtns.forEach((b, i) => {
      const n = i + 1;
      b.disabled = true;
      if (n === current.answer) b.classList.add('correct');
      if (selected === n && n !== current.answer) b.classList.add('wrong');
    });
    timerBar.classList.add('hidden');
    feedback.classList.remove('hidden');
    if (timedOut) feedback.innerHTML = `<span class="fb-timeout">${t('q.timedOut')}</span> · ${t('q.correctIs')} ${current.answer}`;
    else if (selected === current.answer) feedback.innerHTML = `<span class="fb-correct">✓ ${t('q.correct')}</span>`;
    else feedback.innerHTML = `<span class="fb-wrong">✗ ${t('q.wrong')}</span> · ${t('q.correctIs')} ${current.answer}`;
    nextBtn.disabled = false;
    showExplanation(current);
  }

  async function showExplanation(q) {
    const text = await getExplanation(q);
    if (!text || current !== q || !answered) return;
    clear(explEl).append(h('div', { class: 'q-expl-title', text: '💡 ' + t('q.explanation') }), h('div', { class: 'q-expl-body', text }));
    explEl.classList.remove('hidden');
    explEl.scrollTop = 0;
  }

  async function record(selected, correct, timedOut) {
    sess.answered++;
    if (correct) { sess.correct++; sess.streak++; } else { sess.streak = 0; }
    updateCounter();
    await logAttempt({
      questionId: current.questionId,
      testId: current.testId,
      domain: current.domain,
      topic: current.topic,
      mode,
      selected,
      correct,
      timedOut,
      timeMs: stopwatch.elapsedMs,
      sessionId,
    });
    if (source.onAnswered) source.onAnswered({ question: current, selected, correct, timedOut });
    updateRemaining();
  }

  function updateRemaining() {
    if (source.remainingLabel) {
      const txt = source.remainingLabel();
      if (txt) { counter.innerHTML = txt; }
    }
  }

  function showDone() {
    current = null;
    clear(screen);
    const msg = config.doneMessage || t('q.noQuestions');
    screen.appendChild(h('div', { class: 'empty-state' },
      h('div', { class: 'empty-emoji', text: '🎉' }),
      h('p', { text: msg }),
    ));
  }

  function wantInvert() {
    const s = getSettings();
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return s.invertPdfInDark && dark;
  }

  // react to theme/invert changes
  const onSettings = () => { if (viewer) viewer.setInvert(wantInvert()); };
  document.addEventListener('settings-changed', onSettings);
  document.addEventListener('theme-changed', onSettings);

  // desktop keyboard shortcuts
  const unbindKeys = bindKeys((e) => {
    // runners mounted outside the router (e.g. "practise the wrong ones") clean up here
    if (!screen.isConnected) { unbindKeys(); return false; }
    if (!current) return false;
    const n = answerKey(e);
    if (n) { if (!answered) onAnswer(n); return true; }
    if (e.key === 'Enter') {
      // let a focused button handle its own Enter
      if (e.target && /^(BUTTON|A)$/.test(e.target.tagName)) return false;
      if (answered && !nextBtn.disabled) loadNext();
      return true;
    }
    if (e.code === 'KeyF') { toggleFlag(); return true; }
    if (viewer && viewer.handleKey(e)) return true;
    return false;
  });

  loadNext();

  return {
    loadNext,
    destroy() {
      unbindKeys();
      if (countdown) countdown.stop();
      document.removeEventListener('settings-changed', onSettings);
      document.removeEventListener('theme-changed', onSettings);
      if (viewer) viewer.destroy();
    },
  };
}

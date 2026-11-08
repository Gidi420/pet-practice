// modes/review.js — queue of wrong/timed-out questions, served until each is
// answered correctly twice in a row (simple spaced repetition).

import { h, clear } from '../ui.js';
import { t } from '../config.js';
import { getReadyTests, questionsForSheet } from '../tests.js';
import { getReviewQueueIds, reviewProgress } from '../stats.js';
import { mountQuestionRunner } from '../question.js';

async function buildDescriptorMap() {
  const sheets = await getReadyTests();
  const map = new Map();
  for (const s of sheets) for (const q of questionsForSheet(s)) map.set(q.questionId, q);
  return map;
}

export async function renderReview(root, opts = {}) {
  const descriptors = await buildDescriptorMap();
  const progress = await reviewProgress();

  if (!progress.active) {
    clear(root).appendChild(h('div', { class: 'empty-state' },
      h('div', { class: 'empty-emoji', text: '✅' }),
      h('p', { text: t('review.empty') }),
    ));
    return { destroy() {} };
  }

  let lastServed = null;
  const counterEl = h('span');

  const source = {
    async next() {
      const ids = await getReviewQueueIds();
      const avail = ids.filter((id) => descriptors.has(id));
      if (!avail.length) return null;
      let pickId = avail.find((id) => id !== lastServed) || avail[0];
      lastServed = pickId;
      return descriptors.get(pickId);
    },
    remainingLabel() {
      return null; // counter handled by header below
    },
    async onAnswered() {
      const p = await reviewProgress();
      counterEl.textContent = `${t('review.remaining')}: ${p.active}`;
    },
  };

  const header = h('div', { class: 'review-banner' },
    h('b', { text: t('review.title') }), ' · ', counterEl);
  counterEl.textContent = `${t('review.remaining')}: ${progress.active}`;

  return mountQuestionRunner(root, {
    mode: 'review',
    source,
    topbar: header,
    doneMessage: t('review.empty'),
  });
}

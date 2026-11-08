// modes/practice.js — untimed practice with smart randomisation and filters.

import { h, clear } from '../ui.js';
import { t, topicLabel, domainLabel, getSettings } from '../config.js';
import { buildPool, availableFacets } from '../tests.js';
import * as db from '../db.js';
import { getAllAttempts, byTopic } from '../stats.js';
import { mountQuestionRunner } from '../question.js';

export async function createPracticeSource(filters, { passageFirst = true } = {}) {
  let pool = await buildPool(filters);
  const seen = (await db.kvGet('seen', {})) || {};
  let served = new Set();
  let topicWeights = {};
  if (getSettings().weakTopicWeighting) topicWeights = await computeTopicWeights();

  function pick() {
    if (!pool.length) return null;
    // reset the "don't repeat" set once most of the pool has been served
    if (served.size >= Math.max(1, Math.floor(pool.length * 0.8))) served.clear();
    const candidates = pool.filter((q) => !served.has(q.questionId));
    const list = candidates.length ? candidates : pool;
    const weights = list.map((q) => {
      const seenCount = seen[q.questionId] || 0;
      const tw = topicWeights[q.topic] || 1;
      return (1 / (1 + seenCount)) * tw;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < list.length; idx++) { r -= weights[idx]; if (r <= 0) break; }
    const q = list[Math.min(idx, list.length - 1)];
    served.add(q.questionId);
    seen[q.questionId] = (seen[q.questionId] || 0) + 1;
    db.kvSet('seen', seen);
    return q;
  }

  return {
    async next() { return pick(); },
    async rebuild() { pool = await buildPool(filters); served = new Set(); if (getSettings().weakTopicWeighting) topicWeights = await computeTopicWeights(); else topicWeights = {}; },
    poolSize() { return pool.length; },
  };
}

async function computeTopicWeights() {
  const attempts = await getAllAttempts();
  const groups = byTopic(attempts);
  const w = {};
  for (const g of groups) {
    if (g.answered >= 3) w[g.key] = 1 + (1 - g.accuracy); // weaker topic -> up to 2x
  }
  return w;
}

export async function renderPractice(root, { mode = 'practice', timed = false } = {}) {
  const facets = await availableFacets();
  if (!facets.count) {
    clear(root).appendChild(h('div', { class: 'empty-state' },
      h('p', { text: t('q.noQuestions') }),
      h('a', { class: 'btn btn-primary', href: '#/tests', text: t('onboard.cta') }),
    ));
    return { destroy() {} };
  }

  const filters = { domain: 'all', topic: 'all', year: 'all' };
  // pick up a "practise this" hint from the Stats screen
  try {
    const hint = JSON.parse(sessionStorage.getItem('pet.practiceHint') || 'null');
    if (hint) { Object.assign(filters, hint); sessionStorage.removeItem('pet.practiceHint'); }
  } catch {}
  const topbar = h('div', { class: 'filters' });

  let controller = null;
  const source = await createPracticeSource(filters);

  function buildFilterRows() {
    clear(topbar);
    const domainItems = [{ value: 'all', label: t('common.all') },
      { value: 'verbal', label: domainLabel('verbal') }, { value: 'quant', label: domainLabel('quant') }];
    const topicItems = [{ value: 'all', label: t('common.all') },
      ...facets.topics.map((tp) => ({ value: tp, label: topicLabel(tp) }))];
    const yearItems = [{ value: 'all', label: t('common.all') },
      ...facets.years.map((y) => ({ value: String(y), label: String(y) }))];

    topbar.appendChild(filterRow(t('filter.domain'), domainItems, filters.domain, (v) => setFilter('domain', v)));
    topbar.appendChild(filterRow(t('filter.topic'), topicItems, filters.topic, (v) => setFilter('topic', v)));
    topbar.appendChild(filterRow(t('filter.year'), yearItems, filters.year, (v) => setFilter('year', v)));
  }

  async function setFilter(key, val) {
    filters[key] = val;
    buildFilterRows();
    await source.rebuild();
    if (controller) controller.loadNext();
  }

  buildFilterRows();
  controller = mountQuestionRunner(root, { mode, timed, source, topbar });
  return controller;
}

function filterRow(label, items, selected, onPick) {
  const row = h('div', { class: 'filter-line' });
  row.appendChild(h('span', { class: 'filter-label', text: label }));
  const chips = h('div', { class: 'chip-row' });
  items.forEach((it) => chips.appendChild(h('button', {
    class: 'chip' + (it.value === selected ? ' active' : ''),
    text: it.label, onclick: () => onPick(it.value),
  })));
  row.appendChild(chips);
  return row;
}

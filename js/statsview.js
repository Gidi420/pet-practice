// statsview.js — the Stats screen: overall, per-domain/topic, trend, sim
// history, slowest topics, coverage, exam countdown.

import { h, clear, pct, confirmDialog, toast } from './ui.js';
import { t, getSettings, topicLabel, domainLabel } from './config.js';
import * as db from './db.js';
import { getAllAttempts, overall, byDomain, byTopic, trend, slowestTopics, coverage, reviewProgress, resetStats } from './stats.js';
import { listTests } from './tests.js';
import { formatClock, formatDuration } from './timer.js';
import { renderResults } from './modes/simulation.js';

export async function renderStats(root) {
  const lang = getSettings().lang;
  const [attempts, sims, tests, review] = await Promise.all([
    getAllAttempts(), db.getAllSimResults(), listTests(), reviewProgress(),
  ]);

  const wrap = h('div', { class: 'screen stats-screen' });
  wrap.appendChild(h('h1', { class: 'screen-title', text: t('stats.title') }));

  // exam countdown
  wrap.appendChild(examCountdown(lang));

  if (!attempts.length) {
    wrap.appendChild(h('div', { class: 'empty-state' }, h('p', { text: t('stats.noData') })));
    if (review.active) wrap.appendChild(reviewButton(review));
    clear(root).appendChild(wrap);
    return { destroy() {} };
  }

  const ov = overall(attempts);

  // overall tiles
  const tiles = h('div', { class: 'tile-grid' },
    tile(String(ov.answered), t('stats.totalAnswered')),
    tile(pct(ov.accuracy), t('stats.accuracy')),
    tile(formatClock(ov.avgTimeMs), t('stats.avgTime')),
    tile(ov.streakDays + ' ' + t('stats.daysLeft'), t('stats.streakDays')),
    tile(formatDuration(ov.totalTimeMs, lang), t('stats.studyTime')),
    tile(String(ov.timedOut), t('q.timedOut')),
  );
  wrap.appendChild(tiles);

  // review mistakes entry
  if (review.active) wrap.appendChild(reviewButton(review));

  // trend
  wrap.appendChild(trendSection(attempts, lang));

  // by domain
  wrap.appendChild(groupSection(t('stats.byDomain'), byDomain(attempts).map((g) => ({
    key: g.key, label: domainLabel(g.key), g, filter: { domain: g.key },
  })), lang));

  // by topic (weakest first)
  wrap.appendChild(groupSection(t('stats.byTopic') + ' · ' + t('stats.weakestFirst'),
    byTopic(attempts).map((g) => ({ key: g.key, label: topicLabel(g.key), g, filter: { topic: g.key } })), lang));

  // slowest topics
  const slow = slowestTopics(attempts);
  if (slow.length) {
    wrap.appendChild(section(t('stats.slowest'), slow.map((g) => h('div', { class: 'stat-line' },
      h('span', { text: topicLabel(g.key) }),
      h('span', { class: 'bad', text: `${formatClock(g.avgTimeMs)} / ${formatClock(g.budgetMs)}` }),
    ))));
  }

  // simulation history
  if (sims.length) {
    const items = sims.slice().reverse().map((rec) => h('button', { class: 'sim-hist-item', onclick: () => openSim(root, rec) },
      h('div', {},
        h('div', { text: rec.title || rec.testId }),
        h('div', { class: 'muted tiny', text: new Date(rec.finishedAt).toLocaleDateString() + ' · ' + (rec.mode === 'full' ? t('sim.fullTest') : rec.sections.map((s) => s.name).join(', ')) }),
      ),
      h('div', { class: 'sim-hist-score' },
        rec.mode === 'full' && rec.estimate
          ? h('span', { text: `V${rec.estimate.V} Q${rec.estimate.Q}` })
          : h('span', { text: pct(rec.sections[0].pct) }),
      ),
    ));
    wrap.appendChild(section(t('stats.simHistory'), items));
  }

  // coverage
  const cov = coverage(attempts, tests.filter((x) => x.hasAnswers));
  if (cov.length) {
    const totalSeen = cov.reduce((s, c) => s + c.seen, 0);
    wrap.appendChild(section(`${t('stats.coverage')} · ${totalSeen}/${cov.length * 86}`,
      cov.map((c) => h('div', { class: 'stat-line' },
        h('span', { text: c.title || c.id }),
        h('span', { class: 'muted', text: `${c.seen}/${c.total}` }),
      ))));
  }

  // reset
  wrap.appendChild(h('button', { class: 'btn btn-danger-ghost wide', text: t('stats.resetStats'), onclick: async () => {
    const ok = await confirmDialog(t('stats.resetConfirm'), { okText: t('stats.resetStats'), danger: true });
    if (ok) { await resetStats(); toast('הסטטיסטיקה אופסה'); renderStats(root); }
  }}));

  clear(root).appendChild(wrap);
  return { destroy() {} };
}

function reviewButton(review) {
  return h('a', { class: 'btn btn-secondary wide review-cta', href: '#/review' },
    `${t('review.title')} · ${review.active}`);
}

function examCountdown(lang) {
  const s = getSettings();
  const exam = new Date(s.examDate + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.round((exam - now) / 86400000);
  return h('div', { class: 'exam-countdown' },
    h('div', { class: 'exam-days', text: days >= 0 ? String(days) : '—' }),
    h('div', { class: 'exam-label', text: `${t('stats.daysLeft')} ${t('stats.examCountdown')}` }),
    h('div', { class: 'muted tiny', text: exam.toLocaleDateString() }),
  );
}

function tile(value, label) {
  return h('div', { class: 'tile' }, h('div', { class: 'tile-value', text: value }), h('div', { class: 'tile-label', text: label }));
}

function section(title, children) {
  return h('section', { class: 'card' }, h('div', { class: 'card-title', text: title }), ...children);
}

function groupSection(title, entries, lang) {
  const children = entries.map((e) => {
    const bar = h('div', { class: 'acc-bar' }, h('div', { class: 'acc-fill', style: { width: pct(e.g.accuracy) } }));
    return h('a', { class: 'stat-line tappable', href: `#/practice`, onclick: () => rememberTopic(e.filter) },
      h('div', { class: 'sl-main' },
        h('div', { class: 'sl-label' }, h('span', { text: e.label }), h('span', { class: 'muted tiny', text: ` · ${e.g.answered}` })),
        bar,
      ),
      h('div', { class: 'sl-right' },
        h('div', { text: pct(e.g.accuracy) }),
        h('div', { class: 'muted tiny', text: formatClock(e.g.avgTimeMs) }),
      ),
    );
  });
  return section(title, children);
}

// Stash a requested practice filter (picked up by practice on next load is not
// wired; we simply navigate — a lightweight hint via sessionStorage).
function rememberTopic(filter) {
  try { sessionStorage.setItem('pet.practiceHint', JSON.stringify(filter)); } catch {}
}

async function openSim(root, rec) {
  const sheet = await db.getAnswerSheet(rec.testId);
  if (!sheet) { toast('קובץ התשובות נמחק'); return; }
  renderResults(root, sheet, rec);
}

// ---- trend (inline SVG) ----------------------------------------------------

function trendSection(attempts, lang) {
  const state = { days: 14 };
  const container = h('section', { class: 'card' });
  const head = h('div', { class: 'card-title trend-head' },
    h('span', { text: t('stats.trend') }),
    h('div', { class: 'segmented small' },
      h('button', { class: 'seg active', text: t('stats.trend14'), onclick: (e) => setDays(14, e) }),
      h('button', { class: 'seg', text: t('stats.trend30'), onclick: (e) => setDays(30, e) }),
    ),
  );
  const body = h('div', { class: 'trend-body' });
  container.append(head, body);
  draw();

  function setDays(d, e) {
    state.days = d;
    head.querySelectorAll('.seg').forEach((b) => b.classList.remove('active'));
    e.target.classList.add('active');
    draw();
  }
  function draw() {
    clear(body);
    const data = trend(attempts, state.days);
    body.appendChild(h('div', { class: 'trend-caption', text: t('stats.accuracy') }));
    body.appendChild(lineChart(data.map((d) => d.accuracy), { pctAxis: true, color: 'var(--green)' }));
    body.appendChild(h('div', { class: 'trend-caption', text: t('stats.avgTime') }));
    const maxMs = Math.max(1, ...data.map((d) => d.avgTimeMs || 0));
    body.appendChild(lineChart(data.map((d) => d.avgTimeMs == null ? null : d.avgTimeMs / maxMs), { color: 'var(--amber)' }));
  }
  return container;
}

function lineChart(values, { color = 'var(--green)' } = {}) {
  const W = 320, H = 64, pad = 6;
  const n = values.length;
  const stepX = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const pts = [];
  values.forEach((v, i) => {
    if (v == null) return;
    const x = pad + i * stepX;
    const y = H - pad - v * (H - pad * 2);
    pts.push([x, y]);
  });
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'linechart');
  svg.setAttribute('preserveAspectRatio', 'none');
  // baseline
  const base = document.createElementNS(ns, 'line');
  base.setAttribute('x1', pad); base.setAttribute('x2', W - pad);
  base.setAttribute('y1', H - pad); base.setAttribute('y2', H - pad);
  base.setAttribute('class', 'lc-base');
  svg.appendChild(base);
  if (pts.length >= 2) {
    const poly = document.createElementNS(ns, 'polyline');
    poly.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', color);
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-linejoin', 'round');
    poly.setAttribute('stroke-linecap', 'round');
    svg.appendChild(poly);
  }
  for (const p of pts) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); c.setAttribute('r', '2.2');
    c.setAttribute('fill', color);
    svg.appendChild(c);
  }
  if (pts.length < 2 && pts.length <= 1) {
    const txt = document.createElementNS(ns, 'text');
    txt.setAttribute('x', W / 2); txt.setAttribute('y', H / 2); txt.setAttribute('class', 'lc-empty');
    txt.setAttribute('text-anchor', 'middle');
    txt.textContent = '—';
    svg.appendChild(txt);
  }
  return svg;
}

// stats.js — attempt logging, aggregation for the Stats screen, and the
// spaced-repetition review queue state.

import * as db from './db.js';
import { getSettings } from './config.js';

export function newSessionId() {
  return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// Record a single attempt and update review state.
// attempt: { questionId, testId, domain, topic, mode, selected, correct, timedOut, timeMs, sessionId }
export async function logAttempt(attempt) {
  const row = { ...attempt, timestamp: Date.now() };
  await db.addAttempt(row);
  await maintainReview(row);
  return row;
}

// ---- review (spaced repetition) --------------------------------------------
// reviewState: { [questionId]: { active, reviewStreak, wrongs, lastTs } }

async function loadReviewState() { return (await db.kvGet('reviewState', {})) || {}; }
async function saveReviewState(map) { return db.kvSet('reviewState', map); }

async function maintainReview(row) {
  const map = await loadReviewState();
  const key = row.questionId;
  const e = map[key] || { active: false, reviewStreak: 0, wrongs: 0, lastTs: 0 };
  if (row.timedOut || !row.correct) {
    e.active = true; e.reviewStreak = 0; e.wrongs += 1;
  } else if (row.correct) {
    if (row.mode === 'review' && e.active) {
      e.reviewStreak += 1;
      if (e.reviewStreak >= 2) { e.active = false; }
    }
  }
  e.lastTs = row.timestamp;
  map[key] = e;
  await saveReviewState(map);
}

// Returns active review questionIds (most-wrong / oldest first).
export async function getReviewQueueIds() {
  const map = await loadReviewState();
  return Object.entries(map)
    .filter(([, e]) => e.active)
    .sort((a, b) => (b[1].wrongs - a[1].wrongs) || (a[1].lastTs - b[1].lastTs))
    .map(([id]) => id);
}

export async function reviewProgress() {
  const map = await loadReviewState();
  const entries = Object.values(map);
  const active = entries.filter((e) => e.active).length;
  return { active, total: entries.length };
}

// ---- aggregation -----------------------------------------------------------

export async function getAllAttempts() { return db.getAllAttempts(); }

export function overall(attempts) {
  const answered = attempts.length;
  const correct = attempts.filter((a) => a.correct).length;
  const timedOut = attempts.filter((a) => a.timedOut).length;
  const totalTime = attempts.reduce((s, a) => s + (a.timeMs || 0), 0);
  return {
    answered,
    correct,
    timedOut,
    accuracy: answered ? correct / answered : 0,
    avgTimeMs: answered ? totalTime / answered : 0,
    totalTimeMs: totalTime,
    streakDays: dailyStreak(attempts),
  };
}

export function groupBy(attempts, keyFn) {
  const m = new Map();
  for (const a of attempts) {
    const k = keyFn(a);
    if (k == null) continue;
    let g = m.get(k);
    if (!g) { g = { key: k, answered: 0, correct: 0, timedOut: 0, totalTimeMs: 0 }; m.set(k, g); }
    g.answered++; if (a.correct) g.correct++; if (a.timedOut) g.timedOut++; g.totalTimeMs += a.timeMs || 0;
  }
  return [...m.values()].map((g) => ({
    ...g,
    accuracy: g.answered ? g.correct / g.answered : 0,
    avgTimeMs: g.answered ? g.totalTimeMs / g.answered : 0,
  }));
}

export function byDomain(attempts) {
  return groupBy(attempts, (a) => a.domain).sort((a, b) => a.accuracy - b.accuracy);
}
export function byTopic(attempts) {
  return groupBy(attempts, (a) => a.topic).sort((a, b) => a.accuracy - b.accuracy);
}

// Daily streak: consecutive days (ending today or yesterday) with >=1 attempt.
export function dailyStreak(attempts) {
  if (!attempts.length) return 0;
  const days = new Set(attempts.map((a) => startOfDay(a.timestamp)));
  const DAY = 86400000;
  let cursor = startOfDay(Date.now());
  if (!days.has(cursor)) { cursor -= DAY; if (!days.has(cursor)) return 0; }
  let streak = 0;
  while (days.has(cursor)) { streak++; cursor -= DAY; }
  return streak;
}

// Trend over the last N days: per-day accuracy, avg time, count.
export function trend(attempts, days = 14) {
  const DAY = 86400000;
  const today = startOfDay(Date.now());
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = today - i * DAY;
    buckets.push({ date: d, key: dayKey(d), answered: 0, correct: 0, totalTimeMs: 0 });
  }
  const idx = new Map(buckets.map((b) => [b.key, b]));
  for (const a of attempts) {
    const b = idx.get(dayKey(a.timestamp));
    if (b) { b.answered++; if (a.correct) b.correct++; b.totalTimeMs += a.timeMs || 0; }
  }
  return buckets.map((b) => ({
    date: b.date, key: b.key,
    answered: b.answered,
    accuracy: b.answered ? b.correct / b.answered : null,
    avgTimeMs: b.answered ? b.totalTimeMs / b.answered : null,
  }));
}

// Slowest topics: avg time over the domain budget (seconds).
export function slowestTopics(attempts) {
  const s = getSettings();
  const budget = { verbal: s.timePerVerbal * 1000, quant: s.timePerQuant * 1000 };
  // need domain per topic; derive from attempts
  const topicDomain = new Map();
  for (const a of attempts) if (!topicDomain.has(a.topic)) topicDomain.set(a.topic, a.domain);
  return byTopic(attempts)
    .map((g) => ({ ...g, domain: topicDomain.get(g.key), budgetMs: budget[topicDomain.get(g.key)] || 0 }))
    .filter((g) => g.budgetMs && g.avgTimeMs > g.budgetMs && g.answered >= 3)
    .sort((a, b) => (b.avgTimeMs - b.budgetMs) - (a.avgTimeMs - a.budgetMs));
}

// Coverage: distinct questions seen per test (out of its total).
export function coverage(attempts, tests) {
  const seenByTest = new Map();
  for (const a of attempts) {
    if (!seenByTest.has(a.testId)) seenByTest.set(a.testId, new Set());
    seenByTest.get(a.testId).add(a.questionId);
  }
  return tests.map((t) => ({
    id: t.id, title: t.title,
    seen: seenByTest.get(t.id)?.size || 0,
    total: 86,
  }));
}

export async function resetStats() {
  await Promise.all([db.clearAttempts(), db.clearSimResults(), db.kvDelete('reviewState'), db.kvDelete('seen')]);
}

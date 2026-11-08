// modes/timedQuestion.js — same as Practice but with a per-question countdown.

import { renderPractice } from './practice.js';

export function renderTimed(root) {
  return renderPractice(root, { mode: 'timed', timed: true });
}

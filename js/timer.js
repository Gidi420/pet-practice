// timer.js — timestamp-based countdown that survives backgrounding.
// Remaining time is always computed from a stored endTime, never by counting ticks.

export class Countdown {
  // opts: { endTime (ms epoch), onTick(remainingMs), onExpire(), intervalMs }
  constructor(opts) {
    this.endTime = opts.endTime;
    this.onTick = opts.onTick || (() => {});
    this.onExpire = opts.onExpire || (() => {});
    this.intervalMs = opts.intervalMs || 250;
    this._id = null;
    this._expired = false;
    this._onVis = () => this._tick();
  }

  get remaining() { return Math.max(0, this.endTime - Date.now()); }

  start() {
    this.stop();
    document.addEventListener('visibilitychange', this._onVis);
    this._tick();
    this._id = setInterval(() => this._tick(), this.intervalMs);
    return this;
  }

  setEndTime(endTime) { this.endTime = endTime; this._expired = false; this._tick(); }

  addMs(ms) { this.setEndTime(this.endTime + ms); }

  _tick() {
    const rem = this.remaining;
    this.onTick(rem);
    if (rem <= 0 && !this._expired) {
      this._expired = true;
      this.stop();
      this.onExpire();
    }
  }

  stop() {
    if (this._id) { clearInterval(this._id); this._id = null; }
    document.removeEventListener('visibilitychange', this._onVis);
  }
}

// A silent elapsed-time stopwatch (for per-question time tracking).
export class Stopwatch {
  constructor() { this._start = 0; this._acc = 0; this._running = false; }
  start() { if (!this._running) { this._start = Date.now(); this._running = true; } return this; }
  pause() { if (this._running) { this._acc += Date.now() - this._start; this._running = false; } return this; }
  reset() { this._start = 0; this._acc = 0; this._running = false; return this; }
  get elapsedMs() { return this._acc + (this._running ? Date.now() - this._start : 0); }
}

export function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDuration(ms, lang = 'he') {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return lang === 'he' ? `${h} ש׳ ${m} ד׳` : `${h}h ${m}m`;
  const s = total % 60;
  if (m > 0) return lang === 'he' ? `${m} ד׳` : `${m}m`;
  return lang === 'he' ? `${s} שנ׳` : `${s}s`;
}

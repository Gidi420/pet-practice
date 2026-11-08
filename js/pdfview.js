// pdfview.js — pdf.js loading, page rendering, an LRU render cache, and a
// touch PageViewer (pinch-zoom, pan, swipe between pages).

import { getPdf } from './db.js';

// --- Load pdf.js from the vendored /lib (never a CDN) -----------------------

let _pdfjs = null;

// Polyfill for older iOS Safari (<17.4): pdf.js 4.x uses Promise.withResolvers.
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

export async function loadPdfjs() {
  if (_pdfjs) return _pdfjs;
  const lib = await import('../lib/pdfjs/pdf.mjs');
  lib.GlobalWorkerOptions.workerSrc = new URL('../lib/pdfjs/pdf.worker.mjs', import.meta.url).href;
  _pdfjs = lib;
  return lib;
}

const CMAP_URL = new URL('../lib/pdfjs/cmaps/', import.meta.url).href;
const FONT_URL = new URL('../lib/pdfjs/standard_fonts/', import.meta.url).href;

// --- Document cache (keep a couple of open PDFs) ----------------------------

const DOC_CACHE = new Map(); // testId -> { doc, used }
const MAX_DOCS = 2;

async function getDoc(testId) {
  const cached = DOC_CACHE.get(testId);
  if (cached) { cached.used = Date.now(); return cached.doc; }

  const rec = await getPdf(testId);
  if (!rec || !rec.bytes) throw new Error('PDF not imported for ' + testId);
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(rec.bytes.slice(0)),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: FONT_URL,
    disableAutoFetch: true,
    disableStream: true,
  }).promise;

  DOC_CACHE.set(testId, { doc, used: Date.now() });
  // evict least-recently-used
  if (DOC_CACHE.size > MAX_DOCS) {
    let oldestKey = null, oldest = Infinity;
    for (const [k, v] of DOC_CACHE) if (v.used < oldest && k !== testId) { oldest = v.used; oldestKey = k; }
    if (oldestKey) { try { DOC_CACHE.get(oldestKey).doc.destroy(); } catch {} DOC_CACHE.delete(oldestKey); }
  }
  return doc;
}

export async function getPageCount(testId) {
  const doc = await getDoc(testId);
  return doc.numPages;
}

// --- Rendered-page LRU cache ------------------------------------------------

const RENDER_CACHE = new Map(); // key -> { canvas, cssW, cssH }
const MAX_RENDERS = 10;

function cacheKey(testId, pageNum, widthPx) { return `${testId}|${pageNum}|${widthPx}`; }

function touchCache(key, value) {
  RENDER_CACHE.delete(key);
  RENDER_CACHE.set(key, value);
  while (RENDER_CACHE.size > MAX_RENDERS) {
    const firstKey = RENDER_CACHE.keys().next().value;
    RENDER_CACHE.delete(firstKey);
  }
}

// Render a page to an offscreen canvas sized to cssWidth * dpr (capped).
export async function renderPage(testId, pageNum, cssWidth) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const widthPx = Math.round(cssWidth * dpr);
  const key = cacheKey(testId, pageNum, widthPx);
  const hit = RENDER_CACHE.get(key);
  if (hit) { touchCache(key, hit); return hit; }

  const doc = await getDoc(testId);
  const p = Math.max(1, Math.min(pageNum, doc.numPages));
  const page = await doc.getPage(p);
  const viewport1 = page.getViewport({ scale: 1 });
  const scale = widthPx / viewport1.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  await page.render({ canvasContext: ctx, viewport }).promise;

  const value = { canvas, cssW: cssWidth, cssH: Math.round(viewport.height / dpr), widthPx };
  touchCache(key, value);
  return value;
}

// Fire-and-forget pre-render of a nearby page.
export function prefetch(testId, pageNum, cssWidth) {
  if (!testId || !pageNum) return;
  renderPage(testId, pageNum, cssWidth).catch(() => {});
}

export function clearDocCache() {
  for (const { doc } of DOC_CACHE.values()) { try { doc.destroy(); } catch {} }
  DOC_CACHE.clear();
  RENDER_CACHE.clear();
}

// --- PageViewer: a touch-driven page canvas ---------------------------------

export class PageViewer {
  // container: element to fill. opts: { onPageChange(page), invert }
  constructor(container, opts = {}) {
    this.container = container;
    this.onPageChange = opts.onPageChange || (() => {});
    this.invert = !!opts.invert;
    this.testId = null;
    this.first = 1; this.last = 1; this.page = 1;
    this.scale = 1; this.tx = 0; this.ty = 0;
    this._pointers = new Map();
    this._pinchStart = null;
    this._panStart = null;

    container.classList.add('pageviewer');
    this.stage = document.createElement('div');
    this.stage.className = 'pv-stage';
    this.inner = document.createElement('div');
    this.inner.className = 'pv-inner';
    this.stage.appendChild(this.inner);
    container.appendChild(this.stage);
    this.spinner = document.createElement('div');
    this.spinner.className = 'pv-spinner';
    this.spinner.textContent = '…';
    container.appendChild(this.spinner);

    this._bindGestures();
  }

  setInvert(on) { this.invert = on; this.inner.classList.toggle('pv-invert', on); }

  async setSource(testId, range) {
    this.testId = testId;
    this.first = range.first; this.last = range.last;
    await this.showPage(range.page ?? range.first);
  }

  get cssWidth() { return this.container.clientWidth || window.innerWidth; }

  async showPage(pageNum, { resetZoom = true } = {}) {
    const p = Math.max(this.first, Math.min(pageNum, this.last));
    this.page = p;
    if (resetZoom) { this.scale = 1; this.tx = 0; this.ty = 0; this._applyTransform(); }
    this.spinner.style.display = 'flex';
    try {
      const { canvas, cssW, cssH } = await renderPage(this.testId, p, this.cssWidth);
      this.inner.innerHTML = '';
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      this.inner.classList.toggle('pv-invert', this.invert);
      this.inner.appendChild(canvas);
    } catch (e) {
      this.inner.innerHTML = `<div class="pv-error">שגיאה בטעינת העמוד<br><small>${e.message || e}</small></div>`;
    } finally {
      this.spinner.style.display = 'none';
    }
    this.onPageChange(p);
    // pre-render neighbours
    if (p + 1 <= this.last) prefetch(this.testId, p + 1, this.cssWidth);
    if (p - 1 >= this.first) prefetch(this.testId, p - 1, this.cssWidth);
  }

  canPrev() { return this.page > this.first; }
  canNext() { return this.page < this.last; }
  prev() { if (this.canPrev()) this.showPage(this.page - 1); }
  next() { if (this.canNext()) this.showPage(this.page + 1); }

  _applyTransform() {
    this.inner.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
  }

  _bindGestures() {
    const el = this.stage;
    el.style.touchAction = 'pan-y';

    const onDown = (e) => {
      el.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 2) {
        const pts = [...this._pointers.values()];
        this._pinchStart = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          scale: this.scale,
        };
        this._swipe = null;
      } else if (this._pointers.size === 1) {
        this._panStart = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
        this._swipe = { x0: e.clientX, y0: e.clientY, t0: Date.now() };
      }
    };

    const onMove = (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._pointers.size === 2 && this._pinchStart) {
        const pts = [...this._pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        let s = this._pinchStart.scale * (dist / this._pinchStart.dist);
        s = Math.max(1, Math.min(s, 5));
        this.scale = s;
        if (s === 1) { this.tx = 0; this.ty = 0; }
        this._applyTransform();
        e.preventDefault();
      } else if (this._pointers.size === 1 && this.scale > 1 && this._panStart) {
        this.tx = this._panStart.tx + (e.clientX - this._panStart.x);
        this.ty = this._panStart.ty + (e.clientY - this._panStart.y);
        this._applyTransform();
        e.preventDefault();
      }
    };

    const onUp = (e) => {
      const was = this._pointers.get(e.pointerId);
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinchStart = null;

      // swipe to change page (only when not zoomed)
      if (this.scale === 1 && this._swipe && was) {
        const dx = e.clientX - this._swipe.x0;
        const dy = e.clientY - this._swipe.y0;
        const dt = Date.now() - this._swipe.t0;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 600) {
          // RTL note: physical swipe direction is kept intuitive.
          if (dx < 0) this.next(); else this.prev();
        }
      }
      this._swipe = null;
      this._panStart = null;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove, { passive: false });
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    // double-tap to toggle zoom
    let lastTap = 0;
    el.addEventListener('pointerup', (e) => {
      const now = Date.now();
      if (now - lastTap < 300 && this._pointers.size === 0) {
        if (this.scale > 1) { this.scale = 1; this.tx = 0; this.ty = 0; }
        else { this.scale = 2.2; }
        this._applyTransform();
      }
      lastTap = now;
    });
  }

  destroy() {
    this._pointers.clear();
    this.container.innerHTML = '';
    this.container.classList.remove('pageviewer');
  }
}

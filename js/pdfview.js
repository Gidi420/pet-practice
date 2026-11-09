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

// concurrent first loads of the same PDF share one parse instead of opening it twice
const DOC_LOADING = new Map(); // testId -> Promise<doc>

function getDoc(testId) {
  const cached = DOC_CACHE.get(testId);
  if (cached) { cached.used = Date.now(); return Promise.resolve(cached.doc); }
  if (!DOC_LOADING.has(testId)) {
    DOC_LOADING.set(testId, openDoc(testId).finally(() => DOC_LOADING.delete(testId)));
  }
  return DOC_LOADING.get(testId);
}

async function openDoc(testId) {
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
  // cap device pixels so deep zoom stays within a sane memory budget
  const widthPx = Math.min(Math.round(cssWidth * dpr), 2200);
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

  // derive CSS height from the rendered aspect ratio so the width cap never distorts it
  const value = { canvas, cssW: cssWidth, cssH: Math.round(cssWidth * canvas.height / canvas.width), widthPx };
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
  // The page renders at full width inside a vertically-scrollable stage, so the
  // whole page (all questions) is reachable. Zoom re-renders at a wider size and
  // the stage scrolls in both axes.
  constructor(container, opts = {}) {
    this.container = container;
    this.onPageChange = opts.onPageChange || (() => {});
    this.invert = !!opts.invert;
    this.testId = null;
    this.first = 1; this.last = 1; this.page = 1;
    this.zoom = 1;
    this._pointers = new Map();
    this._pinch = null;
    this._pinchTarget = null;

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

    // zoom controls — shown only for mouse/trackpad users (CSS media query)
    const zbtn = (txt, label, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = txt; b.setAttribute('aria-label', label);
      b.addEventListener('click', fn);
      return b;
    };
    this.zoomLabel = document.createElement('span');
    this.zoomLabel.className = 'pv-zoomlabel';
    this.zoomBar = document.createElement('div');
    this.zoomBar.className = 'pv-zoom';
    this.zoomBar.append(
      zbtn('−', 'zoom out', () => this.zoomBy(1 / 1.2)),
      this.zoomLabel,
      zbtn('+', 'zoom in', () => this.zoomBy(1.2)),
    );
    this.zoomLabel.addEventListener('click', () => this.setZoom(1));
    container.appendChild(this.zoomBar);

    this._bindGestures();

    // re-render when the available width changes (desktop window resize, rotation)
    this._lastW = 0;
    if ('ResizeObserver' in window) {
      let rT = null;
      this._ro = new ResizeObserver(() => {
        const w = this.cssWidth;
        if (!this.testId || !this._lastW || Math.abs(w - this._lastW) < 8) { this._lastW = this._lastW || w; return; }
        clearTimeout(rT);
        rT = setTimeout(() => { this._lastW = this.cssWidth; this.showPage(this.page, { keepZoom: true }); }, 200);
      });
      this._ro.observe(this.stage);
    }
  }

  // mouse users may shrink below fit-width to see a whole page at once
  get minZoom() { return window.matchMedia('(pointer: fine)').matches ? 0.5 : 1; }

  zoomBy(f) { return this.setZoom(this.zoom * f); }

  // Keyboard handling shared by all question screens. Returns true if handled.
  handleKey(e) {
    const rtl = document.documentElement.dir === 'rtl';
    switch (e.key) {
      case 'ArrowLeft': rtl ? this.next() : this.prev(); return true;
      case 'ArrowRight': rtl ? this.prev() : this.next(); return true;
      case 'ArrowDown': this.stage.scrollBy({ top: 90 }); return true;
      case 'ArrowUp': this.stage.scrollBy({ top: -90 }); return true;
      case 'PageDown': case ' ': this.stage.scrollBy({ top: this.stage.clientHeight * 0.85, behavior: 'smooth' }); return true;
      case 'PageUp': this.stage.scrollBy({ top: -this.stage.clientHeight * 0.85, behavior: 'smooth' }); return true;
      case 'Home': this.stage.scrollTo({ top: 0 }); return true;
      case 'End': this.stage.scrollTo({ top: this.stage.scrollHeight }); return true;
      case '+': case '=': this.zoomBy(1.2); return true;
      case '-': case '_': this.zoomBy(1 / 1.2); return true;
      case '0': this.setZoom(1); return true;
    }
    return false;
  }

  _updateZoomLabel() { this.zoomLabel.textContent = Math.round(this.zoom * 100) + '%'; }

  setInvert(on) { this.invert = on; this.inner.classList.toggle('pv-invert', on); }

  async setSource(testId, range) {
    this.testId = testId;
    this.first = range.first; this.last = range.last;
    this.zoom = 1;
    await this.showPage(range.page ?? range.first);
  }

  // Fit-width, but on wide desktop screens cap it so an A4 page stays readable
  // without a huge amount of scrolling.
  get cssWidth() {
    const w = this.stage.clientWidth || this.container.clientWidth || window.innerWidth;
    // -1: clientWidth is rounded, so a fractional stage width would otherwise overflow by <1px
    return Math.min(w - 1, 880);
  }

  async showPage(pageNum, { keepZoom = false } = {}) {
    const p = Math.max(this.first, Math.min(pageNum, this.last));
    this.page = p;
    if (!keepZoom) this.zoom = 1;
    this.inner.style.transform = '';
    this.spinner.style.display = 'flex';
    // a newer showPage() may start while this one is still rendering; only the latest may draw
    const token = this._showToken = (this._showToken || 0) + 1;
    try {
      this._lastW = this.cssWidth;
      const renderW = Math.round(this.cssWidth * this.zoom);
      const { canvas, cssW, cssH } = await renderPage(this.testId, p, renderW);
      if (token !== this._showToken) return;
      this.inner.innerHTML = '';
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      this.inner.style.width = cssW + 'px';
      this.inner.classList.toggle('pv-invert', this.invert);
      this.inner.appendChild(canvas);
      if (!keepZoom) this.stage.scrollTop = 0;
      this.stage.scrollLeft = Math.max(0, (cssW - this.stage.clientWidth) / 2);
      this._updateZoomLabel();
    } catch (e) {
      if (token !== this._showToken) return;
      this.inner.innerHTML = `<div class="pv-error">שגיאה בטעינת העמוד<br><small>${e.message || e}</small></div>`;
    } finally {
      if (token === this._showToken) this.spinner.style.display = 'none';
    }
    this.onPageChange(p);
    // pre-render neighbours at base width
    if (p + 1 <= this.last) prefetch(this.testId, p + 1, this.cssWidth);
    if (p - 1 >= this.first) prefetch(this.testId, p - 1, this.cssWidth);
  }

  canPrev() { return this.page > this.first; }
  canNext() { return this.page < this.last; }
  prev() { if (this.canPrev()) this.showPage(this.page - 1); }
  next() { if (this.canNext()) this.showPage(this.page + 1); }

  async setZoom(z) {
    z = Math.max(this.minZoom, Math.min(z, 4));
    this.inner.style.transform = '';
    if (Math.abs(z - this.zoom) < 0.02) return;
    // keep the same relative scroll position across the re-render
    const st = this.stage;
    const relY = st.scrollHeight > st.clientHeight ? st.scrollTop / st.scrollHeight : 0;
    this.zoom = z;
    await this.showPage(this.page, { keepZoom: true });
    st.scrollTop = relY * st.scrollHeight;
  }

  _bindGestures() {
    const el = this.stage;
    // allow native 1-finger scroll (both axes); we handle 2-finger pinch ourselves
    el.style.touchAction = 'pan-x pan-y';

    const onDown = (e) => {
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 2) {
        const pts = [...this._pointers.values()];
        this._pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), zoom: this.zoom };
        this._pinchTarget = this.zoom;
        this._swipe = null;
      } else if (this._pointers.size === 1) {
        this._swipe = { x0: e.clientX, y0: e.clientY, t0: Date.now() };
      }
    };

    const onMove = (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 2 && this._pinch) {
        const pts = [...this._pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const target = Math.max(1, Math.min(this._pinch.zoom * (dist / this._pinch.dist), 4));
        this._pinchTarget = target;
        // live visual feedback relative to the currently-rendered zoom
        this.inner.style.transformOrigin = 'center top';
        this.inner.style.transform = `scale(${target / this.zoom})`;
        e.preventDefault();
      }
    };

    const onUp = (e) => {
      const was = this._pointers.get(e.pointerId);
      this._pointers.delete(e.pointerId);
      if (this._pinch && this._pointers.size < 2) {
        const target = this._pinchTarget || this.zoom;
        this._pinch = null; this._pinchTarget = null;
        this.setZoom(target);
        this._swipe = null;
        return;
      }
      // horizontal swipe to change page — only when not zoomed (no horizontal scroll then)
      if (this.zoom <= 1.02 && this._swipe && was && this._pointers.size === 0) {
        const dx = e.clientX - this._swipe.x0;
        const dy = e.clientY - this._swipe.y0;
        const dt = Date.now() - this._swipe.t0;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.8 && dt < 700) {
          if (dx < 0) this.next(); else this.prev();
        }
      }
      this._swipe = null;
    };

    // ctrl/⌘ + wheel (and trackpad pinch, which browsers report as ctrl+wheel) zooms
    let wheelT = null, wheelTarget = null;
    el.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const base = wheelTarget ?? this.zoom;
      wheelTarget = Math.max(this.minZoom, Math.min(base * Math.exp(-e.deltaY * 0.01), 4));
      this.inner.style.transformOrigin = 'center top';
      this.inner.style.transform = `scale(${wheelTarget / this.zoom})`;
      clearTimeout(wheelT);
      wheelT = setTimeout(() => { const z = wheelTarget; wheelTarget = null; this.setZoom(z); }, 180);
    }, { passive: false });

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove, { passive: false });
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    // double-tap toggles zoom
    let lastTap = 0;
    el.addEventListener('pointerup', () => {
      const now = Date.now();
      if (now - lastTap < 300 && this._pointers.size === 0) {
        this.setZoom(this.zoom > 1.02 ? 1 : 2.2);
      }
      lastTap = now;
    });
  }

  destroy() {
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    this._pointers.clear();
    this.container.innerHTML = '';
    this.container.classList.remove('pageviewer');
  }
}

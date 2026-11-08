// app.js — hash router, app shell, theme/language, onboarding.

import { t, getSettings, saveSettings, APP_VERSION } from './config.js';
import { h, clear } from './ui.js';
import * as db from './db.js';
import { renderPractice } from './modes/practice.js';
import { renderTimed } from './modes/timedQuestion.js';
import { renderSimulation } from './modes/simulation.js';
import { renderReview } from './modes/review.js';
import { renderStats } from './statsview.js';
import { renderSettings, renderTests } from './settings.js';

const appEl = document.getElementById('app');
const tabbarEl = document.getElementById('tabbar');
let currentController = null;

const TABS = [
  { id: 'practice', route: '#/practice', icon: '✎', label: 'tab.practice' },
  { id: 'timed', route: '#/timed', icon: '⏱', label: 'tab.timed' },
  { id: 'sim', route: '#/sim', icon: '▦', label: 'tab.sim' },
  { id: 'stats', route: '#/stats', icon: '📊', label: 'tab.stats' },
  { id: 'settings', route: '#/settings', icon: '⚙', label: 'tab.settings' },
];

const ROUTES = {
  '/practice': { tab: 'practice', render: (root) => renderPractice(root) },
  '/timed': { tab: 'timed', render: (root) => renderTimed(root) },
  '/sim': { tab: 'sim', render: (root) => renderSimulation(root) },
  '/sim/run': { tab: 'sim', render: (root) => renderSimulation(root, { run: true }), chromeless: true },
  '/stats': { tab: 'stats', render: (root) => renderStats(root) },
  '/settings': { tab: 'settings', render: (root) => renderSettings(root) },
  '/tests': { tab: 'settings', render: (root) => renderTests(root) },
  '/review': { tab: 'stats', render: (root) => renderReview(root) },
};

// ---- theme + language ------------------------------------------------------

function resolveDark() {
  const theme = getSettings().theme;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyAppearance() {
  const s = getSettings();
  const dark = resolveDark();
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.lang = s.lang;
  document.documentElement.dir = s.lang === 'he' ? 'rtl' : 'ltr';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#111311' : '#fafaf7');
  document.dispatchEvent(new CustomEvent('theme-changed', { detail: { dark } }));
}

window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => { if (getSettings().theme === 'auto') applyAppearance(); });

document.addEventListener('settings-changed', () => { applyAppearance(); renderTabbar(); });

// ---- tab bar ---------------------------------------------------------------

function renderTabbar(activeTab) {
  clear(tabbarEl);
  for (const tab of TABS) {
    const a = h('a', { class: 'tab' + (tab.id === activeTab ? ' active' : ''), href: tab.route },
      h('span', { class: 'tab-icon', text: tab.icon }),
      h('span', { class: 'tab-label', text: t(tab.label) }),
    );
    tabbarEl.appendChild(a);
  }
}

// ---- onboarding ------------------------------------------------------------

async function hasLibrary() {
  const [sheets, pdfs] = await Promise.all([db.getAllAnswerSheets(), db.getAllPdfMeta()]);
  return sheets.length > 0 || pdfs.length > 0;
}

function renderOnboarding(root) {
  clear(root).appendChild(h('div', { class: 'screen onboarding' },
    h('div', { class: 'ob-logo', text: '📘' }),
    h('h1', { text: t('onboard.title') }),
    h('p', { class: 'ob-body', text: t('onboard.body') }),
    h('div', { class: 'ob-note', text: t('onboard.note') }),
    h('a', { class: 'btn btn-primary wide', href: '#/tests', text: t('onboard.cta') }),
  ));
  return { destroy() {} };
}

// ---- router ----------------------------------------------------------------

async function router() {
  const hash = location.hash || '#/practice';
  const path = hash.slice(1);
  const route = ROUTES[path] || ROUTES['/practice'];

  if (currentController && currentController.destroy) {
    try { currentController.destroy(); } catch {}
  }
  currentController = null;
  // dismiss any open bottom sheets / modals left over from the previous screen
  document.querySelectorAll('.sheet-overlay, .modal-overlay').forEach((el) => el.remove());

  document.body.classList.toggle('chromeless', !!route.chromeless);
  renderTabbar(route.tab);

  // onboarding gate (when no tests and not on a settings/tests screen)
  if (path !== '/settings' && path !== '/tests') {
    const has = await hasLibrary();
    if (!has) { currentController = renderOnboarding(appEl); window.scrollTo(0, 0); return; }
  }

  try {
    currentController = await route.render(appEl);
  } catch (e) {
    clear(appEl).appendChild(h('div', { class: 'screen' }, h('p', { class: 'error', text: 'שגיאה: ' + (e.message || e) })));
    console.error(e);
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', router);

// ---- boot ------------------------------------------------------------------

export async function boot() {
  applyAppearance();
  if (!location.hash) location.hash = '#/practice';
  await router();
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // auto-reload once when a new service worker takes control (seamless updates)
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url).href, { scope: './' })
    .then((reg) => {
      reg.update().catch(() => {});
      // check again whenever the app returns to the foreground
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}

boot();

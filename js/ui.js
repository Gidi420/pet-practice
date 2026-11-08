// ui.js — tiny DOM helpers, haptics, toast, dialogs and bottom sheets.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function haptic(style = 'light') {
  try {
    if (navigator.vibrate) {
      const map = { light: 10, medium: 18, heavy: 30, warn: [20, 40, 20] };
      navigator.vibrate(map[style] || 10);
    }
  } catch {}
}

let _toastTimer = null;
export function toast(msg, ms = 2600) {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', class: 'toast' }); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// Modal confirm. Returns Promise<boolean>.
export function confirmDialog(message, { okText = 'אישור', cancelText = 'ביטול', danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'modal-overlay' });
    const close = (val) => { overlay.remove(); resolve(val); };
    const box = h('div', { class: 'modal-box' },
      h('p', { class: 'modal-msg', text: message }),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn btn-ghost', onclick: () => close(false), text: cancelText }),
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => close(true), text: okText }),
      ),
    );
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

// Bottom sheet modal. contentFn(close) returns an element.
export function sheet(contentFn) {
  const overlay = h('div', { class: 'sheet-overlay' });
  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 220); };
  const panel = h('div', { class: 'sheet-panel' });
  panel.appendChild(h('div', { class: 'sheet-grip' }));
  panel.appendChild(contentFn(close));
  overlay.appendChild(panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return close;
}

export function pct(x) { return Math.round((x || 0) * 100) + '%'; }

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'segmented' });
  options.forEach((opt) => {
    const b = h('button', {
      class: 'seg' + (opt.value === value ? ' active' : ''),
      text: opt.label,
      onclick: () => { onChange(opt.value); },
    });
    b.dataset.value = opt.value;
    wrap.appendChild(b);
  });
  return wrap;
}

// Horizontal scrollable chip row for filters.
export function chipRow(items, selected, onPick) {
  const row = h('div', { class: 'chip-row' });
  items.forEach((it) => {
    row.appendChild(h('button', {
      class: 'chip' + (it.value === selected ? ' active' : ''),
      text: it.label,
      onclick: () => onPick(it.value),
    }));
  });
  return row;
}

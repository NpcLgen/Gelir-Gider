/** Bağımlılıksız minik DOM yardımcıları. */

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'html') el.innerHTML = value;
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export function select(props, options, value) {
  const el = h('select', props);
  for (const opt of options) {
    el.appendChild(h('option', { value: opt.value, selected: String(opt.value) === String(value) }, opt.label));
  }
  return el;
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control,
    hint ? h('span', { class: 'field-hint' }, hint) : null);
}

/** Modal katman. `content(close)` fonksiyonu içeriği üretir. */
export function openModal({ title, subtitle, content, size = 'md', onClose }) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });

  const body = h('div', { class: 'modal-body' });
  const modal = h('div', { class: `modal modal-${size}` },
    h('header', { class: 'modal-header' },
      h('div', {}, h('h2', {}, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
      h('button', { class: 'icon-btn', type: 'button', title: 'Kapat', onClick: close }, '✕')),
    body);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  append(body, [content(close)]);
  return { close, body };
}

export function confirmDialog(message, onYes) {
  openModal({
    title: 'Onay',
    size: 'sm',
    content: (close) => h('div', { class: 'stack' },
      h('p', {}, message),
      h('div', { class: 'row end gap' },
        h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
        h('button', { class: 'btn danger', type: 'button', onClick: () => { close(); onYes(); } }, 'Evet, sil'))),
  });
}

let toastTimer;
export function toast(message, kind = 'ok') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = h('div', { class: 'toast' });
    document.body.appendChild(el);
  }
  el.className = `toast toast-${kind} show`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export function errorList(errors) {
  return h('ul', { class: 'error-list' }, ...errors.map((e) => h('li', {}, e)));
}

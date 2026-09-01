/** Small DOM helpers shared by every view. */

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function toast(message, kind = '') {
  const box = $('#toasts');
  const el = h('div', { class: 'toast' + (kind ? ` toast--${kind}` : '') }, message);
  box.append(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, 4200);
}

// Private-use codepoints: they survive HTML escaping and will never collide
// with anything a person or the model actually writes.
const FENCE_OPEN = '\uE000';
const FENCE_CLOSE = '\uE001';

/** A deliberately small Markdown subset: fenced code, inline code, bold, italic. */
export function renderMarkdown(text) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const blocks = [];
  let out = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
    blocks.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return `${FENCE_OPEN}${blocks.length - 1}${FENCE_CLOSE}`;
  });

  out = esc(out)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  out = out
    .split(/\n{2,}/)
    .map((para) => (para.trim() ? `<p>${para.replace(/\n/g, '<br>')}</p>` : ''))
    .join('');

  const restore = new RegExp(`${FENCE_OPEN}(\\d+)${FENCE_CLOSE}`, 'g');
  return out.replace(restore, (_, i) => blocks[Number(i)] ?? '');
}

export function thinkingDots() {
  return h('span', { class: 'thinking' }, h('i'), h('i'), h('i'));
}

/** Auto-grow a textarea up to its CSS max-height. */
export function autoGrow(textarea) {
  const resize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px';
  };
  textarea.addEventListener('input', resize);
  resize();
  return resize;
}

export function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = path;
  return svg;
}

export const ICONS = {
  send: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  speaker: '<path d="M5 9v6h3.5L13 19V5L8.5 9H5Z"/><path d="M16.5 9.5a3.5 3.5 0 0 1 0 5M19 7a7 7 0 0 1 0 10"/>',
  mute: '<path d="M5 9v6h3.5L13 19V5L8.5 9H5Z"/><path d="m17 10 4 4M21 10l-4 4"/>',
  trash: '<path d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6M20 5v6h-6"/>',
  brain: '<path d="M12 5a3 3 0 0 0-6 .8A3 3 0 0 0 5 11a3 3 0 0 0 1.5 5.6A3 3 0 0 0 12 19M12 5a3 3 0 0 1 6 .8A3 3 0 0 1 19 11a3 3 0 0 1-1.5 5.6A3 3 0 0 1 12 19M12 5v14"/>',
};

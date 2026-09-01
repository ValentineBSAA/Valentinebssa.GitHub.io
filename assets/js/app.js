/** Bootstrap, routing, and the Play tab. */

import { store } from './store.js';
import { hasKey, describeError } from './ai.js';
import { renderChat } from './chat.js';
import { renderSettings } from './settings.js';
import { GAMES, findGame } from './games/index.js';
import { h, $, clear, toast, icon, ICONS } from './ui.js';

const view = $('#view');
const nav = $('#nav');
const scrim = $('#scrim');
const titleEl = $('#viewTitle');
const actionsEl = $('#topbarActions');
const threadList = $('#threadList');
const threadPane = $('#threadPane');

let teardown = null;

/* ------------------------------------------------------------------ routes */

const TITLES = { talk: 'Talk', play: 'Play', you: 'You', game: 'Play' };

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, arg] = hash.split('/');
  if (name === 'game' && arg) return { name: 'game', arg };
  return { name: ['talk', 'play', 'you'].includes(name) ? name : 'talk' };
}

function go(name, arg) {
  location.hash = arg ? `#/${name}/${arg}` : `#/${name}`;
}

/** Shared handles every view gets. */
const actions = {
  go,
  refreshThreads,
  refreshAll,
  describe: describeError,
  online: hasKey,
  onScoreChange: () => { if (currentRoute().name === 'play') render(); },
  remount: () => render(),
  append: (el) => actionsEl.append(el),
};

function render() {
  teardown?.();
  teardown = null;
  clear(view);
  clear(actionsEl);

  const route = currentRoute();
  titleEl.textContent = TITLES[route.name];

  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.route === route.name || (route.name === 'game' && tab.dataset.route === 'play');
    tab.setAttribute('aria-selected', String(active));
  });

  threadPane.hidden = route.name !== 'talk';

  switch (route.name) {
    case 'talk': teardown = renderChat(view, actions); break;
    case 'play': teardown = renderArcade(view); break;
    case 'game': teardown = renderGame(view, route.arg); break;
    case 'you': teardown = renderSettings(view, actions); break;
  }

  refreshThreads();
}

function refreshAll() {
  $('#brandName').textContent = store.get().name || 'Companion';
  document.title = store.get().name || 'Companion';
  render();
}

/* ------------------------------------------------------------------ arcade */

function renderArcade(root) {
  const grid = h('div', { class: 'arcade' });

  for (const game of GAMES) {
    grid.append(h('button', { class: 'gamecard', onClick: () => go('game', game.id) },
      h('div', { class: 'gamecard__emoji' }, game.emoji),
      h('div', { class: 'gamecard__name' }, game.name),
      h('div', { class: 'gamecard__tag' }, game.tagline),
      h('div', { class: 'gamecard__score' }, game.scoreLine(store.score(game.id))),
    ));
  }

  root.append(h('div', { class: 'pad' },
    h('div', { class: 'wrap' },
      !hasKey()
        ? h('div', { class: 'card' },
            h('h2', {}, 'Playing offline'),
            h('p', { class: 'hint', style: 'margin-bottom:12px' },
              'Tic-Tac-Toe and Word Guess work with no key at all. The rest are improvised on the spot, so they need one.'),
            h('button', { class: 'btn btn--primary btn--sm', onClick: () => go('you') }, 'Add a key'))
        : null,
      grid,
    ),
  ));

  return () => {};
}

function renderGame(root, id) {
  const game = findGame(id);
  if (!game) { go('play'); return () => {}; }

  titleEl.textContent = game.name;

  const back = h('button', { class: 'iconbtn', title: 'Back to games', 'aria-label': 'Back to games', onClick: () => go('play') }, icon(ICONS.back));
  const restart = h('button', { class: 'iconbtn', title: 'Start over', 'aria-label': 'Start over', onClick: () => render() }, icon(ICONS.refresh));
  actionsEl.append(restart);

  // The back control belongs at the left of the bar, before the title.
  titleEl.before(back);

  const shell = h('div', { class: 'gameview' });
  root.append(shell);

  const cleanup = game.mount(shell, actions);
  return () => { cleanup?.(); back.remove(); };
}

/* ----------------------------------------------------------------- threads */

function refreshThreads() {
  clear(threadList);
  const { activeThread } = store.get();

  for (const thread of store.threadsByRecency()) {
    const open = h('button', { class: 'threadOpen', onClick: () => {
      store.set({ activeThread: thread.id });
      closeNav();
      go('talk');
      render();
    } }, thread.title);

    const del = h('button', {
      class: 'iconbtn',
      title: 'Delete chat',
      'aria-label': `Delete ${thread.title}`,
      onClick: (e) => {
        e.stopPropagation();
        store.deleteThread(thread.id);
        if (currentRoute().name === 'talk') render();
        else refreshThreads();
      },
    }, icon(ICONS.trash));

    threadList.append(h('li', { class: thread.id === activeThread ? 'is-active' : '' }, open, del));
  }
}

/* -------------------------------------------------------------------- nav */

function openNav() { nav.classList.add('is-open'); scrim.hidden = false; }
function closeNav() { nav.classList.remove('is-open'); scrim.hidden = true; }

$('#menuBtn').addEventListener('click', openNav);
scrim.addEventListener('click', closeNav);

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => { closeNav(); go(tab.dataset.route); });
});

$('#newChatBtn').addEventListener('click', () => {
  store.newThread();
  closeNav();
  go('talk');
  render();
});

/* -------------------------------------------------------------------- boot */

window.addEventListener('hashchange', () => { closeNav(); render(); });

$('#brandName').textContent = store.get().name || 'Companion';
document.title = store.get().name || 'Companion';

if (!location.hash) location.hash = '#/talk';
render();

// Register the service worker so the shell keeps working with no connection.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline support is a nicety; the app is fine without it.
    });
  });
}

window.addEventListener('online', () => toast('Back online.', 'good'));
window.addEventListener('offline', () => toast('Offline — Tic-Tac-Toe and Word Guess still work.'));

/**
 * Word Guess — hangman, with the companion choosing the word and dropping a
 * hint when you start running out of lives.
 */

import { askJSON } from '../ai.js';
import { store } from '../store.js';
import { h, clear, toast, thinkingDots } from '../ui.js';

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const LIVES = 7;

const WORD_SCHEMA = {
  type: 'object',
  properties: {
    word: { type: 'string', description: 'A single common English word, 5 to 10 letters, letters only, no proper nouns.' },
    clue: { type: 'string', description: 'A one-sentence clue that points at the word without containing it.' },
    nudge: { type: 'string', description: 'A second, much more obvious hint, held back until they are nearly out of lives.' },
  },
  required: ['word', 'clue', 'nudge'],
  additionalProperties: false,
};

// Used when there is no key, or the model hands back something unusable.
const OFFLINE_WORDS = [
  { word: 'lantern', clue: 'It keeps the dark at arm’s length.', nudge: 'You carry it by a handle and it glows.' },
  { word: 'compass', clue: 'It always knows which way is north.', nudge: 'A needle, four letters around a dial.' },
  { word: 'harvest', clue: 'What autumn is for.', nudge: 'Bringing in the crops.' },
  { word: 'library', clue: 'Quiet, and full of other people’s thoughts.', nudge: 'You borrow books there.' },
  { word: 'volcano', clue: 'A mountain with a temper.', nudge: 'It erupts with lava.' },
  { word: 'penguin', clue: 'Dressed for dinner, built for cold.', nudge: 'A bird that swims but cannot fly.' },
];

export default {
  id: 'wordguess',
  name: 'Word Guess',
  emoji: '🔤',
  tagline: 'It picks a word and gives you a clue. Seven wrong letters and you lose.',

  scoreLine(s) {
    if (!s.played) return 'Not played yet';
    return `${s.won || 0} of ${s.played} solved`;
  },

  mount(root, ctx) {
    let word = '';
    let clue = '';
    let nudge = '';
    let guessed = new Set();
    let wrong = 0;
    let over = false;
    let aborted = false;

    const livesChip = h('span', { class: 'chip lives' }, '');
    const scoreChip = h('span', { class: 'chip' }, '');
    const bar = h('div', { class: 'scorebar' }, livesChip, scoreChip);

    const slots = h('div', { class: 'wordslots' });
    const clueEl = h('p', { style: 'text-align:center;color:var(--text-dim);margin:0 0 18px;min-height:2.6em' });
    const keyboard = h('div', { class: 'keyboard' });
    const footer = h('div', { class: 'row', style: 'justify-content:center;margin-top:20px' });

    root.append(bar, h('div', { class: 'pad' }, h('div', { class: 'wrap' }, slots, clueEl, keyboard, footer)));

    function refreshScore() {
      const s = store.score('wordguess');
      scoreChip.textContent = `${s.won || 0} of ${s.played || 0} solved`;
    }

    function paintLives() {
      const left = LIVES - wrong;
      livesChip.textContent = '♥'.repeat(left) + '·'.repeat(wrong);
      livesChip.className = 'chip lives' + (left <= 2 ? ' chip--bad' : left <= 4 ? ' chip--warn' : '');
    }

    function paintWord(reveal = false) {
      clear(slots);
      for (const ch of word) {
        const known = reveal || guessed.has(ch);
        slots.append(h('span', { class: 'slot' + (known ? ' is-filled' : '') }, known ? ch.toUpperCase() : ' '));
      }
    }

    function paintKeyboard() {
      clear(keyboard);
      for (const row of ROWS) {
        const rowEl = h('div', { class: 'keyrow' });
        for (const ch of row) {
          const used = guessed.has(ch);
          const hit = used && word.includes(ch);
          rowEl.append(h('button', {
            class: 'key' + (hit ? ' is-hit' : used ? ' is-miss' : ''),
            disabled: used || over,
            'aria-label': `Guess ${ch.toUpperCase()}`,
            onClick: () => guess(ch),
          }, ch));
        }
        keyboard.append(rowEl);
      }
    }

    function guess(ch) {
      if (over || guessed.has(ch)) return;
      guessed.add(ch);

      if (!word.includes(ch)) {
        wrong += 1;
        // One real hint, right when it starts to hurt.
        if (wrong === LIVES - 2 && nudge) clueEl.textContent = `${clue}\n\nHint: ${nudge}`;
      }

      paintLives();
      paintWord();
      paintKeyboard();

      if ([...word].every((c) => guessed.has(c))) end(true);
      else if (wrong >= LIVES) end(false);
    }

    function end(won) {
      over = true;
      paintWord(true);
      paintKeyboard();

      const s = store.score('wordguess');
      store.bumpScore('wordguess', { played: (s.played || 0) + 1, won: (s.won || 0) + (won ? 1 : 0) });
      refreshScore();
      ctx.onScoreChange?.();

      clueEl.textContent = won
        ? `Got it — ${word.toUpperCase()}.`
        : `Out of lives. The word was ${word.toUpperCase()}.`;

      clear(footer).append(h('button', { class: 'btn btn--primary', onClick: () => ctx.remount() }, 'Another word'));
    }

    function start({ word: w, clue: c, nudge: n }) {
      word = w.toLowerCase();
      clue = c;
      nudge = n;
      guessed = new Set();
      wrong = 0;
      over = false;
      clueEl.textContent = clue;
      paintLives();
      paintWord();
      paintKeyboard();
    }

    function offlinePick() {
      return OFFLINE_WORDS[Math.floor(Math.random() * OFFLINE_WORDS.length)];
    }

    async function begin() {
      refreshScore();
      if (!ctx.online()) {
        toast('No key yet — playing from the built-in word list.');
        start(offlinePick());
        return;
      }

      clueEl.append(thinkingDots());
      try {
        const res = await askJSON({
          system: 'You are picking a word for a game of hangman. Choose a single common English noun, verb or adjective between 5 and 10 letters, all lowercase letters, no proper nouns, no hyphens, no plurals of proper nouns. Vary your choices.',
          messages: [{ role: 'user', content: 'Pick a word, a clue, and a stronger backup hint.' }],
          schema: WORD_SCHEMA,
        });
        if (aborted) return;

        const cleaned = String(res.word || '').toLowerCase().replace(/[^a-z]/g, '');
        if (cleaned.length < 4 || cleaned.length > 12) {
          start(offlinePick());
        } else {
          start({ word: cleaned, clue: res.clue, nudge: res.nudge });
        }
      } catch (err) {
        if (aborted) return;
        toast(ctx.describe(err), 'bad');
        start(offlinePick());
      }
    }

    function onKeyDown(e) {
      if (over || e.metaKey || e.ctrlKey || e.altKey) return;
      const ch = e.key.toLowerCase();
      if (ch.length === 1 && ch >= 'a' && ch <= 'z') guess(ch);
    }
    window.addEventListener('keydown', onKeyDown);

    begin();

    return () => {
      aborted = true;
      window.removeEventListener('keydown', onKeyDown);
    };
  },
};

/**
 * 20 Questions. The companion thinks of something; you narrow it down.
 *
 * The secret is picked once, up front, and kept in this page's memory — it is
 * never rendered until the round ends. Pinning it down first is what stops the
 * answer from quietly drifting to whatever would be most inconvenient for you.
 */

import { askJSON } from '../ai.js';
import { store } from '../store.js';
import { h, autoGrow, icon, ICONS, thinkingDots } from '../ui.js';

const CATEGORIES = ['an animal', 'an everyday object', 'a food or drink', 'a place', 'a famous person', 'a fictional character'];

const SECRET_SCHEMA = {
  type: 'object',
  properties: {
    secret: { type: 'string', description: 'The specific thing you are thinking of. Two or three words at most.' },
  },
  required: ['secret'],
  additionalProperties: false,
};

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['yes', 'no', 'sometimes', 'correct'],
      description: 'Answer the question truthfully about the secret. Use "correct" only if they named the secret itself.',
    },
    reply: { type: 'string', description: 'One short sentence of colour. Never reveal or strongly hint at the secret.' },
  },
  required: ['verdict', 'reply'],
  additionalProperties: false,
};

const MAX = 20;

export default {
  id: 'twenty',
  name: '20 Questions',
  emoji: '🔮',
  tagline: 'It picks something. You have twenty yes-or-no questions.',

  scoreLine(s) {
    if (!s.played) return 'Not played yet';
    return `${s.won || 0} of ${s.played} solved`;
  },

  mount(root, ctx) {
    let secret = null;
    let asked = 0;
    let over = false;
    let aborted = false;

    const counter = h('span', { class: 'chip' }, `${MAX} left`);
    const catChip = h('span', { class: 'chip' }, 'Picking something…');
    const bar = h('div', { class: 'scorebar' }, counter, catChip);

    const log = h('div', { class: 'chat__log' });
    const input = h('textarea', { rows: '1', placeholder: 'Ask a yes-or-no question…', disabled: true, 'aria-label': 'Your question' });
    const sendBtn = h('button', { class: 'sendbtn', disabled: true, 'aria-label': 'Ask' }, icon(ICONS.send));
    const composer = h('div', { class: 'composer' },
      h('div', { class: 'composer__inner' }, input, sendBtn),
    );

    root.append(bar, h('div', { class: 'chat' }, log, composer));

    const grow = autoGrow(input);

    function say(who, text, cls = '') {
      const el = h('div', { class: `msg msg--${who === 'me' ? 'me' : 'ai'} ${cls}` },
        h('div', { class: 'msg__avatar' }, who === 'me' ? 'Y' : '🔮'),
        h('div', { class: 'msg__body' },
          h('div', { class: 'msg__who' }, who === 'me' ? 'You' : (store.get().name || 'Companion')),
          h('div', { class: 'msg__text' }, text),
        ),
      );
      log.append(el);
      log.scrollTop = log.scrollHeight;
      return el;
    }

    function pending() {
      const el = say('ai', '');
      el.querySelector('.msg__text').append(thinkingDots());
      return el;
    }

    async function begin() {
      const pick = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
      const waiting = pending();
      try {
        const res = await askJSON({
          system: 'You are hosting a game of 20 Questions. Pick something concrete and fair — well known enough that a reasonable person could get there in twenty yes-or-no questions, but not the most obvious choice in its category.',
          messages: [{ role: 'user', content: `Think of ${pick}. Do not tell me what it is.` }],
          schema: SECRET_SCHEMA,
        });
        if (aborted) return;
        secret = res.secret;
        waiting.remove();
        catChip.textContent = `It's ${pick}`;
        say('ai', `Got one — it's ${pick}. Ask away; you have ${MAX} questions.`);
        input.disabled = false;
        sendBtn.disabled = false;
        if (window.innerWidth >= 860) input.focus();
      } catch (err) {
        if (aborted) return;
        waiting.remove();
        say('ai', ctx.describe(err), 'msg--err');
      }
    }

    async function ask(text) {
      const question = text.trim();
      if (!question || over || !secret || input.disabled) return;

      say('me', question);
      input.value = '';
      grow();
      input.disabled = true;
      sendBtn.disabled = true;

      const waiting = pending();
      try {
        const res = await askJSON({
          system: `You are playing 20 Questions. The secret you are thinking of is "${secret}". Answer the player's question about it truthfully and consistently. Never reveal the secret unless they name it exactly, in which case the verdict is "correct". Do not drop heavy hints.`,
          messages: [{ role: 'user', content: question }],
          schema: ANSWER_SCHEMA,
        });
        if (aborted) return;

        waiting.remove();
        asked += 1;
        counter.textContent = `${Math.max(0, MAX - asked)} left`;

        const label = { yes: 'Yes.', no: 'No.', sometimes: 'Sort of.', correct: 'That is it!' }[res.verdict];
        say('ai', `${label} ${res.reply || ''}`.trim());

        if (res.verdict === 'correct') return end(true);
        if (asked >= MAX) return end(false);

        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
      } catch (err) {
        if (aborted) return;
        waiting.remove();
        say('ai', ctx.describe(err), 'msg--err');
        input.disabled = false;
        sendBtn.disabled = false;
      }
    }

    function end(won) {
      over = true;
      input.disabled = true;
      sendBtn.disabled = true;

      const s = store.score('twenty');
      store.bumpScore('twenty', {
        played: (s.played || 0) + 1,
        won: (s.won || 0) + (won ? 1 : 0),
      });
      ctx.onScoreChange?.();

      counter.className = won ? 'chip chip--good' : 'chip chip--bad';
      counter.textContent = won ? `Solved in ${asked}` : 'Out of questions';
      say('ai', won
        ? `You got it in ${asked} question${asked === 1 ? '' : 's'}. It was ${secret}.`
        : `Out of questions. It was ${secret}.`);

      log.append(h('div', { class: 'row', style: 'justify-content:center;padding:12px 0' },
        h('button', { class: 'btn btn--primary', onClick: () => ctx.remount() }, 'New round'),
      ));
      log.scrollTop = log.scrollHeight;
    }

    sendBtn.addEventListener('click', () => ask(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) {
        e.preventDefault();
        ask(input.value);
      }
    });

    if (ctx.online()) begin();
    else {
      catChip.textContent = 'Needs an API key';
      say('ai', 'This one needs a key — add one under “You”. Tic-Tac-Toe works without.');
    }

    return () => { aborted = true; };
  },
};

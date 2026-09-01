/**
 * Trivia Duel — the companion asks, you answer, both of you keep score.
 * It picks a topic you haven't just had, and explains every answer.
 */

import { askJSON } from '../ai.js';
import { store } from '../store.js';
import { h, clear, thinkingDots } from '../ui.js';

const ROUNDS = 8;

const TOPICS = [
  'history', 'geography', 'science', 'music', 'film and television',
  'sport', 'food and drink', 'literature', 'art', 'the natural world',
  'technology', 'language and words',
];

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    options: {
      type: 'array',
      items: { type: 'string' },
      minItems: 4,
      maxItems: 4,
      description: 'Four answers. Exactly one is correct; the wrong three should be plausible, not silly.',
    },
    answer: { type: 'integer', minimum: 0, maximum: 3, description: 'Index of the correct option.' },
    because: { type: 'string', description: 'One sentence on why that is the answer.' },
  },
  required: ['question', 'options', 'answer', 'because'],
  additionalProperties: false,
};

export default {
  id: 'trivia',
  name: 'Trivia Duel',
  emoji: '🎯',
  tagline: `${ROUNDS} questions, fresh every time, across whatever it feels like asking.`,

  scoreLine(s) {
    if (!s.best) return 'Not played yet';
    return `Best: ${s.best} / ${ROUNDS}`;
  },

  mount(root, ctx) {
    let round = 0;
    let correct = 0;
    let asked = [];
    let aborted = false;

    const progress = h('span', { class: 'chip' }, `Question 1 of ${ROUNDS}`);
    const scoreChip = h('span', { class: 'chip' }, '0 right');
    const bestChip = h('span', { class: 'chip' }, '');
    const bar = h('div', { class: 'scorebar' }, progress, scoreChip, bestChip);

    const topicEl = h('div', { class: 'gamecard__tag', style: 'text-align:center;text-transform:uppercase;letter-spacing:.08em;font-size:11.5px;margin-bottom:8px' });
    const questionEl = h('h2', { style: 'text-align:center;font-size:19px;line-height:1.35;margin:0 0 18px' });
    const choices = h('div', { class: 'choices' });
    const feedback = h('p', { style: 'text-align:center;color:var(--text-dim);min-height:3em;margin:14px 0 0' });
    const footer = h('div', { class: 'row', style: 'justify-content:center;margin-top:8px' });

    root.append(bar, h('div', { class: 'pad' }, h('div', { class: 'wrap' }, topicEl, questionEl, choices, feedback, footer)));

    function refreshBest() {
      const s = store.score('trivia');
      bestChip.textContent = s.best ? `Best ${s.best}/${ROUNDS}` : 'First run';
    }

    async function nextQuestion() {
      round += 1;
      progress.textContent = `Question ${round} of ${ROUNDS}`;
      scoreChip.textContent = `${correct} right`;
      clear(choices);
      clear(footer);
      feedback.textContent = '';
      topicEl.textContent = '';
      clear(questionEl).append(thinkingDots());

      const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];

      try {
        const q = await askJSON({
          system: 'You are the quizmaster in a friendly trivia duel. Write one multiple-choice question of moderate difficulty — a well-read person should get it about half the time. Never repeat a question you have already asked in this session.',
          messages: [{
            role: 'user',
            content: asked.length
              ? `Ask a question about ${topic}. Do not repeat any of these: ${asked.join(' | ')}`
              : `Ask a question about ${topic}.`,
          }],
          schema: QUESTION_SCHEMA,
        });
        if (aborted) return;

        if (!Array.isArray(q.options) || q.options.length !== 4 || q.answer < 0 || q.answer > 3) {
          throw new Error('That question came back malformed — skipping it.');
        }

        asked.push(q.question);
        topicEl.textContent = topic;
        questionEl.textContent = q.question;
        renderOptions(q);
      } catch (err) {
        if (aborted) return;
        questionEl.textContent = 'That question did not come through.';
        feedback.textContent = ctx.describe(err);
        clear(footer).append(
          h('button', { class: 'btn', onClick: () => { round -= 1; nextQuestion(); } }, 'Try again'),
          h('button', { class: 'btn btn--ghost', onClick: () => ctx.remount() }, 'Restart'),
        );
      }
    }

    function renderOptions(q) {
      clear(choices);
      q.options.forEach((text, i) => {
        choices.append(h('button', {
          class: 'choice',
          onClick: () => answer(q, i),
        }, `${'ABCD'[i]}.  ${text}`));
      });
    }

    function answer(q, picked) {
      const buttons = [...choices.children];
      buttons.forEach((b, i) => {
        b.disabled = true;
        if (i === q.answer) b.classList.add('is-right');
        else if (i === picked) b.classList.add('is-wrong');
      });

      const right = picked === q.answer;
      if (right) correct += 1;
      scoreChip.textContent = `${correct} right`;
      scoreChip.className = 'chip' + (right ? ' chip--good' : '');

      feedback.textContent = `${right ? 'Correct. ' : `Not quite — it's ${'ABCD'[q.answer]}. `}${q.because}`;

      clear(footer).append(
        round >= ROUNDS
          ? h('button', { class: 'btn btn--primary', onClick: finish }, 'See how you did')
          : h('button', { class: 'btn btn--primary', onClick: nextQuestion }, 'Next question'),
      );
    }

    function finish() {
      const s = store.score('trivia');
      const best = Math.max(s.best || 0, correct);
      store.bumpScore('trivia', { best, played: (s.played || 0) + 1, lastScore: correct });
      refreshBest();
      ctx.onScoreChange?.();

      const verdict =
        correct === ROUNDS ? 'A clean sweep. Nothing left to teach you.' :
        correct >= ROUNDS - 2 ? 'Very strong round.' :
        correct >= ROUNDS / 2 ? 'Solidly over the line.' :
        'The questions won this one. Rematch?';

      clear(choices);
      topicEl.textContent = '';
      questionEl.textContent = `${correct} out of ${ROUNDS}`;
      feedback.textContent = `${verdict}${best === correct && (s.best || 0) < correct ? ' That is a new best.' : ''}`;
      clear(footer).append(h('button', { class: 'btn btn--primary', onClick: () => ctx.remount() }, 'Play again'));
      progress.textContent = 'Round over';
    }

    refreshBest();

    if (ctx.online()) {
      nextQuestion();
    } else {
      questionEl.textContent = 'Trivia needs an API key';
      feedback.textContent = 'Add one under “You” and the questions will start coming. Tic-Tac-Toe and Word Guess work without one.';
      clear(footer).append(h('button', { class: 'btn btn--primary', onClick: () => ctx.go('you') }, 'Open settings'));
    }

    return () => { aborted = true; };
  },
};

/**
 * Tic-Tac-Toe. You are X, the companion is O.
 *
 * The move comes from the model, but a local minimax runs as a backstop so
 * the game still plays perfectly with no key and no signal — this is the one
 * game that works entirely offline.
 */

import { askJSON } from '../ai.js';
import { store } from '../store.js';
import { h, clear, toast } from '../ui.js';

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function winner(b) {
  for (const line of LINES) {
    const [a, c, d] = line;
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return { player: b[a], line };
  }
  return b.every(Boolean) ? { player: 'draw', line: [] } : null;
}

/** Perfect play, used when the model is unavailable or returns nonsense. */
function bestMove(board, me = 'O') {
  const them = me === 'O' ? 'X' : 'O';

  function score(b, depth, turn) {
    const w = winner(b);
    if (w) {
      if (w.player === me) return 10 - depth;
      if (w.player === them) return depth - 10;
      return 0;
    }
    const scores = [];
    for (let i = 0; i < 9; i++) {
      if (b[i]) continue;
      b[i] = turn;
      scores.push(score(b, depth + 1, turn === me ? them : me));
      b[i] = '';
    }
    return turn === me ? Math.max(...scores) : Math.min(...scores);
  }

  let best = -Infinity;
  let move = board.findIndex((c) => !c);
  for (let i = 0; i < 9; i++) {
    if (board[i]) continue;
    board[i] = me;
    const s = score(board, 0, them);
    board[i] = '';
    if (s > best) { best = s; move = i; }
  }
  return move;
}

const MOVE_SCHEMA = {
  type: 'object',
  properties: {
    cell: { type: 'integer', minimum: 0, maximum: 8, description: 'Index 0-8 of the square to play, reading left-to-right, top-to-bottom.' },
    quip: { type: 'string', description: 'One short playful line about the move. Under 12 words.' },
  },
  required: ['cell', 'quip'],
  additionalProperties: false,
};

export default {
  id: 'tictactoe',
  name: 'Tic-Tac-Toe',
  emoji: '⭕',
  tagline: 'You are X. Good luck — it plays well.',
  offline: true,

  scoreLine(s) {
    if (!s.played) return 'Not played yet';
    return `${s.won || 0}W · ${s.lost || 0}L · ${s.drew || 0}D`;
  },

  mount(root, ctx) {
    let board = Array(9).fill('');
    let locked = false;
    let aborted = false;

    const status = h('div', { class: 'chip' }, 'Your move.');
    const quip = h('p', { class: 'gamecard__tag', style: 'text-align:center;min-height:1.4em;margin:4px 0 0' }, '');
    const grid = h('div', { class: 'board' });
    const again = h('button', { class: 'btn btn--primary', hidden: true, onClick: reset }, 'Play again');

    const bar = h('div', { class: 'scorebar' }, status, scoreChip());
    const body = h('div', { class: 'pad' },
      h('div', { class: 'wrap' },
        grid,
        quip,
        h('div', { class: 'row', style: 'justify-content:center;margin-top:16px' }, again),
      ),
    );

    root.append(bar, body);

    function scoreChip() {
      const s = store.score('tictactoe');
      return h('span', { class: 'chip' }, `You ${s.won || 0} · Me ${s.lost || 0} · Draw ${s.drew || 0}`);
    }

    function refreshBar() {
      clear(bar).append(status, scoreChip());
    }

    function paint(winLine = []) {
      clear(grid);
      board.forEach((mark, i) => {
        const cell = h('button', {
          class: 'cell' + (winLine.includes(i) ? ' is-win' : ''),
          dataset: { p: mark },
          disabled: Boolean(mark) || locked,
          'aria-label': `Square ${i + 1}${mark ? `, ${mark}` : ', empty'}`,
          onClick: () => play(i),
        }, mark);
        grid.append(cell);
      });
    }

    function finish(result) {
      locked = true;
      const s = store.score('tictactoe');
      const patch = { played: (s.played || 0) + 1 };
      if (result.player === 'X') { patch.won = (s.won || 0) + 1; status.textContent = 'You win.'; status.className = 'chip chip--good'; }
      else if (result.player === 'O') { patch.lost = (s.lost || 0) + 1; status.textContent = 'I win.'; status.className = 'chip chip--bad'; }
      else { patch.drew = (s.drew || 0) + 1; status.textContent = 'A draw.'; status.className = 'chip chip--warn'; }
      store.bumpScore('tictactoe', patch);
      refreshBar();
      paint(result.line);
      again.hidden = false;
      ctx.onScoreChange?.();
    }

    async function play(i) {
      if (locked || board[i]) return;
      board[i] = 'X';
      paint();

      let result = winner(board);
      if (result) return finish(result);

      locked = true;
      status.textContent = 'Thinking…';
      status.className = 'chip';
      refreshBar();

      const cell = await companionMove();
      if (aborted) return;

      board[cell] = 'O';
      locked = false;
      paint();

      result = winner(board);
      if (result) return finish(result);

      status.textContent = 'Your move.';
      status.className = 'chip';
      refreshBar();
    }

    async function companionMove() {
      const fallback = bestMove([...board]);
      if (!ctx.online()) { quip.textContent = ''; return fallback; }

      try {
        const move = await askJSON({
          system: 'You are playing tic-tac-toe as O against a human playing X. Play to win. Block their winning line if they have one; take your own win if you have one. Reply with the move only.',
          messages: [{
            role: 'user',
            content: `Board (index: mark, "." is empty):\n${describe(board)}\n\nEmpty squares: ${board.map((c, i) => (c ? null : i)).filter((v) => v !== null).join(', ')}\n\nPlay one square as O.`,
          }],
          schema: MOVE_SCHEMA,
        });

        if (Number.isInteger(move.cell) && !board[move.cell]) {
          quip.textContent = move.quip || '';
          return move.cell;
        }
        // Model picked an occupied square — take the sound move instead.
        quip.textContent = '';
        return fallback;
      } catch (err) {
        quip.textContent = '';
        toast(ctx.describe(err), 'bad');
        return fallback;
      }
    }

    function describe(b) {
      return [0, 3, 6].map((r) => b.slice(r, r + 3).map((c, i) => `${r + i}:${c || '.'}`).join('  ')).join('\n');
    }

    function reset() {
      board = Array(9).fill('');
      locked = false;
      again.hidden = true;
      quip.textContent = '';
      status.textContent = 'Your move.';
      status.className = 'chip';
      refreshBar();
      paint();
    }

    paint();

    return () => { aborted = true; };
  },
};

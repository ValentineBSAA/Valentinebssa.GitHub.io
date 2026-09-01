import tictactoe from './tictactoe.js';
import twenty from './twenty.js';
import wordguess from './wordguess.js';
import trivia from './trivia.js';
import story from './story.js';

export const GAMES = [twenty, trivia, wordguess, tictactoe, story];

export function findGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}

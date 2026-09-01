/**
 * Story Quest — a short choose-your-own adventure the companion improvises
 * around you. Roughly a dozen scenes, then it lands the ending.
 */

import { askJSON } from '../ai.js';
import { store } from '../store.js';
import { h, clear, thinkingDots } from '../ui.js';

const MAX_SCENES = 12;

const SETTINGS = [
  'a lighthouse on a coast where the sea has started behaving strangely',
  'a night train that has one more carriage than it did at the last station',
  'a city built inside the ribcage of something very large and very dead',
  'a research station on a moon where the sun has not risen on schedule',
  'a village at the foot of a mountain nobody is willing to name',
  'a library that has begun lending out books it was never given',
];

const SCENE_SCHEMA = {
  type: 'object',
  properties: {
    scene: { type: 'string', description: 'Two or three paragraphs of second-person narration. Vivid, concrete, and it must react to the choice just made.' },
    choices: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 3,
      description: 'Two or three distinct things the player could do next. Short imperative phrases. Empty when the story has ended.',
    },
    ended: { type: 'boolean', description: 'True only when the story has reached a real ending.' },
    outcome: { type: 'string', enum: ['ongoing', 'good', 'bitter', 'strange'], description: 'How it ended, or "ongoing".' },
  },
  required: ['scene', 'choices', 'ended', 'outcome'],
  additionalProperties: false,
};

export default {
  id: 'story',
  name: 'Story Quest',
  emoji: '🗺️',
  tagline: 'It improvises an adventure. You decide what happens next.',

  scoreLine(s) {
    if (!s.played) return 'Not played yet';
    return `${s.played} finished`;
  },

  mount(root, ctx) {
    let history = [];
    let scenes = 0;
    let aborted = false;
    let setting = SETTINGS[Math.floor(Math.random() * SETTINGS.length)];

    const progress = h('span', { class: 'chip' }, 'Scene 1');
    const bar = h('div', { class: 'scorebar' }, progress);

    const prose = h('div', { class: 'msg__text', style: 'font-size:15.5px;line-height:1.65' });
    const choices = h('div', { class: 'choices' });
    const body = h('div', { class: 'pad' }, h('div', { class: 'wrap' }, prose, choices));

    root.append(bar, body);

    function system() {
      return [
        `You are running a short interactive story for one player, set in ${setting}.`,
        'Write in second person, present tense. Be concrete and sensory; avoid purple prose and avoid explaining the world in exposition dumps.',
        'Every scene must respond directly to the choice the player just made — their decisions have to actually matter.',
        `Pace it to end within about ${MAX_SCENES} scenes. Build tension, then land a real ending rather than trailing off.`,
        'Endings can be good, bitter, or strange, but they should feel earned.',
      ].join(' ');
    }

    async function advance(choiceText) {
      scenes += 1;
      progress.textContent = `Scene ${scenes}`;
      clear(choices);
      clear(prose).append(thinkingDots());

      const nearingEnd = scenes >= MAX_SCENES - 2;
      const instruction = choiceText
        ? `The player chose: "${choiceText}".${nearingEnd ? ' Begin closing the story — bring it to an ending within the next scene or two.' : ''}`
        : 'Open the story. Set the scene and give the player their first real decision.';

      history.push({ role: 'user', content: instruction });

      try {
        const res = await askJSON({
          system: system(),
          messages: history,
          schema: SCENE_SCHEMA,
          thoughtful: true,
        });
        if (aborted) return;

        history.push({ role: 'assistant', content: JSON.stringify(res) });

        clear(prose);
        for (const para of String(res.scene).split(/\n{2,}/)) {
          if (para.trim()) prose.append(h('p', {}, para.trim()));
        }
        body.scrollTop = 0;

        const done = res.ended || scenes >= MAX_SCENES || !res.choices?.length;
        if (done) return end(res.outcome);

        for (const choice of res.choices) {
          choices.append(h('button', { class: 'choice', onClick: () => advance(choice) }, choice));
        }
      } catch (err) {
        if (aborted) return;
        clear(prose).append(h('p', { class: 'msg--err' }, ctx.describe(err)));
        // Drop the turn that failed so a retry doesn't stack up duplicates.
        history.pop();
        clear(choices).append(
          h('button', { class: 'choice', onClick: () => { scenes -= 1; advance(choiceText); } }, 'Try that again'),
        );
      }
    }

    function end(outcome) {
      const s = store.score('story');
      store.bumpScore('story', { played: (s.played || 0) + 1, lastOutcome: outcome });
      ctx.onScoreChange?.();

      progress.textContent = { good: 'A good ending', bitter: 'A bitter ending', strange: 'A strange ending' }[outcome] || 'The end';
      progress.className = 'chip' + (outcome === 'good' ? ' chip--good' : outcome === 'bitter' ? ' chip--bad' : ' chip--warn');

      clear(choices).append(
        h('button', { class: 'btn btn--primary', onClick: () => ctx.remount() }, 'Start a new story'),
      );
    }

    if (ctx.online()) {
      advance(null);
    } else {
      clear(prose).append(
        h('p', {}, 'Story Quest is improvised on the spot, so it needs an API key.'),
        h('p', {}, 'Add one under “You” and the first scene will be waiting.'),
      );
      clear(choices).append(h('button', { class: 'btn btn--primary', onClick: () => ctx.go('you') }, 'Open settings'));
    }

    return () => { aborted = true; };
  },
};

/**
 * Voice mode: the character, full screen, and nothing to type.
 *
 * Shares the active chat thread, so anything said here shows up in Talk and
 * anything typed there is remembered here.
 */

import { store } from './store.js';
import { streamReply, describeError, hasKey } from './ai.js';
import * as voice from './voice.js';
import * as tts from './tts.js';
import { hasAvatar, moodOf } from './avatar.js';
import { h, clear, toast, icon, ICONS } from './ui.js';

function systemPrompt() {
  const { name, persona } = store.get();
  const base = [
    `You are ${name || 'Companion'}, a personal AI companion, speaking out loud to someone through a microphone and speakers.`,
    'This is a spoken conversation, so keep it short: one to three sentences unless they ask for more. No lists, no markdown, no code — it all has to work read aloud.',
    'Be warm and direct, and ask a question back when it keeps things going naturally.',
  ].join(' ');
  return persona.trim() ? `${base}\n\nThe person has asked you to be: ${persona.trim()}` : base;
}

export function renderVoiceMode(view, actions) {
  const thread = store.activeThreadOrNew();

  const stage = h('div', { class: 'stage' });
  const fallback = h('div', { class: 'stage__fallback' });
  stage.append(fallback);

  const caption = h('div', { class: 'vm__caption' });
  const status = h('div', { class: 'vm__status' }, 'Tap to talk');

  const orb = h('button', {
    class: 'vm__orb',
    'aria-label': 'Start talking',
  }, icon(ICONS.mic));

  const handsFreeBtn = h('button', {
    class: 'iconbtn',
    title: 'Hands-free — keeps the mic open between replies',
    'aria-label': 'Hands-free',
    'aria-pressed': String(store.get().handsFree),
  }, icon(ICONS.refresh));

  view.append(h('div', { class: 'vm' },
    stage,
    h('div', { class: 'vm__hud' },
      caption,
      status,
      h('div', { class: 'vm__controls' }, orb),
    ),
  ));

  actions.append(handsFreeBtn);

  /* ---------------------------------------------------------------- state */

  let avatar = null;
  let busy = false;
  let controller = null;
  let disposed = false;

  handsFreeBtn.addEventListener('click', () => {
    const next = !store.get().handsFree;
    store.set({ handsFree: next });
    handsFreeBtn.setAttribute('aria-pressed', String(next));
    toast(next ? 'Hands-free on — she will keep listening.' : 'Hands-free off.');
    if (next && !busy && !voice.isListening() && !tts.isSpeaking()) startListening();
  });

  /* --------------------------------------------------------------- avatar */

  async function bringUpAvatar() {
    if (!hasAvatar()) {
      fallback.append(
        h('div', { class: 'empty' },
          h('div', { class: 'empty__emoji' }, '🎭'),
          h('h2', {}, 'No character yet'),
          h('p', {}, 'Voice mode works without one — but she is much better company with a face. Add a .vrm model under “You”.'),
          h('button', { class: 'btn btn--primary', onClick: () => actions.go('you') }, 'Add a character'),
        ),
      );
      return;
    }

    fallback.append(h('div', { class: 'stage__loading' }, 'Waking her up…'));
    try {
      const { mountAvatar } = await import('./avatar.js');
      if (disposed) return;
      avatar = await mountAvatar(stage, {
        onProgress: (msg) => { const el = fallback.firstChild; if (el) el.textContent = msg; },
      });
      if (disposed) { avatar.dispose(); return; }
      clear(fallback);
    } catch (err) {
      clear(fallback).append(
        h('div', { class: 'empty' },
          h('div', { class: 'empty__emoji' }, '⚠️'),
          h('h2', {}, 'Could not load the character'),
          h('p', {}, err.message),
          h('button', { class: 'btn', onClick: () => actions.go('you') }, 'Open settings'),
        ),
      );
    }
  }

  /* ------------------------------------------------------------ listening */

  function setStatus(text, cls = '') {
    status.textContent = text;
    status.className = 'vm__status' + (cls ? ` vm__status--${cls}` : '');
  }

  function startListening() {
    if (busy || disposed || !voice.canListen) return;
    tts.shutUp();

    orb.classList.add('is-listening');
    setStatus('Listening…', 'live');
    caption.textContent = '';

    const ok = voice.listen({
      onInterim: (t) => { caption.textContent = t; },
      onFinal: (t) => { caption.textContent = t; ask(t); },
      onEnd: () => {
        orb.classList.remove('is-listening');
        if (!busy) setStatus('Tap to talk');
      },
      onError: (e) => {
        orb.classList.remove('is-listening');
        setStatus('Tap to talk');
        toast(e === 'not-allowed'
          ? 'Microphone access was blocked. Allow it in your browser settings.'
          : `Microphone problem: ${e}`, 'bad');
        if (store.get().handsFree) {
          store.set({ handsFree: false });
          handsFreeBtn.setAttribute('aria-pressed', 'false');
        }
      },
    });

    if (!ok) {
      orb.classList.remove('is-listening');
      setStatus('Tap to talk');
      toast('Could not start the microphone.', 'bad');
    }
  }

  /* --------------------------------------------------------------- asking */

  async function ask(text) {
    const message = text.trim();
    if (!message || busy) return;

    busy = true;
    orb.classList.remove('is-listening');
    orb.classList.add('is-busy');
    setStatus('Thinking…');

    thread.messages.push({ role: 'user', content: message });
    if (thread.title === 'New chat') {
      thread.title = message.length > 42 ? message.slice(0, 42).trim() + '…' : message;
    }
    store.saveThread(thread);
    actions.refreshThreads();

    controller = new AbortController();
    let full = '';

    try {
      full = await streamReply({
        system: systemPrompt(),
        messages: thread.messages.map(({ role, content }) => ({ role, content })),
        signal: controller.signal,
        onText: (_chunk, sofar) => { caption.textContent = sofar; },
      });

      thread.messages.push({ role: 'assistant', content: full });
      store.saveThread(thread);

      avatar?.setMood(moodOf(full));
      setStatus('Speaking…', 'live');
      orb.classList.remove('is-busy');
      orb.classList.add('is-speaking');

      await new Promise((resolve) => {
        tts.speak(full, { onDone: resolve });
      });
    } catch (err) {
      const aborted = err?.name === 'AbortError' || controller?.signal.aborted;
      if (!aborted) {
        // Roll the turn back so a retry does not stack a dangling user message.
        if (!full) thread.messages.pop();
        caption.textContent = describeError(err);
        toast(describeError(err), 'bad');
      }
      store.saveThread(thread);
    } finally {
      busy = false;
      controller = null;
      avatar?.setMood('neutral');
      orb.classList.remove('is-busy', 'is-speaking');
      setStatus('Tap to talk');

      if (!disposed && store.get().handsFree) startListening();
    }
  }

  /* ----------------------------------------------------------------- wire */

  orb.addEventListener('click', async () => {
    // Must happen inside the click for autoplay policy to let audio through.
    await tts.unlockAudio();

    if (busy) { controller?.abort(); tts.shutUp(); return; }
    if (voice.isListening()) { voice.stopListening(); return; }
    if (tts.isSpeaking()) { tts.shutUp(); setStatus('Tap to talk'); return; }
    startListening();
  });

  if (!voice.canListen) {
    orb.disabled = true;
    setStatus('This browser cannot hear you — try Chrome, Edge or Safari.');
  } else if (!hasKey()) {
    orb.disabled = true;
    setStatus('Add an API key under “You” first.');
  }

  bringUpAvatar();

  return () => {
    disposed = true;
    controller?.abort();
    voice.stopListening();
    tts.shutUp();
    avatar?.dispose();
  };
}

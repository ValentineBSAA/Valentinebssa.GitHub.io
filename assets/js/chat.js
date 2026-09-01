/** The Talk view: a streaming conversation, optionally hands-free. */

import { store } from './store.js';
import { streamReply, describeError, hasKey } from './ai.js';
import * as voice from './voice.js';
import { h, clear, toast, renderMarkdown, autoGrow, icon, ICONS, thinkingDots } from './ui.js';

function systemPrompt() {
  const { name, persona } = store.get();
  const base = [
    `You are ${name || 'Companion'}, a personal AI companion. The person you are talking to reaches you from their phone, their laptop, wherever they are.`,
    'Talk like a friend who happens to know a lot: warm, direct, curious. Skip the corporate hedging and the bulleted lists unless they actually help.',
    'Keep replies conversational in length — a few sentences is usually right. Go long only when the question genuinely needs it.',
    'Your replies may be read aloud by a speech synthesiser, so prefer plain prose over heavy formatting.',
    'If they seem like they want to play something, mention that the Play tab has 20 Questions, Tic-Tac-Toe, Word Guess, Trivia Duel and Story Quest.',
  ].join(' ');
  return persona.trim() ? `${base}\n\nThe person has asked you to be: ${persona.trim()}` : base;
}

export function renderChat(view, actions) {
  const thread = store.activeThreadOrNew();

  const log = h('div', { class: 'chat__log', id: 'chatLog' });
  const interim = h('div', { class: 'interim' });

  const input = h('textarea', {
    rows: '1',
    placeholder: hasKey() ? 'Say something…' : 'Add an API key under “You” first…',
    'aria-label': 'Message',
  });

  const micBtn = h('button', { class: 'iconbtn', title: 'Hold a conversation out loud', 'aria-label': 'Voice input' }, icon(ICONS.mic));
  const sendBtn = h('button', { class: 'sendbtn', 'aria-label': 'Send' }, icon(ICONS.send));

  const composer = h('div', { class: 'composer' },
    interim,
    h('div', { class: 'composer__inner' },
      input,
      voice.canListen ? micBtn : null,
      sendBtn,
    ),
  );

  view.append(h('div', { class: 'chat' }, log, composer));

  /* ---------------------------------------------------------- top bar bits */

  const { speak: speakOn, handsFree } = store.get();

  const speakBtn = h('button', {
    class: 'iconbtn',
    title: 'Read replies aloud',
    'aria-label': 'Read replies aloud',
    'aria-pressed': String(speakOn),
  }, icon(speakOn ? ICONS.speaker : ICONS.mute));

  speakBtn.addEventListener('click', () => {
    const next = !store.get().speak;
    store.set({ speak: next });
    speakBtn.setAttribute('aria-pressed', String(next));
    clear(speakBtn).append(icon(next ? ICONS.speaker : ICONS.mute));
    if (!next) voice.shutUp();
  });

  const thoughtfulBtn = h('button', {
    class: 'iconbtn',
    title: 'Thoughtful mode — slower, more considered replies',
    'aria-label': 'Thoughtful mode',
    'aria-pressed': 'false',
  }, icon(ICONS.brain));

  let thoughtful = false;
  thoughtfulBtn.addEventListener('click', () => {
    thoughtful = !thoughtful;
    thoughtfulBtn.setAttribute('aria-pressed', String(thoughtful));
    toast(thoughtful ? 'Thoughtful mode on — replies will take longer.' : 'Back to quick replies.');
  });

  if (voice.canSpeak) actions.append(speakBtn);
  actions.append(thoughtfulBtn);

  /* ------------------------------------------------------------- rendering */

  function bubble(role, content, { error = false } = {}) {
    const { name } = store.get();
    const isAI = role === 'assistant';
    const text = h('div', { class: 'msg__text' });
    if (content) text.innerHTML = renderMarkdown(content);

    const el = h('div', { class: `msg msg--${isAI ? 'ai' : 'me'}${error ? ' msg--err' : ''}` },
      h('div', { class: 'msg__avatar' }, isAI ? (name || 'C')[0].toUpperCase() : 'You'[0]),
      h('div', { class: 'msg__body' },
        h('div', { class: 'msg__who' }, isAI ? (name || 'Companion') : 'You'),
        text,
      ),
    );
    log.append(el);
    return text;
  }

  function atBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  }

  function toBottom(force = false) {
    if (force || atBottom()) log.scrollTop = log.scrollHeight;
  }

  function paint() {
    clear(log);
    if (!thread.messages.length) {
      log.append(welcome());
    } else {
      for (const m of thread.messages) bubble(m.role, m.content);
    }
    requestAnimationFrame(() => toBottom(true));
  }

  function welcome() {
    const { name } = store.get();
    return h('div', { class: 'empty' },
      h('div', { class: 'empty__emoji' }, '👋'),
      h('h2', {}, hasKey() ? `Hey — I'm ${name || 'Companion'}.` : 'One thing first'),
      h('p', {}, hasKey()
        ? 'Ask me anything, or head to Play if you want a game instead.'
        : 'Add your Anthropic API key under “You” and I can start talking.'),
      !hasKey() ? h('button', { class: 'btn btn--primary', onClick: () => actions.go('you') }, 'Open settings') : null,
    );
  }

  /* --------------------------------------------------------------- sending */

  let busy = false;
  let controller = null;

  function setBusy(on) {
    busy = on;
    clear(sendBtn).append(icon(on ? ICONS.stop : ICONS.send));
    sendBtn.setAttribute('aria-label', on ? 'Stop' : 'Send');
    input.disabled = false;
  }

  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;

    voice.shutUp();
    if (!thread.messages.length) clear(log);

    thread.messages.push({ role: 'user', content: message });
    const mine = bubble('user', message).closest('.msg');
    input.value = '';
    grow();
    toBottom(true);

    const prevTitle = thread.title;
    if (thread.title === 'New chat') {
      thread.title = message.length > 42 ? message.slice(0, 42).trim() + '…' : message;
    }
    store.saveThread(thread);
    actions.refreshThreads();

    const target = bubble('assistant', '');
    target.append(thinkingDots());
    toBottom(true);

    setBusy(true);
    controller = new AbortController();

    let full = '';
    try {
      full = await streamReply({
        system: systemPrompt(),
        messages: thread.messages.map(({ role, content }) => ({ role, content })),
        thoughtful,
        signal: controller.signal,
        onText: (_chunk, sofar) => {
          const stick = atBottom();
          target.innerHTML = renderMarkdown(sofar);
          target.append(h('span', { class: 'cursor' }));
          if (stick) toBottom(true);
        },
      });

      target.innerHTML = renderMarkdown(full);
      thread.messages.push({ role: 'assistant', content: full });
      store.saveThread(thread);
      toBottom();

      if (store.get().speak) {
        voice.speak(full, { onDone: () => { if (store.get().handsFree) startListening(); } });
      } else if (store.get().handsFree) {
        startListening();
      }
    } catch (err) {
      const wasAbort = err?.name === 'AbortError' || controller.signal.aborted;
      if (wasAbort && full) {
        // Keep what did arrive — a stopped reply is still worth having.
        target.innerHTML = renderMarkdown(full);
        thread.messages.push({ role: 'assistant', content: full });
        store.saveThread(thread);
      } else {
        // Roll the turn back completely: drop it from the history, take the
        // bubble off screen, and hand the text back so nothing typed is lost.
        target.remove();
        mine?.remove();
        thread.messages.pop();
        thread.title = prevTitle;
        store.saveThread(thread);
        actions.refreshThreads();
        bubble('assistant', describeError(err), { error: true });
        if (!input.value.trim()) {
          input.value = message;
          grow();
        }
      }
      toBottom(true);
    } finally {
      setBusy(false);
      controller = null;
    }
  }

  /* ----------------------------------------------------------------- voice */

  function startListening() {
    if (!voice.canListen || busy) return;
    micBtn.classList.add('miclisten');
    micBtn.setAttribute('aria-pressed', 'true');

    const ok = voice.listen({
      onInterim: (t) => { interim.textContent = t; },
      onFinal: (t) => { interim.textContent = ''; send(t); },
      onEnd: () => {
        micBtn.classList.remove('miclisten');
        micBtn.setAttribute('aria-pressed', 'false');
        interim.textContent = '';
      },
      onError: (e) => {
        micBtn.classList.remove('miclisten');
        interim.textContent = '';
        toast(e === 'not-allowed'
          ? 'Microphone access was blocked. Allow it in your browser settings.'
          : `Microphone problem: ${e}`, 'bad');
        if (store.get().handsFree) store.set({ handsFree: false });
      },
    });

    if (!ok) {
      micBtn.classList.remove('miclisten');
      toast('Could not start the microphone.', 'bad');
    }
  }

  micBtn.addEventListener('click', () => {
    if (voice.isListening()) { voice.stopListening(); return; }
    voice.shutUp();
    startListening();
  });

  /* ------------------------------------------------------------------ wire */

  const grow = autoGrow(input);

  sendBtn.addEventListener('click', () => {
    if (busy) { controller?.abort(); return; }
    send(input.value);
  });

  input.addEventListener('keydown', (e) => {
    // Enter sends on a real keyboard; on touch it inserts a newline as usual.
    if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      send(input.value);
    }
  });

  paint();
  if (window.innerWidth >= 860) input.focus();

  return () => {
    controller?.abort();
    voice.stopListening();
    voice.shutUp();
  };
}

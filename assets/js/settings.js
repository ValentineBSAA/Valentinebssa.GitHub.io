/** The "You" view: key, model, personality, voice, and moving between devices. */

import { store } from './store.js';
import { MODELS, testKey, describeError } from './ai.js';
import * as voice from './voice.js';
import { h, clear, toast } from './ui.js';

function card(title, hint, ...body) {
  return h('div', { class: 'card' },
    h('h2', {}, title),
    hint ? h('p', { class: 'hint' }, hint) : null,
    ...body,
  );
}

function field(label, control, sub) {
  return h('div', { class: 'field' },
    h('label', {}, label),
    control,
    sub ? h('div', { class: 'sub' }, sub) : null,
  );
}

function toggle(label, sub, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' },
    input,
    h('span', { class: 'switch__track' }),
    h('span', { class: 'switch__label' }, label, sub ? h('small', {}, sub) : null),
  );
}

export function renderSettings(view, actions) {
  const s = store.get();
  const wrap = h('div', { class: 'wrap' });
  view.append(h('div', { class: 'pad' }, wrap));

  /* ------------------------------------------------------------------ key */

  const keyInput = h('input', {
    type: 'password',
    value: s.apiKey,
    placeholder: 'sk-ant-…',
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const showKey = h('button', { class: 'btn btn--sm btn--ghost' }, 'Show');
  showKey.addEventListener('click', () => {
    const hidden = keyInput.type === 'password';
    keyInput.type = hidden ? 'text' : 'password';
    showKey.textContent = hidden ? 'Hide' : 'Show';
  });

  const saveKey = h('button', { class: 'btn btn--primary' }, 'Save & test');
  const clearKey = h('button', { class: 'btn btn--ghost btn--danger' }, 'Remove');
  const keyStatus = h('div', { class: 'sub' }, s.apiKey ? 'A key is saved on this device.' : 'No key saved yet.');

  saveKey.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) { toast('Paste a key first.', 'bad'); return; }

    saveKey.disabled = true;
    saveKey.textContent = 'Testing…';
    keyStatus.textContent = 'Checking the key against the API…';

    try {
      await testKey(key, store.get().model);
      store.set({ apiKey: key });
      keyStatus.textContent = 'Key works. You are online.';
      toast('Key saved — you are online.', 'good');
      actions.refreshAll();
    } catch (err) {
      keyStatus.textContent = describeError(err);
      toast(describeError(err), 'bad');
    } finally {
      saveKey.disabled = false;
      saveKey.textContent = 'Save & test';
    }
  });

  clearKey.addEventListener('click', () => {
    store.set({ apiKey: '' });
    keyInput.value = '';
    keyStatus.textContent = 'Key removed from this device.';
    toast('Key removed.');
    actions.refreshAll();
  });

  wrap.append(card(
    'Connection',
    'Your key is stored only in this browser, on this device, and is sent nowhere except api.anthropic.com. Anyone who can unlock this device can use it, so treat it like a saved password.',
    field('Anthropic API key', h('div', { class: 'row', style: 'flex-wrap:nowrap' }, keyInput, showKey)),
    h('div', { class: 'row' }, saveKey, s.apiKey ? clearKey : null),
    keyStatus,
    h('div', { class: 'sub', style: 'margin-top:10px' },
      'Get one at ',
      h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'),
      '. Usage is billed to that account.'),
  ));

  /* ---------------------------------------------------------------- model */

  const modelSelect = h('select', {});
  for (const m of MODELS) {
    modelSelect.append(h('option', { value: m.id, selected: m.id === s.model }, m.label));
  }
  const modelNote = h('div', { class: 'sub' }, MODELS.find((m) => m.id === s.model)?.note || '');
  modelSelect.addEventListener('change', () => {
    store.set({ model: modelSelect.value });
    modelNote.textContent = MODELS.find((m) => m.id === modelSelect.value)?.note || '';
  });

  /* ------------------------------------------------------------ character */

  const nameInput = h('input', { type: 'text', value: s.name, placeholder: 'Companion', maxlength: '24' });
  nameInput.addEventListener('change', () => {
    store.set({ name: nameInput.value.trim() || 'Companion' });
    actions.refreshAll();
  });

  const personaInput = h('textarea', {
    placeholder: 'e.g. Dry, a bit sardonic. Into history and bad puns. Calls me by name. Never lectures.',
  });
  personaInput.value = s.persona;
  personaInput.addEventListener('change', () => store.set({ persona: personaInput.value }));

  wrap.append(card(
    'Your companion',
    'Who it is and how it talks. Changes apply to your next message.',
    field('Name', nameInput),
    field('Personality', personaInput, 'Free text. Left blank, it is warm and direct by default.'),
    field('Model', modelSelect),
    modelNote,
  ));

  /* ---------------------------------------------------------------- voice */

  const voiceBody = [];

  if (voice.canSpeak) {
    const voiceSelect = h('select', {});
    const fill = () => {
      clear(voiceSelect);
      voiceSelect.append(h('option', { value: '' }, 'System default'));
      for (const v of voice.listVoices()) {
        voiceSelect.append(h('option', { value: v.voiceURI, selected: v.voiceURI === store.get().voiceURI }, `${v.name} (${v.lang})`));
      }
    };
    fill();
    speechSynthesis.addEventListener('voiceschanged', fill, { once: true });
    voiceSelect.addEventListener('change', () => store.set({ voiceURI: voiceSelect.value }));

    const rate = h('input', { type: 'range', min: '0.6', max: '1.6', step: '0.1', value: String(s.rate || 1), style: 'width:100%' });
    const rateLabel = h('span', {}, `${Number(s.rate || 1).toFixed(1)}×`);
    rate.addEventListener('input', () => {
      store.set({ rate: Number(rate.value) });
      rateLabel.textContent = `${Number(rate.value).toFixed(1)}×`;
    });

    const preview = h('button', { class: 'btn btn--sm' }, 'Preview voice');
    preview.addEventListener('click', () => {
      voice.speak(`Hello. I'm ${store.get().name || 'Companion'}. This is how I'll sound.`);
    });

    voiceBody.push(
      toggle('Read replies aloud', 'Speaks every answer in the Talk tab.', s.speak, (v) => {
        store.set({ speak: v });
        if (!v) voice.shutUp();
        actions.refreshAll();
      }),
      field('Voice', voiceSelect),
      field('Speed', h('div', { class: 'row', style: 'flex-wrap:nowrap' }, rate, rateLabel)),
      preview,
    );
  } else {
    voiceBody.push(h('p', { class: 'hint' }, 'This browser has no speech synthesis, so replies cannot be read aloud.'));
  }

  if (voice.canListen) {
    voiceBody.unshift(
      toggle('Hands-free', 'After each reply, the microphone reopens automatically so you can just keep talking.', s.handsFree, (v) => {
        store.set({ handsFree: v });
      }),
    );
  } else {
    voiceBody.push(h('p', { class: 'hint', style: 'margin-top:12px;margin-bottom:0' },
      'Speech recognition is not available in this browser — try Chrome, Edge or Safari for voice input.'));
  }

  wrap.append(card('Voice', 'Talk to it out loud instead of typing.', ...voiceBody));

  /* ----------------------------------------------------------- your stuff */

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      store.importJSON(await file.text());
      toast('Restored. Your chats and scores are back.', 'good');
      actions.refreshAll();
      actions.go('you');
    } catch (err) {
      toast(`Could not read that file: ${err.message}`, 'bad');
    } finally {
      fileInput.value = '';
    }
  });

  const exportBtn = h('button', { class: 'btn' }, 'Download a backup');
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `companion-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const wipeBtn = h('button', { class: 'btn btn--ghost btn--danger' }, 'Erase everything');
  let armed = false;
  wipeBtn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      wipeBtn.textContent = 'Tap again to confirm';
      setTimeout(() => { armed = false; wipeBtn.textContent = 'Erase everything'; }, 4000);
      return;
    }
    localStorage.removeItem('companion.v1');
    location.reload();
  });

  const threadCount = Object.keys(s.threads).length;

  wrap.append(card(
    'Your data',
    `Everything — ${threadCount} chat${threadCount === 1 ? '' : 's'}, your scores, your settings — lives in this browser only. Nothing is on a server.`,
    h('div', { class: 'row' },
      exportBtn,
      h('button', { class: 'btn', onClick: () => fileInput.click() }, 'Restore from backup'),
      fileInput,
    ),
    h('div', { class: 'sub', style: 'margin-top:10px' },
      'The backup carries your chats and scores between devices. It deliberately leaves the API key out — paste that in fresh on each device.'),
    h('div', { class: 'row', style: 'margin-top:16px' }, wipeBtn),
  ));

  /* --------------------------------------------------------------- install */

  wrap.append(card(
    'Install it',
    'It runs as a real app on any device, with its own icon and no browser chrome.',
    h('p', { class: 'hint', style: 'margin-bottom:0' },
      'iPhone or iPad: Share → Add to Home Screen. ' +
      'Android: menu → Install app. ' +
      'Desktop Chrome or Edge: the install icon at the right of the address bar.'),
  ));

  return () => {};
}

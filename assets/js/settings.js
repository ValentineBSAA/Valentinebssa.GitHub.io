/** The "You" view: key, model, personality, voice, and moving between devices. */

import { store } from './store.js';
import { MODELS, testKey, describeError } from './ai.js';
import * as voice from './voice.js';
import * as tts from './tts.js';
import { saveAvatar, clearAvatar, canStoreFiles } from './idb.js';
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
  let installed = null;          // voices the Piper server reports, once probed

  const piperInput = h('input', {
    type: 'text',
    value: s.piperUrl,
    placeholder: 'http://nas.local:8080/tts',
    spellcheck: 'false',
    autocapitalize: 'off',
  });

  const piperStatus = h('div', { class: 'sub' },
    s.piperUrl ? `Set to ${s.piperUrl}` : 'Not set — using this browser’s own voices.');

  const voiceList = h('div', { class: 'voicegrid' });

  function paintVoices() {
    clear(voiceList);
    const usingPiper = Boolean(store.get().piperUrl);

    if (!usingPiper) {
      const pool = tts.femaleBrowserVoices();
      if (!pool.length) {
        voiceList.append(h('p', { class: 'hint', style: 'margin:0' },
          'No female voices found in this browser. Point at a Piper server above for a proper voice.'));
        return;
      }
      for (const v of pool) {
        const on = v.voiceURI === store.get().voiceURI || (!store.get().voiceURI && v === pool[0]);
        voiceList.append(h('button', {
          class: 'voiceopt' + (on ? ' is-on' : ''),
          onClick: () => { store.set({ voiceURI: v.voiceURI }); paintVoices(); },
        },
          h('span', { class: 'voiceopt__dot' }),
          h('span', { class: 'voiceopt__name' }, v.name),
          h('span', { class: 'voiceopt__meta' }, v.lang),
        ));
      }
      return;
    }

    for (const v of tts.PIPER_VOICES) {
      const on = v.id === store.get().piperVoice;
      const missing = installed && !installed.includes(v.id);
      voiceList.append(h('button', {
        class: 'voiceopt' + (on ? ' is-on' : '') + (missing ? ' is-missing' : ''),
        title: missing ? 'Not installed on the server yet' : v.id,
        onClick: () => {
          store.set({ piperVoice: v.id });
          paintVoices();
          if (missing) toast(`${v.id} is not on the server yet — run download-voices.sh for it.`, 'bad');
        },
      },
        h('span', { class: 'voiceopt__dot' }),
        h('span', { class: 'voiceopt__name' }, v.label),
        v.verified ? h('span', { class: 'badge' }, 'verified') : null,
        h('span', { class: 'voiceopt__meta' }, missing ? 'not installed' : v.size),
      ));
    }
  }

  const testPiper = h('button', { class: 'btn btn--primary' }, 'Connect');
  testPiper.addEventListener('click', async () => {
    const url = piperInput.value.trim().replace(/\/+$/, '');
    if (!url) {
      store.set({ piperUrl: '' });
      installed = null;
      piperStatus.textContent = 'Cleared — back to this browser’s own voices.';
      paintVoices();
      return;
    }

    testPiper.disabled = true;
    testPiper.textContent = 'Connecting…';
    piperStatus.textContent = 'Asking the server which voices it has…';

    try {
      installed = await tts.probePiper(url);
      store.set({ piperUrl: url });
      const female = installed.filter((id) => tts.PIPER_VOICES.some((v) => v.id === id));
      if (female.length && !female.includes(store.get().piperVoice)) {
        store.set({ piperVoice: female[0] });
      }
      piperStatus.textContent = `Connected. ${installed.length} voice${installed.length === 1 ? '' : 's'} installed, ${female.length} of them on the list below.`;
      toast('Piper connected.', 'good');
      paintVoices();
    } catch (err) {
      piperStatus.textContent = `Could not reach it: ${err.message}`;
      toast(`Could not reach Piper: ${err.message}`, 'bad');
    } finally {
      testPiper.disabled = false;
      testPiper.textContent = 'Connect';
    }
  });

  const rate = h('input', { type: 'range', min: '0.6', max: '1.6', step: '0.05', value: String(s.rate || 1), style: 'width:100%' });
  const rateLabel = h('span', { style: 'min-width:3.2em;text-align:right' }, `${Number(s.rate || 1).toFixed(2)}×`);
  rate.addEventListener('input', () => {
    store.set({ rate: Number(rate.value) });
    rateLabel.textContent = `${Number(rate.value).toFixed(2)}×`;
  });

  const preview = h('button', { class: 'btn' }, 'Hear her');
  preview.addEventListener('click', async () => {
    await tts.unlockAudio();
    preview.disabled = true;
    preview.textContent = 'Speaking…';
    await tts.speak(`Hello. I'm ${store.get().name || 'Companion'}, and this is how I sound.`);
    preview.disabled = false;
    preview.textContent = 'Hear her';
  });

  voiceBody.push(
    toggle('Read replies aloud', 'Speaks every answer in the Talk tab. Voice mode always speaks.', s.speak, (v) => {
      store.set({ speak: v });
      if (!v) tts.shutUp();
    }),
    voice.canListen
      ? toggle('Hands-free', 'Reopens the microphone after each reply so you can just keep talking.', s.handsFree, (v) => {
          store.set({ handsFree: v });
        })
      : h('p', { class: 'hint', style: 'margin:6px 0 0' },
          'Speech recognition is not available in this browser — try Chrome, Edge or Safari to talk to her.'),
    h('hr', { style: 'border:0;border-top:1px solid var(--line);margin:16px 0' }),
    field('Piper server', h('div', { class: 'row', style: 'flex-wrap:nowrap' }, piperInput, testPiper),
      'The URL of the Piper container on your NAS. Leave it blank to use the voices built into this browser instead.'),
    piperStatus,
    h('div', { class: 'field', style: 'margin-top:16px' },
      h('label', {}, 'Voice'),
      voiceList,
    ),
    field('Speed', h('div', { class: 'row', style: 'flex-wrap:nowrap' }, rate, rateLabel)),
    preview,
  );

  wrap.append(card(
    'Voice',
    'Every voice offered here is female. Piper runs on your own hardware and sounds far better than the browser’s built-in speech.',
    ...voiceBody,
  ));

  paintVoices();
  if (tts.canBrowserSpeak) speechSynthesis.addEventListener('voiceschanged', paintVoices, { once: true });
  // Re-probe on open so the "not installed" marks are accurate.
  if (s.piperUrl) {
    tts.probePiper(s.piperUrl)
      .then((list) => { installed = list; paintVoices(); })
      .catch(() => { piperStatus.textContent = `Saved, but ${s.piperUrl} is not answering right now.`; });
  }

  /* ------------------------------------------------------------ the model */

  const modelStatus = h('div', { class: 'sub', style: 'margin-top:10px' });

  function describeAvatar() {
    const cur = store.get();
    if (cur.avatarSource === 'file') return `Using ${cur.avatarFileName || 'an uploaded model'}.`;
    if (cur.avatarSource === 'url' && cur.avatarUrl) return `Loading from ${cur.avatarUrl}`;
    return 'No character set. Voice mode still works — she just has no face yet.';
  }
  modelStatus.textContent = describeAvatar();

  const vrmInput = h('input', { type: 'file', accept: '.vrm,model/gltf-binary', style: 'display:none' });

  async function acceptFile(file) {
    if (!file) return;
    if (!/\.vrm$/i.test(file.name)) { toast('That needs to be a .vrm file.', 'bad'); return; }
    if (!canStoreFiles) { toast('This browser cannot store files locally.', 'bad'); return; }

    modelStatus.textContent = `Saving ${file.name}…`;
    try {
      await saveAvatar(file);
      store.set({ avatarSource: 'file', avatarFileName: file.name, avatarUrl: '' });
      modelStatus.textContent = describeAvatar();
      toast('Character saved. Open Voice mode to meet her.', 'good');
    } catch (err) {
      modelStatus.textContent = `Could not save it: ${err.message}`;
      toast('Could not save that model — it may be too large for this browser.', 'bad');
    }
  }

  vrmInput.addEventListener('change', () => { acceptFile(vrmInput.files?.[0]); vrmInput.value = ''; });

  const drop = h('div', { class: 'filedrop', onClick: () => vrmInput.click() },
    h('strong', {}, 'Drop a .vrm here, or choose a file'),
    h('small', {}, 'Stored on this device only. Typically 10–50 MB.'),
  );
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    acceptFile(e.dataTransfer?.files?.[0]);
  });

  const urlInput = h('input', { type: 'text', value: s.avatarUrl, placeholder: 'https://…/character.vrm', spellcheck: 'false' });
  const useUrl = h('button', { class: 'btn btn--sm' }, 'Use this URL');
  useUrl.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) { toast('Paste a URL first.', 'bad'); return; }
    store.set({ avatarSource: 'url', avatarUrl: url, avatarFileName: '' });
    modelStatus.textContent = describeAvatar();
    toast('Character set. Open Voice mode to meet her.', 'good');
  });

  const zoom = h('input', { type: 'range', min: '1', max: '3', step: '0.1', value: String(s.avatarZoom || 1), style: 'width:100%' });
  const zoomLabel = h('span', { style: 'min-width:5.5em;text-align:right' }, zoomText(s.avatarZoom || 1));
  function zoomText(z) { return z < 1.5 ? 'Face' : z < 2.2 ? 'Head & shoulders' : 'Half body'; }
  zoom.addEventListener('input', () => {
    store.set({ avatarZoom: Number(zoom.value) });
    zoomLabel.textContent = zoomText(Number(zoom.value));
  });

  const removeModel = h('button', { class: 'btn btn--ghost btn--danger btn--sm' }, 'Remove character');
  removeModel.addEventListener('click', async () => {
    await clearAvatar().catch(() => {});
    store.set({ avatarSource: 'none', avatarUrl: '', avatarFileName: '' });
    urlInput.value = '';
    modelStatus.textContent = describeAvatar();
    toast('Character removed.');
  });

  wrap.append(card(
    'Her character',
    'Voice mode shows a 3D VRM model that blinks, breathes, and moves her mouth to the actual audio. Make one free in VRoid Studio, or download one from VRoid Hub.',
    drop,
    vrmInput,
    h('div', { class: 'sub', style: 'margin:14px 0 6px' }, '…or load one from a URL:'),
    h('div', { class: 'row', style: 'flex-wrap:nowrap' }, urlInput, useUrl),
    modelStatus,
    h('div', { class: 'field', style: 'margin-top:16px' },
      h('label', {}, 'Framing'),
      h('div', { class: 'row', style: 'flex-wrap:nowrap' }, zoom, zoomLabel),
    ),
    h('div', { class: 'row' }, removeModel),
    h('div', { class: 'sub', style: 'margin-top:12px' },
      'Models come from ',
      h('a', { href: 'https://vroid.com/en/studio', target: '_blank', rel: 'noopener' }, 'VRoid Studio'),
      ' (free, makes your own) or ',
      h('a', { href: 'https://hub.vroid.com/en', target: '_blank', rel: 'noopener' }, 'VRoid Hub'),
      '. Check each model’s licence before using it.'),
  ));

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

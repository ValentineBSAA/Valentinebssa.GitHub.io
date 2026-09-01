/** The "You" view: key, characters, voice, and moving between devices. */

import { store, DEFAULT_VOICE } from './store.js';
import { MODELS, testKey, describeError } from './ai.js';
import * as voice from './voice.js';
import * as tts from './tts.js';
import { saveModel, deleteModel, canStoreFiles } from './idb.js';
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

  const modelSelect = h('select', {});
  for (const m of MODELS) {
    modelSelect.append(h('option', { value: m.id, selected: m.id === s.model }, m.label));
  }
  const modelNote = h('div', { class: 'sub' }, MODELS.find((m) => m.id === s.model)?.note || '');
  modelSelect.addEventListener('change', () => {
    store.set({ model: modelSelect.value });
    modelNote.textContent = MODELS.find((m) => m.id === modelSelect.value)?.note || '';
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
    h('hr', { style: 'border:0;border-top:1px solid var(--line);margin:16px 0' }),
    field('Model', modelSelect),
    modelNote,
  ));

  /* ----------------------------------------------------------- characters */

  const charList = h('div', { class: 'charlist' });
  const editor = h('div', { class: 'chareditor' });

  function paintAll() {
    paintCharList();
    paintEditor();
    paintVoices();
  }

  function voiceLabel(id) {
    return tts.PIPER_VOICES.find((v) => v.id === id)?.label.split(' — ')[0] || 'default voice';
  }

  function paintCharList() {
    clear(charList);
    const activeId = store.get().activeCharacter;

    for (const c of store.charList()) {
      const model = c.source === 'file' ? (c.fileName || 'model file')
        : c.source === 'url' ? c.url
        : 'no model yet';

      charList.append(h('button', {
        class: 'charcard' + (c.id === activeId ? ' is-on' : ''),
        onClick: () => {
          store.setActiveChar(c.id);
          paintAll();
          actions.refreshAll();
        },
      },
        h('span', { class: 'charcard__mark' }, (c.name || '?')[0].toUpperCase()),
        h('span', { class: 'charcard__body' },
          h('span', { class: 'charcard__name' }, c.name || 'Unnamed'),
          h('span', { class: 'charcard__meta' }, `${voiceLabel(c.voice)} · ${model}`),
        ),
        c.id === activeId ? h('span', { class: 'badge' }, 'active') : null,
      ));
    }

    charList.append(h('button', {
      class: 'charcard charcard--add',
      onClick: () => {
        const n = store.charList().length + 1;
        store.addChar({ name: `Character ${n}` });
        paintAll();
        actions.refreshAll();
        toast('New character added — give her a name and a model.');
      },
    },
      h('span', { class: 'charcard__mark' }, '+'),
      h('span', { class: 'charcard__body' },
        h('span', { class: 'charcard__name' }, 'Add a character'),
        h('span', { class: 'charcard__meta' }, 'Her own name, voice, personality and model'),
      ),
    ));
  }

  function paintEditor() {
    clear(editor);
    const c = store.activeChar();

    const nameInput = h('input', { type: 'text', value: c.name, placeholder: 'Her name', maxlength: '24' });
    nameInput.addEventListener('change', () => {
      store.updateChar(c.id, { name: nameInput.value.trim() || 'Companion' });
      paintCharList();
      actions.refreshAll();
    });

    const personaInput = h('textarea', {
      placeholder: 'e.g. Dry, a bit sardonic. Into history and bad puns. Calls me by name. Never lectures.',
    });
    personaInput.value = c.persona;
    personaInput.addEventListener('change', () => store.updateChar(c.id, { persona: personaInput.value }));

    /* ---- her model ---- */

    const modelStatus = h('div', { class: 'sub', style: 'margin-top:10px' });
    function describeModel() {
      const cur = store.activeChar();
      if (cur.source === 'file') return `Using ${cur.fileName || 'an uploaded model'}.`;
      if (cur.source === 'url' && cur.url) return `Loading from ${cur.url}`;
      return 'No model yet. Voice mode still works — she just has no face.';
    }
    modelStatus.textContent = describeModel();

    const vrmInput = h('input', { type: 'file', accept: '.vrm,model/gltf-binary', style: 'display:none' });

    async function acceptFile(file) {
      if (!file) return;
      if (!/\.vrm$/i.test(file.name)) { toast('That needs to be a .vrm file.', 'bad'); return; }
      if (!canStoreFiles) { toast('This browser cannot store files locally.', 'bad'); return; }

      modelStatus.textContent = `Saving ${file.name}…`;
      try {
        await saveModel(c.id, file);
        store.updateChar(c.id, { source: 'file', fileName: file.name, url: '' });
        modelStatus.textContent = describeModel();
        paintCharList();
        toast('Model saved. Open Voice mode to meet her.', 'good');
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

    const urlInput = h('input', { type: 'text', value: c.url, placeholder: 'characters/her.vrm', spellcheck: 'false' });
    const useUrl = h('button', { class: 'btn btn--sm' }, 'Use URL');
    useUrl.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!url) { toast('Paste a URL or path first.', 'bad'); return; }
      store.updateChar(c.id, { source: 'url', url, fileName: '' });
      modelStatus.textContent = describeModel();
      paintCharList();
      toast('Model set. Open Voice mode to meet her.', 'good');
    });

    const zoom = h('input', { type: 'range', min: '1', max: '3', step: '0.1', value: String(c.zoom || 2), style: 'width:100%' });
    const zoomText = (z) => (z < 1.5 ? 'Face' : z < 2.4 ? 'Head & shoulders' : 'Half body');
    const zoomLabel = h('span', { style: 'min-width:6.5em;text-align:right' }, zoomText(c.zoom || 2));
    zoom.addEventListener('input', () => {
      store.updateChar(c.id, { zoom: Number(zoom.value) });
      zoomLabel.textContent = zoomText(Number(zoom.value));
    });

    const removeModel = h('button', { class: 'btn btn--ghost btn--sm' }, 'Remove model');
    removeModel.addEventListener('click', async () => {
      await deleteModel(c.id).catch(() => {});
      store.updateChar(c.id, { source: 'none', url: '', fileName: '' });
      urlInput.value = '';
      modelStatus.textContent = describeModel();
      paintCharList();
      toast('Model removed.');
    });

    const deleteChar = h('button', { class: 'btn btn--ghost btn--danger btn--sm' }, 'Delete character');
    let armed = false;
    deleteChar.addEventListener('click', async () => {
      if (store.charList().length <= 1) {
        toast('She is your only character — give her a different model instead.', 'bad');
        return;
      }
      if (!armed) {
        armed = true;
        deleteChar.textContent = 'Tap again to delete';
        setTimeout(() => { armed = false; deleteChar.textContent = 'Delete character'; }, 4000);
        return;
      }
      await deleteModel(c.id).catch(() => {});
      store.deleteChar(c.id);
      paintAll();
      actions.refreshAll();
      toast('Character deleted.');
    });

    editor.append(
      h('div', { class: 'chareditor__head' }, `Editing ${c.name || 'this character'}`),
      field('Name', nameInput, 'What she is called, in chat and on the sidebar.'),
      field('Personality', personaInput, 'Free text. Left blank, she is warm and direct by default.'),
      h('div', { class: 'field' }, h('label', {}, 'Character model'), drop, vrmInput),
      h('div', { class: 'sub', style: 'margin:12px 0 6px' }, '…or load one by URL or path:'),
      h('div', { class: 'row', style: 'flex-wrap:nowrap' }, urlInput, useUrl),
      modelStatus,
      h('div', { class: 'field', style: 'margin-top:16px' },
        h('label', {}, 'Framing'),
        h('div', { class: 'row', style: 'flex-wrap:nowrap' }, zoom, zoomLabel),
      ),
      h('div', { class: 'row' }, removeModel, deleteChar),
    );
  }

  wrap.append(card(
    'Characters',
    'Each one has her own name, personality, voice and model. Switching character switches all four — the conversation carries over.',
    charList,
    editor,
    h('div', { class: 'sub', style: 'margin-top:14px' },
      'Models come from ',
      h('a', { href: 'https://vroid.com/en/studio', target: '_blank', rel: 'noopener' }, 'VRoid Studio'),
      ' (free, makes your own) or ',
      h('a', { href: 'https://hub.vroid.com/en', target: '_blank', rel: 'noopener' }, 'VRoid Hub'),
      '. Check each model’s licence before using it.'),
  ));

  /* ---------------------------------------------------------------- voice */

  let installed = null;          // voices the Piper server reports, once probed

  const piperInput = h('input', {
    type: 'text',
    value: s.piperUrl,
    placeholder: 'tts  ·  or  http://nas:8080/tts',
    spellcheck: 'false',
    autocapitalize: 'off',
  });

  const piperStatus = h('div', { class: 'sub' },
    s.piperUrl ? `Set to ${s.piperUrl}` : 'Not set — using this browser’s own voices.');

  const voiceList = h('div', { class: 'voicegrid' });

  function paintVoices() {
    clear(voiceList);
    const c = store.activeChar();

    if (!store.get().piperUrl) {
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
      const on = v.id === (c.voice || DEFAULT_VOICE);
      const missing = installed && !installed.includes(v.id);
      voiceList.append(h('button', {
        class: 'voiceopt' + (on ? ' is-on' : '') + (missing ? ' is-missing' : ''),
        title: missing ? 'Not installed on the server yet' : v.id,
        onClick: () => {
          store.updateChar(c.id, { voice: v.id });
          paintVoices();
          paintCharList();
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
      if (female.length && !female.includes(store.activeChar().voice)) {
        store.updateChar(store.activeChar().id, { voice: female[0] });
      }
      piperStatus.textContent = `Connected. ${installed.length} voice${installed.length === 1 ? '' : 's'} installed, ${female.length} of them on the list below.`;
      toast('Piper connected.', 'good');
      paintVoices();
      paintCharList();
    } catch (err) {
      piperStatus.textContent = `Could not reach it: ${err.message}`;
      toast(`Could not reach Piper: ${err.message}`, 'bad');
    } finally {
      testPiper.disabled = false;
      testPiper.textContent = 'Connect';
    }
  });

  const rate = h('input', { type: 'range', min: '0.6', max: '1.6', step: '0.05', value: String(s.rate || 1), style: 'width:100%' });
  const rateLabel = h('span', { style: 'min-width:3.4em;text-align:right' }, `${Number(s.rate || 1).toFixed(2)}×`);
  rate.addEventListener('input', () => {
    store.set({ rate: Number(rate.value) });
    rateLabel.textContent = `${Number(rate.value).toFixed(2)}×`;
  });

  const preview = h('button', { class: 'btn' }, 'Hear her');
  preview.addEventListener('click', async () => {
    await tts.unlockAudio();
    preview.disabled = true;
    preview.textContent = 'Speaking…';
    await tts.speak(`Hello. I'm ${store.activeChar().name || 'Companion'}, and this is how I sound.`);
    preview.disabled = false;
    preview.textContent = 'Hear her';
  });

  wrap.append(card(
    'Voice',
    'Every voice offered here is female. Piper runs on your own hardware and sounds far better than the browser’s built-in speech. The voice you pick belongs to whichever character is active.',
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
      'Running the all-in-one Docker stack, this is just tts. On Web Station with Piper in its own container, use the full address, e.g. http://192.168.1.20:8080/tts. Leave it blank to use the voices built into this browser instead.'),
    piperStatus,
    h('div', { class: 'field', style: 'margin-top:16px' }, h('label', {}, 'Voice'), voiceList),
    field('Speed', h('div', { class: 'row', style: 'flex-wrap:nowrap' }, rate, rateLabel)),
    preview,
  ));

  paintAll();
  if (tts.canBrowserSpeak) speechSynthesis.addEventListener('voiceschanged', paintVoices, { once: true });
  if (s.piperUrl) {
    tts.probePiper(s.piperUrl)
      .then((list) => { installed = list; paintVoices(); })
      .catch(() => { piperStatus.textContent = `Saved, but ${s.piperUrl} is not answering right now.`; });
  }

  /* ----------------------------------------------------------- your stuff */

  const backupInput = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  backupInput.addEventListener('change', async () => {
    const file = backupInput.files?.[0];
    if (!file) return;
    try {
      store.importJSON(await file.text());
      toast('Restored. Your chats and characters are back.', 'good');
      actions.refreshAll();
      actions.go('you');
    } catch (err) {
      toast(`Could not read that file: ${err.message}`, 'bad');
    } finally {
      backupInput.value = '';
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
  let wipeArmed = false;
  wipeBtn.addEventListener('click', () => {
    if (!wipeArmed) {
      wipeArmed = true;
      wipeBtn.textContent = 'Tap again to confirm';
      setTimeout(() => { wipeArmed = false; wipeBtn.textContent = 'Erase everything'; }, 4000);
      return;
    }
    localStorage.removeItem('companion.v1');
    try { indexedDB.deleteDatabase('companion'); } catch { /* nothing stored */ }
    location.reload();
  });

  const threadCount = Object.keys(s.threads).length;
  const charCount = store.charList().length;

  wrap.append(card(
    'Your data',
    `Everything — ${threadCount} chat${threadCount === 1 ? '' : 's'}, ${charCount} character${charCount === 1 ? '' : 's'}, your scores — lives in this browser only. Nothing is on a server.`,
    h('div', { class: 'row' },
      exportBtn,
      h('button', { class: 'btn', onClick: () => backupInput.click() }, 'Restore from backup'),
      backupInput,
    ),
    h('div', { class: 'sub', style: 'margin-top:10px' },
      'The backup carries your chats, characters and scores between devices. It leaves out the API key, and it leaves out the model files — those are far too large for a JSON file. Add those again per device, or serve them from the NAS by URL and they follow you everywhere.'),
    h('div', { class: 'row', style: 'margin-top:16px' }, wipeBtn),
  ));

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

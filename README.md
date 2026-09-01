# Companion

A personal AI you can talk to — and play games with — from your phone, your
laptop, or anything else with a browser. It's a static site, so it runs on
GitHub Pages with no server, no build step, and no backend to keep alive.

**Live at:** https://valentinebsaa.github.io

---

## What it does

**Talk.** A streaming conversation that remembers. Chats are kept in threads
down the left. You can type, or tap the microphone and just speak — replies can
be read back aloud, and *hands-free* mode reopens the mic after every answer, so
you can have an actual back-and-forth without touching the screen.

**Voice.** A full-screen mode with nothing to type: a 3D anime character who
blinks, breathes, and moves her mouth in time with the actual audio waveform.
Speech is [Piper](https://github.com/rhasspy/piper) running on your own hardware,
so nothing you say is sent anywhere but Anthropic. Every voice offered is female.
It shares the same conversation as Talk, so you can start typing and finish out
loud.

**Characters.** You can keep as many as you like. Each one has her own name,
personality, voice and VRM model; the chip above the microphone cycles between
them without leaving the view, and the conversation carries across. Add them
under **You → Characters**.

**Play.** Five games where the AI is genuinely the other player:

| Game | What happens |
|---|---|
| **20 Questions** | It thinks of something and answers your yes-or-no questions. The answer is locked in before you start, so it can't quietly move the goalposts. |
| **Trivia Duel** | Eight multiple-choice questions, freshly written each round, across a dozen topics. It explains every answer. |
| **Word Guess** | Hangman. It picks the word, writes the clue, and drops a real hint when you're two lives from losing. |
| **Tic-Tac-Toe** | It plays to win. Works with no key and no connection at all. |
| **Story Quest** | An improvised choose-your-own adventure that reacts to your choices and lands a real ending. |

**You.** Your key, which Claude model to use, your cast of characters, the
shared voice settings, and a backup file for moving your chats to another
device.

---

## Getting it running

1. Open the site.
2. Go to **You**, paste an Anthropic API key from
   [console.anthropic.com](https://console.anthropic.com/settings/keys), and hit
   **Save & test**.
3. Start talking.

Tic-Tac-Toe and Word Guess work before you do any of that.

For Voice mode you also need two things, both covered in
**[deploy/SETUP-NAS.md](deploy/SETUP-NAS.md)**: a Piper server (your NAS) and a
`.vrm` character model (yours to supply). Without them, Voice mode falls back to
the browser's own female voices and says so.

### Install it as an app

It's a PWA, so it gets its own icon and runs without browser chrome:

- **iPhone / iPad** — Share → Add to Home Screen
- **Android** — menu → Install app
- **Desktop Chrome / Edge** — the install icon at the right of the address bar

---

## About the API key

The key is stored in `localStorage` on whichever device you typed it into. It is
sent to exactly one place: `api.anthropic.com`. There is no server in between,
because there is no server at all.

Two things follow from that, and they're worth being clear about:

- **The key lives in the browser.** Anyone who can unlock that device can open
  the site and spend against your account. Treat it like a saved password. If a
  device goes missing, revoke the key in the Anthropic console.
- **Backups deliberately exclude it.** The export file carries your chats and
  scores between devices; you paste the key in fresh on each one.

This is a reasonable trade for a personal, single-user page. It is *not* a
pattern to copy for a site other people will use — that needs a backend holding
the key server-side.

Usage is billed to your Anthropic account. The default model is Opus 5; Sonnet 5
and Haiku 4.5 are cheaper and quicker, and you can switch under **You**.

---

## How it's put together

No framework, no bundler, no `npm install` to deploy. Plain ES modules the
browser loads directly.

```
index.html               app shell
manifest.webmanifest     PWA manifest
sw.js                    service worker (shell caching; never caches API calls)
assets/
  css/app.css            all styles; light and dark via prefers-color-scheme
  js/
    app.js               routing, navigation, the Play grid
    chat.js              the Talk view
    voicemode.js         the Voice view
    settings.js          the You view
    ai.js                Anthropic client — streaming, JSON turns, error text
    tts.js               speech out: Piper, or browser voices as a fallback
    voice.js             speech in (recognition)
    avatar.js            VRM rendering, idle motion, blinking, lip sync
    store.js             localStorage: settings, characters, threads, scores
    idb.js               IndexedDB, one model file per character
    ui.js                DOM helpers and a small Markdown renderer
    games/               one module per game
    vendor/              Anthropic SDK and three.js + three-vrm, bundled
deploy/
  docker-compose.yml     nginx + Piper, for the NAS
  download-voices.sh     fetches the female voices
  SETUP-NAS.md           DS418+ walkthrough
```

**The SDK is vendored, not loaded from a CDN.** `assets/js/vendor/anthropic-sdk.esm.js`
is `@anthropic-ai/sdk@0.122.0` bundled with esbuild for the browser. That keeps
the site working offline, removes a third-party runtime dependency, and means
nothing breaks if a CDN has a bad day. To update it:

```bash
npm install @anthropic-ai/sdk@<version> esbuild
echo 'export { default as Anthropic } from "@anthropic-ai/sdk";' > entry.js
npx esbuild entry.js --bundle --format=esm --platform=browser \
  --target=es2022 --minify --external:node:* \
  --outfile=assets/js/vendor/anthropic-sdk.esm.js
```

`--external:node:*` leaves the SDK's Node-only credential lookups as unreachable
dynamic imports; the browser never evaluates them because the key is passed in
directly.

**three.js and three-vrm are vendored the same way** into
`assets/js/vendor/three-vrm.esm.js` (~900 KB). `avatar.js` imports it with a
dynamic `import()`, so Talk and the games never download it — only Voice mode
pays that cost, and only when a character is actually set.

```bash
npm install three@0.185.1 @pixiv/three-vrm@3.5.5 esbuild
cat > entry.js <<'EOF'
export * as THREE from 'three';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
EOF
npx esbuild entry.js --bundle --format=esm --platform=browser \
  --target=es2022 --minify --outfile=assets/js/vendor/three-vrm.esm.js
```

### Notes on the voice

Piper publishes no gender metadata, so the female-only list in `tts.js` is
curated by hand. Where I could, I checked it rather than trusting the name:
synthesise a fixed phrase, measure median fundamental frequency, and compare
against known male voices. Amy 195 Hz, Lessac 193 Hz, southern_english_female
195 Hz, Kathleen 152 Hz — against Alan 95 Hz, Danny 117 Hz and Ryan 137 Hz as
controls. Those are marked *verified* in the UI. The rest are on the list
because their source dataset has a documented female speaker. Voices I could not
stand behind were left off entirely.

Long replies are split into sentences and pipelined — sentence N+1 is
synthesised while N is still playing. On a Celeron NAS that is the difference
between speaking in half a second and speaking in five.

### Notes on the character

Both VRM 0.x and VRM 1.0 models work. three-vrm remaps 0.x's blendshape names
onto the 1.0 presets (`a` → `aa`, `joy` → `happy`, `sorrow` → `sad`), so the
same lip-sync and expression code drives both; the one thing it does not remap
is 0.x's "unknown" slot, which VRoid tends to export as a custom expression
literally named `Surprised`, so expression lookup falls back to a
case-insensitive match.

Two things are measured from the model rather than assumed, because guessing
gets both wrong:

- **Which way the arms swing down.** Rotating the upper arm about its local Z
  lowers it in VRM 1.0 and *raises* it in 0.x, because `rotateVRM0` turns the
  rig 180°. The code tries both signs and keeps whichever actually puts the
  hand lower.
- **How tall she is.** The mesh bounding box is the wrong ruler — wings, tails
  and floor-length hair inflate it, and a winged model ends up framed as a
  distant full-body shot. Framing measures head bone to floor off the skeleton
  instead.

### Notes on the API usage

- Chat streams via `messages.stream()` at `effort: "low"`, which is what makes
  replies feel immediate. The brain button in the top bar switches to `"high"`
  for a question worth thinking about.
- Games use `output_config.format` with a JSON schema, so a move comes back as a
  move rather than a paragraph that has to be parsed hopefully.
- `dangerouslyAllowBrowser: true` is set deliberately, for the reasons above. The
  SDK adds the `anthropic-dangerous-direct-browser-access` header that the API
  needs for direct browser calls.

### Working on it locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Anything that serves static files works. There's nothing to compile.

---

## Running it on a NAS

`deploy/` holds a two-container stack — nginx serving the site, Piper doing
speech — behind a single port. Written for a Synology DS418+, but nothing in it
is Synology-specific beyond the walkthrough.

```bash
cd deploy
./download-voices.sh            # a female voice, ~63 MB
docker compose up -d --build
```

Then open `http://<nas-ip>:8080` and set the Piper server to `/tts` under
**You → Voice**. Full walkthrough, including the DS418+'s CPU limits and the
HTTPS-vs-microphone gotcha: **[deploy/SETUP-NAS.md](deploy/SETUP-NAS.md)**.

You can also keep the app on GitHub Pages and point it at your NAS for voice
only — the nginx config sends the CORS headers for it. That path needs HTTPS on
the NAS, because an HTTPS page cannot call a plain-HTTP server.

---

## Browser support

Chat, games, storage and installation work anywhere current. Voice is thinner:

- **Speech output** works everywhere. With Piper it is the same on every browser;
  without it, quality depends on the voices the OS ships.
- **Speech input** is Chrome, Edge and Safari only — Firefox has no speech
  recognition. Elsewhere the microphone simply doesn't appear and typing works
  as it always did. It also needs a **secure context**: HTTPS or localhost. Over
  plain HTTP to a NAS IP you get voice out but not voice in.
- **The character** needs WebGL2, which is everything current.

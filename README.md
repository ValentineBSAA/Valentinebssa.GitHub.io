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

**Play.** Five games where the AI is genuinely the other player:

| Game | What happens |
|---|---|
| **20 Questions** | It thinks of something and answers your yes-or-no questions. The answer is locked in before you start, so it can't quietly move the goalposts. |
| **Trivia Duel** | Eight multiple-choice questions, freshly written each round, across a dozen topics. It explains every answer. |
| **Word Guess** | Hangman. It picks the word, writes the clue, and drops a real hint when you're two lives from losing. |
| **Tic-Tac-Toe** | It plays to win. Works with no key and no connection at all. |
| **Story Quest** | An improvised choose-your-own adventure that reacts to your choices and lands a real ending. |

**You.** Your key, which model to use, what your companion is called and how it
talks, voice and speed, and a backup file for moving your chats to another
device.

---

## Getting it running

1. Open the site.
2. Go to **You**, paste an Anthropic API key from
   [console.anthropic.com](https://console.anthropic.com/settings/keys), and hit
   **Save & test**.
3. Start talking.

Tic-Tac-Toe and Word Guess work before you do any of that.

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
    settings.js          the You view
    ai.js                Anthropic client — streaming, JSON turns, error text
    store.js             localStorage: settings, threads, scores
    voice.js             speech recognition and synthesis
    ui.js                DOM helpers and a small Markdown renderer
    games/               one module per game
    vendor/              the Anthropic SDK, bundled for the browser
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

## Browser support

Chat, games, storage and installation work anywhere current. Voice is thinner:
speech synthesis is near-universal, but speech *recognition* is Chrome, Edge and
Safari only — elsewhere the microphone button simply doesn't appear, and typing
works as it always did.

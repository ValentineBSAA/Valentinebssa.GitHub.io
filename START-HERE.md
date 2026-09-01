# Start here

This is **Companion** — an AI you can talk to and play games with, running from
your own NAS.

## The 5-minute version

1. Copy the **`companion`** folder into your NAS's `web` shared folder
   (File Station → `web` → drag it in).
2. Open `http://<your-nas-ip>/companion/` on any device in the house.
3. Go to **You → Connection**, paste your Anthropic API key, press
   *Save & test*.
4. Go to **You → Characters**, set her model to `characters/ggg9.vrm` or
   `characters/b.vrm` — your two models are already in there.
5. Open **Voice** and say hello.

That's it. Web Station serves it; nothing else is required.

Full walkthrough, including screenshots-worth of DSM menu paths:
**[deploy/SETUP-WEBSTATION.md](deploy/SETUP-WEBSTATION.md)**

## One thing worth knowing before you start

Over plain `http://` your browser will not let the page use the **microphone**
(and won't offer to install it as an app, or work offline). Everything else —
chat, games, the character, speaking out loud — works fine.

To talk to her rather than type, you need HTTPS. On a Synology that's free and
takes about two minutes: **Control Panel → External Access → DDNS**, pick a
`something.synology.me` name, and tick the Let's Encrypt certificate. No domain
purchase, no router ports. The setup guide walks through it.

## Want better voices?

Out of the box she uses the voices already on your phone or computer. They're
serviceable.

For proper ones, there's a single Docker container (Piper) that runs neural
text-to-speech on the NAS itself — much better quality, and nothing you say ever
leaves the house. It's Level 2 in the setup guide, and it's about four commands.

## What's in here

```
index.html               the app
assets/                  code, styles, icons, and the bundled libraries
characters/              your .vrm character models
deploy/
  SETUP-WEBSTATION.md    ← the guide you want
  SETUP-NAS.md           the all-Docker alternative
  docker-compose.voice-only.yml   just Piper, for use with Web Station
  docker-compose.yml     Docker serves the site too
  download-voices.sh     fetches the (female) Piper voices
README.md                how the whole thing is built
```

Nothing needs compiling. There is no build step and no `npm install` — the
libraries are already bundled in `assets/js/vendor/`.

## Your data

Your API key, chats, characters and scores live in your browser's own storage on
each device, not in these files or on any server. **You → Your data** has a
backup you can move between devices.

The key is sent to exactly one place: `api.anthropic.com`. Usage bills to your
Anthropic account.

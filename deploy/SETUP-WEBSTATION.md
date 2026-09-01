# Running Companion on Synology Web Station

The simplest way to get this onto your NAS: copy a folder, point Web Station at
it, done. No Docker, no terminal, no build step.

**Read this first, because it decides how you set it up:**

Web Station serves files. It cannot run Piper — Piper is a Python program with
neural voice models, and Web Station has nowhere to run it. So there are two
levels, and the first one is genuinely fine on its own:

| | Level 1 — Web Station only | Level 2 — add Piper |
|---|---|---|
| Setup | Copy a folder | Plus one Docker container |
| Chat, games, characters | Yes | Yes |
| Speaks out loud | Yes, your device's built-in voices | Yes, much better voices |
| Runs where | Any device on your network | Same |

Start at Level 1. Add Level 2 later if the built-in voices annoy you.

---

## The one thing that will bite you: HTTP vs HTTPS

Browsers treat a plain `http://192.168.1.20/...` page as insecure, and quietly
switch off three things:

- **The microphone.** You will get voice *out* but not voice *in*. This is a hard
  browser rule, not a setting.
- **Installing it as an app** (its own icon, no browser chrome).
- **Offline caching**, so the games won't work without the NAS reachable.

Everything else — chat, games, the character, speaking out loud — works fine over
plain HTTP. If you only ever want to type, skip ahead.

**If you want to talk to her, set up HTTPS.** On a Synology this is genuinely
easy and free, because you don't need to own a domain:

1. **Control Panel → External Access → DDNS → Add.** Service provider
   **Synology**, pick a hostname — you get `something.synology.me`.
2. Tick **Get a certificate from Let's Encrypt** while you're in that dialog
   (or afterwards: **Control Panel → Security → Certificate → Add**).
3. Reach the site at `https://something.synology.me/companion/` — this works from
   inside the house too, and everything switches on.

You do **not** need to open any router ports for this to work on your own
network. (Let's Encrypt does need port 80 reachable briefly to issue the
certificate; DSM walks you through it.)

---

## Level 1 — the site on Web Station

### 1. Install Web Station

**Package Center → Web Station → Install.** It will offer to install a web
server package alongside it; **Nginx** is fine, and so is Apache.

### 2. Copy the folder across

Web Station serves out of the shared folder called `web`, which installing it
creates.

**In File Station**, open `web`, make a folder called `companion`, and drag the
entire contents of the zip into it. You want it to look like:

```
web/
└── companion/
    ├── index.html
    ├── manifest.webmanifest
    ├── sw.js
    ├── assets/
    ├── characters/
    └── deploy/
```

`index.html` must sit directly inside `companion` — not inside another nested
folder. This is the single most common thing to get wrong.

### 3. Point Web Station at it

On **DSM 7**:

1. **Web Station → Web Service → Create.**
2. Service type **Static website**. Name it `Companion`.
3. Document root: browse to `web/companion`.
4. **Create.**
5. **Web Station → Web Portal → Create → Portal-based**, choose the `Companion`
   service, and give it a port (say **8081**) or a subdomain.

Alternatively, skip the portal entirely: the **Default Server** already serves
the whole `web` folder, so `http://<nas-ip>/companion/` works as soon as the
files are there. That is the least fiddly route, and everything in the app is
built with relative paths so it runs happily in a subfolder.

### 4. Open it

Go to `http://<your-nas-ip>/companion/` (or your portal address, or the
`https://something.synology.me/companion/` from above).

Then, under **You**:

1. **Connection** — paste your Anthropic API key, press *Save & test*.
2. **Characters** — name her, and give her a model. Your `.vrm` files are already
   in `characters/`, so just set the model URL to `characters/ggg9.vrm`
   (or whichever). Leave the leading slash off — that keeps it working in the
   subfolder.
3. **Voice** — leave the Piper server blank for now. She'll use the voices your
   phone or computer already has, filtered to female ones.

That's Level 1. It works.

---

## Level 2 — better voices, with Piper

Piper is a neural text-to-speech engine that runs entirely on your NAS. It sounds
dramatically better than the browser's built-in speech, and nothing you say or
hear leaves the house.

It needs one container. **Package Center → Container Manager → Install**, then
over SSH (**Control Panel → Terminal & SNMP → Enable SSH service**):

```sh
cd /volume1/web/companion/deploy
chmod +x download-voices.sh
./download-voices.sh                  # the default female voice, ~63 MB
sudo docker compose -f docker-compose.voice-only.yml up -d --build
```

Check it came up:

```sh
curl http://localhost:8080/tts/voices
```

Then in the app, **You → Voice**, set the Piper server to the full address of
your NAS:

```
http://192.168.1.20:8080/tts
```

Use your NAS's actual IP. Press **Connect** — it will tell you how many voices it
found. Voices you haven't downloaded are greyed out as *not installed*.

> **Serving the site over HTTPS?** Then Piper must be HTTPS too — a secure page is
> not allowed to call an insecure one, and the request is blocked before it is
> sent. Put a reverse proxy in front of it: **Control Panel → Login Portal →
> Advanced → Reverse Proxy → Create**, source
> `https://something.synology.me` port 443, destination `http://localhost` port
> 8080. Then use that HTTPS address in the Piper field.

### Which voice

On a DS418+ (Celeron J3455, no AVX) the voice size matters:

- **`low`** — comfortably faster than real time.
- **`medium`** — about real time. The default, and the right trade.
- **`high`** — slower than real time. You'll wait.

Long replies are split into sentences and the next one is synthesised while the
current one plays, so you only ever wait for the first sentence.

Get more voices any time — they all appear in the app once downloaded:

```sh
./download-voices.sh all              # every female voice, ~700 MB
sudo docker compose -f docker-compose.voice-only.yml restart
```

---

## Characters

Your `.vrm` files live in `characters/`. Anything you drop in that folder is
served by Web Station, so setting a character's model to
`characters/hername.vrm` makes her available on every device on the network —
no re-uploading per phone.

You can also drop a `.vrm` straight into the app under **You → Characters**, but
that stores it in that one browser only.

Add as many characters as you like. Each keeps her own name, personality, voice
and model, and the chip above the microphone in Voice mode switches between them.

Models come from [VRoid Studio](https://vroid.com/en/studio) (free, make your
own) or [VRoid Hub](https://hub.vroid.com/en). Both VRM 0.x and 1.0 work.

---

## Updating it later

Replace the contents of `web/companion` with the newer files. Your API key,
characters and chats live in your browser, not in those files, so nothing is
lost. Leave `characters/` alone and your models survive too.

If a change doesn't seem to take, it's the browser cache: reload with
Ctrl-Shift-R (Cmd-Shift-R on a Mac).

---

## When something doesn't work

**A blank page, or "index of /companion".** `index.html` is one folder too deep.
It must be directly inside `companion`.

**"No API key yet" and nothing happens.** The key wasn't saved. Under **You →
Connection**, press *Save & test* — it tells you plainly if the key is rejected.

**The microphone button isn't there, or does nothing.** Either you're on plain
HTTP (see the top of this page), or you're in Firefox, which has no speech
recognition. Chrome, Edge and Safari all work.

**She won't speak at all.** Some browsers block audio until you've tapped the
page. Tap the microphone button once. If you've set a Piper server, check it with
`curl http://<nas-ip>:8080/tts/voices` from another machine — if that fails, the
container is down.

**"Could not reach it" when connecting to Piper.** Use the NAS's IP address, not
`localhost` — `localhost` on your phone means the phone. And check whether the
page is HTTPS while Piper is HTTP; see the note above.

**The character never appears.** Check the model path. In a subfolder it must be
`characters/hername.vrm` with no leading slash. Very large models (>100 MB) may
also exceed what a browser will store, which is another reason to serve them from
the NAS rather than uploading them.

**Everything is sluggish and DSM feels slow.** A DS418+ ships with 2 GB. Use one
`low` voice, or add RAM — it's the single best upgrade for this box.

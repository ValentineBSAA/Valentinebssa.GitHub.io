# Running Companion on a Synology DS418+

This puts the whole thing on your NAS: the site, and Piper doing the speech
locally so nothing about your voice leaves the house.

Two containers — nginx serving the site, Piper doing text-to-speech — behind one
port. Roughly 20 minutes, most of it downloading.

---

## What the DS418+ can and can't do

Worth knowing up front, because it shapes a couple of the choices below.

| | |
|---|---|
| CPU | Intel Celeron J3455, 4 cores @ 1.5 GHz (Apollo Lake) |
| RAM | 2 GB as shipped, up to 6 GB |
| Docker | Yes — it's a "+" model, so Container Manager is available |

**No AVX.** Apollo Lake doesn't have it. Piper doesn't need it — the same models
run on a Raspberry Pi — but it isn't fast either. In practice:

- **`low` voices** — comfortably faster than real time. Replies start almost at once.
- **`medium` voices** — roughly real time. This is the default and it's the right
  trade for most people.
- **`high` voices** — slower than real time on this CPU. You'll wait. Avoid them
  unless you don't mind the pause.

The app splits long replies into sentences and synthesises the next one while the
current one plays, so the wait you actually feel is only for the *first* sentence,
not the whole answer.

**On 2 GB of RAM**, run one voice at a time. Each loaded model costs a few hundred
megabytes, and the compose file caps Piper at 1 GB so a burst can't push DSM into
swap. If you use several voices regularly, the RAM upgrade is worth more than
anything else you could do to this box.

---

## 1. Turn on SSH and Docker

1. **DSM → Control Panel → Terminal & SNMP → Enable SSH service.**
2. **Package Center → install Container Manager** (called Docker on older DSM).

## 2. Get the files onto the NAS

SSH in and clone into a shared folder — this example uses one called `docker`:

```sh
ssh yourname@nas.local
cd /volume1/docker
git clone https://github.com/ValentineBSAA/Valentinebssa.GitHub.io.git companion
cd companion/deploy
```

## 3. Download a voice

Every voice on the list is female.

```sh
chmod +x download-voices.sh
./download-voices.sh                 # just the default, en_US-amy-medium (~63 MB)
```

Or take the lot (~700 MB), and pick between them later in the app:

```sh
./download-voices.sh all
```

Or name the ones you want:

```sh
./download-voices.sh en_GB-jenny_dioco-medium en_US-amy-low
```

For a snappier NAS, `en_US-amy-low` and `en_GB-southern_english_female-low` are
the two fastest.

## 4. Start it

```sh
sudo docker compose up -d --build
```

The first build takes a few minutes — it's compiling nothing, just pulling Python
and installing Piper, but the NAS is not quick about it.

Check it came up:

```sh
sudo docker compose ps
curl -s http://localhost:8080/tts/voices
```

That last command should list the voices you downloaded.

> **Prefer the DSM GUI?** Container Manager → Project → Create, point it at
> `/volume1/docker/companion/deploy`, and it will pick up `docker-compose.yml`.
> Run `download-voices.sh` over SSH first either way — Piper will restart in a
> loop if there's no model to load.

## 5. Point the app at it

Open `http://<your-nas-ip>:8080` on any device on your network.

Go to **You**:

1. **Connection** — paste your Anthropic API key, hit *Save & test*.
2. **Voice** — set the Piper server to exactly `/tts`, then hit *Connect*.
   Because nginx serves both the app and Piper, that relative path is all it
   needs. Voices you haven't downloaded show as *not installed*.
3. **Characters** — give her a name and a `.vrm` model (see below). Add as
   many characters as you like; each keeps her own voice and personality.

Then open **Voice** and tap the microphone.

---

## Character models

Voice mode renders a VRM model that blinks, breathes, and moves her mouth in time
with the actual audio coming back from Piper. You can keep several characters and
switch between them with the chip above the microphone — each has her own name,
personality, voice and model.

You supply the models. None are committed to this repository, deliberately: VRM
files embed a licence, and plenty of them forbid redistribution. Publishing one
in a public repo *is* redistribution, and this repo is served publicly by GitHub
Pages.

- **[VRoid Studio](https://vroid.com/en/studio)** — free, Windows/Mac. Make your
  own anime character and export `.vrm`. This is the easiest route, and the model
  is unambiguously yours.
- **[VRoid Hub](https://hub.vroid.com/en)** — models other people have shared.
  Check the licence on each one; many allow personal use.

Two ways to load one, per character, under *You → Characters*:

- **Drop the file in.** It's stored in this browser's IndexedDB, so it lives on
  that one device and has to be added again on each device you use.
- **Serve it from the NAS**, which is much better with more than one device and
  is the reason `characters/` exists. Put your `.vrm` files there:

  ```sh
  mkdir -p /volume1/docker/companion/characters
  cp ~/Downloads/*.vrm /volume1/docker/companion/characters/
  ```

  Then set each character's URL field to `/characters/hername.vrm`. nginx already
  serves `.vrm` with the right type and a week-long cache, and `characters/*.vrm`
  is gitignored so a `git pull` never touches them and they are never published.

**Framing**, on each character, runs from a face shot to half body. Models with
wings, tails or very long hair frame correctly — the camera measures her
skeleton, not her silhouette.

### A note on model licences

Open any `.vrm` and it carries the terms its author chose: whether it can be
redistributed, modified, or used commercially. VRoid Hub shows these on the
download page, and VRoid Studio writes them in when you export your own. Serving
a model from your own NAS on your own LAN is not redistribution; committing it to
a public repo or putting it on a public web server is. Worth a look before you
publish anything.

---

## Reaching it from outside the house

The simplest and safest answer is **don't** — use Tailscale or your NAS's VPN and
treat it as a home-only service.

If you do want it exposed, put it behind DSM's reverse proxy with a real
certificate, because two things break on plain HTTP over the open internet:

- **Microphone access requires a secure context.** Browsers only allow it on
  HTTPS or `localhost`. On `http://192.168.x.x` you'll get voice *output* but no
  voice *input*.
- Your Anthropic API key would be travelling over an unencrypted connection.

DSM → Login Portal → Advanced → Reverse Proxy, source `https://companion.yourdomain`
→ destination `http://localhost:8080`, and let DSM handle the Let's Encrypt
certificate.

---

## Using GitHub Pages with your NAS's voice

You can also leave the app on `valentinebsaa.github.io` and only run Piper at
home. Set the Piper server to the full URL — `https://companion.yourdomain/tts`.

The nginx config already sends the CORS headers this needs. It has to be
**https**, though: a page served over HTTPS is not allowed to call a plain-HTTP
server, and the request will be blocked before it's sent.

---

## Keeping it running

```sh
cd /volume1/docker/companion
git pull
sudo docker compose -f deploy/docker-compose.yml up -d --build
```

Logs, if something's wrong:

```sh
sudo docker compose -f deploy/docker-compose.yml logs -f piper
```

---

## When something doesn't work

**Piper keeps restarting.** It can't find its model. Check that
`PIPER_VOICE` in `docker-compose.yml` matches a file in `deploy/voices/` —
the name without the `.onnx`. `ls deploy/voices/` to see what you actually have.

**"Could not reach it" when you hit Connect.** Check the URL is `/tts` with no
trailing slash and no hostname. Then `curl http://localhost:8080/tts/voices` on
the NAS to see whether the problem is Piper or the browser.

**She speaks, but with a long pause first.** You're on a `high` voice. Switch to
`medium` or `low` under *You → Voice*.

**The microphone button does nothing.** Either the browser doesn't support speech
recognition (Chrome, Edge and Safari do; Firefox doesn't), or you're on plain HTTP
from another machine — see the secure-context note above.

**The character never appears.** Make sure the file really is `.vrm` and not
`.vrmodel` or a `.zip`. The browser console will name the failure. Very large
models (>100 MB) can also exceed what the browser will store — serving it from
the NAS by URL avoids that limit entirely.

**Everything is slow and DSM feels sluggish.** You're likely swapping on 2 GB.
Use one `low` voice, or add RAM.

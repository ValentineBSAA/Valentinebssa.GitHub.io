#!/usr/bin/env sh
#
# Downloads Piper voices into ./voices.
#
# Every voice here is female — that is the whole list the app offers. Amy,
# Lessac, southern_english_female and Kathleen were confirmed by measuring the
# pitch of synthesised speech; the rest come from datasets with a known female
# speaker. See assets/js/tts.js for the details.
#
#   ./download-voices.sh              # the default voice only (~63 MB)
#   ./download-voices.sh all          # every voice on the list (~700 MB)
#   ./download-voices.sh en_US-amy-medium en_GB-jenny_dioco-medium
#
# Runs with plain sh + curl, which is what a Synology NAS has.

set -eu

DIR="$(cd "$(dirname "$0")" && pwd)/voices"
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"

# id                                     path-within-the-repo
ALL="
en_US-amy-medium|en/en_US/amy/medium
en_US-amy-low|en/en_US/amy/low
en_GB-jenny_dioco-medium|en/en_GB/jenny_dioco/medium
en_GB-alba-medium|en/en_GB/alba/medium
en_GB-southern_english_female-low|en/en_GB/southern_english_female/low
en_US-lessac-medium|en/en_US/lessac/medium
en_US-lessac-high|en/en_US/lessac/high
en_US-hfc_female-medium|en/en_US/hfc_female/medium
en_US-kristin-medium|en/en_US/kristin/medium
en_US-ljspeech-high|en/en_US/ljspeech/high
en_US-kathleen-low|en/en_US/kathleen/low
"

DEFAULT="en_US-amy-medium"

lookup() {
  echo "$ALL" | while IFS='|' read -r id path; do
    [ -z "$id" ] && continue
    [ "$id" = "$1" ] && { echo "$path"; return; }
  done
}

fetch() {
  id="$1"
  path="$(lookup "$id")"
  if [ -z "$path" ]; then
    echo "  ! $id is not on the female-voice list — skipping." >&2
    return 0
  fi

  for ext in onnx onnx.json; do
    out="$DIR/$id.$ext"
    if [ -s "$out" ]; then
      echo "  = $id.$ext already here"
      continue
    fi
    echo "  > $id.$ext"
    # Download to a temp name so an interrupted run never leaves a truncated
    # model that Piper would then fail to load.
    if curl -fL --progress-bar -o "$out.part" "$BASE/$path/$id.$ext?download=true"; then
      mv "$out.part" "$out"
    else
      rm -f "$out.part"
      echo "  ! failed to download $id.$ext" >&2
      return 1
    fi
  done
}

mkdir -p "$DIR"

case "${1:-}" in
  all)
    echo "Downloading every female voice (~700 MB) into $DIR"
    echo "$ALL" | while IFS='|' read -r id _; do
      [ -z "$id" ] && continue
      fetch "$id"
    done
    ;;
  "")
    echo "Downloading the default voice into $DIR"
    fetch "$DEFAULT"
    ;;
  *)
    echo "Downloading into $DIR"
    for id in "$@"; do fetch "$id"; done
    ;;
esac

echo
echo "Installed:"
ls -1 "$DIR"/*.onnx 2>/dev/null | sed 's#.*/#  #; s#\.onnx$##' || echo "  (nothing yet)"
echo
echo "Set PIPER_VOICE in docker-compose.yml to one of these, then:"
echo "  docker compose up -d --build"

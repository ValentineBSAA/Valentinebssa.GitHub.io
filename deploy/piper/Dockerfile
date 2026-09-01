# Piper text-to-speech, exposed over HTTP.
#
# Built for linux/amd64, which is what a DS418+ (Intel Celeron J3455) runs.
# That CPU has no AVX; Piper does not need it — the same models run on a
# Raspberry Pi — but it is not fast, so prefer "low" and "medium" voices over
# "high" ones. See ../SETUP-NAS.md.
FROM python:3.11-slim-bookworm

# espeak-ng supplies the phonemiser Piper uses for English.
RUN apt-get update \
 && apt-get install -y --no-install-recommends espeak-ng curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "piper-tts==1.7.0" flask

# Voices are mounted at runtime rather than baked in, so the image stays small
# and you can add voices without rebuilding.
VOLUME /voices
ENV PIPER_VOICE=en_US-amy-medium

EXPOSE 5000

# --data-dir lets /voices hold several models; the app picks between them per
# request, so all your installed voices are selectable from Settings.
CMD ["sh", "-c", "exec python3 -m piper.http_server \
      --host 0.0.0.0 --port 5000 \
      -m /voices/${PIPER_VOICE}.onnx \
      --data-dir /voices"]

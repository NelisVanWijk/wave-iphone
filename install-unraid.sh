#!/bin/sh
set -eu
cd "$(dirname "$0")"
: "${SUBWAVE_URL:?Set SUBWAVE_URL to your SUB/WAVE server URL}"
if docker container inspect wave-iphone >/dev/null 2>&1; then
  echo 'wave-iphone bestaat al. De bestaande container is niet gewijzigd.'
  echo 'Zie README.md voor bijwerken.'
  exit 1
fi
docker pull ghcr.io/nelisvanwijk/wave-iphone:latest
docker run -d --name wave-iphone --restart unless-stopped \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --log-opt max-size=5m --log-opt max-file=2 \
  -p 7780:7780 -e SUBWAVE_URL="$SUBWAVE_URL" \
  ghcr.io/nelisvanwijk/wave-iphone:latest
echo 'WAVE is gestart. Open http://<server-ip>:7780 op je iPhone.'

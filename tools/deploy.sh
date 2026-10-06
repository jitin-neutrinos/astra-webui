#!/usr/bin/env bash
# deploy.sh — one command per astra-webui deploy (2026-10-06).
#
# WHY THIS EXISTS: threeUINT breakage classes were measured, all with the same
# shape — "the fix is in the repo but no device can see it":
#   1. CF edge pinned index.html 1y (zone catch-all) → purged via API; the
#      zone's HTML revalidate rule now re-fetches within 60s, but a PURGE is
#      still needed whenever a deploy wants old entries gone instantly
#      (e.g. an asset redirect or an emergency revert).
#   2. Android APK bundles drift from dist (the Oct-3 vs Oct-6 two-week-class
#      staleness). cap sync + gradle + telegram delivery must be part of the
#      same commit loop, otherwise the phone lags until someone remembers.
#   3. The web client self-updates via /api/build-id (commit 08586afb1d26) —
#      but only if the server process is RESTARTED to serve the new build id
#      … actually no: the id is computed lazily from git HEAD, so no restart
#      IS needed for the check; the restart below is for server/*.mjs changes.
#
# Usage:
#   tools/deploy.sh web        → build web, restart service if server code changed, purge CF
#   tools/deploy.sh android    → cap sync, gradle release, send APK to Telegram
#   tools/deploy.sh all        → both, plus purge

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-all}"
TELEGRAM_BOT="8631271551:AAHKXrC1SeBqkOyGFp2FW1PMJYY_QyUiEVE"
TELEGRAM_CHAT="8881524728"
CF_CREDS="$HOME/.config/cloudflare/credentials.env"
CF_ZONE="52a4d6a1d562826ff02bc51efd56c963"
JAVA_HOME_FOR_BUILD=/usr/lib/jvm/java-21-openjdk   # Gradle 8.14 cannot read Java 25 classfiles

say() { echo "[deploy] $*"; }

build_web() {
  say "building web bundle…"
  npm run build >/dev/null
  local stamp
  stamp=$(node -e "
    const fs=require('fs');
    const f=fs.readdirSync('dist/assets').filter(x=>x.startsWith('index-')&&x.endsWith('.js'))[0];
    const s=fs.readFileSync('dist/assets/'+f,'utf8');
    const m=s.match(/n===\`([a-f0-9]{12})\`\)/);
    console.log(m?m[1]:'?');
  ")
  say "built; client stamp: $stamp"
  echo "$stamp"
}

server_relevant() {
  # server/*.mjs changed since the last commit? then the service needs a restart
  git diff --quiet HEAD -- server/ 2>/dev/null && return 1 || return 0
}

restart_service() {
  say "restarting astra-webui.service…"
  systemctl --user restart astra-webui.service
  sleep 1
  curl -sf 127.0.0.1:3011/api/health >/dev/null && say "health: ok" || { say "HEALTH FAILED"; exit 1; }
}

purge_cf() {
  say "purging Cloudflare edge cache…"
  # shellcheck disable=SC1090
  source "$CF_CREDS"
  curl -s -X POST \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H 'content-type: application/json' \
    "https://api.cloudflare.com/client/v4/zones/$CF_ZONE/purge_cache" \
    -d '{"purge_everything":true}' | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('[deploy] purge ok:', d.get('success')) if d.get('success') else print('[deploy] PURGE FAILED:', d.get('errors'))
"
}

sync_and_apk() {
  # The APK bundles NO web assets by design (R6, android/app/build.gradle:80):
  # server.url points the WebView at the live site, so web fixes flow through
  # the tunnel as soon as the web deploy lands — the APK only needs rebuilding
  # when NATIVE code (android/app/src/main/java, plugins, config, permissions)
  # changes. Skip the whole gradle+telegram loop otherwise; say so plainly.
  if ! git diff --quiet HEAD~1 HEAD -- android/app/src/main/java android/app/src/main/AndroidManifest.xml android/app/capacitor.build.gradle android/app/src/main/assets/capacitor.config.json 2>/dev/null; then
    say "native android code changed in the last commit — rebuilding APK"
  else
    # an explicit ask ('tools/deploy.sh android') still rebuilds, but the 'all'
    # path should skip pointless 25s gradle runs that produce byte-identical APKs
    if [ "${TARGET:-all}" = "android" ]; then
      say "no staged native changes — FORCE rebuild requested"
    else
      git diff --quiet HEAD -- android/app/src/main/java 2>/dev/null || true
      say "no native android changes since last commit — APK is already current, skipping gradle"
      return 0
    fi
  fi
  say "cap sync android…"
  npx cap sync android >/dev/null
  say "gradle assembleRelease (JDK 21)…"
  # shellcheck disable=SC1090
  export $(grep 'KEYSTORE_PASSWORD' "$HOME/Work/services/astra-android/astra.keystore.env")
  (cd android && JAVA_HOME=$JAVA_HOME_FOR_BUILD ./gradlew assembleRelease -q)
  local apk="android/app/build/outputs/apk/release/app-release.apk"
  say "APK built: $(stat -c '%y %s bytes' "$apk")"
  say "sending to Telegram…"
  curl -s -F chat_id="$TELEGRAM_CHAT" \
    -F document=@"$apk" \
    -F caption="Astra Android — deploy $(date '+%d-%b %H:%M'), HEAD $(git rev-parse --short HEAD)" \
    "https://api.telegram.org/bot$TELEGRAM_BOT/sendDocument" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('[deploy] telegram ok:', d.get('ok'), d.get('result',{}).get('message_id',''))"
}

case "$TARGET" in
  web)     build_web; if server_relevant; then restart_service; fi; purge_cf ;;
  android) sync_and_apk ;;
  all)     build_web; sync_and_apk; if server_relevant; then restart_service; fi; purge_cf ;;
  *) echo "usage: tools/deploy.sh [web|android|all]"; exit 1 ;;
esac
say "done."

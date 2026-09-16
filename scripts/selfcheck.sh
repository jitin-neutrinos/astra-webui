#!/usr/bin/env bash
# astra-webui self-check: run while the service is up. Exit 0 = all pass.
set -e
BASE="${1:-http://127.0.0.1:3011}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

fail() { echo "FAIL: $1"; exit 1; }

[ "$(curl -s "$BASE/api/health")" = '{"ok":true}' ] || fail "health"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/login" \
  -H 'content-type: application/json' -d '{"password":"definitely-wrong"}')
[ "$code" = "401" ] || fail "wrong password should 401, got $code"

BODY=$(printf '{"password":"%s"}' "$ASTRA_WEBUI_PASSWORD")
curl -s -c "$JAR" -o /dev/null -X POST "$BASE/api/login" \
  -H 'content-type: application/json' -d "$BODY" || fail "good login request"
grep -q astra_session "$JAR" || fail "no session cookie set"

[ "$(curl -s -b "$JAR" "$BASE/api/me")" = '{"authenticated":true}' ] || fail "me with cookie"
[ "$(curl -s "$BASE/api/me")" = '{"authenticated":false}' ] || fail "me without cookie"

curl -s "$BASE/" | grep -q '<div id="root">' || fail "index served"


code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/hx/sessions")
[ "$code" = "401" ] || fail "hx unauth should 401, got $code"

code=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/hx/sessions")
[ "$code" = "200" ] || fail "hx sessions should 200, got $code"

code=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/hx/sessions/search?q=test")
[ "$code" = "200" ] || fail "hx search should 200, got $code"

curl -s -b "$JAR" -c "$JAR" -o /dev/null -X POST "$BASE/api/logout"
[ "$(curl -s -b "$JAR" "$BASE/api/me")" = '{"authenticated":false}' ] || fail "logout should clear session"

echo "self-check: ALL PASS ($BASE)"

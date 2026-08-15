#!/usr/bin/env bash
# M0 independence verification: two DSH entities, different versions, running
# simultaneously with isolated $DSH_HOME + ports.
#
# Usage: DSHM=http://127.0.0.1:4180 scripts/verify-m0.sh
set -euo pipefail

API="${DSHM:-http://127.0.0.1:4180}"
PASS=0
FAIL=0

check() {
  local name="$1" cond="$2"
  if eval "$cond"; then
    echo "  ✓ $name"; PASS=$((PASS + 1))
  else
    echo "  ✗ $name"; FAIL=$((FAIL + 1))
  fi
}

# read a JSON doc from stdin, eval an expression against it
j() {
  node -e '
    let d = ""; process.stdin.on("data", c => d += c).on("end", () => {
      const v = JSON.parse(d)
      const out = eval("(" + process.argv[1] + ")")
      if (out === undefined) process.exit(2)
      console.log(typeof out === "object" ? JSON.stringify(out) : out)
    })
  ' "$1"
}

req() { curl -s "$API$1"; }

echo "== health =="
HEALTH=$(req /api/health)
check "manager healthy" 'test "$(echo "$HEALTH" | j "v.ok")" = true'

echo "== entity alpha (local checkout, dev) =="
ALPHA=$(req /api/entities | j 'v.find(x => x.spec.name === "alpha")?.spec.id ?? ""')
check "alpha exists" 'test -n "$ALPHA"'

echo "== entity beta (npm 0.1.0-rc.6) =="
BETA=$(req /api/entities | j 'v.find(x => x.spec.name === "beta")?.spec.id ?? ""')
if [ -z "$BETA" ]; then
  echo "  creating beta pinned to npm 0.1.0-rc.6..."
  BETA=$(curl -s -X POST "$API/api/entities" -H 'content-type: application/json' \
    -d '{"name":"beta","version":{"source":"npm","ref":"0.1.0-rc.6"}}' \
    | j 'v.spec.id')
fi
check "beta exists" 'test -n "$BETA"'

echo "== ensure both running =="
curl -s -X POST "$API/api/entities/$ALPHA/start" >/dev/null 2>&1 || true
curl -s -X POST "$API/api/entities/$BETA/start" >/dev/null 2>&1 || true

AINFO=$(req "/api/entities/$ALPHA")
BINFO=$(req "/api/entities/$BETA")
APHASE=$(echo "$AINFO" | j 'v.status.phase')
APORT=$(echo "$AINFO" | j 'v.status.port')
AHOME=$(echo "$AINFO" | j 'v.spec.homeDir')
AVER=$(echo "$AINFO" | j 'v.spec.version.ref')
BPHASE=$(echo "$BINFO" | j 'v.status.phase')
BPORT=$(echo "$BINFO" | j 'v.status.port')
BHOME=$(echo "$BINFO" | j 'v.spec.homeDir')
BVER=$(echo "$BINFO" | j 'v.spec.version.ref')

check "alpha running (v$AVER)" 'test "$APHASE" = running'
check "beta running (v$BVER)" 'test "$BPHASE" = running'
check "versions differ" 'test "$AVER" != "$BVER"'
check "ports differ" 'test "$APORT" != "$BPORT" -a "$APORT" != null'
check "homes differ" 'test "$AHOME" != "$BHOME"'

echo "== both GUIs serve =="
AGUI=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$APORT/")
BGUI=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$BPORT/")
check "alpha GUI 200" 'test "$AGUI" = 200'
check "beta GUI 200" 'test "$BGUI" = 200'

echo "== data isolation =="
ASET="$AHOME/storages/workspace.json"
BSET="$BHOME/storages/workspace.json"
if [ -f "$ASET" ] && [ -f "$BSET" ]; then
  ISOLATED=$(node -e '
    const fs = require("fs")
    const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const b = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
    a.__m0_probe = { who: "alpha", at: Date.now() }
    fs.writeFileSync(process.argv[1], JSON.stringify(a, null, 2))
    const b2 = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
    console.log(b2.__m0_probe === undefined)
  ' "$ASET" "$BSET")
  check "settings isolated between homes" 'test "$ISOLATED" = true'
else
  check "settings files exist (both homes booted)" 'test -f "$ASET" -a -f "$BSET"'
fi

echo
echo "== result: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ] || exit 1

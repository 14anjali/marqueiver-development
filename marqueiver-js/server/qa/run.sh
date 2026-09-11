#!/usr/bin/env bash
# Every gate that must pass before a deploy. Run from marqueiver-js/server.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FE="$(cd "$ROOT/../../frontend" && pwd)"
fail=0

step () { printf '\n\033[1m%s\033[0m\n' "$1"; }

step "1/6  unit suite"
# `cd "$ROOT"` because `npm test` resolves package.json from the working
# directory, not from the script. Run from the project root it found no test
# script, printed no summary lines, and the gate reported FAILING TESTS on a
# perfectly good tree — a false alarm that is expensive precisely because it
# looks like the real thing. Every other gate already takes absolute paths.
unit_out="$(cd "$ROOT" && npm test 2>&1)"
echo "$unit_out" | grep -E '^# (tests|pass|fail|skipped)' || fail=1
echo "$unit_out" | grep -qE '^# fail 0$' || { echo "  FAILING TESTS"; fail=1; }

step "2/6  import/export integrity"
# Reports the counts AND fails on a nonzero problem count. It only printed the
# summary line before, which meant the gate could not fail — it had 25 standing
# false positives (module-local route middleware, and the checker matching its
# own import paths), so a real one would have been invisible in the noise.
# Both classes of false positive are fixed in xref.mjs; the gate can be strict.
xref_out="$(node "$ROOT/qa/xref.mjs" "$ROOT" 2>/dev/null)"
echo "$xref_out" | grep -E '^files scanned' || fail=1
echo "$xref_out" | grep -qE '^files scanned.*problems: 0$' || { echo "  CROSS-REFERENCE PROBLEMS"; fail=1; }

step "3/6  frontend/backend contract"
node "$ROOT/qa/contract.mjs" "$ROOT" "$FE" 2>/dev/null | tail -1 | tee /dev/stderr | grep -q '^PASS' || fail=1

step "4/6  auth coverage"
node "$ROOT/qa/authcover.mjs" "$ROOT" 2>/dev/null | tail -1 | tee /dev/stderr | grep -q '^PASS' || fail=1

step "5/6  frontend api client references"
node "$ROOT/qa/apiref.mjs" "$FE" 2>/dev/null | tail -1 | tee /dev/stderr | grep -q '^PASS' || fail=1

step "6/6  production payment guard"
NODE_ENV=production INTEGRATION_MODE=live DOTENV_PATH=/dev/null node --input-type=module -e "
const {assertPaymentsSafeToBoot}=await import('$ROOT/src/services/cashfree.service.js');
try { assertPaymentsSafeToBoot(); console.log('  FAIL - would boot on mock payments'); process.exit(1); }
catch { console.log('  ok - refuses to boot without Cashfree'); }
" || fail=1

printf '\n'
[ $fail -eq 0 ] && echo "ALL GATES PASS" || echo "GATES FAILED"
exit $fail
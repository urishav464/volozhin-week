#!/usr/bin/env bash
# Checks .claude/hooks/guard-bash.sh against the commands it must allow and
# block. Kept as a file (not typed on a command line) because a guard that
# inspects command lines would block its own test cases.
set -u
HOOK="$(dirname "$0")/../.claude/hooks/guard-bash.sh"
fail=0

check() { # expected-exit command
  local got
  printf '{"tool_input":{"command":%s}}' "$(printf '%s' "$2" | jq -Rs .)" | bash "$HOOK" 2>/dev/null
  got=$?
  if [ "$got" != "$1" ]; then
    echo "FAIL (want $1, got $got): $2"
    fail=1
  fi
}

P="git push"
check 0 "$P -u origin Volozin"
check 2 "$P origin main"
check 2 "$P origin HEAD:main"
check 2 "$P --force origin Volozin"
check 2 "$P -f origin Volozin"
check 0 "git add src/App.tsx docs/SETUP.he.md"
check 0 "git add -A"
check 2 "git add imports/speakers.xlsx"
check 2 "git add 'reader 2026.pdf'"
check 2 "git add data.CSV"
check 2 "git add -f imports/notes.txt"
check 0 "git commit -m 'never stage a .pdf; never $P to main'"

[ "$fail" = 0 ] && echo "guard: all cases pass"
exit "$fail"

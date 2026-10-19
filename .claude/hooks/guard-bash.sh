#!/usr/bin/env bash
# PreToolUse guard for Bash — the repo's hard rules, enforced rather than trusted.
#   1. `git push` may not target main, and may not be forced (work goes to
#      Volozin; main changes only through a pull request the user approves).
#   2. Personal-data files (last year's spreadsheets, documents, the reader)
#      may never be staged: no `git add` of *.xlsx/*.xls/*.docx/*.doc/*.pdf/*.csv,
#      and no `git add -f` (which would bypass .gitignore).
# Exit 2 blocks the call; stderr is shown to Claude as the reason.
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$cmd" ] && exit 0

# Only an INVOCATION counts: `git push` followed by whitespace or end of line.
pushargs=$(printf '%s' "$cmd" | grep -Eo 'git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push([[:space:]][^;&|]*|$)')
if [ -n "$pushargs" ]; then
  if printf '%s' "$pushargs" | grep -Eq '(^|[[:space:]:/])main([[:space:]]|$)'; then
    echo "blocked by .claude/hooks/guard-bash.sh: main changes only through a pull request — push to Volozin." >&2
    exit 2
  fi
  if printf '%s' "$pushargs" | grep -Eq -- '--force([[:space:]]|$)|(^|[[:space:]])-f([[:space:]]|$)'; then
    echo "blocked by .claude/hooks/guard-bash.sh: no force pushes." >&2
    exit 2
  fi
fi

addargs=$(printf '%s' "$cmd" | grep -Eo 'git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+add([[:space:]][^;&|]*|$)')
if [ -n "$addargs" ]; then
  if printf '%s' "$addargs" | grep -Eiq '\.(xlsx|xls|docx|doc|pdf|csv)([[:space:]"'"'"']|$)'; then
    echo "blocked by .claude/hooks/guard-bash.sh: spreadsheets, documents and PDFs carry personal data and never enter git. Import them through the app." >&2
    exit 2
  fi
  if printf '%s' "$addargs" | grep -Eq -- '(^|[[:space:]])(-f|--force)([[:space:]]|$)'; then
    echo "blocked by .claude/hooks/guard-bash.sh: no \`git add -f\` — .gitignore is what keeps personal data out." >&2
    exit 2
  fi
fi
exit 0

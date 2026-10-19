#!/usr/bin/env bash
# PreToolUse guard for Bash — the repo's hard rules, enforced rather than trusted.
#   1. `git push` may not target main and may not be forced in any spelling
#      (--force, -f, --force-with-lease, --force-if-includes, a +refspec,
#      --mirror, --all, --delete); work goes to Volozin, and main changes only
#      through a pull request the user approves.
#   2. Personal-data files (last year's spreadsheets, documents, the reader,
#      exports) may never be staged: no `git add`/`git stage` of those
#      extensions, and no forced add (which would bypass .gitignore).
# Exit 2 blocks the call; stderr is shown to Claude as the reason.
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$cmd" ] && exit 0
# A commit message is prose, not a command: drop `-m '…'` / `--message=…` first.
# Then quotes cannot hide a ref or a path: `git push origin "main"` is still main.
flat=$(printf '%s' "$cmd" \
  | sed -E "s/(-m|--message)(=|[[:space:]]+)\"[^\"]*\"//g; s/(-m|--message)(=|[[:space:]]+)'[^']*'//g" \
  | tr -d "\"'")

# An INVOCATION: `git` (with any global options, e.g. -C dir) then the verb,
# then its arguments up to the next shell separator.
GITOPTS='git([[:space:]]+-{1,2}[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*'

pushargs=$(printf '%s' "$flat" | grep -Eo "${GITOPTS}[[:space:]]+push([[:space:]][^;&|]*|$)")
if [ -n "$pushargs" ]; then
  if printf '%s' "$pushargs" | grep -Eq '(^|[[:space:]:/+])main([[:space:]]|$)'; then
    echo "blocked by .claude/hooks/guard-bash.sh: main changes only through a pull request — push to Volozin." >&2
    exit 2
  fi
  if printf '%s' "$pushargs" | grep -Eq -- '--force|(^|[[:space:]])-[a-zA-Z]*f[a-zA-Z]*([[:space:]]|$)|[[:space:]]\+[^[:space:]]|--mirror|--all|--delete|(^|[[:space:]])-d([[:space:]]|$)'; then
    echo "blocked by .claude/hooks/guard-bash.sh: no force, mirror, all-branches or delete pushes." >&2
    exit 2
  fi
fi

addargs=$(printf '%s' "$flat" | grep -Eo "${GITOPTS}[[:space:]]+(add|stage)([[:space:]][^;&|]*|$)")
if [ -n "$addargs" ]; then
  if printf '%s' "$addargs" | grep -Eiq '\.(xlsx|xls|xlsm|xlsb|ods|numbers|docx|doc|odt|pages|rtf|pdf|csv|tsv|zip)([[:space:]]|$)'; then
    echo "blocked by .claude/hooks/guard-bash.sh: spreadsheets, documents, PDFs and archives carry personal data and never enter git. Import them through the app." >&2
    exit 2
  fi
  if printf '%s' "$addargs" | grep -Eq -- '(^|[[:space:]])(-[a-zA-Z]*f[a-zA-Z]*|--force)([[:space:]]|$)'; then
    echo "blocked by .claude/hooks/guard-bash.sh: no forced add — .gitignore is what keeps personal data out." >&2
    exit 2
  fi
fi
exit 0

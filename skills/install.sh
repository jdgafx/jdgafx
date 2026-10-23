#!/bin/sh
# Install these skills for Claude Code, Codex / ChatGPT desktop, or both.
# Usage: ./install.sh [claude|codex|both] [skill ...]   (defaults: both, every skill)
set -eu
cd "$(dirname "$0")"
target="${1:-both}"; [ $# -gt 0 ] && shift
skills="${*:-$(ls -d */ | tr -d /)}"
case "$target" in
  claude) dirs="$HOME/.claude/skills" ;;
  codex)  dirs="$HOME/.agents/skills" ;;
  both)   dirs="$HOME/.claude/skills $HOME/.agents/skills" ;;
  *) echo "usage: $0 [claude|codex|both] [skill ...]" >&2; exit 2 ;;
esac
for d in $dirs; do
  for s in $skills; do
    [ -f "$s/SKILL.md" ] || { echo "no such skill: $s" >&2; exit 1; }
    mkdir -p "$d/$s" && cp -R "$s/." "$d/$s/"
    echo "installed $s -> $d/$s"
  done
done

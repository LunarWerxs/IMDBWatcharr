#!/usr/bin/env bash
#
# Adapted from mattpocock/skills skills/engineering/wizard/template.sh
# (MIT, Copyright (c) 2026 Matt Pocock). Adapted for claude-memory.
#
# A wizard walks a HUMAN through a setup step only they can do (a dashboard click, a
# credential only they hold). WHY it exists here: an agent must never read a secret value,
# so a step that needs one used to end as a to-do for the human. With a wizard the agent
# scripts the whole procedure, and the secret goes from the human's keyboard (hidden read)
# into .env or a GitHub secret (on stdin, never argv) without ever entering the agent's
# context. Skill `wizard` says how to author one.
#
# Everything above the STAGES marker is the library: identical in every wizard, never
# hand-edited. Author only the stages below the marker. The human runs the result in their
# OWN terminal; the agent never runs it (it opens browsers and blocks on input).

set -euo pipefail

# ------------------------------------------------------------------------------------------
# Wizard library
# ------------------------------------------------------------------------------------------

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""
fi

TOTAL_STAGES=0      # the author sets this at the top of the stages section
_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()      # KEY names written to ENV_FILE this run (names only, never values)
WRITTEN_SECRET=()   # GitHub secret names set this run
SKIPPED=()          # what the human still has to do by hand
_ENV_CHECKED=""
_TMP_ENV=""         # write_env's in-flight temp copy of ENV_FILE, if any

# WHY: that temp copy holds every saved secret and a `.env` ignore line does not match its
# `.env.XXXXXX` name, so Ctrl-C or a failure mid-write must not leave it behind.
_cleanup_tmp() { if [[ -n "$_TMP_ENV" ]]; then rm -f "$_TMP_ENV"; fi; }
trap _cleanup_tmp EXIT
trap 'exit 130' INT TERM   # exit so the EXIT trap runs

# _clear keeps only the current step on screen; a no-op when output is not a terminal.
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

say()  { printf '  %s\n' "$1"; }
step() { printf '  %s*%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s! %s%s\n' "$YELLOW" "$1" "$RESET"; }

# pause "msg" waits for the human to say the manual part is done.
pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

# confirm "question" is a y/N gate; put one before every irreversible step.
confirm() {
  local reply=""
  printf '  %s? %s [y/N]%s ' "$YELLOW" "$1" "$RESET"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

# banner "Title" opens the wizard: what it does and that a re-run keeps saved values.
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  note "You drive the browser; this wizard says what to do and saves what you paste."
  note "Secrets are read hidden and never printed. Ctrl-C any time; a re-run keeps saved values."
  pause "Ready to start?"
}

# stage "Name" clears the screen and shows progress.
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s> Stage %s/%s - %s%s\n' "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

# open_url URL opens it in the human's browser: Git Bash, WSL, Linux, macOS.
open_url() {
  local url="$1"
  printf '  %sopening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview      >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open     >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open         >/dev/null 2>&1; then open "$url"
    else warn "could not open a browser; visit it by hand: $url"; fi
  } >/dev/null 2>&1 || true   # explorer.exe exits 1 even when it opened the page
}

# _key_ok KEY refuses anything but a shell/env identifier, so a key is never a regex.
_key_ok() {
  [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { warn "not a valid variable name: $1"; exit 2; }
}

# _existing KEY prints KEY's current value in ENV_FILE, if any (used as the re-run default).
_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

# _read_into KEY PROMPT FLAGS reads one line into $KEY; Enter keeps the saved value.
_read_into() {
  local key="$1" prompt="$2" flags="$3" current input=""
  _key_ok "$key"
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read $flags input || true
  [[ "$flags" == *s* ]] && printf '\n'
  input="${input%$'\r'}"   # a Windows console paste can carry a trailing CR
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# ask KEY "Prompt" reads a visible (non-secret) value into $KEY.
ask()        { _read_into "$1" "$2" "-r"; }
# ask_secret KEY "Prompt" reads a value with echo off; it is never printed afterwards.
ask_secret() { _read_into "$1" "$2" "-rs"; }

# _env_guard warns once when ENV_FILE sits in a git repo that does not ignore it, because
# a secret committed to git is permanent (only revoking it at the provider undoes that).
_env_guard() {
  [[ -n "$_ENV_CHECKED" ]] && return 0
  _ENV_CHECKED=1
  command -v git >/dev/null 2>&1 || return 0
  local dir; dir=$(dirname "$ENV_FILE")   # ENV_FILE's repo, not the terminal's
  git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  git -C "$dir" check-ignore -q "$(basename "$ENV_FILE")" 2>/dev/null && return 0
  warn "$ENV_FILE is NOT gitignored here: add it to .gitignore before you commit anything"
  SKIPPED+=("add $ENV_FILE to .gitignore")
}

# _env_abs prints ENV_FILE as an absolute path, so the human sees exactly which file got
# the value (a relative .env lands wherever their terminal happens to be).
_env_abs() {
  local dir; dir=$(cd "$(dirname "$ENV_FILE")" 2>/dev/null && pwd) || dir=$(dirname "$ENV_FILE")
  printf '%s/%s' "$dir" "$(basename "$ENV_FILE")"
}

# write_env KEY VALUE upserts KEY=VALUE into ENV_FILE: one line per key however often it
# runs. The temp file sits beside ENV_FILE (same drive, so mv is a rename) and is created
# owner-only.
write_env() {
  local key="$1" value="$2" rc=0
  _key_ok "$key"
  _env_guard
  if [[ -z "$value" ]]; then
    SKIPPED+=("$key (left empty)"); warn "skipped $key: no value given"; return 0
  fi
  [[ -f "$ENV_FILE" ]] || (umask 077; : > "$ENV_FILE")
  _TMP_ENV=$(umask 077; mktemp "${ENV_FILE}.XXXXXX")
  # grep exits 1 when no other line survives (fine); 2 is a read error, and mv would then
  # replace ENV_FILE with this one key and lose every other saved value.
  grep -vE "^${key}=" "$ENV_FILE" > "$_TMP_ENV" || rc=$?
  if (( rc > 1 )); then warn "could not read $ENV_FILE; left it unchanged"; exit 1; fi
  printf '%s=%s\n' "$key" "$value" >> "$_TMP_ENV"
  mv "$_TMP_ENV" "$ENV_FILE"
  _TMP_ENV=""
  WRITTEN_ENV+=("$key")
  printf '  %swrote%s %s -> %s\n' "$GREEN" "$RESET" "$key" "$(_env_abs)"
}

# _gh_ready: gh installed and signed in.
_gh_ready() { command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; }

# set_secret NAME VALUE sets a GitHub Actions secret. The value goes in on STDIN, never as
# an argument, so it never shows in a process list or a shell trace.
set_secret() {
  local name="$1" value="$2"
  if [[ -n "$value" ]] && _gh_ready && printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
    WRITTEN_SECRET+=("$name")
    printf '  %sset%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
    return 0
  fi
  SKIPPED+=("GitHub secret $name (gh secret set $name)")
  warn "skipped GitHub secret $name: gh not ready or no value; set it later"
}

# set_var NAME VALUE sets a GitHub Actions variable (non-secret, so --body is fine).
set_var() {
  local name="$1" value="$2"
  if _gh_ready && gh variable set "$name" --body "$value" >/dev/null 2>&1; then
    printf '  %sset%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
    return 0
  fi
  SKIPPED+=("GitHub variable $name")
  warn "skipped GitHub variable $name: gh not ready; set it later"
}

# finish prints what was written or skipped, by NAME only: the agent may read this summary.
finish() {
  _clear
  printf '\n%s%s  Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  if (( ${#WRITTEN_ENV[@]} )); then note "wrote ${#WRITTEN_ENV[@]} value(s) to $(_env_abs): ${WRITTEN_ENV[*]}"; fi
  if (( ${#WRITTEN_SECRET[@]} )); then note "set ${#WRITTEN_SECRET[@]} GitHub secret(s): ${WRITTEN_SECRET[*]}"; fi
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "still to do by hand:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# STAGES: one Cloudflare API token that lets GitHub Actions deploy BOTH Cloudflare-hosted
# LunarWerx sites on every push to main:
#   LunarWerxs/IMDBWatcharr  (.github/workflows/deploy-worker.yml, `wrangler deploy`)
#   LunarWerxs/VectorMojo    (.github/workflows/ci.yml deploy job, `wrangler pages deploy`)
# Both repos already hold CLOUDFLARE_ACCOUNT_ID; only CLOUDFLARE_API_TOKEN is missing or dead.
#
# Do NOT paste wrangler's own login token (`wrangler auth token`) instead: it is an OAuth
# access token that expires in about an hour. That is what happened on 2026-09-20: the
# secret was set, one deploy passed a second later, and every run since failed with
# `Invalid access token [code: 9109]`.
#
# Run from anywhere:  bash "D:/PublicProjects/imdbwatch/scripts/setup-deploy-token.sh"

TOTAL_STAGES=3
ENV_FILE="${ENV_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env}"   # this repo's; nothing is written to it

CF_ACCOUNT=36d7c731fd0352ef08ea7e46d2d20793   # Lunawerx@gmail.com's Account (not a secret)
REPOS=(LunarWerxs/IMDBWatcharr LunarWerxs/VectorMojo)

# cf_code PATH prints the HTTP status of a GET with the pasted token. The header goes to
# curl on stdin (-H @-), so the token never appears in a process list.
cf_code() {
  printf 'Authorization: Bearer %s\n' "$CLOUDFLARE_API_TOKEN" |
    curl -s -o /dev/null -w '%{http_code}' -H @- "https://api.cloudflare.com/client/v4$1" || true
}

# set_repo_secret REPO NAME VALUE is set_secret for a named repo, value on stdin.
set_repo_secret() {
  if [[ -n "$3" ]] && _gh_ready && printf '%s' "$3" | gh secret set "$2" -R "$1" >/dev/null 2>&1; then
    WRITTEN_SECRET+=("$1:$2")
    printf '  %sset%s %s in %s\n' "$GREEN" "$RESET" "$2" "$1"
    return 0
  fi
  SKIPPED+=("GitHub secret $2 in $1 (gh secret set $2 -R $1)")
  warn "skipped $2 in $1: gh not ready or no value"
}

banner "Cloudflare deploy token: Watcharr + VectorMojo"

stage "Cloudflare: create one deploy token"
say "Both sites deploy from GitHub on every push, and that needs one Cloudflare API token."
open_url "https://dash.cloudflare.com/profile/api-tokens"
step "Click 'Create Token', then 'Use template' on the 'Edit Cloudflare Workers' row."
step "Under Permissions click '+ Add more' and add:  Account | D1 | Edit"
step "and once more:                                 Account | Cloudflare Pages | Edit   (VectorMojo deploys to Pages)"
step "Account Resources:  Include | Lunawerx@gmail.com's Account"
step "Zone Resources:     Include | Specific zone | lunarwerx.com"
step "Continue to summary, Create Token, then click Copy."
while :; do
  ask_secret CLOUDFLARE_API_TOKEN "Paste the token:"
  w=$(cf_code "/accounts/$CF_ACCOUNT/workers/scripts")
  p=$(cf_code "/accounts/$CF_ACCOUNT/pages/projects/vectormojo")
  d=$(cf_code "/accounts/$CF_ACCOUNT/d1/database")
  if [[ "$w$p$d" == "200200200" ]]; then
    printf '  %sok%s the token reaches Workers, Pages and D1 on the LunarWerx account\n' "$GREEN" "$RESET"
    break
  fi
  warn "that token is missing something (workers=$w pages=$p d1=$d; each should be 200, 000 means no connection)"
  confirm "Paste a different token?" || { SKIPPED+=("a working CLOUDFLARE_API_TOKEN"); finish; exit 1; }
done

stage "GitHub: store it in both repos"
say "The token goes to GitHub on stdin; it is never printed."
for repo in "${REPOS[@]}"; do set_repo_secret "$repo" CLOUDFLARE_API_TOKEN "$CLOUDFLARE_API_TOKEN"; done

stage "Deploy both sites now"
say "Re-running each deploy so what is already on main goes live without waiting for a push."
gh workflow run deploy-worker.yml -R LunarWerxs/IMDBWatcharr --ref main >/dev/null 2>&1 \
  || SKIPPED+=("start Watcharr's deploy: gh workflow run deploy-worker.yml -R LunarWerxs/IMDBWatcharr")
vm_run=$(gh run list -R LunarWerxs/VectorMojo -w CI -b main -L 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
[[ -n "$vm_run" ]] && gh run rerun "$vm_run" -R LunarWerxs/VectorMojo >/dev/null 2>&1 \
  || SKIPPED+=("re-run VectorMojo's CI on main")
sleep 8
wa_run=$(gh run list -R LunarWerxs/IMDBWatcharr -w "Deploy Worker" -L 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
for pair in "IMDBWatcharr:$wa_run" "VectorMojo:$vm_run"; do
  name=${pair%%:*}; id=${pair#*:}
  [[ -n "$id" ]] || continue
  note "watching $name's run $id ..."
  if gh run watch "$id" -R "LunarWerxs/$name" --exit-status >/dev/null 2>&1; then
    printf '  %sdeployed%s %s\n' "$GREEN" "$RESET" "$name"
  else
    SKIPPED+=("$name's deploy failed: gh run view $id -R LunarWerxs/$name --log-failed")
  fi
done

finish

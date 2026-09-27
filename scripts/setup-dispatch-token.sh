#!/usr/bin/env bash
# Give the Worker GITHUB_DISPATCH_TOKEN, so a pasted list fills in about a
# minute instead of on the next scheduled sync (roughly fifteen minutes).
#
# Optional: without the token every list is still read, just on the schedule.
# Run it from the repository root on a machine signed in with `wrangler login`.
# The token is read without echo, checked against GitHub, handed to wrangler on
# stdin, and never printed or written to disk.
set -euo pipefail

REPO="LunarWerxs/IMDBWatcharr"
WORKFLOW="sync-feeds.yml"
export CLOUDFLARE_ACCOUNT_ID="36d7c731fd0352ef08ea7e46d2d20793"
PAT_URL="https://github.com/settings/personal-access-tokens/new?name=IMDb%20Watcharr%20sync%20dispatch&description=Lets%20the%20watcharr.lunarwerx.com%20Worker%20start%20the%20sync-feeds%20workflow&target_name=LunarWerxs&expires_in=none&actions=write"

cat <<EOF
1. A GitHub page opens for a new fine-grained token. Check that it has:
     Resource owner:     LunarWerxs
     Repository access:  Only select repositories -> IMDBWatcharr
     Permissions:        Actions -> Read and write (nothing else)
   then press Generate token and copy it.
2. Paste it here. Nothing shows while you paste.
EOF

if command -v cmd.exe >/dev/null 2>&1; then
  cmd.exe /c start "" "$PAT_URL" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "$PAT_URL" || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$PAT_URL" >/dev/null 2>&1 || true
fi
echo "   (if nothing opened: $PAT_URL)"

read -rsp "Token: " TOKEN
echo
if [ -z "$TOKEN" ]; then
  echo "No token pasted; nothing changed."
  exit 1
fi

# The real check: ask for a queue-only sync run, exactly what the Worker will do.
status=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/actions/workflows/$WORKFLOW/dispatches" \
  -d '{"ref":"main","inputs":{"scope":"requested"}}')
if [ "$status" != "204" ]; then
  echo "GitHub answered $status to a test dispatch (000 means no connection). Check the token's repository and its Actions permission, then run this again."
  exit 1
fi
echo "GitHub accepted a test dispatch."

printf '%s' "$TOKEN" | npx wrangler secret put GITHUB_DISPATCH_TOKEN >/dev/null
unset TOKEN
echo "GITHUB_DISPATCH_TOKEN is set on the Worker. New lists now fill in about a minute."

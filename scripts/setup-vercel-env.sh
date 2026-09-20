#!/bin/sh
# One-time wiring of the deployment's secrets. Run by a person, not an agent:
# the values go from your machine straight to Vercel and are never printed.
#
#   - DATABASE_URL (Production + Preview): Neon's pooled connection string
#   - BETTER_AUTH_SECRET (Preview): a fresh random signing secret
#
# Needs `npx vercel login`, `npx vercel link` and `npx neonctl auth` done once.
set -eu
cd "$(dirname "$0")/.."

NEON_PROJECT="${NEON_PROJECT:-broad-tree-20089008}"

# Fetch first, then hand over: the Vercel CLI stops waiting for piped input
# before neonctl (a few seconds) has answered.
URL=$(npx --yes neonctl connection-string --project-id "$NEON_PROJECT" --pooled)
case "$URL" in
  postgres://* | postgresql://*) ;;
  *)
    echo "Neon didn't return a connection string. Run: npx neonctl auth" >&2
    exit 1
    ;;
esac

printf %s "$URL" | npx vercel env add DATABASE_URL production --force --yes --type secret
printf %s "$URL" | npx vercel env add DATABASE_URL preview --force --yes --type secret
unset URL

openssl rand -base64 32 | tr -d '\n' |
  npx vercel env add BETTER_AUTH_SECRET preview --force --yes --type secret

echo
echo "Set on the project (names only):"
npx vercel env ls 2>/dev/null | grep -E "^ name|DATABASE_URL|BETTER_AUTH_SECRET|CRON_SECRET"

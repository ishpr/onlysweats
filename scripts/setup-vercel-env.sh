#!/bin/sh
# One-time wiring of the deployment's secrets. Run by a person, not an agent:
# the values go from your machine straight to Vercel and are never printed.
#
#   - DATABASE_URL (Production + Preview): distinct Neon branch connection strings
#   - BETTER_AUTH_SECRET (Preview): a fresh random signing secret
#
# Set NEON_PRODUCTION_BRANCH and NEON_PREVIEW_BRANCH to existing branch ids or
# names. Provision an empty/schema-only preview branch before running this;
# copying production rows into previews also exposes personal data.
# Needs `npx vercel login`, `npx vercel link` and `npx neonctl auth` done once.
set -eu
cd "$(dirname "$0")/.."

NEON_PROJECT="${NEON_PROJECT:-broad-tree-20089008}"
: "${NEON_PRODUCTION_BRANCH:?Set the production Neon branch id or name}"
: "${NEON_PREVIEW_BRANCH:?Set a separate preview Neon branch id or name}"
if [ "$NEON_PRODUCTION_BRANCH" = "$NEON_PREVIEW_BRANCH" ]; then
  echo "Production and preview must use separate Neon branches." >&2
  exit 1
fi

# Fetch first, then hand over: the Vercel CLI stops waiting for piped input
# before neonctl (a few seconds) has answered.
PRODUCTION_URL=$(npx --yes neonctl connection-string "$NEON_PRODUCTION_BRANCH" --project-id "$NEON_PROJECT" --pooled)
PREVIEW_URL=$(npx --yes neonctl connection-string "$NEON_PREVIEW_BRANCH" --project-id "$NEON_PROJECT" --pooled)
# Compare destinations, not passwords or role names: aliases can identify the
# same branch, and pooled/direct URLs can target the same Neon endpoint. Keep
# secrets off the command line and never print them.
PRODUCTION_URL="$PRODUCTION_URL" PREVIEW_URL="$PREVIEW_URL" node --input-type=module <<'JS'
const destination = (raw) => {
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
  return `${url.hostname.replace(/-pooler(?=\.)/, '')}:${url.port || '5432'}`;
};
try {
  if (destination(process.env.PRODUCTION_URL) === destination(process.env.PREVIEW_URL)) {
    console.error('Production and preview resolved to the same database endpoint. Refusing to update Vercel.');
    process.exit(1);
  }
} catch {
  console.error('Neon did not return valid Postgres URLs. No Vercel settings changed.');
  process.exit(1);
}
JS

printf %s "$PRODUCTION_URL" | npx vercel env add DATABASE_URL production --force --yes --type secret
printf %s "$PREVIEW_URL" | npx vercel env add DATABASE_URL preview --force --yes --type secret
unset PRODUCTION_URL PREVIEW_URL

openssl rand -base64 32 | tr -d '\n' |
  npx vercel env add BETTER_AUTH_SECRET preview --force --yes --type secret

echo
echo "Set on the project (names only):"
npx vercel env ls 2>/dev/null | grep -E "^ name|DATABASE_URL|BETTER_AUTH_SECRET|CRON_SECRET"

#!/bin/sh
# Builds the trial entity in a preview instance started with Docker Compose.
#
# The command runs from this checkout, not inside the image, so the stack has
# to publish its database on localhost. deploy/staging/compose.staging.yaml
# does that; docs/extension/PREVIEW-DEPLOY.md starts the preview with it.
#
#   sh deploy/extension/seed-trial-entity.sh [--password <value>]
#
# It reads the database password and the sign-in secret from the secrets the
# lifecycle helper generated, and passes its arguments to `pnpm ext:seed`.
set -eu

cd "$(dirname "$0")/../.."
REPO="$(pwd)"
SECRETS="$REPO/deploy/docker/secrets"

: "${OPENOKR_STAGING_DB_PORT:=55434}"

fail() { echo "seed-trial-entity: $1" >&2; exit 1; }

command -v pnpm >/dev/null 2>&1 \
  || fail "pnpm is not installed. The seed runs from this checkout. Run corepack enable, then pnpm install."

if [ -f "$REPO/.env" ]; then
  fail "This checkout has a .env. Remove it: the command would read its DATABASE_URL instead of the preview container's."
fi

[ -f "$SECRETS/db.env" ] && [ -f "$SECRETS/app.env" ] \
  || fail "No secrets in $SECRETS. Start the stack with deploy/docker/openokr up first."

secret() {
  grep "^$2=" "$SECRETS/$1" | cut -d= -f2-
}

db_password="$(secret db.env POSTGRES_PASSWORD)"
[ -n "$db_password" ] || fail "could not read POSTGRES_PASSWORD from db.env"

DATABASE_URL="postgres://openokr:$db_password@127.0.0.1:$OPENOKR_STAGING_DB_PORT/openokr"
BETTER_AUTH_URL="$(secret app.env BETTER_AUTH_URL)"
BETTER_AUTH_SECRET="$(secret app.env BETTER_AUTH_SECRET)"
export DATABASE_URL BETTER_AUTH_URL BETTER_AUTH_SECRET

[ -n "$BETTER_AUTH_URL" ] && [ -n "$BETTER_AUTH_SECRET" ] \
  || fail "could not read BETTER_AUTH_URL and BETTER_AUTH_SECRET from app.env"

pnpm ext:seed "$@"

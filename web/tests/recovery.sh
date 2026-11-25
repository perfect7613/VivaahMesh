#!/usr/bin/env bash
# Run after npm ci in web. Put PostgreSQL 17 tools and PostgREST 14 on PATH.
# The test creates its own database on a private socket and a loopback API.
set -euo pipefail

web_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/vivaahmesh-recovery.XXXXXX")
jwt_secret="disposable-local-recovery-fixture-key"
api_pid=""
cleanup() {
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  pg_ctl -D "$work/db" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT

initdb -D "$work/db" -U postgres -A trust --no-locale -E UTF8 >/dev/null
pg_ctl -D "$work/db" -l "$work/postgres.log" -o "-h '' -k '$work' -p 5432" -w start >/dev/null
sql() {
  psql -X -v ON_ERROR_STOP=1 -h "$work" -p 5432 -U postgres -d postgres "$@"
}
sql -q <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant anon, service_role to postgres;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant execute on functions to service_role;
SQL
for migration in "$web_dir"/../supabase/migrations/*.sql; do
  sql -q < "$migration"
done
for fixture in "$web_dir"/tests/fixtures/*.sql; do
  sql -q -f "$fixture"
done

port=$(node -e '
  const server = require("node:net").createServer();
  server.listen(0, "127.0.0.1", () => {
    console.log(server.address().port);
    server.close();
  });
')
export PGRST_DB_URI="host='$work' port=5432 dbname=postgres user=postgres"
export PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$jwt_secret"
export PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT="$port"
postgrest >"$work/postgrest.log" 2>&1 &
api_pid=$!
endpoint="http://127.0.0.1:$port"
for ((i = 0; i < 20; i++)); do
  if curl -fsS "$endpoint/" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$api_pid" 2>/dev/null; then break; fi
  sleep 1
done
curl -fsS "$endpoint/" >/dev/null || { cat "$work/postgrest.log"; exit 1; }

token=$(node -e '
  const { createHmac } = require("node:crypto");
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = [encode({ alg: "HS256", typ: "JWT" }), encode({ role: "service_role" })].join(".");
  console.log(payload + "." + createHmac("sha256", process.argv[1]).update(payload).digest("base64url"));
' "$jwt_secret")
cd "$web_dir"
NEXT_PUBLIC_SUPABASE_URL="$endpoint" SUPABASE_SERVICE_ROLE_KEY="$token" \
  ./node_modules/.bin/vitest run --config tests/recovery.config.mts

#!/usr/bin/env bash
set -euo pipefail

image=${1:?Usage: bash scripts/test-image.sh IMAGE}
name="meal-prep-smoke-${RANDOM}-$$"
volume="${name}-data"
cleanup() {
  result=$?
  if (( result != 0 )); then podman logs "$name" >&2 || true; fi
  podman rm --force "$name" >/dev/null 2>&1 || true
  podman volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
podman volume create "$volume" >/dev/null
podman run --detach --name "$name" \
  --volume "$volume:/data" \
  --env BETTER_AUTH_URL=https://meals.example.test \
  --env ORIGIN=https://meals.example.test \
  --env BETTER_AUTH_SECRET=image-smoke-test-only-not-a-production-secret \
  --env MAIL_DELIVERY=smtp \
  --env SMTP_HOST=smtp.example.test \
  --env MAIL_FROM=login@example.test \
  "$image" >/dev/null

# No host ports or real SMTP account are needed. Exercise the actual production server.
podman exec -i "$name" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
assert.notEqual(process.getuid(), 0, 'Runtime must not run as root');
assert.equal(process.env.NODE_ENV, 'production');
const origin = 'http://127.0.0.1:3000';
let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    const response = await fetch(`${origin}/sign-in`);
    if (response.ok && (await response.text()).includes('Meal Prep')) { ready = true; break; }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert.ok(ready, 'Production sign-in page must respond');
assert.equal((await fetch(`${origin}/api/plan`)).status, 401);
assert.equal((await fetch(`${origin}/api/dev/inbox`)).status, 404);
assert.equal((await fetch(`${origin}/images/brand/cat-chef.svg`)).status, 200);
assert.ok(existsSync('/data/accounts.sqlite'), 'Auth database must initialize on mounted storage');
const db = new DatabaseSync('/data/accounts.sqlite');
assert.ok(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n > 0);
db.exec('CREATE TABLE image_smoke (value TEXT); INSERT INTO image_smoke VALUES (\'persisted\')');
db.close();
console.log('Production routes, assets, authentication, and non-root SQLite writes passed.');
JS
podman restart "$name" >/dev/null
podman exec "$name" node --input-type=module -e '
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/data/accounts.sqlite");
assert.equal(db.prepare("SELECT value FROM image_smoke").get().value, "persisted");
db.close();
console.log("Data survives a container restart.");
'

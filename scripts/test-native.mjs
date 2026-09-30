import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const archive = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Usage: node scripts/test-native.mjs ARCHIVE');
const scratch = mkdtempSync(join(tmpdir(), 'meal-prep-native-'));
let child;
let logs = '';
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timeout);
}
try {
  execFileSync('tar', ['-xzf', archive, '-C', scratch]);
  const app = join(scratch, readdirSync(scratch)[0]);
  for (const file of [
    'build/index.js',
    'node_modules',
    'LICENSE',
    'REVISION',
    'deploy/native/meal-prep.service'
  ]) {
    assert.ok(existsSync(join(app, file)), `Archive missing ${file}`);
  }
  assert.ok(!existsSync(join(app, 'node_modules/vite')), 'Build tools must not ship');
  const state = join(scratch, 'state');
  for (let run = 0; run < 2; run++) {
    logs = '';
    child = spawn(process.execPath, ['build'], {
      cwd: app,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '0',
        MEAL_PREP_DB_PATH: join(state, 'meal-prep.sqlite'),
        ORIGIN: 'https://meals.example.test',
        BETTER_AUTH_SECRET: 'native-smoke-test-only-not-a-production-secret',
        MAIL_DELIVERY: 'smtp',
        SMTP_HOST: 'smtp.example.test',
        MAIL_FROM: 'login@example.test'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (data) => {
      logs += data;
    });
    child.stderr.on('data', (data) => {
      logs += data;
    });
    let origin;
    for (let attempt = 0; attempt < 100; attempt++) {
      origin = logs.match(/Listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (origin) break;
      assert.equal(child.exitCode, null, logs);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(origin, `Server did not start: ${logs}`);
    const request = (path) => fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5000) });
    const response = await request('/sign-in');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Meal Prep/);
    assert.equal((await request('/api/plan')).status, 401);
    const session = await request('/api/auth/get-session');
    assert.equal(session.status, 200);
    assert.equal(await session.json(), null);
    assert.doesNotMatch(logs, /Database schema mismatch|Could not validate the database schema/);
    assert.equal((await request('/api/dev/inbox')).status, 404);
    assert.equal((await request('/images/brand/cat-chef.svg')).status, 200);
    const db = new DatabaseSync(join(state, 'accounts.sqlite'));
    if (run === 0)
      db.exec(
        "CREATE TABLE native_smoke (value TEXT); INSERT INTO native_smoke VALUES ('persisted')"
      );
    else assert.equal(db.prepare('SELECT value FROM native_smoke').get().value, 'persisted');
    db.close();
    await stop();
  }
  console.log(
    'Extracted archive: startup, routes, assets, SQLite writes, and restart persistence passed.'
  );
} finally {
  await stop();
  rmSync(scratch, { recursive: true, force: true });
}

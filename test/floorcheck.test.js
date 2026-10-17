import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFloorCheck, summary } from '../src/floorcheck.js';

const quiet = { log() {}, warn() {}, error() {} };
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('calls the website\'s floor check with the bearer secret', async () => {
  const seen = [];
  const f = createFloorCheck({ websiteUrl: 'https://locas.example', cronSecret: 's'.repeat(32), log: quiet, fetch: async (url, init) => { seen.push([url, init.headers.Authorization]); return reply(200, { opened: 1, readings: [], finalized: [] }); } });
  assert.equal((await f.run()).ok, true);
  assert.deepEqual(seen, [['https://locas.example/api/cron/protection', `Bearer ${'s'.repeat(32)}`]]);
});

test('a project that closed below triggers the notices at once; above does not', async () => {
  let triggered = 0;
  const run = (finalized) => createFloorCheck({ websiteUrl: 'https://x', cronSecret: 's'.repeat(32), log: quiet, onFinalized: () => triggered++, fetch: async () => reply(200, { finalized }) }).run();
  await run([{ project: 'A', status: 'above' }]);
  assert.equal(triggered, 0);
  await run([{ project: 'B', status: 'below' }]);
  assert.equal(triggered, 1);
});

test('a wrong secret or a down website is logged, never thrown; runs never overlap', async () => {
  const errors = [];
  const log = { ...quiet, error: (m) => errors.push(m) };
  assert.equal((await createFloorCheck({ websiteUrl: 'https://x', cronSecret: 's'.repeat(32), log, fetch: async () => reply(401, {}) }).run()).ok, false);
  assert.match(errors[0], /401: CRON_SECRET is not the website's value/);
  assert.equal((await createFloorCheck({ websiteUrl: 'https://x', cronSecret: 's'.repeat(32), log, fetch: async () => { throw new Error('ECONNREFUSED'); } }).run()).ok, false);
  assert.match(errors[1], /could not reach the website: ECONNREFUSED/);
  let calls = 0, release;
  const slow = createFloorCheck({ websiteUrl: 'https://x', cronSecret: 's'.repeat(32), log, fetch: () => { calls++; return new Promise((r) => { release = () => r(reply(200, {})); }); } });
  const a = slow.run(), b = slow.run();
  assert.equal(a, b);
  release();
  await a;
  assert.equal(calls, 1);
});

test('the log line says what happened', () => {
  assert.equal(
    summary({ opened: 1, readings: [{ project: 'A', outcome: 'ok' }, { project: 'B', outcome: 'error', error: 'OpenSea answered 503' }], finalized: [{ project: 'C', status: 'below' }] }),
    '1 window(s) opened · 2 reading(s) · C: below · errors: B: OpenSea answered 503'
  );
});

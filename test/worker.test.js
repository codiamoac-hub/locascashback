import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNoticeWorker, workerId } from '../src/worker.js';
import { deliver, NO_ACCESS } from '../src/deliver.js';
import { discordError, fakeDiscord, notice, paidNotice } from './fakes.js';

const quiet = { log() {}, warn() {}, error() {} };

/* The outbox as the database runs it: claim leases pending notices, done
   records them; a notice whose outcome was never recorded comes back. */
function fakeOutbox(notices, { failDone = 0 } = {}) {
  const rows = notices.map((n) => ({ ...n, state: 'pending' }));
  const recorded = [];
  let doneFailures = failDone;
  return {
    rows,
    recorded,
    calls: { claim: 0 },
    async claim() {
      this.calls.claim++;
      return rows.filter((r) => r.state === 'pending').map(({ state, ...n }) => n);
    },
    async done(_worker, id, kind, result) {
      if (doneFailures-- > 0) throw new Error('Supabase did not answer');
      const row = rows.find((r) => r.cashback_id === id && r.kind === kind);
      row.state = result.skipped ? 'skipped' : result.done ? 'done' : 'pending';
      if (result.channel_message_id) row.channel_message_id = result.channel_message_id;
      if (result.dm_state) row.dm_state = result.dm_state;
      recorded.push([kind, result]);
      return true;
    },
  };
}

test('safe to restart: recording fails after posting, the next tick finds the message and records it, one post in total', async () => {
  const discord = fakeDiscord();
  const outbox = fakeOutbox([notice()], { failDone: 1 });
  const w = createNoticeWorker({ rpc: outbox, worker: 'w1', log: quiet, deliverOne: (n) => deliver(n, { discord, site: 'https://locas.example', adminIds: [] }) });
  assert.deepEqual(await w.tick(), { claimed: 1, posted: 1 });
  assert.equal(outbox.rows[0].state, 'pending', 'not recorded');
  await w.tick();
  assert.equal(outbox.rows[0].state, 'done');
  assert.equal(discord.calls.post, 1, 'never posted twice');
  assert.equal(outbox.rows[0].channel_message_id, discord.ticket[0].id);
});

test('a failure is recorded as "retry later" with its reason, and the rest of the batch still goes out', async () => {
  const discord = fakeDiscord({ postError: discordError(50013, 'Missing Permissions') });
  const ok = fakeDiscord();
  const outbox = fakeOutbox([notice(), paidNotice({ cashback_id: '8e2f0a1b-2c3d-4e5f-9b4e-4c1d7d1f3c2a' })]);
  const w = createNoticeWorker({ rpc: outbox, worker: 'w1', log: quiet, deliverOne: (n) => deliver(n, { discord: n.kind === 'paid' ? ok : discord, site: 'https://locas.example', adminIds: [] }) });
  assert.deepEqual(await w.tick(), { claimed: 2, posted: 1 });
  assert.deepEqual(outbox.recorded[0], ['eligible', { done: false, error: NO_ACCESS }]);
  assert.equal(outbox.recorded[1][1].done, true);
});

test('never two ticks at once', async () => {
  let release;
  const outbox = { claim: () => new Promise((r) => { release = () => r([]); }), done: async () => true };
  const w = createNoticeWorker({ rpc: outbox, worker: 'w1', log: quiet, deliverOne: async () => ({ done: true }) });
  const a = w.tick(), b = w.tick();
  assert.equal(a, b, 'the second call joins the first');
  release();
  await a;
});

test('a claim failure is logged and the bot keeps running', async () => {
  const errors = [];
  const w = createNoticeWorker({ rpc: { claim: async () => { throw new Error('Supabase did not answer'); } }, worker: 'w1', log: { ...quiet, error: (m) => errors.push(m) }, deliverOne: async () => ({}) });
  assert.deepEqual(await w.tick(), { claimed: 0, posted: 0 });
  assert.match(errors[0], /claim failed: Supabase did not answer/);
});

test('worker ids are unique per process and fit the database rule', () => {
  assert.match(workerId(), /^[A-Za-z0-9_.:-]{1,64}$/);
  assert.ok(workerId().endsWith(`-${process.pid}`));
});

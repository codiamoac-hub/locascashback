import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliver, NO_ACCESS } from '../src/deliver.js';
import { discordError, fakeDiscord, notice, paidNotice } from './fakes.js';

const ctx = (discord) => ({ discord, site: 'https://locas.example', adminIds: ['111111111111111111'] });

test('eligible, buyer can see the ticket: posted once in the ticket, no DM', async () => {
  const d = fakeDiscord();
  const r = await deliver(notice(), ctx(d));
  assert.deepEqual(r, { done: true, channel_message_id: d.ticket[0].id, dm_state: 'not_needed', dm_message_id: null, error: null });
  assert.equal(d.calls.post, 1); assert.equal(d.calls.dm, 0);
  assert.equal(d.ticket[0].payload.enforceNonce, true, 'Discord drops a duplicate from an overlapping replica');
  assert.match(d.ticket[0].payload.content, /<@402914829112836096>.*\n-# <@111111111111111111>/);
});

test('a restart between posting and recording never posts twice', async () => {
  const d = fakeDiscord();
  const first = await deliver(notice(), ctx(d));
  // The outcome was never recorded: the notice comes back exactly as before.
  const again = await deliver(notice(), ctx(d));
  assert.equal(d.calls.post, 1, 'one message in the ticket');
  assert.equal(again.channel_message_id, first.channel_message_id, 'the earlier message is found and recorded');
});

test('eligible, buyer can no longer see the ticket: still posted there for the admins, and the same card by DM', async () => {
  const d = fakeDiscord({ access: { state: 'ok', buyerCanSee: false } });
  const r = await deliver(notice(), ctx(d));
  assert.equal(r.done, true); assert.equal(r.dm_state, 'sent');
  assert.equal(d.calls.post, 1); assert.equal(d.calls.dm, 1);
  assert.deepEqual(d.dmBox[0].payload.allowedMentions, { parse: [] }, 'the DM pings nobody');
  await deliver(notice({ channel_message_id: r.channel_message_id }), ctx(d));
  assert.equal(d.calls.post, 1); assert.equal(d.calls.dm, 1, 'a DM already sent is found, not resent');
});

test('eligible: DMs closed is recorded and the notice is finished; any other DM failure keeps the ticket post and retries the DM only', async () => {
  const closed = fakeDiscord({ access: { state: 'ok', buyerCanSee: false }, dmError: discordError(50007) });
  const r = await deliver(notice(), ctx(closed));
  assert.deepEqual([r.done, r.dm_state, r.error], [true, 'failed', 'The buyer does not accept DMs from the server.']);
  const flaky = fakeDiscord({ access: { state: 'ok', buyerCanSee: false }, dmError: discordError(0, 'socket hang up') });
  const f = await deliver(notice(), ctx(flaky));
  assert.equal(f.done, false); assert.ok(f.channel_message_id, 'the ticket post is kept'); assert.match(f.error, /DM to the buyer failed: socket hang up/);
});

test('eligible: ticket deleted → the buyer gets it by DM; if DMs are closed too, it is skipped with the reason', async () => {
  const d = fakeDiscord({ access: { state: 'gone' } });
  const r = await deliver(notice(), ctx(d));
  assert.deepEqual([r.done, r.dm_state, d.calls.post], [true, 'sent', 0]);
  const both = await deliver(notice(), ctx(fakeDiscord({ access: { state: 'gone' }, dmError: discordError(50007) })));
  assert.deepEqual([both.skipped, both.error], [true, 'The deal ticket no longer exists and the buyer does not accept DMs.']);
});

test('the bot cannot open the ticket: nothing is posted anywhere, retried later with the fix in plain words', async () => {
  const d = fakeDiscord({ access: { state: 'no_access', error: NO_ACCESS } });
  const r = await deliver(notice(), ctx(d));
  assert.deepEqual(r, { done: false, error: NO_ACCESS });
  assert.equal(d.calls.post + d.calls.dm, 0);
  assert.match(NO_ACCESS, /admin role/);
});

test('never a public channel, another server, or a deal without a ticket', async () => {
  for (const state of ['not_private', 'wrong_guild', 'no_channel']) {
    const d = fakeDiscord({ access: { state, error: `refused: ${state}` } });
    assert.deepEqual(await deliver(notice(), ctx(d)), { skipped: true, error: `refused: ${state}` });
    assert.deepEqual(await deliver(paidNotice(), ctx(d)), { skipped: true, error: `refused: ${state}` });
    assert.equal(d.calls.post + d.calls.dm, 0);
  }
});

test('receipt: only in the deal ticket, pinging the buyer only, even when the buyer can no longer see it', async () => {
  const d = fakeDiscord({ access: { state: 'ok', buyerCanSee: false } });
  const r = await deliver(paidNotice(), ctx(d));
  assert.deepEqual(r, { done: true, channel_message_id: d.ticket[0].id, dm_state: 'not_needed' });
  assert.equal(d.calls.dm, 0, 'no DM for a receipt');
  assert.deepEqual(d.ticket[0].payload.allowedMentions, { parse: [], users: ['402914829112836096'] });
  await deliver(paidNotice(), ctx(d));
  assert.equal(d.calls.post, 1, 'and only once');
});

test('receipt: the ticket was deleted → skipped with the reason, never sent anywhere else', async () => {
  const d = fakeDiscord({ access: { state: 'gone' } });
  assert.deepEqual(await deliver(paidNotice(), ctx(d)), { skipped: true, error: 'The deal ticket no longer exists, so the receipt was not posted.' });
  assert.equal(d.calls.post + d.calls.dm, 0);
});

test('a Discord error while posting reaches the worker (which records it and retries)', async () => {
  const d = fakeDiscord({ postError: discordError(50013, 'Missing Permissions') });
  await assert.rejects(() => deliver(notice(), ctx(d)), /Missing Permissions/);
});

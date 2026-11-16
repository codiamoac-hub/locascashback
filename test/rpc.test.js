import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRpc } from '../src/rpc.js';

const rpcWith = (answer) =>
  createRpc({ url: 'http://supabase.test', anonKey: 'anon', ns: 'prod', guild: '1503661074937806880', secret: 'cd'.repeat(32), fetch: async (url, init) => answer(new URL(url).pathname.split('/').pop(), JSON.parse(init.body)) });
const refuse = (status, body) => ({ ok: false, status, json: async () => body });

test('"No cashback" on a database without website migration 0054: nothing to post, and the bot carries on', async () => {
  const rpc = rpcWith(() => refuse(404, { code: 'PGRST202', message: 'Could not find the function' }));
  assert.deepEqual(await rpc.claimNone('w1', 10), []);
});

test('"No cashback": any other refusal is an error, and done is signed for the deal', async () => {
  await assert.rejects(() => rpcWith(() => refuse(403, { code: '42501', message: 'Invalid cashback bot request' })).claimNone('w1', 10), /Invalid cashback bot request/);
  let sent;
  const rpc = rpcWith((fn, body) => { sent = [fn, body]; return { ok: true, json: async () => true }; });
  assert.equal(await rpc.doneNone('w1', '304', 'L7', { done: true }), true);
  assert.equal(sent[0], 'web_cashback_bot_none_done_v1');
  assert.deepEqual([sent[1].p_worker, sent[1].p_deal_id, sent[1].p_listing_id, sent[1].p_result], ['w1', '304', 'L7', { done: true }]);
  assert.match(sent[1].p_signature, /^[a-f0-9]{64}$/);
});

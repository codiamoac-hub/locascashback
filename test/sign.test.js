import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, sign } from '../src/sign.js';

test('one fixed vector, shared with the website repo (tests/protection-db.test.cjs), which checks it against the SQL', () => {
  const s = sign('ab'.repeat(32), 'hello', 'test', '1543227658370809906', { issuedAt: 1760000000, nonce: '0'.repeat(32) });
  assert.equal(s.p_signature, '43ed718e2ec44b9047a594665f26ae03e14dd44afa6df17adcc317cc4788da91');
  assert.deepEqual(Object.keys(s), ['p_ns', 'p_guild', 'p_issued_at', 'p_nonce', 'p_signature']);
});

test('the signed text names the operation, the namespace and the guild, under the bot\'s own prefix', () => {
  assert.equal(canonical('claim', 'prod', '1503661074937806880', 1, 'n'), 'locas-cashback-v1\nclaim\nprod\n1503661074937806880\n1\nn');
});

test('every call gets a fresh nonce and the current time', () => {
  const a = sign('ab'.repeat(32), 'claim', 'prod', '1503661074937806880');
  const b = sign('ab'.repeat(32), 'claim', 'prod', '1503661074937806880');
  assert.notEqual(a.p_nonce, b.p_nonce);
  assert.match(a.p_nonce, /^[a-f0-9]{32}$/);
  assert.ok(Math.abs(a.p_issued_at - Date.now() / 1000) < 5);
});

import { createHmac, randomBytes } from 'node:crypto';

/* The bot's half of locas_web_private.verify_cashback_bot (website migration
   0014). Same HMAC and secret as the website's passport requests, with its
   own prefix, and the namespace and guild inside the signed text so a request
   signed for the test server is useless against production. The database
   accepts it for 60 seconds. Keep this byte-for-byte in step with the SQL:
   test/sign.test.js and the website's tests check one shared vector. */
export const PREFIX = 'locas-cashback-v1';

export const canonical = (op, ns, guild, issuedAt, nonce) => [PREFIX, op, ns, guild, String(issuedAt), nonce].join('\n');

export function sign(secret, op, ns, guild, { issuedAt = Math.floor(Date.now() / 1000), nonce = randomBytes(16).toString('hex') } = {}) {
  const signature = createHmac('sha256', secret).update(canonical(op, ns, guild, issuedAt, nonce)).digest('hex');
  return { p_ns: ns, p_guild: guild, p_issued_at: issuedAt, p_nonce: nonce, p_signature: signature };
}

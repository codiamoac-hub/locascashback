import { sign } from './sign.js';

export class RpcError extends Error {
  constructor(fn, status, message, code) {
    super(message);
    this.name = 'RpcError';
    this.fn = fn;
    this.status = status;
    this.code = code;
  }
}

/**
 * The three signed RPCs of website migration 0014. Every call is signed for
 * this bot's namespace and guild; the database checks both. Only the anon
 * key is ever sent: on its own it can read nothing.
 */
export function createRpc({ url, anonKey, ns, guild, secret, fetch = globalThis.fetch }) {
  async function call(fn, op, args = {}) {
    let res;
    try {
      res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sign(secret, op, ns, guild), ...args }),
      });
    } catch (e) {
      throw new RpcError(fn, 0, `Supabase did not answer (${e?.name === 'TimeoutError' ? 'timeout' : e?.message || e})`);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new RpcError(fn, res.status, body.message || `Supabase answered ${res.status}`, body.code);
    }
    return res.json();
  }

  return {
    /** Start-up: proves the signature, the namespace and the guild. */
    hello: () => call('web_cashback_bot_hello_v1', 'hello'),
    /** Queues what is new and leases up to `limit` due notices to `worker`. */
    claim: (worker, limit) => call('web_cashback_bot_claim_v1', 'claim', { p_worker: worker, p_limit: limit }),
    /** What happened to one notice. false: the lease had moved on. */
    done: (worker, cashbackId, kind, result) =>
      call('web_cashback_bot_done_v1', 'done', { p_worker: worker, p_cashback_id: cashbackId, p_kind: kind, p_result: result }),
  };
}

/** Plain words for a start-up refusal. */
export function helloProblem(e) {
  if (!(e instanceof RpcError)) return `Could not reach Supabase: ${e?.message || e}`;
  if (e.status === 404 || e.code === 'PGRST202')
    return 'The cashback RPCs are not installed. Run supabase/migrations/0014_cashback_bot.sql (website repo) in the Supabase SQL editor, then restart.';
  if (/does not belong to guild/i.test(e.message))
    return `${e.message}. GUILD_ID and SUPABASE_NS disagree: prod is the LOCAS server, test is the test server. Fix one of them and restart.`;
  if (/Invalid cashback bot request/i.test(e.message))
    return 'Supabase refused the signature. WEB_PASSPORT_RPC_SECRET must be the website\'s exact value, and the server clock must be right.';
  if (/not configured/i.test(e.message)) return 'The website\'s signing secret is not installed in Supabase (npm run setup:passport in the website repo).';
  if (e.status === 401) return 'Supabase rejected SUPABASE_ANON_KEY.';
  return `Supabase refused the start-up check: ${e.message}`;
}

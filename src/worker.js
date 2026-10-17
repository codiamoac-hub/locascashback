import { hostname } from 'node:os';
import { describe } from './deliver.js';

/* Who holds a lease in web_cashback_notices. Unique per process, so two
   replicas overlapping during a Railway deploy never share one. */
export function workerId() {
  const host = process.env.RAILWAY_REPLICA_ID || hostname();
  return `${host.slice(0, 40)}-${process.pid}`.replace(/[^A-Za-z0-9_.:-]/g, '-');
}

/**
 * Reads the outbox: claim what is due (leased for 3 minutes), deliver each
 * notice, record the outcome. Never runs twice at once. If recording fails,
 * the lease runs out and the next claim hands the notice back; delivery then
 * finds the message it already posted instead of posting again.
 */
export function createNoticeWorker({ rpc, deliverOne, worker = workerId(), limit = 10, log = console }) {
  let running = null;

  async function once() {
    let list;
    try {
      list = await rpc.claim(worker, limit);
    } catch (e) {
      log.error(`[notices] claim failed: ${e.message}`);
      return { claimed: 0, posted: 0 };
    }
    let posted = 0;
    for (const n of list) {
      let result;
      try {
        result = await deliverOne(n);
      } catch (e) {
        result = { done: false, error: describe(e) };
      }
      if (result.done) posted++;
      const what = `${n.kind === 'paid' ? 'receipt' : 'eligible'} · ${n.project} · ${n.cashback_id}`;
      log[result.done ? 'log' : 'warn'](
        `[notices] ${what} → ${result.done ? 'posted' : result.skipped ? 'skipped' : 'retry later'}${result.error ? ` · ${result.error}` : ''}`
      );
      try {
        const recorded = await rpc.done(worker, n.cashback_id, n.kind, result);
        if (!recorded) log.warn(`[notices] ${what}: the lease had moved to another worker; it records its own result`);
      } catch (e) {
        log.error(`[notices] ${what}: could not record (${e.message}); the next claim finds the message and records it`);
      }
    }
    return { claimed: list.length, posted };
  }

  return {
    tick() {
      running ??= once().finally(() => {
        running = null;
      });
      return running;
    },
    /** Resolves once the current tick (if any) has finished. */
    idle: () => running ?? Promise.resolve(),
  };
}

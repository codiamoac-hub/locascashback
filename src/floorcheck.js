/**
 * Job 1: the website's 24h floor check, every 30 minutes. The website does
 * the work (/api/cron/protection: opens windows, reads OpenSea / Magic Eden,
 * closes finished ones); this only calls it, with the same CRON_SECRET. It is
 * safe at any rate, so a restart or a missed run costs at most one reading.
 */
export function createFloorCheck({ websiteUrl, cronSecret, ns, fetch = globalThis.fetch, log = console, onFinalized }) {
  let running = null;

  async function once() {
    const started = Date.now();
    let res;
    try {
      res = await fetch(`${websiteUrl}/api/cron/protection`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      log.error(`[floor] could not reach the website: ${e?.name === 'TimeoutError' ? 'no answer in 2 minutes' : e?.message || e}`);
      return { ok: false };
    }
    if (!res.ok) {
      log.error(`[floor] the website answered ${res.status}${res.status === 401 ? ': CRON_SECRET is not the website\'s value' : ''}`);
      return { ok: false, status: res.status };
    }
    const r = await res.json().catch(() => ({}));
    /* The website says which namespace it serves (SUPABASE_NS there). A test
       bot calling the live site, or the other way round, ran the other site's
       check: harmless, but its cashbacks are not this bot's to announce. */
    if (ns && r.ns && r.ns !== ns) {
      log.error(`[floor] WEBSITE_URL is the ${r.ns} website, but this bot runs ns=${ns}: point WEBSITE_URL and CRON_SECRET at the ${ns} site.`);
      return { ok: false, wrongSite: r.ns };
    }
    log.log(`[floor] ${summary(r)} · ${Date.now() - started} ms`);
    /* A project that closed below just created cashbacks: announce them now
       rather than on the next poll. */
    if ((r.finalized ?? []).some((f) => f.status === 'below')) await onFinalized?.();
    return { ok: true, result: r };
  }

  return {
    run() {
      running ??= once().finally(() => {
        running = null;
      });
      return running;
    },
    idle: () => running ?? Promise.resolve(),
  };
}

export function summary(r) {
  const parts = [
    `${r.opened ?? 0} window(s) opened`,
    `${r.readings?.length ?? 0} reading(s)`,
    ...(r.finalized ?? []).map((f) => `${f.project}: ${f.status}`),
  ];
  const errors = (r.readings ?? []).filter((x) => x.outcome === 'error').map((x) => `${x.project}: ${x.error}`);
  return [...parts, ...(errors.length ? [`errors: ${errors.join('; ')}`] : [])].join(' · ');
}

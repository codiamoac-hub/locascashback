const SNOWFLAKE = /^\d{17,20}$/;

/* Which guild each namespace belongs to, as in the namespaces table (LOCAS
   MARKET migration 0004). The database checks it again on every call; this is
   only so a wrong pair is explained before anything connects. */
export const NAMESPACE_GUILDS = { prod: '1503661074937806880', test: '1543227658370809906' };

/**
 * Everything that must be right before the bot is allowed to start. Each
 * entry is a sentence for the Railway log. Empty means go.
 */
export function startupProblems(cfg) {
  const out = [];
  if (!cfg.token) out.push('Missing DISCORD_BOT_TOKEN: the website\'s bot token (same Discord app).');
  if (!SNOWFLAKE.test(cfg.guildId ?? '')) out.push('GUILD_ID must be the server id: 1503661074937806880 for LOCAS, 1543227658370809906 for the test server.');
  if (!cfg.supabase.url || !cfg.supabase.anonKey) out.push('Missing SUPABASE_URL or SUPABASE_ANON_KEY (the website\'s values; never the service-role key).');

  const ns = cfg.supabase.ns;
  if (!ns) {
    out.push('SUPABASE_NS is not set. It has no default on purpose: set SUPABASE_NS=prod in production, or SUPABASE_NS=test for the test server, and restart.');
  } else if (!NAMESPACE_GUILDS[ns]) {
    out.push(`SUPABASE_NS must be prod or test, not "${ns}".`);
  } else if (cfg.guildId && NAMESPACE_GUILDS[ns] !== cfg.guildId) {
    out.push(`SUPABASE_NS=${ns} belongs to guild ${NAMESPACE_GUILDS[ns]}, but GUILD_ID is ${cfg.guildId}. Refusing to start.`);
  }

  if (!/^[a-f0-9]{64}$/.test(cfg.signingSecret ?? '')) out.push('WEB_PASSPORT_RPC_SECRET must be the website\'s value (64 hex characters).');

  if (!cfg.adminIds.length) out.push('ADMIN_IDS is empty: list the admins\' Discord ids, comma separated (the website\'s ADMIN_IDS).');
  const bad = cfg.adminIds.filter((id) => !SNOWFLAKE.test(id));
  if (bad.length) out.push(`ADMIN_IDS has values that are not Discord ids: ${bad.join(', ')}`);

  let site = null;
  try {
    site = cfg.websiteUrl ? new URL(cfg.websiteUrl) : null;
  } catch {
    /* reported below */
  }
  if (!site || !/^https?:$/.test(site.protocol)) out.push('WEBSITE_URL must be the website\'s address, e.g. https://locas.example (the Claim button and the floor check use it).');
  else if (ns === 'prod' && site.protocol !== 'https:') out.push('WEBSITE_URL must be https in production.');

  /* Production runs the floor check; without the secret no cashback would
     ever be decided, so that is a refusal, not a warning. */
  if (ns === 'prod' && !cfg.cronSecret) out.push('CRON_SECRET is required in production: it runs the website\'s floor check every 30 minutes (same value as the website).');
  if (cfg.cronSecret && cfg.cronSecret.length < 16) out.push('CRON_SECRET must be at least 16 characters, the same value as the website.');

  if (!(cfg.pollSeconds >= 5 && cfg.pollSeconds <= 300)) out.push('POLL_SECONDS must be between 5 and 300.');
  if (!(cfg.floorCheckMinutes >= 5 && cfg.floorCheckMinutes <= 60)) out.push('FLOOR_CHECK_MINUTES must be between 5 and 60.');
  return out;
}

/** The floor check is the website's production job; a test bot never triggers it. */
export const floorCheckOn = (cfg) => cfg.supabase.ns === 'prod' && Boolean(cfg.websiteUrl && cfg.cronSecret);

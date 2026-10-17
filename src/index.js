import { createServer } from 'node:http';
import { Client, Events, GatewayIntentBits, ActivityType } from 'discord.js';
import { CFG } from './config.js';
import { startupProblems, floorCheckOn } from './guards.js';
import { createRpc, helloProblem } from './rpc.js';
import { discordAdapter } from './discord.js';
import { deliver } from './deliver.js';
import { createNoticeWorker, workerId } from './worker.js';
import { createFloorCheck } from './floorcheck.js';

/* Everything is checked before anything connects. A bot that started with a
   wrong namespace or a missing secret would post into the wrong server or
   never post at all, so every one of these is a refusal, not a warning. */
const problems = startupProblems(CFG);
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}

const rpc = createRpc({
  url: CFG.supabase.url,
  anonKey: CFG.supabase.anonKey,
  ns: CFG.supabase.ns,
  guild: CFG.guildId,
  secret: CFG.signingSecret,
});

/* The namespace guard, in the database: the signature must verify and the
   namespace must belong to GUILD_ID, or this is where the bot stops. */
let hello;
try {
  hello = await rpc.hello();
} catch (e) {
  console.error(`✗ ${helloProblem(e)}`);
  process.exit(1);
}

const state = { ready: false, lastNotices: null, lastFloor: null };
const worker = workerId();

/* Railway's health check. 200 once the bot is in its server and polling. */
const health = CFG.port
  ? createServer((req, res) => {
      if (req.url !== '/health') return res.writeHead(404).end();
      res.writeHead(state.ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: state.ready, ns: CFG.supabase.ns, worker, lastNotices: state.lastNotices, lastFloor: state.lastFloor }));
    }).listen(CFG.port)
  : null;

/* Guilds only: channel permissions arrive with it, and the one member lookup
   (can the buyer still see the ticket?) is a REST call. No privileged intent. */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const timers = [];

client.once(Events.ClientReady, async (c) => {
  /* The other half of the guard: the token must belong to a bot that is in
     the server this namespace is for. */
  if (!c.guilds.cache.has(CFG.guildId)) {
    console.error(`✗ ${c.user.tag} is not in guild ${CFG.guildId}. Invite it there (see README), then restart.`);
    process.exit(1);
  }

  c.user.setPresence({ activities: [{ name: 'LOCAS CASHBACK', state: 'LOCAS CASHBACK', type: ActivityType.Custom }], status: 'online' });

  const notices = createNoticeWorker({
    rpc,
    worker,
    deliverOne: (n) => deliver(n, { discord: discordAdapter(c, CFG.guildId), site: CFG.websiteUrl, adminIds: CFG.adminIds }),
  });
  const pollNotices = async () => {
    const r = await notices.tick();
    state.lastNotices = { at: new Date().toISOString(), ...r };
  };

  console.log(`> ${c.user.tag} online · guild ${CFG.guildId} · ns=${CFG.supabase.ns}${hello.label ? ` (${hello.label})` : ''} · worker ${worker}`);
  console.log(`> notices  every ${CFG.pollSeconds}s · ${hello.notices_pending} waiting · admins ${CFG.adminIds.join(', ')}`);

  if (floorCheckOn(CFG)) {
    const floor = createFloorCheck({ websiteUrl: CFG.websiteUrl, cronSecret: CFG.cronSecret, onFinalized: pollNotices });
    const runFloor = async () => {
      const r = await floor.run();
      state.lastFloor = { at: new Date().toISOString(), ok: r.ok };
    };
    console.log(`> floor    ${CFG.websiteUrl}/api/cron/protection every ${CFG.floorCheckMinutes} min (first run in 1 min)`);
    timers.push(setTimeout(runFloor, 60_000), setInterval(runFloor, CFG.floorCheckMinutes * 60_000));
    state.floor = floor;
  } else {
    console.log(`> floor    off (${CFG.supabase.ns === 'prod' ? 'set WEBSITE_URL and CRON_SECRET' : 'the website\'s floor check is production-only'})`);
  }

  await pollNotices();
  timers.push(setInterval(pollNotices, CFG.pollSeconds * 1000));
  state.notices = notices;
  state.ready = true;
});

/* Railway stops a deployment with SIGTERM. Let the notice in hand finish so
   its outcome is recorded, then leave; a notice cut off anyway is safe, the
   next start finds its message and records it. */
async function shutdown(signal) {
  console.log(`> ${signal}: finishing the current notice, then stopping`);
  state.ready = false;
  for (const t of timers) clearInterval(t);
  await Promise.race([Promise.all([state.notices?.idle(), state.floor?.idle()]), new Promise((r) => setTimeout(r, 10_000))]);
  await client.destroy();
  health?.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
/* Same as LOCAS MARKET: a stray socket error must not take the bot down.
   Anything genuinely broken shows up again on the next tick. */
process.on('uncaughtException', (e) => console.error(`[uncaught] ${e?.code || e?.name || 'error'} — ${e?.message || e}`));

client.login(CFG.token).catch((e) => {
  console.error(`✗ Discord refused the login (${e?.code || e?.message || e}). DISCORD_BOT_TOKEN must be the website's bot token.`);
  process.exit(1);
});

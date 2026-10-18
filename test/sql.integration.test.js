/* The bot's real requests against the website's real SQL (migrations
   0005-0014, run in an in-memory Postgres), through a stand-in for PostgREST.
   Proves the function names, argument names and signatures line up, and that
   a restart never posts twice with the real outbox.

   Needs the website repo next to this one (../locaswebsite, or set
   LOCAS_WEBSITE_REPO) with its dependencies installed; skipped otherwise. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { createRpc, helloProblem } from '../src/rpc.js';
import { createNoticeWorker } from '../src/worker.js';
import { deliver } from '../src/deliver.js';
import { fakeDiscord } from './fakes.js';

const site = resolve(process.env.LOCAS_WEBSITE_REPO || join(import.meta.dirname, '..', '..', 'locaswebsite'));
const available = existsSync(join(site, 'supabase/migrations/0014_cashback_bot.sql')) && existsSync(join(site, 'node_modules/@electric-sql/pglite'));
const opts = { skip: available ? false : `website repo not found at ${site}` };

const guild = '1503661074937806880', testGuild = '1543227658370809906';
const secret = 'cd'.repeat(32);
const buyer = '402914829112836096';
const quiet = { log() {}, warn() {}, error() {} };
let db;

/* POST /rest/v1/rpc/<fn> with named arguments, as the anon role, with
   PostgREST's status codes for the errors the RPCs raise. */
const postgrest = async (url, init) => {
  const fn = new URL(url).pathname.split('/').pop();
  const args = JSON.parse(init.body);
  const keys = Object.keys(args);
  const values = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  await db.exec('set role anon');
  try {
    const r = await db.query(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`, values);
    return { ok: true, status: 200, json: async () => r.rows[0].v };
  } catch (e) {
    const status = e.code === '42501' ? 403 : e.code === '42883' ? 404 : 400;
    return { ok: false, status, json: async () => ({ message: e.message, code: e.code === '42883' ? 'PGRST202' : e.code }) };
  } finally {
    await db.exec('reset role');
  }
};
const rpcFor = (ns = 'prod', g = guild) => createRpc({ url: 'http://supabase.test', anonKey: 'anon', ns, guild: g, secret, fetch: postgrest });

before(async () => {
  if (!available) return;
  const require = createRequire(join(site, 'package.json'));
  const { PGlite } = require('@electric-sql/pglite');
  const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions; create extension pgcrypto with schema extensions;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.namespaces(ns text primary key, guild_id text, label text);
    insert into public.namespaces values ('prod','${guild}','LOCAS production'), ('test','${testGuild}','LOCAS test server');
    create table public.listings(id text, ns text, project text, spot_type text, delivery text, price numeric, quantity integer, sold integer, status text, message_id text, channel_id text, created_at timestamptz default now());
    insert into public.listings values ('L1','prod','Solana Business Frogs','GTD','x',260,10,3,'live','1','1',now());
    create table public.deals(ns text, id text, guild_id text, buyer_id text, status text, price numeric, quantity integer, listing_id text, created_at timestamptz default now(), completed_at timestamptz, seller_id text, channel_id text);
    insert into public.deals values ('prod','d3','${guild}','${buyer}','complete',260,2,'L1',now(),now(),null,'1542000000000000001');
    insert into public.listings values ('LT','test','Test Project','wl','x',33.30,10,1,'live','1','1',now());
    insert into public.deals values ('test','t9','${testGuild}','${buyer}','complete',33.30,3,'LT',now(),now(),null,'1542000000000000009');
  `);
  for (const f of readdirSync(join(site, 'supabase/migrations')).filter((f) => /^00(0[5-9]|[1-9]\d)_.*\.sql$/.test(f)).sort()) {
    await db.exec(readFileSync(join(site, 'supabase/migrations', f), 'utf8'));
  }
  await db.query('insert into locas_web_private.passport_config values (true, $1)', [secret]);
  // A cashback as create_cashbacks makes it (project closed at a 150.00 floor under a 260.00 mint).
  await db.exec(`
    insert into public.web_cashbacks (ns, deal_id, listing_id, buyer_id, project, paid_usd, rate_pct, cashback_usd, spot_type, quantity, threshold_usd, floor_usd)
    values ('prod', 'd3', 'L1', '${buyer}', 'Solana Business Frogs', 520.00, 15, 78.00, 'GTD', 2, 260.00, 150.000000);`);
});
after(async () => { await db?.close(); });

test('start-up: the namespace guard runs in the database', opts, async () => {
  assert.deepEqual(await rpcFor().hello(), { ns: 'prod', guild_id: guild, label: 'LOCAS production', notices_pending: 0 });
  const wrong = await rpcFor('test', guild).hello().catch((e) => e);
  assert.match(helloProblem(wrong), /Namespace test does not belong to guild 1503661074937806880.*GUILD_ID and SUPABASE_NS disagree/);
  const forged = await createRpc({ url: 'http://x', anonKey: 'anon', ns: 'prod', guild, secret: 'ef'.repeat(32), fetch: postgrest }).hello().catch((e) => e);
  assert.match(helloProblem(forged), /refused the signature/);
});

test('eligible, then paid: each posted once, with the database\'s numbers, and recorded', opts, async () => {
  const discord = fakeDiscord();
  const w = createNoticeWorker({ rpc: rpcFor(), worker: 'it-1', log: quiet, deliverOne: (n) => deliver(n, { discord, site: 'https://locas.example', adminIds: ['111111111111111111'] }) });
  assert.deepEqual(await w.tick(), { claimed: 1, posted: 1 });
  const card = discord.ticket[0].embeds[0];
  assert.equal(card.title, 'Cashback eligible');
  for (const line of ['You paid : **520.00 USD**', 'Mint price : **260.00 USD**', 'Median floor : **150.00 USD**  ·  **−42.31%**', '## Cashback · 78.00 USD', 'Quantity : **2**'])
    assert.ok(card.description.includes(line), line);
  assert.deepEqual(await w.tick(), { claimed: 0, posted: 0 }, 'nothing twice');

  await db.exec(`update public.web_cashbacks set payout_chain = 'robinhood', payout_asset = 'USDG', payout_address = '0x${'ab'.repeat(20)}',
    requested_at = now(), status = 'paid', paid_at = now(), tx_hash = '0x${'cd'.repeat(32)}' where deal_id = 'd3'`);
  assert.deepEqual(await w.tick(), { claimed: 1, posted: 1 });
  const receipt = discord.ticket[1];
  assert.equal(receipt.embeds[0].title, 'Cashback paid');
  assert.equal(receipt.payload.components[0].toJSON().components[0].url, `https://robin.etherscan.io/tx/0x${'cd'.repeat(32)}`);
  const row = (await db.query(`select notified_at, notify_error from public.web_cashbacks where deal_id = 'd3'`)).rows[0];
  assert.ok(row.notified_at, 'the website\'s admin row now shows the receipt as posted');
  assert.equal(discord.calls.post, 2);
});

test('safe to restart, with the real outbox: recording lost, lease runs out, the message is found, not reposted', opts, async () => {
  await db.exec(`insert into public.deals values ('prod','d4','${guild}','${buyer}','complete',100,1,'L1',now(),now(),null,'1542000000000000002');
    insert into public.web_cashbacks (ns, deal_id, listing_id, buyer_id, project, paid_usd, rate_pct, cashback_usd, spot_type, quantity, threshold_usd, floor_usd)
    values ('prod','d4','L1','${buyer}','Solana Business Frogs',100.00,10,10.00,'GTD',1,260.00,150.000000);`);
  const discord = fakeDiscord();
  const real = rpcFor();
  let lost = 1;
  const flaky = { ...real, done: (...a) => (lost-- > 0 ? Promise.reject(new Error('Supabase did not answer')) : real.done(...a)) };
  const first = createNoticeWorker({ rpc: flaky, worker: 'it-old', log: quiet, deliverOne: (n) => deliver(n, { discord, site: 'https://locas.example', adminIds: [] }) });
  await first.tick();
  assert.equal(discord.calls.post, 1);
  const second = createNoticeWorker({ rpc: real, worker: 'it-new', log: quiet, deliverOne: (n) => deliver(n, { discord, site: 'https://locas.example', adminIds: [] }) });
  assert.deepEqual(await second.tick(), { claimed: 0, posted: 0 }, 'the old lease still holds');
  await db.exec(`update public.web_cashback_notices set lease_until = now() - interval '1 second' where cashback_id = (select id from public.web_cashbacks where deal_id = 'd4')`);
  assert.deepEqual(await second.tick(), { claimed: 1, posted: 1 });
  assert.equal(discord.calls.post, 1, 'one message in the ticket');
  const n = (await db.query(`select state, channel_message_id from public.web_cashback_notices where cashback_id = (select id from public.web_cashbacks where deal_id = 'd4')`)).rows[0];
  assert.deepEqual(n, { state: 'done', channel_message_id: discord.ticket[0].id });
});

test('docs/test-server.sql works as written: the test bot posts both cards, production never sees them', opts, async () => {
  const sql = readFileSync(join(import.meta.dirname, '..', 'docs', 'test-server.sql'), 'utf8').replaceAll('PASTE_DEAL_ID', 't9');
  const step = (start, end) => sql.slice(sql.indexOf(start), sql.indexOf(end, sql.indexOf(start)) + end.length);
  const discord = fakeDiscord();
  const w = createNoticeWorker({ rpc: rpcFor('test', testGuild), worker: 'it-test', log: quiet, deliverOne: (n) => deliver(n, { discord, site: 'https://locas.example', adminIds: [] }) });

  await db.exec(step('insert into public.web_cashbacks', 'do nothing;'));
  assert.deepEqual(await w.tick(), { claimed: 1, posted: 1 });
  const card = discord.ticket[0].embeds[0].description;
  for (const line of ['Spot Type : **WL**  ·  Quantity : **3**', 'You paid : **99.90 USD**', 'WL price : **1,200.00 USD**', 'Median floor : **950.50 USD**  ·  **\u221220.79%**', '## Cashback · 14.99 USD'])
    assert.ok(card.includes(line), line);

  await db.exec(step('update public.web_cashbacks', "deal_id = 't9';"));
  assert.deepEqual(await w.tick(), { claimed: 1, posted: 1 });
  assert.equal(discord.ticket[1].payload.components[0].toJSON().components[0].url, 'https://basescan.org/tx/0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060');
  assert.deepEqual(await createNoticeWorker({ rpc: rpcFor(), worker: 'it-prod', log: quiet, deliverOne: async () => assert.fail('production must not see test rows') }).tick(), { claimed: 0, posted: 0 });
  const recorded = (await db.query(step('select c.deal_id, n.kind', 'n.created_at desc;'))).rows;
  assert.deepEqual(recorded.map((r) => [r.deal_id, r.kind, r.state]).sort(), [['t9', 'eligible', 'done'], ['t9', 'paid', 'done']]);
  await db.exec(step("delete from public.web_cashbacks where ns = 'test'", ';'));
  assert.equal((await db.query(`select count(*)::int as n from public.web_cashback_notices where ns = 'test'`)).rows[0].n, 0, 'clean-up takes the notices with it');
});

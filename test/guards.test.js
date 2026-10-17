import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorCheckOn, startupProblems } from '../src/guards.js';

const prod = {
  token: 'x', guildId: '1503661074937806880',
  supabase: { url: 'https://p.supabase.co', anonKey: 'anon', ns: 'prod' },
  signingSecret: 'ab'.repeat(32), adminIds: ['111111111111111111'],
  websiteUrl: 'https://locas.example', cronSecret: 's'.repeat(32), floorCheckMinutes: 30, pollSeconds: 15,
};
const test_ = { ...prod, guildId: '1543227658370809906', supabase: { ...prod.supabase, ns: 'test' }, cronSecret: null, websiteUrl: 'http://localhost:3005' };

test('a complete production or test config starts', () => {
  assert.deepEqual(startupProblems(prod), []);
  assert.deepEqual(startupProblems(test_), []);
});

test('namespace guard: SUPABASE_NS is required and must belong to GUILD_ID', () => {
  assert.match(startupProblems({ ...prod, supabase: { ...prod.supabase, ns: null } }).join(), /SUPABASE_NS is not set/);
  assert.match(startupProblems({ ...prod, supabase: { ...prod.supabase, ns: 'staging' } }).join(), /must be prod or test/);
  assert.match(startupProblems({ ...prod, guildId: '1543227658370809906' }).join(), /SUPABASE_NS=prod belongs to guild 1503661074937806880, but GUILD_ID is 1543227658370809906/);
  assert.match(startupProblems({ ...test_, guildId: '1503661074937806880' }).join(), /SUPABASE_NS=test belongs to guild 1543227658370809906/);
});

test('production needs CRON_SECRET and an https website; secrets and ids are checked', () => {
  assert.match(startupProblems({ ...prod, cronSecret: null }).join(), /CRON_SECRET is required in production/);
  assert.match(startupProblems({ ...prod, websiteUrl: 'http://locas.example' }).join(), /https in production/);
  assert.match(startupProblems({ ...prod, signingSecret: 'short' }).join(), /WEB_PASSPORT_RPC_SECRET/);
  assert.match(startupProblems({ ...prod, adminIds: [] }).join(), /ADMIN_IDS is empty/);
  assert.match(startupProblems({ ...prod, adminIds: ['bob'] }).join(), /not Discord ids: bob/);
  assert.match(startupProblems({ ...prod, token: null }).join(), /DISCORD_BOT_TOKEN/);
  assert.match(startupProblems({ ...prod, supabase: { ...prod.supabase, anonKey: null } }).join(), /never the service-role key/);
});

test('the floor check runs in production only', () => {
  assert.equal(floorCheckOn(prod), true);
  assert.equal(floorCheckOn({ ...test_, cronSecret: 's'.repeat(32) }), false, 'a test bot never triggers the production job');
});

test('.env.example as Railway imports it: every PASTE_… counts as missing and is named; filling them starts the bot', async () => {
  const { readFileSync } = await import('node:fs');
  const { readConfig } = await import('../src/config.js');
  const example = Object.fromEntries(
    readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
  );
  for (const key of ['DISCORD_BOT_TOKEN', 'GUILD_ID', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_NS', 'WEB_PASSPORT_RPC_SECRET', 'ADMIN_IDS', 'WEBSITE_URL', 'CRON_SECRET', 'POLL_SECONDS', 'FLOOR_CHECK_MINUTES'])
    assert.ok(key in example, `${key} is in .env.example, so Railway shows it`);
  const untouched = startupProblems(readConfig(example)).join('\n');
  for (const name of ['DISCORD_BOT_TOKEN', 'SUPABASE_URL or SUPABASE_ANON_KEY', 'WEB_PASSPORT_RPC_SECRET', 'ADMIN_IDS', 'WEBSITE_URL', 'CRON_SECRET'])
    assert.ok(untouched.includes(name), `${name} is reported while it still says PASTE_…`);

  const filled = { ...example, DISCORD_BOT_TOKEN: 'x', SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon', WEB_PASSPORT_RPC_SECRET: 'ab'.repeat(32), ADMIN_IDS: '111111111111111111', WEBSITE_URL: 'https://locas.up.railway.app', CRON_SECRET: 's'.repeat(32) };
  assert.deepEqual(startupProblems(readConfig(filled)), []);
  const testServer = { ...filled, GUILD_ID: '1543227658370809906', SUPABASE_NS: 'test', CRON_SECRET: 'PASTE_FROM_WEBSITE' };
  assert.deepEqual(startupProblems(readConfig(testServer)), [], 'on the test server the CRON_SECRET placeholder is simply ignored');
  assert.equal(readConfig(testServer).cronSecret, null);
});

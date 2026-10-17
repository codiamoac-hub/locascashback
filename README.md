# LOCAS CASHBACK

The Protected Buyer bot for the LOCAS server. It works with the LOCAS website (repo `locaswebsite`) and does three things:

```
every 30 min   →  the website's 24h floor check  (/api/cron/protection)
                    └── a project closes under its mint price → cashbacks are created

cashback created  →  "Cashback eligible" in that deal's ticket
                       pings the buyer and every admin · "Claim cashback" button → website
                       + the same card by DM if the buyer can no longer see the ticket

admin clicks Mark paid on the website  →  receipt in that deal's ticket, and only there
                       pings the buyer only · amount, token, network, wallet, explorer
```

The website decides and records; this bot only announces. It **never sends crypto and never holds a private key**: payment stays manual, by an admin, on the website.

Fourth bot in the set, alongside **LOCASDEAL**, **LOCAS MARKET** and **LocasTXN**, and it pairs with the LOCAS website.

---

## Rules it keeps

- **Only the deal's ticket, or a DM.** A notice goes to `deals.channel_id` and nowhere else. Before posting, the bot checks the channel is a private text channel in its own server (`@everyone` cannot see it); anything else is refused and recorded, never posted. The receipt never goes to a DM.
- **Each notice exactly once, and safe to restart at any time.** Notices come from an outbox in the database (`web_cashback_notices`, website migration 0014). The bot leases a notice for 3 minutes, posts, then records the message id. Before posting it reads the ticket's recent messages for its own card for that cashback (the card's title links to `/protection#cashback-<id>`), so a restart between posting and recording finds the message instead of posting it again. Messages also carry a Discord nonce, which covers two replicas overlapping during a deploy.
- **Failures retry on their own**: after 2 minutes, then 4, 8, … up to once an hour. The reason shows on the website's admin row.
- **No service-role key.** The anon key and signed RPCs only, with the website's HMAC and secret under the bot's own prefix (`locas-cashback-v1`).
- **Namespace guard**, like the other bots: no `SUPABASE_NS`, or a namespace that does not belong to `GUILD_ID`, and it refuses to start. The database checks the same pair on every call.
- **Exact numbers.** Every amount comes from the database as a decimal string, rounded to the cent there, and is printed as is. The card shows exactly what the website shows.

---

## Setup

```bash
npm install
cp .env.example .env.test   # fill in (see below); .env.* files never leave your machine
npm test                    # 43 tests; with ../locaswebsite present, also against the real SQL
npm run dev:test            # run against .env.test
```

### 1. The database

Run **`supabase/migrations/0014_cashback_bot.sql`** from the website repo in the Supabase SQL editor, after 0012 and 0013. Without it the bot refuses to start and says so.

### 2. Discord

Same Discord app as the website (application `1554761393805336667`), so no new bot: the website's bot user logs in here.

- **Invite / permissions**: scope `bot`; **View Channel, Send Messages, Embed Links, Read Message History**: permission integer **84992**. No Administrator, no Manage anything, no Mention @everyone, no slash commands.
  `https://discord.com/oauth2/authorize?client_id=1554761393805336667&scope=bot&permissions=84992`
  Open it again for a server the bot is already in to update its role's permissions.
- **Ticket access**: LOCAS MARKET makes every deal ticket private (`@everyone` denied) and lets in only the buyer, itself and its admin role (`ADMIN_ROLE_ID`). **Give this bot user that admin role** in the server, or it cannot open a single ticket. It reports exactly that, per ticket, on the website until it is fixed. Note that the bot also gets the admin role's server-wide permissions.
- **Privileged intents**: none. Guilds only.
- **Presence**: custom status "LOCAS CASHBACK".

### 3. Railway

**Variables come in by themselves**: Railway reads `.env.example` and shows every variable under Variables → Suggested Variables. Add them all, then replace each `PASTE_…` value (the website's `.env.local` has most of them). A value still saying `PASTE_…` counts as missing: the bot refuses to start and names it. On the test server change `GUILD_ID` to `1543227658370809906` and `SUPABASE_NS` to `test`, and point `WEBSITE_URL` and `CRON_SECRET` at the test website.

One service, **region EU West, one replica**: `railway.json` sets `europe-west4-drams3a` with `numReplicas: 1`, the start command and restart on failure. In the service settings, check that the region shows EU West and replicas 1. No public domain is needed; when Railway gives the service a `PORT`, the bot also answers `GET /health`.

| Variable | Value |
|---|---|
| `DISCORD_BOT_TOKEN` | The website's `DISCORD_BOT_TOKEN` (same app) |
| `GUILD_ID` | `1503661074937806880` (LOCAS) · `1543227658370809906` (test server) |
| `SUPABASE_NS` | `prod` · `test`. Required, no default |
| `SUPABASE_URL` | The website's `SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | The website's `SUPABASE_ANON_KEY`. Never the service-role key |
| `WEB_PASSPORT_RPC_SECRET` | The website's value (64 hex) |
| `ADMIN_IDS` | The website's `ADMIN_IDS`: pinged on every "Cashback eligible" |
| `WEBSITE_URL` | The website's address on Railway, `https://…` (Claim button + floor check); the test website for a test bot |
| `CRON_SECRET` | The website's `CRON_SECRET`. Required in production; on the test server the test website's, or unset to leave the floor check off |
| `POLL_SECONDS` | Optional, default `15`: how fast a receipt follows Mark paid |
| `FLOOR_CHECK_MINUTES` | Optional, default `30` |
| `PORT` | Set by Railway |

On start the log says what it found:

```
> LOCAS#1234 online · guild 1503661074937806880 · ns=prod (LOCAS production) · worker …
> notices  every 15s · 0 waiting · admins …
> floor    https://…/api/cron/protection every 30 min (first run in 1 min)
```

Then one line per notice (`posted`, `skipped` with the reason, or `retry later` with the reason) and one per floor check.

---

## Try it on the test server first

[`docs/test-server.md`](docs/test-server.md): a test deployment, a real ticket, and two SQL snippets ([`docs/test-server.sql`](docs/test-server.sql)) that play the website's part. The test suite runs those same snippets.

---

## Files

| File | What |
|---|---|
| `src/index.js` | Start-up guards, the namespace check, Discord login, presence, the two loops, health, shutdown |
| `src/guards.js` | Every refusal to start, in words |
| `src/rpc.js`, `src/sign.js` | The three signed RPCs (`web_cashback_bot_hello_v1`, `_claim_v1`, `_done_v1`) |
| `src/worker.js` | The outbox loop: claim, deliver, record |
| `src/deliver.js` | One notice: where it may go, the restart check, the DM rule |
| `src/discord.js` | The only Discord calls: ticket checks, history read, post, DM |
| `src/cards.js`, `src/money.js` | The two cards, explorer links, exact amounts |
| `src/floorcheck.js` | The 30-minute call to the website |

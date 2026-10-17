# Testing LOCAS CASHBACK on the test server

Everything here happens in the `test` namespace and on the test server
(`1543227658370809906`); production never sees it. With the test website
running (`SUPABASE_NS=test`, website migration 0015), do the website's part
there: mint in `/admin`, decide the floor, request, approve, Mark paid. Without
it, two SQL snippets in [`test-server.sql`](test-server.sql) play that part; the
test suite runs the same snippets, so they are known to work.

## Before you start

1. **Database**: in the Supabase SQL editor, run the website repo's
   `supabase/migrations/0014_cashback_bot.sql` (after 0012 and 0013).
2. **Bot in the test server**: open
   `https://discord.com/oauth2/authorize?client_id=1554761393805336667&scope=bot&permissions=84992`
   and pick the test server.
3. **Ticket access**: in the test server, Server Settings → Members → the
   website's bot → add the admin role LOCAS MARKET's test bot uses
   (its `ADMIN_ROLE_ID`). Without it the bot cannot open tickets.
4. **A test deployment**: in Railway, a service from this repo (or
   `npm run dev:test` on your machine with `.env.test`). Variables →
   Suggested Variables → add them all, replace every `PASTE_…`, and set:

   | Variable | Test value |
   |---|---|
   | `GUILD_ID` | `1543227658370809906` |
   | `SUPABASE_NS` | `test` |
   | `WEBSITE_URL` | the **test** website's address (website repo, `docs/test-server.md`) |
   | `CRON_SECRET` | the test website's `CRON_SECRET`, to run its floor check; or leave it, and the floor check stays off |

   The log must say `online · guild 1543227658370809906 · ns=test`, then
   either the floor check line or `floor off`. Pointed at the live website by
   mistake, each floor check logs "WEBSITE_URL is the prod website, but this
   bot runs ns=test". Swap `GUILD_ID` to the production server once on purpose: it
   must refuse to start with "SUPABASE_NS=test belongs to guild
   1543227658370809906, but GUILD_ID is …".

## The tests

1. **Make a ticket.** In the test server, buy a test listing with LOCAS
   MARKET's test bot, so a real deal ticket opens with you as the buyer.
2. **Find it.** Run block 1 of `test-server.sql`; copy your deal's `id`.
3. **Cashback eligible.** Run block 2 with `PASTE_DEAL_ID` replaced. Within
   ~15 seconds the ticket gets the "Cashback eligible" card:
   - it pings you and every admin in `ADMIN_IDS`, nobody else;
   - project, spot type and quantity, what you paid, mint (or WL) price
     1,200.00, floor 950.50 with −20.79%, rate 15%, and the cashback,
     all to the cent;
   - "Claim cashback" opens the website's `/protection`.
4. **Exactly once.** Restart the bot (Railway → Restart). No second card.
   Block 4 shows the notice `done` with its message id.
5. **Mark paid.** Run block 3. Within ~15 seconds the receipt is in the same
   ticket: pings only you, the cashback amount in USDC, Base, the wallet, and
   "View on Basescan". Run block 3 again with `solana` / `ethereum` /
   `robinhood` values on a fresh cashback to see each explorer (Solscan,
   Etherscan, robin.etherscan.io).
6. **Restart mid-way.** Make a fresh cashback (another deal), run block 3 and
   restart the bot straight away. Still exactly one receipt.
7. **Buyer can't see the ticket.** On another deal, run LOCAS MARKET's
   `/close` (it takes the buyer out of the ticket), then run block 2 for it.
   The card is posted in the ticket for the admins **and** sent to you by DM.
   Its receipt (block 3) goes to the ticket only, never a DM.
8. **No access.** Take the admin role off the bot, make a cashback: nothing
   is posted, the log says `retry later · LOCAS CASHBACK can't post in this
   ticket…`. Give the role back: it posts on the next retry (within 2–4 min).
9. **Clean up.** Block 5 deletes the test cashbacks and their notices.

## Then production

Same service settings with `GUILD_ID=1503661074937806880`, `SUPABASE_NS=prod`
and `CRON_SECRET` set. The log must show `ns=prod`, the floor check every 30
minutes, and a `[floor] …` line after the first minute. On the website,
`/admin` rows then show "Cashback eligible posted in the deal's ticket" and
"Receipt posted in the deal's ticket".

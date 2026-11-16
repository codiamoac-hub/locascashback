-- LOCAS CASHBACK · try it on the test server.
-- Paste one block at a time into the Supabase SQL editor. Everything here is
-- in the 'test' namespace: the website never reads it, production never sees
-- it. Bot tables are only read. See docs/test-server.md for the steps.

-- 1. Find your test deal (a ticket LOCAS MARKET opened on the test server).
select id, listing_id, buyer_id, channel_id, price, quantity, status, created_at
  from public.deals
 where ns = 'test'
 order by created_at desc
 limit 5;

-- 2. Make it a cashback, as if its project had closed under the mint price.
--    Replace PASTE_DEAL_ID. The mint price (1200.00) and the floor (950.50)
--    are made up; the card shows exactly these numbers.
insert into public.web_cashbacks (ns, deal_id, listing_id, buyer_id, project, paid_usd, rate_pct, cashback_usd, spot_type, quantity, threshold_usd, floor_usd)
select d.ns, d.id, d.listing_id, d.buyer_id, l.project, round(d.price * d.quantity, 2), 15, round(d.price * d.quantity * 15 / 100.0, 2),
       upper(l.spot_type), d.quantity, 1200.00, 950.50
  from public.deals d join public.listings l on l.ns = d.ns and l.id = d.listing_id
 where d.ns = 'test' and d.id = 'PASTE_DEAL_ID'
on conflict (ns, deal_id, listing_id) do nothing;
-- Within ~15 seconds: "Cashback eligible" in that ticket.

-- 3. Mark it paid, as the website's Mark paid would. Replace PASTE_DEAL_ID.
--    Try another network by changing the three payout values together:
--      solana    + SOL / USDC / USDT  + a Solana address
--      ethereum  + ETH / USDC / USDT  + 0x address
--      base      + ETH / USDC / USDT  + 0x address
--      robinhood + USDG               + 0x address
update public.web_cashbacks
   set payout_chain = 'base', payout_asset = 'USDC', payout_address = '0x9f2c4a7e1b3d5f60718293a4b5c6d7e8f9012345',
       requested_at = now(), status = 'paid', paid_at = now(),
       tx_hash = '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060'
 where ns = 'test' and deal_id = 'PASTE_DEAL_ID';
-- Within ~15 seconds: the receipt in the same ticket.

-- 4. What the bot recorded.
select c.deal_id, n.kind, n.state, n.channel_message_id, n.dm_state, n.attempts, n.last_error, n.done_at
  from public.web_cashback_notices n join public.web_cashbacks c on c.id = n.cashback_id
 where n.ns = 'test'
 order by n.created_at desc;

-- 5. Clean up when done (its notices go with it).
delete from public.web_cashbacks where ns = 'test';

-- 6. "No cashback": as if the deal's project had held its floor (website
--    migration 0054). Use a deal with no cashback: run block 5 first, or pick
--    another deal. Replace PASTE_DEAL_ID twice. The mint price (1200.00) and
--    the floor (1350.25) are made up; the card shows exactly these numbers.
insert into public.web_project_mints (ns, project, chain, contract_or_slug, mint_price_usd, mint_at, check_after,
                                      status, checked_floor_usd, checked_at, decided_by, created_by)
select d.ns, l.project, 'base', 'test-floor-held', 1200.00, now() - interval '13 hours', interval '12 hours',
       'above', 1350.25, now(), 'test', d.buyer_id
  from public.deals d join public.listings l on l.ns = d.ns and l.id = d.listing_id
 where d.ns = 'test' and d.id = 'PASTE_DEAL_ID'
on conflict do nothing;
insert into public.web_deal_protection (ns, deal_id, listing_id, buyer_id, project, spot_type, paid_usd, prior_deals, rate_pct, deal_completed_at)
select d.ns, d.id, d.listing_id, d.buyer_id, l.project, upper(l.spot_type), round(d.price * d.quantity, 2), 5, 10, now() - interval '1 day'
  from public.deals d join public.listings l on l.ns = d.ns and l.id = d.listing_id
 where d.ns = 'test' and d.id = 'PASTE_DEAL_ID'
on conflict do nothing;
-- Within ~15 seconds: "No cashback on this deal" in that ticket.

-- 7. What the bot recorded for it.
select deal_id, state, channel_message_id, dm_state, attempts, last_error, done_at
  from public.web_no_cashback_notices
 where ns = 'test'
 order by created_at desc;

-- 8. Clean up block 6.
delete from public.web_no_cashback_notices where ns = 'test';
delete from public.web_deal_protection where ns = 'test';
delete from public.web_project_mints where ns = 'test' and contract_or_slug = 'test-floor-held';

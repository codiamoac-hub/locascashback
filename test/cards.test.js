import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleCard, explorerLink, floorLink, isOurMessage, noCashbackCard, nonceFor, receiptCard } from '../src/cards.js';
import { noneNotice } from './fakes.js';

const site = 'https://locas.example';
const id = '7d1f3c2a-9b4e-4c1d-8e2f-0a1b2c3d4e5f';
const buyer = '402914829112836096';
const admins = ['111111111111111111', '222222222222222222'];
const base = {
  cashback_id: id, kind: 'eligible', buyer_id: buyer, project: 'Solana *Business* Frogs', spot_type: 'GTD', quantity: 2,
  paid_usd: '520.00', threshold_usd: '260.00', floor_usd: '150.00', drop_pct: '42.31', rate_pct: 15, cashback_usd: '78.00',
};
const json = (payload) => payload.embeds[0].toJSON();

test('eligible, in the ticket: tags nobody, not the buyer and not the admins', () => {
  const p = eligibleCard(base, { site, adminIds: [...admins, buyer, admins[0]] });
  assert.equal(p.content, 'Your Protected Buyer cashback on **Solana \\*Business\\* Frogs** is ready to claim.');
  assert.doesNotMatch(p.content, /<@/);
  assert.deepEqual(p.allowedMentions, { parse: [] });
});

test('eligible: every number, exact to the cent, the same as the website', () => {
  const e = json(eligibleCard(base, { site, adminIds: admins }));
  assert.equal(e.title, 'Cashback eligible');
  assert.equal(e.url, `${site}/protection#cashback-${id}`);
  assert.equal(e.author.name, 'LOCAS CASHBACK');
  assert.equal(
    e.description,
    [
      'Project Name : **Solana \\*Business\\* Frogs**',
      'Spot Type : **GTD**  ·  Quantity : **2**',
      '',
      'You paid : **520.00 USD**',
      'Mint price : **260.00 USD**',
      'Median floor : **150.00 USD**  ·  **−42.31%**',
      'Your rate : **15%**  ·  locked when your deal completed',
      'Covered : deal completed before the floor check',
      '',
      '## Cashback · 78.00 USD',
      '-# 15% of 520.00 USD, exact to the cent',
      '',
      'Claim it on the website: pick the network, the token and your wallet.',
    ].join('\n')
  );
  assert.ok(e.footer.text.startsWith('LOCAS CASHBACK'));
  assert.match(json(eligibleCard({ ...base, spot_type: 'WL', threshold_usd: '200.00' }, { site })).description, /WL price : \*\*200\.00 USD\*\*/);
  assert.match(json(eligibleCard({ ...base, threshold_label: 'WL price', threshold_usd: '100.00' }, { site })).description, /WL price : \*\*100\.00 USD\*\*/, 'a free mint: the database names the price');
});

test('eligible: a "Claim cashback" link button to the cashback on /protection', () => {
  const [row] = eligibleCard(base, { site }).components;
  const [button] = row.toJSON().components;
  assert.deepEqual([button.label, button.url, button.style], ['Claim cashback', `${site}/protection#cashback-${id}`, 5]);
});

test('eligible, by DM: the same card, pinging nobody', () => {
  const p = eligibleCard(base, { site, adminIds: admins, dm: true });
  assert.equal(p.content, 'Your Protected Buyer cashback on **Solana \\*Business\\* Frogs** is ready to claim.');
  assert.deepEqual(p.allowedMentions, { parse: [] });
  const { timestamp: _a, ...dm } = json(p), { timestamp: _b, ...ticket } = json(eligibleCard(base, { site }));
  assert.deepEqual(dm, ticket, 'identical card');
});

const paid = { ...base, kind: 'paid', payout_chain: 'base', payout_asset: 'USDC', payout_address: '0x' + 'ab'.repeat(20), tx_hash: '0x' + 'cd'.repeat(32), paid_at: '2026-10-17T20:00:00.000Z' };

test('receipt: tags nobody, shows amount, token, network, wallet and the explorer', () => {
  const p = receiptCard(paid, { site });
  assert.equal(p.content, 'Your **Solana \\*Business\\* Frogs** cashback has been sent.');
  assert.deepEqual(p.allowedMentions, { parse: [] });
  const e = json(p);
  assert.equal(e.title, 'Cashback paid');
  assert.equal(e.author.name, 'LOCAS CASHBACK · Base');
  assert.match(e.description, /^Project Name : .*\n## 78\.00 USDC\n-# 15% of 520\.00 USD · paid on Base · <t:1792267200:f>$/);
  const field = (name) => e.fields.find((f) => f.name === name).value;
  assert.equal(field('▸ WALLET'), '```\n0x' + 'ab'.repeat(20) + '\n```');
  assert.deepEqual([field('Amount'), field('Token'), field('Network')], ['**78.00 USD**', '**USDC**', 'Base']);
  assert.equal(field('▸ TRANSACTION'), '```\n0x' + 'cd'.repeat(32) + '\n```');
  const [button] = p.components[0].toJSON().components;
  assert.deepEqual([button.label, button.url], ['View on Basescan', `https://basescan.org/tx/0x${'cd'.repeat(32)}`]);
});

test('receipt: ETH or SOL is the dollar amount paid at the day\'s price', () => {
  assert.match(json(receiptCard({ ...paid, payout_chain: 'ethereum', payout_asset: 'ETH' }, { site })).description, /## 78\.00 USD in ETH/);
});

test('explorers: Solscan, Etherscan, Basescan, robin.etherscan.io; a pasted link is rebuilt on the right one', () => {
  const evm = '0x' + '12'.repeat(32), sig = '5'.repeat(88);
  assert.equal(explorerLink('solana', sig).url, `https://solscan.io/tx/${sig}`);
  assert.equal(explorerLink('ethereum', evm).url, `https://etherscan.io/tx/${evm}`);
  assert.equal(explorerLink('base', evm).url, `https://basescan.org/tx/${evm}`);
  assert.equal(explorerLink('robinhood', evm).url, `https://robin.etherscan.io/tx/${evm}`);
  assert.equal(explorerLink('robinhood', evm).label, 'View on Etherscan');
  assert.equal(explorerLink('base', `https://blockscout.com/tx/${evm}?tab=logs`).url, `https://basescan.org/tx/${evm}`);
  assert.equal(explorerLink('solana', evm), null, 'an EVM hash is not a Solana signature');
  assert.equal(explorerLink('base', 'javascript:alert(1)'), null);
  assert.equal(explorerLink('bitcoin', evm), null);
  assert.deepEqual(receiptCard({ ...paid, tx_hash: 'paid in cash' }, { site }).components, [], 'no button without a real hash');
});

test('recognising its own earlier card, for the restart check', () => {
  const msg = (author, title, url) => ({ author: { id: author }, embeds: [{ title, url }] });
  const anchor = `${site}/protection#cashback-${id}`;
  assert.equal(isOurMessage(msg('BOT', 'Cashback eligible', anchor), 'BOT', 'eligible', id), true);
  assert.equal(isOurMessage(msg('BOT', 'Cashback eligible', `https://old.example/protection#cashback-${id}`), 'BOT', 'eligible', id), true, 'still ours after the site moves');
  assert.equal(isOurMessage(msg('BOT', 'Cashback paid', anchor), 'BOT', 'eligible', id), false, 'the receipt is not the eligible card');
  assert.equal(isOurMessage(msg('SOMEONE', 'Cashback eligible', anchor), 'BOT', 'eligible', id), false);
  assert.equal(isOurMessage(msg('BOT', 'Cashback eligible', `${site}/protection#cashback-other`), 'BOT', 'eligible', id), false);
  assert.ok(nonceFor('eligible', id).length <= 25);
  assert.notEqual(nonceFor('eligible', id), nonceFor('paid', id));
});

test('no cashback: the price, the floor 12h after the mint and the reason; no amount, no tag, a button to the floor', () => {
  const p = noCashbackCard(noneNotice(), { site });
  const e = json(p);
  assert.equal(p.content, 'No cashback on your **demarco** deal: the floor held.');
  assert.deepEqual(p.allowedMentions, { parse: [] });
  const button = p.components[0].toJSON().components[0];
  assert.deepEqual([button.label, button.url], ['View floor on OpenSea', 'https://opensea.io/collection/asperites']);
  assert.equal(e.title, 'No cashback on this deal');
  assert.equal(e.url, `${site}/protection#deal-304`);
  assert.equal(
    e.description,
    [
      'Project Name : **demarco**',
      'Spot Type : **GTD**  ·  Quantity : **5**',
      '',
      'You paid : **12.50 USD**',
      'WL price : **2.00 USD**',
      'Floor 12h after the mint : **3.40 USD**',
      '',
      'The floor stayed at or above the WL price, so no cashback is due on this deal.',
      '-# Protected Buyer pays only when the floor closes under the price.',
    ].join('\n')
  );
  assert.doesNotMatch(e.description, /Cashback ·|Claim/);
});

test('no cashback: a moved timer is not called 12h, and a mint price reads as one', () => {
  const moved = json(noCashbackCard(noneNotice({ check_hours: 7.5, threshold_label: 'Mint price', threshold_usd: '260.00', floor_usd: '260.00' }), { site })).description;
  assert.ok(moved.includes('Floor after the mint : **260.00 USD**'), moved);
  assert.ok(moved.includes('The floor stayed at or above the mint price, so no cashback is due on this deal.'), moved);
  assert.ok(moved.includes('Mint price : **260.00 USD**'));
  assert.ok(json(noCashbackCard(noneNotice({ check_hours: 6 }), { site })).description.includes('Floor 6h after the mint : **3.40 USD**'));
});

test('no cashback: the floor button only for a known marketplace and a clean slug', () => {
  assert.deepEqual(floorLink('magiceden', 'okay_bears'), { label: 'View floor on Magic Eden', url: 'https://magiceden.io/marketplace/okay_bears' });
  assert.equal(floorLink('opensea', 'https://evil.example/x'), null);
  assert.equal(floorLink('opensea', 'a b'), null);
  assert.equal(floorLink('opensea', null), null);
  assert.equal(floorLink('blur', 'asperites'), null);
  assert.deepEqual(noCashbackCard(noneNotice({ floor_slug: null }), { site }).components, [], 'no slug: no button');
});

test('no cashback: recognised by its deal, never mistaken for another card or another deal', () => {
  const msg = (title, url) => ({ author: { id: 'BOT' }, embeds: [{ title, url }] });
  assert.equal(isOurMessage(msg('No cashback on this deal', `${site}/protection#deal-304`), 'BOT', 'none', '304'), true);
  assert.equal(isOurMessage(msg('No cashback on this deal', `${site}/protection#deal-3040`), 'BOT', 'none', '304'), false);
  assert.equal(isOurMessage(msg('Cashback eligible', `${site}/protection#deal-304`), 'BOT', 'none', '304'), false);
  assert.equal(isOurMessage(msg('No cashback on this deal', `${site}/protection#cashback-304`), 'BOT', 'none', '304'), false);
  assert.ok(nonceFor('none', '304').length <= 25);
  assert.notEqual(nonceFor('none', '304'), nonceFor('eligible', '304'));
});

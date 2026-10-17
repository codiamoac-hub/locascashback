/* A stand-in for the Discord adapter (src/discord.js): one ticket, one DM
   box, every call recorded. Messages look like what Discord returns. */
export function fakeDiscord({ access = { state: 'ok', buyerCanSee: true }, dmError = null, postError = null } = {}) {
  const ticket = [];
  const dmBox = [];
  const store = (box, payload) => {
    const m = { id: String(1600000000000000000n + BigInt(box.length + 1 + (box === dmBox ? 500 : 0))), author: { id: 'BOT' }, embeds: payload.embeds.map((e) => e.toJSON()), payload };
    box.push(m);
    return m.id;
  };
  return {
    botId: 'BOT',
    ticket,
    dmBox,
    calls: { post: 0, dm: 0, findMine: 0, dmFindMine: 0 },
    access: async () => access,
    async findMine(_channel, isMine) {
      this.calls.findMine++;
      return ticket.find(isMine)?.id ?? null;
    },
    async post(_channel, payload) {
      this.calls.post++;
      if (postError) throw postError;
      return store(ticket, payload);
    },
    async dmFindMine(_user, isMine) {
      this.calls.dmFindMine++;
      return dmBox.find(isMine)?.id ?? null;
    },
    async dm(_user, payload) {
      this.calls.dm++;
      if (dmError) throw dmError;
      return store(dmBox, payload);
    },
  };
}

export const discordError = (code, message = `Discord error ${code}`) => Object.assign(new Error(message), { code });

export const notice = (over = {}) => ({
  cashback_id: '7d1f3c2a-9b4e-4c1d-8e2f-0a1b2c3d4e5f', kind: 'eligible', attempts: 1,
  channel_message_id: null, dm_state: null, dm_message_id: null,
  buyer_id: '402914829112836096', project: 'Solana Business Frogs', deal_id: 'd3', listing_id: 'L1', channel_id: '1542000000000000001',
  spot_type: 'GTD', quantity: 2, paid_usd: '520.00', rate_pct: 15, cashback_usd: '78.00',
  threshold_usd: '260.00', floor_usd: '150.00', drop_pct: '42.31', status: 'eligible',
  payout_chain: null, payout_asset: null, payout_address: null, tx_hash: null, paid_at: null,
  ...over,
});

export const paidNotice = (over = {}) =>
  notice({ kind: 'paid', status: 'paid', payout_chain: 'base', payout_asset: 'USDC', payout_address: '0x' + 'ab'.repeat(20), tx_hash: '0x' + 'cd'.repeat(32), paid_at: '2026-10-17T20:00:00.000Z', ...over });

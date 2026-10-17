import { eligibleCard, isOurMessage, nonceFor, receiptCard } from './cards.js';

/* 50007: the buyer does not accept DMs from server members. Retrying will not
   change that, so it is recorded and the notice is finished. */
const DM_CLOSED = 50007;

export const NO_ACCESS =
  "LOCAS CASHBACK can't post in this ticket. Give its bot user LOCAS MARKET's admin role (ADMIN_ROLE_ID), which every deal ticket lets in, and keep Send Messages and Embed Links on its own role.";

/** Plain words for a Discord or network failure, for the admin page. Never includes a token. */
export function describe(e) {
  if (e?.code === 50001 || e?.code === 50013) return NO_ACCESS;
  if (e?.code === 10003) return 'The deal ticket no longer exists.';
  if (e?.code === DM_CLOSED) return 'The buyer does not accept DMs from the server.';
  const text = `${e?.name && e.name !== 'Error' ? `${e.name}: ` : ''}${e?.message ?? e}`;
  return text.slice(0, 280);
}

/**
 * One notice, start to finish. Returns what to record with
 * web_cashback_bot_done_v1: { done } posted, { skipped } can never go out,
 * neither = retry later.
 *
 * Exactly once: before posting anywhere, the channel (or the DM) is searched
 * for this bot's own card for this cashback, so a restart between posting and
 * recording finds the message instead of posting a second one. What was
 * already recorded (a channel message, a DM) is never redone.
 *
 * `discord` is the small adapter in discord.js; tests pass a fake.
 */
export async function deliver(n, { discord, site, adminIds }) {
  const access = await discord.access(n.channel_id, n.buyer_id);
  if (access.state === 'no_access') return { done: false, error: access.error ?? NO_ACCESS };
  /* Never anywhere but a private deal ticket in this server. */
  if (access.state === 'not_private' || access.state === 'wrong_guild' || access.state === 'no_channel') {
    return { skipped: true, error: access.error };
  }
  return n.kind === 'paid' ? receipt(n, access, discord, site) : eligible(n, access, discord, site, adminIds);
}

async function inChannel(n, discord, payload) {
  const mine = (m) => isOurMessage(m, discord.botId, n.kind, n.cashback_id);
  return (
    (await discord.findMine(n.channel_id, mine)) ??
    (await discord.post(n.channel_id, { ...payload, nonce: nonceFor(n.kind, n.cashback_id), enforceNonce: true }))
  );
}

/* The ticket only, pinging the buyer only. If the ticket was deleted there is
   nowhere it is allowed to go, so it is recorded as skipped. */
async function receipt(n, access, discord, site) {
  if (n.channel_message_id) return { done: true, channel_message_id: n.channel_message_id, dm_state: 'not_needed' };
  if (access.state === 'gone') return { skipped: true, error: 'The deal ticket no longer exists, so the receipt was not posted.' };
  const id = await inChannel(n, discord, receiptCard(n, { site }));
  return { done: true, channel_message_id: id, dm_state: 'not_needed' };
}

/* The ticket, pinging the buyer and the admins; and the same card by DM when
   the buyer can no longer see the ticket (closed deal, left the server). */
async function eligible(n, access, discord, site, adminIds) {
  let channelMessageId = n.channel_message_id ?? null;
  if (!channelMessageId && access.state === 'ok') {
    channelMessageId = await inChannel(n, discord, eligibleCard(n, { site, adminIds }));
  }

  const dmNeeded = access.state === 'gone' || !access.buyerCanSee;
  let dmState = dmNeeded ? n.dm_state : 'not_needed';
  let dmMessageId = n.dm_message_id ?? null;
  let note = null;
  if (dmNeeded && dmState !== 'sent' && dmState !== 'failed') {
    const mine = (m) => isOurMessage(m, discord.botId, 'eligible', n.cashback_id);
    try {
      dmMessageId = (await discord.dmFindMine(n.buyer_id, mine)) ?? (await discord.dm(n.buyer_id, eligibleCard(n, { site, dm: true })));
      dmState = 'sent';
    } catch (e) {
      if (e?.code !== DM_CLOSED) {
        /* Keep what is done; only the DM is retried. */
        return { done: false, channel_message_id: channelMessageId, error: `DM to the buyer failed: ${describe(e)}` };
      }
      dmState = 'failed';
      note = describe(e);
    }
  }

  if (access.state === 'gone' && !channelMessageId) {
    return dmState === 'sent'
      ? { done: true, dm_state: dmState, dm_message_id: dmMessageId, error: 'The deal ticket no longer exists; the buyer got it by DM.' }
      : { skipped: true, dm_state: dmState, error: 'The deal ticket no longer exists and the buyer does not accept DMs.' };
  }
  return { done: true, channel_message_id: channelMessageId, dm_state: dmState, dm_message_id: dmMessageId, error: note };
}

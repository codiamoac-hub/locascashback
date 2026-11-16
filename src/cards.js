import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { CHAINS, COLOR, STABLES, TYPES } from './config.js';
import { cents, drop } from './money.js';

/* LOCAS MARKET's eligibility badge, for the same ~80px thumbnail slot. When a
   dedicated cashback badge lands in locas-assets, swap the file name here. */
const ELIGIBLE_THUMB = 'https://raw.githubusercontent.com/codiamoac-hub/locas-assets/main/eligibility.webp';

/* Footers carry the width, as on the other LOCAS cards: the bodies are short,
   and ~50 characters of footer keep the cards from rendering narrow. */
const ELIGIBLE_FOOTER = 'LOCAS CASHBACK · Protected Buyer · claim on the website';
const PAID_FOOTER = 'LOCAS CASHBACK · Protected Buyer · sent by the team';
const NONE_FOOTER = 'LOCAS CASHBACK · Protected Buyer · the floor held';

export const TITLES = { eligible: 'Cashback eligible', paid: 'Cashback paid', none: 'No cashback on this deal' };

/* Every card links its title to the cashback on the website. That link is
   also how the bot recognises its own earlier message after a restart: if a
   card with this title and this cashback's anchor is already in the channel,
   it is not posted again. */
export const anchorOf = (cashbackId) => `#cashback-${cashbackId}`;
export const claimUrl = (site, cashbackId) => `${site}/protection${anchorOf(cashbackId)}`;

/* Where the buyer can see the floor for themselves: the collection the website's
   check read. Built here from a checked slug, never taken as a URL. */
const MARKETS = {
  opensea: { label: 'View floor on OpenSea', url: (s) => `https://opensea.io/collection/${s}`, ok: /^[a-z0-9_-]{1,100}$/i },
  magiceden: { label: 'View floor on Magic Eden', url: (s) => `https://magiceden.io/marketplace/${s}`, ok: /^[a-z0-9_-]{1,100}$/i },
};
export function floorLink(source, slug) {
  const m = MARKETS[source];
  const s = String(slug ?? '').trim();
  return m && m.ok.test(s) ? { label: m.label, url: m.url(encodeURIComponent(s)) } : null;
}

/* A "No cashback" card has no cashback to link to: it is found again by its deal. */
const dealAnchorOf = (dealId) => `#deal-${dealId}`;

/* What a notice is about: its cashback, or its deal when there is none. */
export const idOf = (n) => n.cashback_id ?? n.deal_id;

export function isOurMessage(message, botId, kind, id) {
  if (message?.author?.id !== botId) return false;
  const anchor = kind === 'none' ? dealAnchorOf(id) : anchorOf(id);
  return (message.embeds ?? []).some((e) => e?.title === TITLES[kind] && String(e?.url ?? '').endsWith(anchor));
}

/* Discord drops a second message with the same nonce from the same author
   for a few minutes, which covers two replicas overlapping during a deploy.
   25 characters at most. */
export const nonceFor = (kind, cashbackId) => `cb${kind[0]}${cashbackId.replace(/-/g, '').slice(0, 22)}`;

/* Project names come from listings; keep them from turning into formatting. */
const plain = (s) => String(s ?? '').replace(/([\\*_`~|>[\]])/g, '\\$1');
const typeOf = (t) => TYPES[String(t ?? '').toUpperCase()] || null;

/**
 * Explorer link for the transaction the admin saved: always on the network's
 * own explorer. A pasted link from anywhere else is rebuilt from its hash; a
 * value that is neither a hash nor such a link gets no button.
 */
export function explorerLink(chainId, hash) {
  const chain = CHAINS[chainId];
  if (!chain || !hash) return null;
  let h = String(hash).trim();
  if (/^https?:\/\//i.test(h)) h = h.match(/\/tx\/([^/?#\s]+)/i)?.[1] ?? '';
  const ok = chain.family === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(h) : /^0x[0-9a-fA-F]{64}$/.test(h);
  return ok ? { label: `View on ${chain.explorer.label}`, url: chain.explorer.tx(h), hash: h } : null;
}

/* ────────────────────────── cashback eligible ────────────────────────── */

/**
 * Posted once in the deal's ticket when a project closes under its mint
 * price. Every number comes from the database exactly as the website shows
 * it: frozen on the cashback when it was created, rounded to the cent there.
 *
 * In the ticket it pings the buyer and every admin; in a DM (when the buyer
 * can no longer see the ticket) it pings nobody.
 */
export function eligibleCard(n, { site }) {
  const t = typeOf(n.spot_type);
  // The database says which price the floor was measured against (WL price for WL spots and for free mints, 0021).
  const priceLabel = n.threshold_label || (t?.label === 'WL' ? 'WL price' : 'Mint price');
  const fall = drop(n.drop_pct);
  const money = (v) => (v == null ? '—' : `${cents(v)} USD`);

  const embed = new EmbedBuilder()
    .setColor(COLOR.eligible)
    .setAuthor({ name: 'LOCAS CASHBACK' })
    .setTitle(TITLES.eligible)
    .setURL(claimUrl(site, n.cashback_id))
    .setThumbnail(ELIGIBLE_THUMB)
    .setDescription(
      [
        `Project Name : **${plain(n.project)}**`,
        `Spot Type : **${t?.label ?? (n.spot_type ? plain(n.spot_type) : '—')}**${n.quantity ? `  ·  Quantity : **${n.quantity}**` : ''}`,
        '',
        `You paid : **${money(n.paid_usd)}**`,
        `${priceLabel} : **${money(n.threshold_usd)}**`,
        `Median floor : **${money(n.floor_usd)}**${fall ? `  ·  **${fall}**` : ''}`,
        `Your rate : **${n.rate_pct}%**  ·  locked when your deal completed`,
        'Covered : deal completed before the floor check',
        '',
        `## Cashback · ${cents(n.cashback_usd)} USD`,
        `-# ${n.rate_pct}% of ${cents(n.paid_usd)} USD, exact to the cent`,
        '',
        'Claim it on the website: pick the network, the token and your wallet.',
      ].join('\n')
    )
    .setFooter({ text: ELIGIBLE_FOOTER })
    .setTimestamp(Date.now());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Claim cashback').setURL(claimUrl(site, n.cashback_id))
  );

  /* Nobody is tagged, in the ticket or the DM: the card sits in the buyer's own
     ticket, so it needs no ping, and the admins are not called to it either. */
  return {
    content: `Your Protected Buyer cashback on **${plain(n.project)}** is ready to claim.`,
    embeds: [embed],
    components: [row],
    allowedMentions: { parse: [] },
  };
}

/* ────────────────────────── no cashback ────────────────────────── */

/**
 * Posted once in the deal's ticket when a covered deal is owed nothing: the
 * floor closed at or above the price the deal is measured against (website
 * migration 0054). Same numbers the website decided on. Tags nobody.
 */
export function noCashbackCard(n, { site }) {
  const t = typeOf(n.spot_type);
  const priceLabel = n.threshold_label || (t?.label === 'WL' ? 'WL price' : 'Mint price');
  const money = (v) => (v == null ? '—' : `${cents(v)} USD`);
  /* The timer is 12 hours unless an admin moved it; say the hours only when they are whole. */
  const hours = Number(n.check_hours);
  const when = Number.isInteger(hours) && hours > 0 ? ` ${hours}h after the mint` : ' after the mint';
  const link = floorLink(n.floor_source, n.floor_slug);

  const embed = new EmbedBuilder()
    .setColor(COLOR.none)
    .setAuthor({ name: 'LOCAS CASHBACK' })
    .setTitle(TITLES.none)
    .setURL(`${site}/protection${dealAnchorOf(n.deal_id)}`)
    .setDescription(
      [
        `Project Name : **${plain(n.project)}**`,
        `Spot Type : **${t?.label ?? (n.spot_type ? plain(n.spot_type) : '—')}**${n.quantity ? `  ·  Quantity : **${n.quantity}**` : ''}`,
        '',
        `You paid : **${money(n.paid_usd)}**`,
        `${priceLabel} : **${money(n.threshold_usd)}**`,
        `Floor${when} : **${money(n.floor_usd)}**`,
        '',
        `The floor stayed at or above the ${priceLabel.replace(/^Mint/, 'mint')}, so no cashback is due on this deal.`,
        '-# Protected Buyer pays only when the floor closes under the price.',
      ].join('\n')
    )
    .setFooter({ text: NONE_FOOTER })
    .setTimestamp(Date.now());

  return {
    content: `No cashback on your **${plain(n.project)}** deal: the floor held.`,
    embeds: [embed],
    components: link ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(link.label).setURL(link.url))] : [],
    allowedMentions: { parse: [] },
  };
}

/* ────────────────────────── receipt ────────────────────────── */

/**
 * Posted once in the deal's ticket after an admin marks the cashback paid on
 * the website. Pings the buyer only. The amount is the cashback in dollars:
 * paid one-for-one in a stablecoin, or at the day's price in ETH or SOL.
 */
export function receiptCard(n, { site }) {
  const chain = CHAINS[n.payout_chain] ?? { name: n.payout_chain ?? 'unknown network', icon: undefined };
  const asset = String(n.payout_asset ?? '');
  const amount = cents(n.cashback_usd);
  const link = explorerLink(n.payout_chain, n.tx_hash);
  const paidAt = n.paid_at ? new Date(n.paid_at) : new Date();
  const unix = Math.floor(paidAt.getTime() / 1000);

  const embed = new EmbedBuilder()
    .setColor(COLOR.paid)
    .setAuthor({ name: `LOCAS CASHBACK · ${chain.name}`, iconURL: chain.icon })
    .setTitle(TITLES.paid)
    .setURL(claimUrl(site, n.cashback_id))
    .setDescription(
      [
        `Project Name : **${plain(n.project)}**`,
        STABLES.has(asset) ? `## ${amount} ${asset}` : `## ${amount} USD in ${asset}`,
        /* <t:…:f> renders in each reader's own timezone; the bot runs in UTC. */
        `-# ${n.rate_pct}% of ${cents(n.paid_usd)} USD · paid on ${chain.name} · <t:${unix}:f>`,
      ].join('\n')
    )
    .addFields(
      { name: '▸ WALLET', value: ['```', n.payout_address ?? 'unknown', '```'].join('\n'), inline: false },
      { name: 'Amount', value: `**${amount} USD**`, inline: true },
      { name: 'Token', value: `**${asset || '—'}**`, inline: true },
      { name: 'Network', value: chain.name, inline: true },
      {
        name: '▸ TRANSACTION',
        value: ['```', link?.hash ?? String(n.tx_hash ?? 'unknown').replace(/`/g, ''), '```'].join('\n'),
        inline: false,
      }
    )
    .setFooter({ text: PAID_FOOTER })
    .setTimestamp(paidAt);

  const components = link
    ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(link.label).setURL(link.url))]
    : [];

  return {
    content: `Your **${plain(n.project)}** cashback has been sent.`,
    embeds: [embed],
    components,
    allowedMentions: { parse: [] },
  };
}

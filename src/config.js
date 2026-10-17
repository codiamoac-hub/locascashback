/* A value still showing the .env.example placeholder (PASTE_…) counts as
   not set, so the start-up checks name it instead of the bot trying to log
   in with "PASTE_FROM_WEBSITE". Railway imports .env.example as suggested
   variables: every name shows up with its placeholder to replace. */
const PLACEHOLDER = /PASTE[_-]/i;

export function readConfig(env = process.env) {
  const val = (k) => {
    const v = env[k]?.trim();
    return v && !PLACEHOLDER.test(v) ? v : null;
  };
  const list = (k) =>
    (val(k) || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const num = (k, d) => (val(k) === null ? d : Number(val(k)));
  const url = (k) => val(k)?.replace(/\/+$/, '') || null;

  return {
    /* The website's Discord app. Same token as the website's DISCORD_BOT_TOKEN:
       the website only reads members with it over REST, this bot is the one
       that logs in to the gateway and posts. */
    token: val('DISCORD_BOT_TOKEN'),
    guildId: val('GUILD_ID'),

    /* Same project, anon key and namespace rules as the website. There is no
       service-role key anywhere: every read and write is a signed RPC
       (migration 0014 in the website repo), and the database refuses a
       namespace that does not belong to GUILD_ID. SUPABASE_NS has no default
       on purpose, the same rule as LOCAS MARKET: a missing variable must not
       quietly turn a test bot into a production one. */
    supabase: {
      url: url('SUPABASE_URL'),
      anonKey: val('SUPABASE_ANON_KEY'),
      ns: val('SUPABASE_NS'),
    },
    /* The website's WEB_PASSPORT_RPC_SECRET, same value. The bot signs under its
       own prefix (locas-cashback-v1), so its signatures are never valid as
       website ones and the other way round. */
    signingSecret: val('WEB_PASSPORT_RPC_SECRET'),

    /* Pinged on every "Cashback eligible" card. Same list as the website's
       ADMIN_IDS, so whoever can pay on the website is told when there is
       something to pay. */
    adminIds: list('ADMIN_IDS'),

    /* The website: the "Claim cashback" button points at it, and the floor
       check calls its /api/cron/protection with CRON_SECRET. */
    websiteUrl: url('WEBSITE_URL'),
    cronSecret: val('CRON_SECRET'),

    floorCheckMinutes: num('FLOOR_CHECK_MINUTES', 30),
    /* How often the outbox is read. A receipt reaches the ticket within this
       long after an admin clicks Mark paid. */
    pollSeconds: num('POLL_SECONDS', 15),
    /* Railway sets PORT; the health endpoint listens there. */
    port: num('PORT', 0),
  };
}

export const CFG = readConfig();

/* Card colours. Green is LOCAS MARKET's "accepted"; blue is LocasTXN's
   "Outgoing Payment" (admin wallet to customer), which a paid cashback is. */
export const COLOR = {
  eligible: 0x1d9e75,
  paid: 0x5b8cff,
};

export const TYPES = {
  GTD: { label: 'GTD', name: 'Guaranteed' },
  WL: { label: 'WL', name: 'Whitelist' },
  FCFS: { label: 'FCFS', name: 'First come, first served' },
};

/* Where a cashback can be paid: the same networks and tokens as the website
   (lib/payout.ts) and the market bot's invoice. One explorer per network,
   fixed: a pasted link from another explorer is rebuilt onto this one. The
   icons are LocasTXN's. */
export const CHAINS = {
  solana: {
    name: 'Solana',
    family: 'solana',
    icon: 'https://cryptologos.cc/logos/solana-sol-logo.png',
    explorer: { label: 'Solscan', tx: (h) => `https://solscan.io/tx/${h}` },
  },
  ethereum: {
    name: 'Ethereum',
    family: 'evm',
    icon: 'https://cryptologos.cc/logos/ethereum-eth-logo.png',
    explorer: { label: 'Etherscan', tx: (h) => `https://etherscan.io/tx/${h}` },
  },
  base: {
    name: 'Base',
    family: 'evm',
    icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png',
    explorer: { label: 'Basescan', tx: (h) => `https://basescan.org/tx/${h}` },
  },
  robinhood: {
    name: 'Robinhood Chain',
    family: 'evm',
    // LocasTXN's placeholder: the chain only ships SVG logos, which Discord will not render.
    icon: 'https://cryptologos.cc/logos/ethereum-eth-logo.png',
    explorer: { label: 'Etherscan', tx: (h) => `https://robin.etherscan.io/tx/${h}` },
  },
};

/* Paid one-for-one in dollars; anything else is paid at the day's price. */
export const STABLES = new Set(['USDC', 'USDT', 'USDG']);

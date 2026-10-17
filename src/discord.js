import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { NO_ACCESS } from './deliver.js';

/* What the bot needs in a deal ticket. Read Message History is for the
   restart check: it reads the ticket's recent messages for its own card
   before ever posting one. */
const NEEDED = [
  ['View Channel', PermissionFlagsBits.ViewChannel],
  ['Send Messages', PermissionFlagsBits.SendMessages],
  ['Embed Links', PermissionFlagsBits.EmbedLinks],
  ['Read Message History', PermissionFlagsBits.ReadMessageHistory],
];

/* 10007 Unknown Member (left the server), 10013 Unknown User. */
const NOT_A_MEMBER = new Set([10007, 10013]);

/**
 * The only Discord calls the bot makes, behind a small surface so the
 * delivery logic can be tested without a gateway. Guilds intent only: the
 * single member lookup is a REST call, which needs no privileged intent.
 */
export function discordAdapter(client, guildId) {
  async function ticket(channelId) {
    return client.channels.fetch(channelId);
  }

  return {
    get botId() {
      return client.user.id;
    },

    /**
     * Can the bot post here, is it really a private ticket in this server, and
     * can the buyer still see it?
     *   ok { buyerCanSee } · gone · no_channel · no_access · not_private · wrong_guild
     */
    async access(channelId, buyerId) {
      if (!channelId) return { state: 'no_channel', error: 'No ticket channel is recorded for this deal.' };
      let channel;
      try {
        channel = await ticket(channelId);
      } catch (e) {
        if (e?.code === 10003) return { state: 'gone' };
        if (e?.code === 50001) return { state: 'no_access', error: NO_ACCESS };
        throw e;
      }
      if (!channel || channel.guildId !== guildId || channel.type !== ChannelType.GuildText) {
        return { state: 'wrong_guild', error: `Channel ${channelId} is not a deal ticket in this server; nothing was posted.` };
      }
      const guild = channel.guild;
      if (channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) {
        return { state: 'not_private', error: 'That channel is visible to everyone; cashback notices only go to private deal tickets.' };
      }
      const me = guild.members.me ?? (await guild.members.fetchMe());
      const perms = channel.permissionsFor(me);
      const missing = NEEDED.filter(([, flag]) => !perms?.has(flag)).map(([name]) => name);
      if (missing.length) {
        return { state: 'no_access', error: `LOCAS CASHBACK is missing ${missing.join(', ')} in this ticket. ${NO_ACCESS}` };
      }
      let buyerCanSee = false;
      try {
        const buyer = await guild.members.fetch({ user: buyerId, force: true });
        buyerCanSee = Boolean(channel.permissionsFor(buyer)?.has(PermissionFlagsBits.ViewChannel));
      } catch (e) {
        if (!NOT_A_MEMBER.has(e?.code)) throw e;
      }
      return { state: 'ok', buyerCanSee };
    },

    async findMine(channelId, isMine) {
      const channel = await ticket(channelId);
      const recent = await channel.messages.fetch({ limit: 100 });
      return recent.find(isMine)?.id ?? null;
    },

    async post(channelId, payload) {
      const channel = await ticket(channelId);
      return (await channel.send(payload)).id;
    },

    async dmFindMine(userId, isMine) {
      const user = await client.users.fetch(userId);
      const dm = await user.createDM();
      const recent = await dm.messages.fetch({ limit: 50 });
      return recent.find(isMine)?.id ?? null;
    },

    async dm(userId, payload) {
      const user = await client.users.fetch(userId);
      return (await user.send(payload)).id;
    },
  };
}

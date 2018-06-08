import * as Discord from "eris";
import { Module } from "./module";
import { selfServeVoice as config } from './config';

interface GuildConfig {
  selfServiceCategoryID: string;
  commandChannelID: string;
  /**
   * Mapping from voice channel ID to timeout handle
   */
  channelTimeouts: Record<string, NodeJS.Timer>;
}

export class SelfServeVoice implements Module {
  private activeGuilds: Record<string, GuildConfig> = {};

  init(client: Discord.Client) {
    client.on('ready', () => {
      // look at all current guild memberships, find and catalog the IDs for the category and text channel for commands
      client.guilds.forEach(this.initGuild.bind(this));

      console.log('Ready for action in these servers:');
      for (const guildID of Object.keys(this.activeGuilds)) {
        console.log('  ' + client.guilds.get(guildID)!.name);
      }
    });

    // Handle new joins
    client.on('guildCreate', (guild: Discord.Guild) => {
      const guildConfig = this.activeGuilds[guild.id];
      if (guildConfig) {
        return;
      }
      this.initGuild(guild);
      console.log(`Joined ${guild.name}!`);
    });

    // Handle removal from a server
    client.on('guildDelete', (guild: Discord.Guild) => {
      const guildConfig = this.activeGuilds[guild.id];
      if (!guildConfig) {
        return;
      }
      for (const channelID of Object.keys(guildConfig.channelTimeouts)) {
        clearTimeout(guildConfig.channelTimeouts[channelID]);
      }
      delete this.activeGuilds[guild.id];
      console.log(`Left ${guild.name}`);
    });

    // Watch messages sent
    const playCommand = /^!letsplay (.+)$/;
    client.on('messageCreate', (message: Discord.Message) => {
      if (!(message.channel instanceof Discord.GuildChannel) || !message.member) {
        // TODO: respond to DMs in some way?
        return;
      }

      const guildConfig = this.activeGuilds[message.channel.guild.id];
      if (!guildConfig) {
        return;
      }

      if (message.channel.id !== guildConfig.commandChannelID) {
        // does not come from our dedicated command channel
        return;
      }

      if (!message.cleanContent) {
        return;
      }

      const commandPieces = message.cleanContent.match(playCommand);
      const newChannelName = commandPieces && commandPieces[1] && commandPieces[1].trim();
      if (!newChannelName) {
        // not a valid command
        return;
      }

      client.createChannel(
        message.channel.guild.id,
        newChannelName,
        2,
        `Requested by ${message.member.username}`,
        guildConfig.selfServiceCategoryID,
      ).then((newChannel) => {
        this.queueChannelCleanup(newChannel as Discord.VoiceChannel, config.firstJoinWindow);
        message.addReaction('✅');
      }).catch(() => message.addReaction('🙅♀️'));

      // TODO: check if user is already in a voice channel and move them to the new channel???
    });

    // Watch members entering and leaving voice rooms
    client.on('voiceChannelJoin', (member, newChannel) => this.voiceMemberJoinLeve(member, newChannel));
    client.on('voiceChannelLeave', (member, oldChannel) => this.voiceMemberJoinLeve(member, undefined, oldChannel));
    client.on('voiceChannelSwitch', (member, newChannel, oldChannel) => this.voiceMemberJoinLeve(member, newChannel, oldChannel));

    // Watch channels being moved into our category
    client.on('channelUpdate', (newChannel) => {
      if (!(newChannel instanceof Discord.VoiceChannel)) {
        return;
      }

      const guildConfig = this.activeGuilds[newChannel.guild.id];
      if (!guildConfig) {
        return;
      }

      if (newChannel.parentID === guildConfig.selfServiceCategoryID && (!newChannel.voiceMembers || newChannel.voiceMembers.size === 0)) {
        this.queueChannelCleanup(newChannel);
      }
    });
  }

  private abortCleanup(channel: Discord.VoiceChannel) {
    const guildConfig = this.activeGuilds[channel.guild.id];
    if (!guildConfig) {
      return;
    }
    if (guildConfig.channelTimeouts[channel.id]) {
      clearTimeout(guildConfig.channelTimeouts[channel.id]);
      delete guildConfig.channelTimeouts[channel.id];
    }
  }

  private queueChannelCleanup(channel: Discord.VoiceChannel, timeout = config.cleanupWindow) {
    const guildConfig = this.activeGuilds[channel.guild.id];
    if (!guildConfig) {
      return;
    }

    if (channel.parentID !== guildConfig.selfServiceCategoryID) {
      return;
    }

    guildConfig.channelTimeouts[channel.id] = setTimeout(() => {
      if (channel.parentID !== guildConfig.selfServiceCategoryID) {
        // abort delete operation if channel is moved
        return;
      }

      channel.delete(`Has gone unused for ${timeout} seconds`)
      .catch((e) => console.log(`Failed to delete ${channel.name} from ${channel.guild.name}: ${e}`));

    }, timeout * 1000);
  }

  private initGuild(guild: Discord.Guild) {
    const selfServiceCategory = guild.channels.find(c => (
      c instanceof Discord.CategoryChannel
      && c.name.toLocaleLowerCase() === config.categoryName.toLocaleLowerCase()
    )) as Discord.CategoryChannel;

    if (!selfServiceCategory) {
      console.log(`Could not find self-service category for ${guild.name}`);
      return;
    }

    let commandChannelID = '';
    const emptyChannels: Discord.VoiceChannel[] = [];
    for (const [key, channel] of selfServiceCategory.channels || []) {
      // find the command channel ID first within the self-service category
      if (channel instanceof Discord.TextChannel && channel.name.toLocaleLowerCase() === config.commandChannelName.toLocaleLowerCase()) {
        commandChannelID = channel.id;
      } else if (channel instanceof Discord.VoiceChannel && (!channel.voiceMembers || channel.voiceMembers.size === 0)) {
        emptyChannels.push(channel);
      }
    }

    // command channel was not in self-service category, search all channels
    if (!commandChannelID) {
      for (const [key, channel] of guild.channels) {
        if (channel instanceof Discord.TextChannel && channel.name.toLocaleLowerCase() === config.commandChannelName.toLocaleLowerCase()) {
          commandChannelID = channel.id;
          break;
        }
      }
    }

    if (!commandChannelID) {
      console.log(`Could not find command channel for ${guild.name}`);
      return;
    }

    this.activeGuilds[guild.id] = {
      selfServiceCategoryID: selfServiceCategory.id,
      commandChannelID,
      channelTimeouts: {},
    };

    // now that guild config is set, queue initial timeouts for any empty voice channels in our category
    for (const channel of emptyChannels) {
      this.queueChannelCleanup(channel);
    }
  }

  private voiceMemberJoinLeve(member: Discord.Member, newChannel?: Discord.VoiceChannel, oldChannel?: Discord.VoiceChannel) {
    if (oldChannel && (!oldChannel.voiceMembers || oldChannel.voiceMembers.size === 0)) {
      this.queueChannelCleanup(oldChannel);
    }

    if (newChannel) {
      this.abortCleanup(newChannel);
    }
  }
}

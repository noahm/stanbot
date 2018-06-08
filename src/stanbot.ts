import * as readline from 'readline';
import * as Discord from 'eris';
import * as config from './config';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const client = new Discord.Client(config.auth.token);

interface GuildConfig {
  selfServiceCategoryID: string;
  commandChannelID: string;
  /**
   * Mapping from voice channel ID to timeout handle
   */
  channelTimeouts: Record<string, NodeJS.Timer>;
}

const activeGuilds: Record<string, GuildConfig> = {};

function abortCleanup(channel: Discord.VoiceChannel) {
  const guildConfig = activeGuilds[channel.guild.id];
  if (!guildConfig) {
    return;
  }
  if (guildConfig.channelTimeouts[channel.id]) {
    clearTimeout(guildConfig.channelTimeouts[channel.id]);
    delete guildConfig.channelTimeouts[channel.id];
  }
}

function queueChannelCleanup(channel: Discord.VoiceChannel, timeout = config.selfServeVoice.cleanupWindow) {
  const guildConfig = activeGuilds[channel.guild.id];
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

function initGuild(guild: Discord.Guild) {
  const selfServiceCategory = guild.channels.find(c => (
    c instanceof Discord.CategoryChannel
    && c.name.toLocaleLowerCase() === config.selfServeVoice.categoryName.toLocaleLowerCase()
  )) as Discord.CategoryChannel;

  if (!selfServiceCategory) {
    console.log(`Could not find self-service category for ${guild.name}`);
    return;
  }

  let commandChannelID = '';
  const emptyChannels: Discord.VoiceChannel[] = [];
  for (const [key, channel] of selfServiceCategory.channels || []) {
    // find the command channel ID first within the self-service category
    if (channel instanceof Discord.TextChannel && channel.name.toLocaleLowerCase() === config.selfServeVoice.commandChannelName.toLocaleLowerCase()) {
      commandChannelID = channel.id;
    } else if (channel instanceof Discord.VoiceChannel && (!channel.voiceMembers || channel.voiceMembers.size === 0)) {
      emptyChannels.push(channel);
    }
  }

  // command channel was not in self-service category, search all channels
  if (!commandChannelID) {
    for (const [key, channel] of guild.channels) {
      if (channel instanceof Discord.TextChannel && channel.name.toLocaleLowerCase() === config.selfServeVoice.commandChannelName.toLocaleLowerCase()) {
        commandChannelID = channel.id;
        break;
      }
    }
  }

  if (!commandChannelID) {
    console.log(`Could not find command channel for ${guild.name}`);
    return;
  }

  activeGuilds[guild.id] = {
    selfServiceCategoryID: selfServiceCategory.id,
    commandChannelID,
    channelTimeouts: {},
  };

  // now that guild config is set, queue initial timeouts for any empty voice channels in our category
  for (const channel of emptyChannels) {
    queueChannelCleanup(channel);
  }
}

function voiceMemberJoinLeve(member: Discord.Member, newChannel?: Discord.VoiceChannel, oldChannel?: Discord.VoiceChannel) {
  if (oldChannel && (!oldChannel.voiceMembers || oldChannel.voiceMembers.size === 0)) {
    queueChannelCleanup(oldChannel);
  }

  if (newChannel) {
    abortCleanup(newChannel);
  }
}

client.on('ready', () => {
  console.log(`Stanbot is now online! Visit here to invite it to your server:`);
  console.log(`https://discordapp.com/oauth2/authorize?client_id=${config.auth.clientID}&scope=bot&permissions=16780304`);

  // look at all current guild memberships, find and catalog the IDs for the category and text channel for commands
  client.guilds.forEach(initGuild);

  console.log('Ready for action in these servers:');
  for (const guildID of Object.keys(activeGuilds)) {
    console.log('  ' + client.guilds.get(guildID)!.name);
  }
});

// Handle new joins
client.on('guildCreate', (guild: Discord.Guild) => {
  const guildConfig = activeGuilds[guild.id];
  if (guildConfig) {
    return;
  }
  initGuild(guild);
  console.log(`Joined ${guild.name}!`);
});

// Handle removal from a server
client.on('guildDelete', (guild: Discord.Guild) => {
  const guildConfig = activeGuilds[guild.id];
  if (!guildConfig) {
    return;
  }
  for (const channelID of Object.keys(guildConfig.channelTimeouts)) {
    clearTimeout(guildConfig.channelTimeouts[channelID]);
  }
  delete activeGuilds[guild.id];
  console.log(`Left ${guild.name}`);
});

// Watch messages sent
const playCommand = /^!letsplay (.+)$/;
client.on('messageCreate', (message: Discord.Message) => {
  if (!(message.channel instanceof Discord.GuildChannel) || !message.member) {
    // TODO: respond to DMs in some way?
    return;
  }

  const guildConfig = activeGuilds[message.channel.guild.id];
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
    queueChannelCleanup(newChannel as Discord.VoiceChannel, config.selfServeVoice.firstJoinWindow);
    message.addReaction('✅');
  }).catch(() => message.addReaction('🙅♀️'));

  // TODO: check if user is already in a voice channel and move them to the new channel???
});

// Watch members entering and leaving voice rooms
client.on('voiceChannelJoin', (member, newChannel) => voiceMemberJoinLeve(member, newChannel));
client.on('voiceChannelLeave', (member, oldChannel) => voiceMemberJoinLeve(member, undefined, oldChannel));
client.on('voiceChannelSwitch', (member, newChannel, oldChannel) => voiceMemberJoinLeve(member, newChannel, oldChannel));

// Watch channels being moved into our category
client.on('channelUpdate', (newChannel) => {
  if (!(newChannel instanceof Discord.VoiceChannel)) {
    return;
  }

  const guildConfig = activeGuilds[newChannel.guild.id];
  if (!guildConfig) {
    return;
  }

  if (newChannel.parentID === guildConfig.selfServiceCategoryID && (!newChannel.voiceMembers || newChannel.voiceMembers.size === 0)) {
    queueChannelCleanup(newChannel);
  }
});

client.connect();

rl.on('SIGINT', () => {
  client.disconnect({
    reconnect: false,
  });
  process.exit(0);
});

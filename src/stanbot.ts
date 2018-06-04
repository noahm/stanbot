import * as readline from 'readline';
import * as Discord from 'discord.js';
import * as config from './config';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const client = new Discord.Client({
  // One noisy event we can safely ignore completely
  disabledEvents: ['TYPING_START'],
});

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

    if (channel.deletable) {
      channel.delete(`Has gone unused for ${timeout} seconds`)
      .catch(() => console.log(`Failed to delete ${channel.name} from ${channel.guild.name}`));
    }
  }, timeout * 1000);
}

function initGuild(guild: Discord.Guild) {
  if (!guild.available) {
    console.log(`Skipping unavailable guild: ${guild.name}`);
    return;
  }

  const selfServiceCategory = guild.channels.find(c => (
    c.type === 'category'
    && c.name.toLocaleLowerCase() === config.selfServeVoice.categoryName.toLocaleLowerCase()
  )) as Discord.CategoryChannel;

  if (!selfServiceCategory) {
    console.log(`Could not find self-service category for ${guild.name}`);
    return;
  }

  let commandChannelID = '';
  const emptyChannels: Discord.VoiceChannel[] = [];
  for (const [channelID, channel] of selfServiceCategory.children) {
    // find the command channel ID first within the self-service category
    if (channel.type === 'text' && channel.name.toLocaleLowerCase() === config.selfServeVoice.commandChannelName.toLocaleLowerCase()) {
      commandChannelID = channelID;
    } else if (channel.type === 'voice' && (channel as Discord.VoiceChannel).members.size === 0) {
      emptyChannels.push(channel as Discord.VoiceChannel);
    }
  }

  // command channel was not in self-service category, search all channels
  if (!commandChannelID) {
    for (const [channelID, channel] of guild.channels) {
      if (channel.type === 'text' && channel.name.toLocaleLowerCase() === config.selfServeVoice.commandChannelName.toLocaleLowerCase()) {
        commandChannelID = channelID;
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
client.on('guildCreate', guild => {
  const guildConfig = activeGuilds[guild.id];
  if (guildConfig) {
    return;
  }
  initGuild(guild);
  console.log(`Joined ${guild.name}!`);
});

// Handle removal from a server
client.on('guildDelete', guild => {
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
client.on('message', message => {
  if (!message.guild) {
    // TODO: respond to DMs in some way?
    return;
  }

  const guildConfig = activeGuilds[message.guild.id];
  if (!guildConfig) {
    return;
  }

  if (message.channel.id !== guildConfig.commandChannelID) {
    // does not come from our dedicated command channel
    return;
  }

  const commandPieces = message.content.match(playCommand);
  const newChannelName = commandPieces && commandPieces[1] && commandPieces[1].trim();
  if (!newChannelName) {
    // not a valid command
    return;
  }

  message.guild.createChannel(
    newChannelName,
    'voice',
    undefined,
    `Requested by ${message.member.displayName}`,
  ).then(newChannel => {
    return newChannel.setParent(guildConfig.selfServiceCategoryID);
  }).then(newChannel => {
    queueChannelCleanup(newChannel as Discord.VoiceChannel, config.selfServeVoice.firstJoinWindow);
    message.react('✅');
  }).catch(() => message.react('🙅♀️'));

  // TODO: check if user is already in a voice channel and move them to the new channel???
});

// Watch members entering and leaving voice rooms
client.on('voiceStateUpdate', (oldMember, newMember) => {
  if (newMember.voiceChannel) {
    // user was not leaving a channel
    abortCleanup(newMember.voiceChannel);
    return;
  }

  if (!oldMember.voiceChannel) {
    // neither new member nor old member have a voice channel reference
    // this makes no sense
    return;
  }

  if (oldMember.voiceChannel.members.size !== 0) {
    // user left, but there are other members
    return;
  }

  queueChannelCleanup(oldMember.voiceChannel);
});

// Watch channels being moved into our category
client.on('channelUpdate', (oldChannel, newChannel) => {
  if (newChannel.type !== 'voice') {
    return;
  }

  // Assuming both are voice channels, since channel type is unchangable in discord UI
  const oldVoiceChannel = oldChannel as Discord.VoiceChannel;
  const newVoiceChannel = newChannel as Discord.VoiceChannel;

  const guildConfig = activeGuilds[newVoiceChannel.guild.id];
  if (!guildConfig) {
    return;
  }

  if (newVoiceChannel.parentID === guildConfig.selfServiceCategoryID && newVoiceChannel.members.size === 0) {
    queueChannelCleanup(newVoiceChannel);
  }
});

client.login(config.auth.token);

rl.on('SIGINT', () => {
  client.destroy()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
});

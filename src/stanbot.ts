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

client.on('ready', () => {
  console.log(`Stanbot is now online! Visit here to add to your server:`);
  console.log(`https://discordapp.com/oauth2/authorize?client_id=${config.auth.clientId}&scope=bot&permissions=16780304`);
});

const playCommand = /^!letsplay (.+)$/;
client.on('message', message => {
  const commandPieces = message.content.match(playCommand);
  const newChannelName = commandPieces && commandPieces[1] && commandPieces[1].trim();
  if (!newChannelName) {
    // not a valid command
    console.log('not a valid command', commandPieces);
    return;
  }
  console.log(`Creating voice channel ${newChannelName}`);
  // actually create the channel
  // check if user is in voice and move them to the new channel???
});

// clean up empty voice rooms
client.on('voiceStateUpdate', (oldMember, newMember) => {
  if (newMember.voiceChannel || !oldMember.voiceChannel) {
    // user was not leaving, a channel
    // check if user joined a channel we were planning to delete
    // if so, cancel that delete
    return;
  }
  if (oldMember.voiceChannel.members.size !== 0) {
    // user left, but there are other members
    return;
  }
  console.log(`${newMember.displayName} just left ${oldMember.voiceChannel.name} and it is now empty`);
  // set a timer for 60 seconds to remove the channel
});

client.login(config.auth.token);

rl.on('SIGINT', () => {
  client.destroy()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
});

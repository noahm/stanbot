import * as readline from 'readline';
import { Client } from 'eris';
import { auth } from './config';
import { SelfServeVoice } from './self-serve-voice';
import { Module } from './module';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const client = new Client(auth.token);
client.on('ready', () => {
  console.log(`Stanbot is now online! Visit here to invite it to your server:`);
  console.log(`https://discordapp.com/oauth2/authorize?client_id=${auth.clientID}&scope=bot&permissions=16780304`);
});

const modules: Module[] = [
  new SelfServeVoice(),
];

for (const m of modules) {
  m.init(client);
}

client.connect();

rl.on('SIGINT', () => {
  client.disconnect({
    reconnect: false,
  });
  process.exit(0);
});

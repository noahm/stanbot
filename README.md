# Stanbot
Making the GWJ discord server a nicer place since sometime in the future!

## Features
### Self-Service Voice Channels

A designated channel will be watched for `!letsplay {game_name}` commands.
When sent, the bot will create a voice channel named `game_name` in a
designated category. Any voice channel in that category that has not had
anyone join it within a configurable number of seconds will be deleted.

## Developing

1. `cp src/config.dist.ts src/config.ts` and follow the instructions inside
1. `npm i`
1. `npm start`

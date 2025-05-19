# OK Bot

A Discord bot to help decompilation servers manage work and empower contributors.

## Features
- Work Claiming: Allows users to claim a file to work on for a configurable amount of days. After the claim time limit passes, the user is pinged that their claim has expired. Users cannot claim already-claimed filenames.

## Setup
1. Install dependencies:
   ```sh
   npm install
   ```
2. Create a `.env` file with your Discord bot token:
   ```env
   DISCORD_TOKEN=your-bot-token-here
   ```
3. Run the bot (TypeScript):
   ```sh
   npx ts-node index.ts
   ```
   Or use the provided VS Code task "Run Discord Bot".

## Usage
- /claim
- /unclaim
- /setokchannel (Admin only)

## Requirements
- Node.js
- discord.js v14
- dayjs
- TypeScript
- ts-node

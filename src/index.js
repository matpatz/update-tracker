'use strict';

const fs = require('node:fs');
const { ActivityType, Client, GatewayIntentBits } = require('discord.js');
const { readConfig, validateConfig } = require('./config');
const { createLogger, formatDuration } = require('./utils');
const { Store } = require('./store');
const { Scheduler } = require('./scheduler');
const { WebhookClient } = require('./webhook');

const log = createLogger('bot');

function loadGames(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`could not read game list ${file}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`game list ${file} is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`game list ${file} must contain a JSON array`);

  const seen = new Set();
  const games = [];
  parsed.forEach((item, index) => {
    const universeId = Number(item?.universeId ?? item?.id);
    if (!Number.isSafeInteger(universeId) || universeId <= 0) {
      log.warn(`game list entry #${index + 1} has no usable universeId; skipping it`);
      return;
    }
    if (seen.has(universeId)) {
      log.warn(`game list entry #${index + 1} repeats universe ${universeId}; skipping it`);
      return;
    }
    seen.add(universeId);
    const placeId = Number(item.placeId);
    games.push({
      universeId,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `Universe ${universeId}`,
      placeId: Number.isSafeInteger(placeId) && placeId > 0 ? placeId : null,
    });
  });

  if (games.length === 0) throw new Error(`game list ${file} contains no usable games`);
  return games;
}

async function connectBot(config, gameCount) {
  if (!config.botToken) {
    log.warn('BOT_TOKEN is not set - running webhook-only, so the bot will not appear online');
    return null;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  let announced = false;
  const announce = () => {
    if (announced) return;
    announced = true;
    const presence = { name: `${gameCount} Roblox games`, type: ActivityType.Watching };
    client.user?.setPresence({ activities: [presence], status: 'online' });
    log.ok(`connected to Discord as ${client.user?.tag}`);
  };
  client.once('clientReady', announce);

  try {
    await client.login(config.botToken);
  } catch (error) {
    log.warn(`bot login failed (${error.message}) - continuing with webhook alerts only`);
    await client.destroy().catch(() => {});
    return null;
  }
  return client;
}

async function main() {
  const config = readConfig();
  const problems = validateConfig(config);
  if (problems.length > 0) {
    for (const problem of problems) log.error(problem);
    log.error('fix the .env file (see .env.example) and start again');
    process.exitCode = 1;
    return;
  }

  const games = loadGames(config.gamesFile);
  const store = Store.load(config.stateFile);
  const webhook = new WebhookClient({
    url: config.webhookUrl,
    username: config.webhookUsername,
    pingRoleId: config.pingRoleId,
    dryRun: config.dryRun,
  });

  const scheduler = new Scheduler({
    games,
    store,
    batchSize: config.batchSize,
    intervalMs: config.intervalMs,
    onChange: (changes) => webhook.notify(changes),
  });

  log.info(
    `plan: ${games.length} games · ${config.batchSize} per check every ${formatDuration(config.intervalMs)} ` +
      `· ${scheduler.ticksPerLap} checks per lap (~${formatDuration(scheduler.lapDurationMs)} per lap)` +
      (config.dryRun ? ' · DRY RUN (no Discord posts)' : ''),
  );

  try {
    await scheduler.bootstrap();
  } catch (error) {
    log.error(`could not save the baseline snapshot: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const client = await connectBot(config, games.length);
  scheduler.start();

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal} received - stopping`);
    scheduler.stop();
    try {
      store.save();
      log.info(`state saved to ${config.stateFile}`);
    } catch (error) {
      log.error(`could not save state: ${error.message}`);
    }
    if (client) await client.destroy().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log.error(`unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : reason}`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    log.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}

module.exports = { loadGames };

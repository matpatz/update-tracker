'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

/**
 * Roblox rejects `/v1/games` requests with more than 50 universe IDs, so this is
 * a hard ceiling; the per-tick batch size must stay at or below it.
 */
const MAX_BATCH_SIZE = 50;

function toInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function resolvePath(value, fallback) {
  const target = value && value.trim() ? value.trim() : fallback;
  return path.isAbsolute(target) ? target : path.join(ROOT, target);
}

function readConfig(env = process.env) {
  return {
    root: ROOT,
    botToken: env.BOT_TOKEN?.trim() || null,
    webhookUrl: env.CHANNEL_WEBHOOK?.trim() || null,
    pingRoleId: env.PING_ROLE_ID?.trim() || null,
    webhookUsername: env.WEBHOOK_USERNAME?.trim() || 'Update Tracker',
    batchSize: clamp(toInt(env.BATCH_SIZE, 5), 1, MAX_BATCH_SIZE),
    intervalMs: clamp(toInt(env.CHECK_INTERVAL_MS, 30_000), 5_000, 3_600_000),
    gamesFile: resolvePath(env.GAMES_FILE, 'data/games.json'),
    stateFile: resolvePath(env.STATE_FILE, 'data/state.json'),
    dryRun: /^(1|true|yes|on)$/i.test(env.DRY_RUN ?? ''),
  };
}

function validateConfig(config) {
  const problems = [];

  if (!config.webhookUrl) {
    problems.push('CHANNEL_WEBHOOK is not set.');
  } else if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/.test(config.webhookUrl)) {
    problems.push('CHANNEL_WEBHOOK does not look like a Discord webhook URL.');
  }

  if (config.pingRoleId && !/^\d{5,25}$/.test(config.pingRoleId)) {
    problems.push('PING_ROLE_ID must be a numeric Discord role ID.');
  }

  if (!fs.existsSync(config.gamesFile)) {
    problems.push(`Game list not found at ${config.gamesFile}`);
  }

  return problems;
}

module.exports = { ROOT, MAX_BATCH_SIZE, readConfig, validateConfig };

'use strict';

const { createLogger, chunk, sleep } = require('./utils');

const log = createLogger('roblox');

const GAMES_API = 'https://games.roblox.com/v1/games';
const ICONS_API = 'https://thumbnails.roblox.com/v1/places/gameicons';
const USER_AGENT = 'update-tracker/1.0 (+https://github.com/; discord bot)';
const MAX_IDS_PER_REQUEST = 50;
const DEFAULT_RETRIES = 4;
const DEFAULT_TIMEOUT_MS = 15_000;

const HEADERS = {
  accept: 'application/json',
  'user-agent': USER_AGENT,
};

class RobloxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RobloxError';
  }
}

function retryDelay(attempt, retryAfterHeader) {
  const serverWait = Number.parseFloat(retryAfterHeader ?? '');
  if (Number.isFinite(serverWait) && serverWait > 0) {
    return Math.min(serverWait * 1000, 30_000);
  }
  const backoff = 1000 * 2 ** (attempt - 1);
  return Math.min(backoff + Math.random() * 250, 20_000);
}

async function attemptFetch(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: HEADERS, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { ok: response.ok && body !== null, status: response.status, body, headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson(url, { retries = DEFAULT_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let lastError = new RobloxError(`request to ${url} never ran`);
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    let waitMs = 0;
    try {
      const result = await attemptFetch(url, timeoutMs);
      if (result.ok) return result.body;
      lastError = new RobloxError(`HTTP ${result.status} for ${url}`);
      const retryable = result.status === 429 || result.status >= 500;
      if (!retryable) break;
      waitMs = retryDelay(attempt, result.headers.get('retry-after'));
    } catch (error) {
      lastError = error;
      waitMs = retryDelay(attempt, null);
    }
    if (attempt < retries) {
      log.warn(`${lastError.message} - retrying in ${Math.round(waitMs)}ms (attempt ${attempt}/${retries})`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

function normalizeGame(item) {
  const placeId = item.rootPlaceId ?? null;
  return {
    universeId: item.id,
    name: item.name ?? `Universe ${item.id}`,
    updated: item.updated ?? null,
    placeId,
    url: placeId ? `https://www.roblox.com/games/${placeId}` : `https://www.roblox.com/games/${item.id}`,
    playing: Number.isFinite(item.playing) ? item.playing : null,
    visits: Number.isFinite(item.visits) ? item.visits : null,
    creator: item.creator?.name ?? null,
  };
}

/**
 * Fetch current details for up to 50 universe IDs in a single request (Roblox caps
 * the batch at 50), splitting larger lists into several requests.
 *
 * @returns {Promise<Map<number, object>>} universeId -> normalized details
 */
async function fetchUniverseDetails(universeIds, options = {}) {
  const ids = [...new Set(universeIds.filter((id) => Number.isFinite(id)))];
  const details = new Map();
  if (ids.length === 0) return details;

  for (const part of chunk(ids, MAX_IDS_PER_REQUEST)) {
    const body = await requestJson(`${GAMES_API}?universeIds=${part.join(',')}`, options);
    const rows = Array.isArray(body?.data) ? body.data : [];
    for (const row of rows) {
      const game = normalizeGame(row);
      details.set(game.universeId, game);
    }
  }
  return details;
}

/**
 * Best-effort game icons for a set of places. Failures degrade to "no thumbnail"
 * rather than blocking the alert.
 */
async function fetchGameIcons(placeIds, options = {}) {
  const icons = new Map();
  const ids = [...new Set(placeIds.filter((id) => Number.isFinite(id)))];
  if (ids.length === 0) return icons;

  for (const part of chunk(ids, MAX_IDS_PER_REQUEST)) {
    try {
      const url = `${ICONS_API}?placeIds=${part.join(',')}&size=512x512&format=Png&isCircular=false`;
      const body = await requestJson(url, { retries: 2, ...options });
      for (const row of Array.isArray(body?.data) ? body.data : []) {
        if (row?.targetId && row?.imageUrl) icons.set(row.targetId, row.imageUrl);
      }
    } catch (error) {
      log.warn(`could not load thumbnails: ${error.message}`);
    }
  }
  return icons;
}

module.exports = { RobloxError, MAX_IDS_PER_REQUEST, normalizeGame, fetchUniverseDetails, fetchGameIcons };

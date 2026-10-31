'use strict';

const { createLogger, sleep, unixSeconds, chunk } = require('./utils');
const { fetchGameIcons } = require('./roblox');

const log = createLogger('webhook');
const MAX_EMBEDS_PER_MESSAGE = 10;
const COLOR_UPDATE = 0x2ecc71;

function truncate(text, max) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function relativeStamp(iso) {
  const unix = unixSeconds(iso);
  return unix === null ? 'unknown' : `<t:${unix}:R>`;
}

function absoluteStamp(iso) {
  const unix = unixSeconds(iso);
  return unix === null ? 'unknown' : `<t:${unix}:f>`;
}

class WebhookClient {
  constructor({ url, username = 'Update Tracker', pingRoleId = null, dryRun = false, fetchIcons = fetchGameIcons }) {
    this.url = url;
    this.username = username;
    this.pingRoleId = pingRoleId;
    this.dryRun = dryRun;
    this.fetchIcons = fetchIcons;
  }

  buildEmbed(change, icons) {
    const { entry, previousUpdated } = change;
    const iconUrl = entry.placeId ? icons.get(entry.placeId) : null;
    const fields = [
      { name: 'Published', value: `${absoluteStamp(entry.updated)}\n${relativeStamp(entry.updated)}`, inline: true },
      { name: 'Previous version', value: absoluteStamp(previousUpdated), inline: true },
    ];

    return {
      title: truncate(entry.name ?? `Universe ${entry.universeId}`, 256),
      url: change.detail?.url ?? (entry.placeId ? `https://www.roblox.com/games/${entry.placeId}` : undefined),
      color: COLOR_UPDATE,
      description: 'A new version of this game was just published.',
      thumbnail: iconUrl ? { url: iconUrl } : undefined,
      fields,
      footer: { text: `Update Tracker · universe ${entry.universeId}` },
      timestamp: new Date(entry.updated ?? Date.now()).toISOString(),
    };
  }

  async notify(changes) {
    if (!changes || changes.length === 0) return;

    const placeIds = changes.map((change) => change.entry.placeId).filter((id) => Number.isFinite(id));
    const icons = await this.fetchIcons(placeIds);

    for (const group of chunk(changes, MAX_EMBEDS_PER_MESSAGE)) {
      const payload = {
        username: this.username,
        embeds: group.map((change) => this.buildEmbed(change, icons)),
        allowed_mentions: { parse: [], roles: this.pingRoleId ? [this.pingRoleId] : [] },
      };
      if (this.pingRoleId) payload.content = `<@&${this.pingRoleId}>`;

      await this.send(payload);
      if (!this.dryRun) log.ok(`posted ${group.length} update alert(s) to Discord`);
    }
  }

  async send(payload, attempt = 1) {
    if (this.dryRun) {
      log.info(`[dry-run] would post: ${payload.embeds.map((embed) => embed.title).join(', ')}`);
      return null;
    }

    const response = await fetch(`${this.url}?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) return response.json().catch(() => null);

    if (response.status === 429 && attempt < 4) {
      const body = await response.json().catch(() => ({}));
      const waitMs = Math.min((body?.retry_after ?? 1) * 1000, 15_000);
      log.warn(`rate limited by Discord, retrying in ${Math.round(waitMs)}ms`);
      await sleep(waitMs);
      return this.send(payload, attempt + 1);
    }

    if (response.status >= 500 && attempt < 3) {
      await sleep(1000 * attempt);
      return this.send(payload, attempt + 1);
    }

    const body = await response.text().catch(() => '');
    throw new Error(`webhook POST failed: HTTP ${response.status} ${body.slice(0, 200)}`);
  }
}

module.exports = { WebhookClient, MAX_EMBEDS_PER_MESSAGE };

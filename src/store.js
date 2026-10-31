'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createLogger } = require('./utils');

const log = createLogger('store');
const STATE_VERSION = 1;

function emptyState() {
  return {
    version: STATE_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    cursor: 0,
    lap: 0,
    games: {},
  };
}

class Store {
  constructor(file, state) {
    this.file = file;
    this.state = state ?? emptyState();
  }

  static load(file) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') log.warn(`could not read ${file}: ${error.message}`);
      return new Store(file);
    }

    if (!raw.trim()) return new Store(file);

    try {
      const state = JSON.parse(raw);
      if (!state || typeof state !== 'object' || typeof state.games !== 'object' || state.games === null) {
        throw new Error('unexpected shape');
      }
      state.version ??= STATE_VERSION;
      state.cursor = Number.isInteger(state.cursor) ? state.cursor : 0;
      state.lap = Number.isInteger(state.lap) ? state.lap : 0;
      return new Store(file, state);
    } catch (error) {
      const backup = `${file}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(file, backup);
        log.warn(`${file} was unreadable (${error.message}); moved to ${path.basename(backup)} and starting fresh`);
      } catch {
        log.warn(`${file} was unreadable (${error.message}); starting fresh`);
      }
      return new Store(file);
    }
  }

  get size() {
    return Object.keys(this.state.games).length;
  }

  get cursor() {
    return this.state.cursor;
  }

  set cursor(value) {
    this.state.cursor = value;
  }

  get lap() {
    return this.state.lap;
  }

  snapshot(universeId) {
    return this.state.games[String(universeId)] ?? null;
  }

  has(universeId) {
    return Boolean(this.snapshot(universeId));
  }

  /** Universe IDs from the game list that have no saved version yet. */
  missingSnapshots(games) {
    return games.filter((game) => !this.has(game.universeId)).map((game) => game.universeId);
  }

  /**
   * Compare a freshly fetched game against its saved snapshot and record it.
   * A first sighting is never an update; it just seeds the snapshot.
   */
  applyCheck(details) {
    const key = String(details.universeId);
    const now = new Date().toISOString();
    const entry = this.state.games[key];

    if (!entry) {
      const created = {
        universeId: details.universeId,
        name: details.name,
        placeId: details.placeId ?? null,
        updated: details.updated ?? null,
        firstSeenAt: now,
        lastCheckedAt: now,
        lastChangedAt: null,
        previousUpdated: null,
        changes: 0,
      };
      this.state.games[key] = created;
      return { status: 'new', entry: created };
    }

    entry.name = details.name || entry.name;
    entry.placeId = details.placeId ?? entry.placeId;
    entry.lastCheckedAt = now;

    if (!details.updated || !entry.updated || details.updated === entry.updated) {
      if (!entry.updated && details.updated) entry.updated = details.updated;
      return { status: 'unchanged', entry };
    }

    const previousUpdated = entry.updated;
    entry.updated = details.updated;
    entry.previousUpdated = previousUpdated;
    entry.lastChangedAt = now;
    entry.changes = (entry.changes ?? 0) + 1;
    return { status: 'changed', entry, previousUpdated };
  }

  /** Move the round-robin cursor forward, wrapping to the top of the list. */
  advanceCursor(step, total) {
    if (total <= 0) return this.state.cursor;
    this.state.cursor += step;
    if (this.state.cursor >= total) {
      this.state.cursor %= total;
      this.state.lap = (this.state.lap ?? 0) + 1;
    }
    return this.state.cursor;
  }

  /** Undo the last detected change so it is announced again on the next check. */
  revert(entry) {
    if (!entry || !entry.previousUpdated) return;
    entry.updated = entry.previousUpdated;
    entry.previousUpdated = null;
    entry.changes = Math.max(0, (entry.changes ?? 1) - 1);
  }

  save() {
    this.state.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store, STATE_VERSION, emptyState };

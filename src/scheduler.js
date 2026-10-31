'use strict';

const { createLogger, formatDuration } = require('./utils');
const { fetchUniverseDetails } = require('./roblox');

const log = createLogger('scheduler');

class Scheduler {
  constructor({ games, store, batchSize = 5, intervalMs = 30_000, fetchDetails = fetchUniverseDetails, onChange = null }) {
    this.games = games;
    this.store = store;
    this.batchSize = Math.max(1, Math.min(batchSize, games.length || 1));
    this.intervalMs = intervalMs;
    this.fetchDetails = fetchDetails;
    this.onChange = onChange;
    this.timer = null;
    this.running = false;
    this.ticks = 0;
    this.errors = 0;
    this.lastTickAt = null;
    this.unavailable = new Set();
    this._warnedUnavailable = new Set();
  }

  get ticksPerLap() {
    return Math.ceil(this.games.length / this.batchSize);
  }

  get lapDurationMs() {
    return this.ticksPerLap * this.intervalMs;
  }

  /** Save a baseline for every game that has no snapshot yet. Never alerts. */
  async bootstrap() {
    const missing = this.store.missingSnapshots(this.games);
    if (missing.length === 0) {
      log.info(`baseline snapshot already covers all ${this.games.length} game(s)`);
      return 0;
    }

    log.info(`saving baseline snapshot for ${missing.length} game(s)...`);
    const details = await this.fetchDetails(missing);
    let saved = 0;
    for (const universeId of missing) {
      const detail = details.get(universeId);
      if (!detail) {
        this.markUnavailable(universeId);
        continue;
      }
      this.store.applyCheck(detail);
      saved += 1;
    }
    this.store.save();
    log.ok(`baseline saved for ${saved}/${missing.length} game(s)`);
    return saved;
  }

  nextBatch() {
    const total = this.games.length;
    if (total === 0) return [];
    const start = this.store.cursor % total;
    const batch = [];
    for (let offset = 0; offset < this.batchSize; offset += 1) {
      batch.push(this.games[(start + offset) % total]);
    }
    return batch;
  }

  async tick() {
    const batch = this.nextBatch();
    if (batch.length === 0) return [];

    const total = this.games.length;
    const ids = batch.map((game) => game.universeId);
    const changes = [];

    try {
      const details = await this.fetchDetails(ids);
      for (const game of batch) {
        const detail = details.get(game.universeId);
        if (!detail) {
          this.markUnavailable(game.universeId, game);
          continue;
        }
        this.unavailable.delete(game.universeId);
        const result = this.store.applyCheck(detail);
        if (result.status === 'changed') changes.push({ ...result, detail });
      }
    } catch (error) {
      this.errors += 1;
      log.error(`check failed for batch starting at universe ${ids[0]}: ${error.message}`);
    }

    this.store.advanceCursor(batch.length, total);
    this.store.save();
    this.ticks += 1;
    this.lastTickAt = new Date();

    const label = changes.length === 1 ? '1 update' : `${changes.length} updates`;
    log.info(
      `lap ${this.store.lap + 1} · checked ${batch.length}/${total} ` +
        `(next: #${this.store.cursor + 1}) · ${label}`,
    );

    if (changes.length > 0 && this.onChange) {
      try {
        await this.onChange(changes);
      } catch (error) {
        // Keep the old snapshot so the next lap re-detects and re-announces this update.
        log.error(`alert delivery failed: ${error.message} - will retry next lap`);
        for (const change of changes) this.store.revert(change.entry);
        this.store.save();
      }
    }

    return changes;
  }

  markUnavailable(universeId, game) {
    this.unavailable.add(universeId);
    if (this._warnedUnavailable.has(universeId)) return;
    this._warnedUnavailable.add(universeId);
    const name = game?.name ? ` (${game.name})` : '';
    log.warn(`universe ${universeId}${name} returned no data; leaving its snapshot untouched`);
  }

  start() {
    if (this.timer || this.running) return this;
    log.info(
      `watching ${this.games.length} game(s), ${this.batchSize} per tick every ${formatDuration(this.intervalMs)} ` +
        `- a full lap takes ~${formatDuration(this.lapDurationMs)}`,
    );
    this.schedule(this.intervalMs);
    return this;
  }

  schedule(delayMs) {
    this.timer = setTimeout(() => {
      void this.runOnce();
    }, delayMs);
  }

  async runOnce() {
    if (this.running) return;
    this.running = true;
    const startedAt = Date.now();
    try {
      await this.tick();
    } catch (error) {
      this.errors += 1;
      log.error(`unexpected tick failure: ${error.stack ?? error.message}`);
    } finally {
      this.running = false;
    }
    this.schedule(Math.max(0, this.intervalMs - (Date.now() - startedAt)));
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  status() {
    return {
      games: this.games.length,
      batchSize: this.batchSize,
      intervalMs: this.intervalMs,
      lapDurationMs: this.lapDurationMs,
      cursor: this.store.cursor,
      laps: this.store.lap,
      snapshots: this.store.size,
      ticks: this.ticks,
      errors: this.errors,
      unavailable: this.unavailable.size,
      lastTickAt: this.lastTickAt,
    };
  }
}

module.exports = { Scheduler };

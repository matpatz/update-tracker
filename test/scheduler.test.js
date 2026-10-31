'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { Store } = require('../src/store');
const { Scheduler } = require('../src/scheduler');

function newStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-tracker-'));
  return new Store(path.join(dir, 'state.json'));
}

function makeGames(count) {
  return Array.from({ length: count }, (_, index) => ({
    universeId: 1000 + index,
    name: `Game ${index}`,
    placeId: 5000 + index,
  }));
}

/** Stand-in for Roblox that reports versions from a mutable map. */
function fakeFetcher(versions, calls = []) {
  return async (ids) => {
    calls.push([...ids]);
    const out = new Map();
    for (const id of ids) {
      const updated = versions[id];
      if (updated === undefined) continue;
      out.set(id, {
        universeId: id,
        name: `Game ${id}`,
        updated,
        placeId: id + 4000,
        url: `https://www.roblox.com/games/${id + 4000}`,
      });
    }
    return out;
  };
}

test('each tick checks a batch and rotates through the list', async () => {
  const games = makeGames(12);
  const versions = Object.fromEntries(games.map((game) => [game.universeId, 'v1']));
  const calls = [];
  const scheduler = new Scheduler({
    games,
    store: newStore(),
    batchSize: 5,
    intervalMs: 30_000,
    fetchDetails: fakeFetcher(versions, calls),
  });

  await scheduler.tick();
  await scheduler.tick();
  await scheduler.tick();

  const ids = games.map((game) => game.universeId);
  assert.deepEqual(calls[0], ids.slice(0, 5));
  assert.deepEqual(calls[1], ids.slice(5, 10));
  assert.deepEqual(calls[2], [...ids.slice(10, 12), ...ids.slice(0, 3)]);
  assert.equal(scheduler.status().cursor, 3);
  assert.equal(scheduler.status().laps, 1);
});

test('a full lap touches every game exactly once', async () => {
  const games = makeGames(10);
  const versions = Object.fromEntries(games.map((game) => [game.universeId, 'v1']));
  const calls = [];
  const scheduler = new Scheduler({
    games,
    store: newStore(),
    batchSize: 5,
    intervalMs: 1000,
    fetchDetails: fakeFetcher(versions, calls),
  });

  await scheduler.tick();
  await scheduler.tick();

  const checked = calls.flat().sort((a, b) => a - b);
  assert.deepEqual(checked, games.map((game) => game.universeId));
  assert.equal(scheduler.status().lapDurationMs, 2000);
});

test('only a real version change is announced, and only once', async () => {
  const games = makeGames(3);
  const versions = Object.fromEntries(games.map((game) => [game.universeId, 'v1']));
  const alerts = [];
  const scheduler = new Scheduler({
    games,
    store: newStore(),
    batchSize: 3,
    intervalMs: 1000,
    fetchDetails: fakeFetcher(versions),
    onChange: async (changes) => alerts.push(changes),
  });

  await scheduler.bootstrap();
  await scheduler.tick();
  assert.equal(alerts.length, 0);

  versions[1001] = 'v2';
  const changes = await scheduler.tick();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].entry.universeId, 1001);
  assert.equal(changes[0].previousUpdated, 'v1');
  assert.equal(alerts.length, 1);

  await scheduler.tick();
  assert.equal(alerts.length, 1);
});

test('a failed webhook keeps the snapshot so the update is retried next lap', async () => {
  const games = makeGames(2);
  const versions = Object.fromEntries(games.map((game) => [game.universeId, 'v1']));
  const store = newStore();
  let attempts = 0;
  const scheduler = new Scheduler({
    games,
    store,
    batchSize: 2,
    intervalMs: 1000,
    fetchDetails: fakeFetcher(versions),
    onChange: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('discord is down');
    },
  });

  await scheduler.bootstrap();
  versions[1000] = 'v2';
  await scheduler.tick();
  assert.equal(store.snapshot(1000).updated, 'v1');

  const retried = await scheduler.tick();
  assert.equal(retried.length, 1);
  assert.equal(store.snapshot(1000).updated, 'v2');
});

test('a failed Roblox request still advances the cursor and is counted', async () => {
  const scheduler = new Scheduler({
    games: makeGames(4),
    store: newStore(),
    batchSize: 2,
    intervalMs: 1000,
    fetchDetails: async () => {
      throw new Error('boom');
    },
  });

  await scheduler.tick();
  assert.equal(scheduler.status().errors, 1);
  assert.equal(scheduler.status().cursor, 2);
});

test('games Roblox does not return are skipped without touching their snapshot', async () => {
  const games = makeGames(2);
  const store = newStore();
  const scheduler = new Scheduler({
    games,
    store,
    batchSize: 2,
    intervalMs: 1000,
    fetchDetails: fakeFetcher({ 1000: 'v1' }),
  });

  await scheduler.tick();

  assert.equal(store.snapshot(1001), null);
  assert.equal(scheduler.status().unavailable, 1);
  assert.equal(store.snapshot(1000).updated, 'v1');
});

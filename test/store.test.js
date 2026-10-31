'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { Store } = require('../src/store');

function tempFile(name = 'state.json') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-tracker-'));
  return path.join(dir, name);
}

function details(universeId, updated) {
  return {
    universeId,
    name: `Game ${universeId}`,
    updated,
    placeId: universeId * 10,
    url: `https://www.roblox.com/games/${universeId * 10}`,
  };
}

test('a first sighting seeds the snapshot without counting as an update', () => {
  const store = new Store(tempFile());
  const result = store.applyCheck(details(1, '2026-01-01T00:00:00.000Z'));

  assert.equal(result.status, 'new');
  assert.equal(store.snapshot(1).updated, '2026-01-01T00:00:00.000Z');
  assert.equal(store.snapshot(1).changes, 0);
});

test('an unchanged version reports unchanged', () => {
  const store = new Store(tempFile());
  store.applyCheck(details(1, '2026-01-01T00:00:00.000Z'));

  assert.equal(store.applyCheck(details(1, '2026-01-01T00:00:00.000Z')).status, 'unchanged');
  assert.equal(store.snapshot(1).changes, 0);
});

test('a new version reports the change and remembers the previous one', () => {
  const store = new Store(tempFile());
  store.applyCheck(details(1, '2026-01-01T00:00:00.000Z'));

  const result = store.applyCheck(details(1, '2026-02-02T00:00:00.000Z'));
  assert.equal(result.status, 'changed');
  assert.equal(result.previousUpdated, '2026-01-01T00:00:00.000Z');
  assert.equal(store.snapshot(1).updated, '2026-02-02T00:00:00.000Z');
  assert.equal(store.snapshot(1).changes, 1);
});

test('a missing updated timestamp never fakes an update', () => {
  const store = new Store(tempFile());
  store.applyCheck(details(1, '2026-01-01T00:00:00.000Z'));

  assert.equal(store.applyCheck(details(1, null)).status, 'unchanged');
  assert.equal(store.snapshot(1).updated, '2026-01-01T00:00:00.000Z');
});

test('reverting a change makes the next check alert again', () => {
  const store = new Store(tempFile());
  store.applyCheck(details(1, '2026-01-01T00:00:00.000Z'));
  const change = store.applyCheck(details(1, '2026-02-02T00:00:00.000Z'));

  store.revert(change.entry);
  assert.equal(store.snapshot(1).updated, '2026-01-01T00:00:00.000Z');
  assert.equal(store.applyCheck(details(1, '2026-02-02T00:00:00.000Z')).status, 'changed');
});

test('the cursor wraps back to the top and counts laps', () => {
  const store = new Store(tempFile());
  assert.equal(store.advanceCursor(5, 10), 5);
  assert.equal(store.advanceCursor(5, 10), 0);
  assert.equal(store.lap, 1);
  assert.equal(store.advanceCursor(5, 10), 5);
  assert.equal(store.lap, 1);
});

test('state survives a save/load round trip', () => {
  const file = tempFile();
  const first = Store.load(file);
  first.applyCheck(details(7, '2026-03-03T00:00:00.000Z'));
  first.advanceCursor(3, 10);
  first.save();

  const second = Store.load(file);
  assert.equal(second.cursor, 3);
  assert.equal(second.snapshot(7).updated, '2026-03-03T00:00:00.000Z');
  assert.equal(second.snapshot(7).placeId, 70);
});

test('an empty or missing state file starts clean', () => {
  const file = tempFile();
  fs.writeFileSync(file, '');
  assert.equal(Store.load(file).size, 0);
  assert.equal(Store.load(path.join(path.dirname(file), 'nope.json')).size, 0);
});

test('missingSnapshots lists only games without a saved version', () => {
  const store = new Store(tempFile());
  store.applyCheck(details(1, '2026-01-01T00:00:00.000Z'));

  const games = [{ universeId: 1 }, { universeId: 2 }, { universeId: 3 }];
  assert.deepEqual(store.missingSnapshots(games), [2, 3]);
});

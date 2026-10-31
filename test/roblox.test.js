'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { MAX_IDS_PER_REQUEST, fetchUniverseDetails, normalizeGame } = require('../src/roblox');

test('a raw game row is normalized into a usable record', () => {
  const game = normalizeGame({
    id: 99,
    rootPlaceId: 111,
    name: 'Some Game',
    updated: '2026-05-05T10:00:00.000Z',
    playing: 12,
    visits: 3456,
    creator: { name: 'Studio' },
  });

  assert.deepEqual(game, {
    universeId: 99,
    name: 'Some Game',
    updated: '2026-05-05T10:00:00.000Z',
    placeId: 111,
    url: 'https://www.roblox.com/games/111',
    playing: 12,
    visits: 3456,
    creator: 'Studio',
  });
});

test('a row with missing fields still yields a record', () => {
  const game = normalizeGame({ id: 5 });

  assert.equal(game.universeId, 5);
  assert.equal(game.name, 'Universe 5');
  assert.equal(game.updated, null);
  assert.equal(game.placeId, null);
  assert.equal(game.url, 'https://www.roblox.com/games/5');
  assert.equal(game.playing, null);
});

test(`more than ${MAX_IDS_PER_REQUEST} ids are fetched in several requests`, async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    const ids = new URL(url).searchParams.get('universeIds').split(',').map(Number);
    return new Response(JSON.stringify({ data: ids.map((id) => ({ id, name: `G${id}`, updated: 'v1', rootPlaceId: id })) }), {
      status: 200,
    });
  };
  try {
    const ids = Array.from({ length: 120 }, (_, index) => index + 1);
    const details = await fetchUniverseDetails(ids);

    assert.equal(urls.length, 3);
    assert.equal(details.size, 120);
    assert.equal(details.get(120).name, 'G120');
  } finally {
    globalThis.fetch = original;
  }
});

test('duplicate and invalid ids are de-duplicated before fetching', async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return new Response(JSON.stringify({ data: [{ id: 7, name: 'G7', updated: 'v1', rootPlaceId: 70 }] }), { status: 200 });
  };
  try {
    const details = await fetchUniverseDetails([7, 7, null, undefined]);
    assert.equal(urls.length, 1);
    assert.equal(details.size, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('a 404 is not retried', async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response('{"errors":[]}', { status: 404 });
  };
  try {
    await assert.rejects(() => fetchUniverseDetails([1]), /HTTP 404/);
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('a 500 is retried and then reported', async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response('oops', { status: 503 });
  };
  try {
    await assert.rejects(() => fetchUniverseDetails([1], { retries: 2 }), /HTTP 503/);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = original;
  }
});

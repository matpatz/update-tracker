'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { WebhookClient } = require('../src/webhook');

function client(overrides = {}) {
  return new WebhookClient({
    url: 'https://discord.com/api/webhooks/1/abc',
    fetchIcons: async () => new Map(),
    ...overrides,
  });
}

function change(overrides = {}) {
  return {
    status: 'changed',
    previousUpdated: '2026-01-01T00:00:00.000Z',
    entry: {
      universeId: 123,
      name: 'Grow a Garden',
      placeId: 456,
      updated: '2026-02-02T00:00:00.000Z',
      changes: 3,
    },
    detail: {
      creator: 'Splitting Point Studios',
      playing: 4200,
      url: 'https://www.roblox.com/games/456',
    },
    ...overrides,
  };
}

test('the alert embed links the game and shows both versions', () => {
  const embed = client().buildEmbed(change(), new Map([[456, 'https://tr.rbxcdn.com/icon.png']]));

  assert.equal(embed.title, 'Grow a Garden');
  assert.equal(embed.url, 'https://www.roblox.com/games/456');
  assert.equal(embed.thumbnail.url, 'https://tr.rbxcdn.com/icon.png');
  assert.match(embed.fields[0].value, /<t:\d+:f>/);
  assert.match(embed.fields[1].value, /<t:1767225600:f>/);
  assert.equal(embed.footer.text, 'Update Tracker · universe 123');
  assert.equal(embed.timestamp, '2026-02-02T00:00:00.000Z');
  assert.deepEqual(embed.fields.map((field) => field.name), ['Published', 'Previous version']);
});

test('the embed survives missing thumbnails, creators and long names', () => {
  const longName = 'x'.repeat(400);
  const embed = client().buildEmbed(
    change({ entry: { universeId: 9, name: longName, placeId: null, updated: '2026-02-02T00:00:00.000Z' }, detail: {} }),
    new Map(),
  );

  assert.equal(embed.title.length, 256);
  assert.equal(embed.thumbnail, undefined);
  assert.equal(embed.url, undefined);
  assert.equal(embed.fields.length, 2);
});

test('a dry run never calls Discord', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response('{}', { status: 200 });
  };
  try {
    await client({ dryRun: true }).notify([change(), change()]);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('a 429 is retried, then the alert is delivered', async () => {
  const original = globalThis.fetch;
  const statuses = [429, 200];
  const bodies = [{ retry_after: 0.01 }, { id: '42' }];
  globalThis.fetch = async () => {
    const status = statuses.shift();
    return new Response(JSON.stringify(bodies.shift()), { status });
  };
  try {
    const message = await client().send({ embeds: [{ title: 'x' }] });
    assert.equal(message.id, '42');
  } finally {
    globalThis.fetch = original;
  }
});

test('a hard failure is surfaced so the snapshot can be retried', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('nope', { status: 401 });
  try {
    await assert.rejects(() => client().send({ embeds: [] }), /HTTP 401/);
  } finally {
    globalThis.fetch = original;
  }
});

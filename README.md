# Roblox Update Tracker

A quiet Discord bot that watches a list of Roblox games and posts to a channel the moment one of them ships an update.

Node.js 18+ · no build step · zero-config storage (two JSON files).

## How it works

1. **Baseline** — on first start it saves the current version (Roblox's `updated` timestamp) of every game in `data/games.json` to `data/state.json`. Nothing is announced for that first pass.
2. **Round-robin checks** — every 30 seconds it checks the next 5 games, then moves on. After the last game it wraps back to the top and starts a new lap.
3. **Batched requests** — all 5 universe IDs go out in a *single* `games.roblox.com/v1/games` call (Roblox accepts up to 50 IDs per request), so 100 games cost 20 requests every 10 minutes.
4. **Alerts** — if a game's `updated` timestamp differs from its snapshot, the webhook posts an embed and the snapshot is updated, so each publish is announced exactly once.

5 games per 30 s → 10 games/min → a 100-game lap takes ~10 minutes, so any update is caught within roughly 10 minutes.

If Discord rejects an alert, the snapshot is rolled back for that game so the next lap re-detects it and tries again instead of silently dropping it.

## Requirements

- Node.js 18 or newer (`node --version`)
- A Discord channel webhook URL
- Optional: a bot token if you want the bot to show up as online

## Setup

```powershell
npm install
```

Copy `.env.example` to `.env` and fill it in:

| Variable | Required | Description |
| --- | --- | --- |
| `BOT_TOKEN` | no | Makes the bot appear online with a "Watching N Roblox games" presence. Alerts work without it. |
| `CHANNEL_WEBHOOK` | **yes** | Discord channel webhook that receives the alerts. |
| `PING_ROLE_ID` | no | Role ID to mention in each alert. |
| `BATCH_SIZE` | no | Games per check (default `5`, max `50`). |
| `CHECK_INTERVAL_MS` | no | Delay between checks (default `30000`). |
| `WEBHOOK_USERNAME` | no | Name the alerts are posted as (default `Update Tracker`). |
| `DRY_RUN` | no | `1` logs alerts instead of posting them. |

Run it:

```powershell
npm start
```

## Editing the game list

`data/games.json` is an array of games. The copy in this repo only holds placeholder entries — replace them with your own:

```json
[{ "universeId": 7896346755, "placeId": 130526979296684, "name": "+1 Age Every Click" }]
```

`universeId` is what the version check needs; `placeId` is only used for links and thumbnails. New games are picked up automatically and get a silent baseline on the next start. Removing a game just drops it from future laps — its snapshot is kept.

## State file

`data/state.json` holds the snapshots and the round-robin cursor. The committed copy is an empty example (`"games": {}`), so a fresh clone starts by baselining everything and announcing nothing.

Once the bot runs, that file is rewritten in place, so it will show up as modified in git. Delete it (or set `STATE_FILE` to a path outside the repo) to re-baseline everything — this discards the "already announced" memory.

## Project layout

```
src/
  index.js      entry point: config check, baseline, bot presence, shutdown
  config.js     env parsing, validation, path resolution
  scheduler.js  round-robin batching, change detection, rollback on failed alert
  store.js      state snapshots, cursor/lap bookkeeping, atomic saves
  roblox.js     Roblox API client with retries, backoff and 50-ID chunking
  webhook.js    Discord embed building and posting
  utils.js      logger, sleep, chunk, duration and timestamp helpers
data/
  games.json    the watch list
  state.json    snapshots + cursor (empty example)
test/           node:test suites for scheduler, store, webhook and Roblox client
```

## Tests

```powershell
npm test
```

Uses the built-in `node:test` runner — no extra dependencies. CI runs the suite on Node 18, 20 and 22 for every push and pull request.

## Contributing

Issues and pull requests are welcome. Please run `npm test` before opening a PR, keep the "no runtime dependencies beyond `discord.js` + `dotenv`" rule, and keep the existing file layout.

## License

[MIT](LICENSE) — free to use, modify and redistribute, including commercially. Keep the copyright notice.
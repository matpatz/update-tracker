'use strict';

const COLORS = {
  info: '\x1b[36m',
  ok: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function clock() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function createLogger(scope = '') {
  const prefix = scope ? `${DIM}[${scope}]${RESET} ` : '';
  const emit = (level, message) => {
    const tag = useColor
      ? `${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET}`
      : level.toUpperCase().padEnd(5);
    const stamp = useColor ? `${DIM}${clock()}${RESET}` : clock();
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(`${stamp} ${tag} ${prefix}${message}\n`);
  };
  return {
    info: (message) => emit('info', message),
    ok: (message) => emit('ok', message),
    warn: (message) => emit('warn', message),
    error: (message) => emit('error', message),
    child: (childScope) => createLogger(scope ? `${scope}:${childScope}` : childScope),
  };
}

const log = createLogger();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function chunk(list, size) {
  const out = [];
  for (let index = 0; index < list.length; index += size) {
    out.push(list.slice(index, index + size));
  }
  return out;
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function unixSeconds(value) {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

module.exports = { createLogger, log, sleep, chunk, formatDuration, unixSeconds };

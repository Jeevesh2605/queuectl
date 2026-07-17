'use strict';
const { configObject } = require('../db');
const VALID_KEYS = new Set(['max-retries', 'backoff-base']);
function setConfig(db, key, value) {
  if (!VALID_KEYS.has(key)) throw new Error(`Unknown config key "${key}". Valid keys: ${[...VALID_KEYS].join(', ')}`);
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || (key === 'max-retries' && !Number.isInteger(numeric))) {
    throw new Error(`${key} must be a positive ${key === 'max-retries' ? 'integer' : 'number'}`);
  }
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  return configObject(db);
}
module.exports = { setConfig };

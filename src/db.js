'use strict';

const Database = require('better-sqlite3');
const path = require('node:path');

const BOOTSTRAP_CONFIG = Object.freeze({ 'max-retries': '3', 'backoff-base': '2' });

function databasePath(value) {
  return value || process.env.QUEUECTL_DB || path.resolve(process.cwd(), 'queuectl.db');
}

function openDatabase(value) {
  const db = new Database(databasePath(value));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','processing','completed','failed','dead')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      available_at TEXT NOT NULL,
      locked_by TEXT,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(state, available_at, created_at);
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workers (
      pid INTEGER PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('running','stopping')),
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const seed = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
  for (const [key, configValue] of Object.entries(BOOTSTRAP_CONFIG)) seed.run(key, configValue);
  return db;
}

function now() { return new Date().toISOString(); }

function getConfig(db, key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  if (!row) throw new Error(`Missing configuration value: ${key}`);
  return row.value;
}

function configObject(db) {
  return Object.fromEntries(db.prepare('SELECT key, value FROM config ORDER BY key').all().map((row) => [row.key, row.value]));
}

function recoverAbandonedJobs(db) {
  const timestamp = now();
  const activePids = new Set();
  for (const { pid } of db.prepare("SELECT pid FROM workers WHERE status IN ('running', 'stopping')").all()) {
    try { process.kill(pid, 0); activePids.add(String(pid)); } catch { db.prepare('DELETE FROM workers WHERE pid = ?').run(pid); }
  }
  const abandoned = db.prepare("SELECT id, locked_by FROM jobs WHERE state = 'processing'").all()
    .filter((job) => !job.locked_by || !activePids.has(String(job.locked_by)));
  const reset = db.prepare("UPDATE jobs SET state = 'pending', locked_by = NULL, updated_at = ? WHERE id = ? AND state = 'processing'");
  for (const job of abandoned) reset.run(timestamp, job.id);
  return abandoned.length;
}

// BEGIN IMMEDIATE serializes the select/update portion across separate worker processes.
function claimNextJob(db, workerId) {
  const claim = db.transaction(() => {
    const timestamp = now();
    const job = db.prepare(`SELECT * FROM jobs
      WHERE state IN ('pending', 'failed') AND available_at <= ?
      ORDER BY available_at, created_at LIMIT 1`).get(timestamp);
    if (!job) return null;
    const updated = db.prepare(`UPDATE jobs SET state = 'processing', locked_by = ?, updated_at = ?
      WHERE id = ? AND state IN ('pending', 'failed') AND available_at <= ?`)
      .run(workerId, timestamp, job.id, timestamp);
    return updated.changes === 1 ? { ...job, state: 'processing', locked_by: workerId } : null;
  });
  return claim.immediate();
}

module.exports = { openDatabase, databasePath, now, getConfig, configObject, recoverAbandonedJobs, claimNextJob };

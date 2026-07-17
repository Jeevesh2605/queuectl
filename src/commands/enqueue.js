'use strict';
const { now, getConfig } = require('../db');

function enqueue(db, raw) {
  let job;
  try { job = JSON.parse(raw); } catch { throw new Error('Job must be valid JSON'); }
  if (!job || typeof job.id !== 'string' || !job.id.trim()) throw new Error('Job requires a non-empty string id');
  if (typeof job.command !== 'string' || !job.command.trim()) throw new Error('Job requires a non-empty string command');
  const maxRetries = job.max_retries === undefined ? Number(getConfig(db, 'max-retries')) : Number(job.max_retries);
  if (!Number.isInteger(maxRetries) || maxRetries < 1) throw new Error('max_retries must be a positive integer');
  const timestamp = now();
  try {
    db.prepare(`INSERT INTO jobs (id, command, state, attempts, max_retries, created_at, updated_at, available_at)
      VALUES (?, ?, 'pending', 0, ?, ?, ?, ?)`).run(job.id, job.command, maxRetries, timestamp, timestamp, timestamp);
  } catch (error) {
    if (error.code && error.code.includes('CONSTRAINT')) throw new Error(`A job with id "${job.id}" already exists`);
    throw error;
  }
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id);
}
module.exports = { enqueue };

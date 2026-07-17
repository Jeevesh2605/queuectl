'use strict';
const { spawn } = require('node:child_process');
const { openDatabase, now, getConfig, recoverAbandonedJobs, claimNextJob } = require('../db');
const { backoffSeconds } = require('../lib/backoff');

const db = openDatabase();
const workerId = String(process.pid);
let stopping = false;
let timer;
let currentChild;

db.prepare("INSERT OR REPLACE INTO workers (pid, status, started_at, updated_at) VALUES (?, 'running', ?, ?)").run(process.pid, now(), now());
recoverAbandonedJobs(db);

function unregister() { try { db.prepare('DELETE FROM workers WHERE pid = ?').run(process.pid); db.close(); } catch {} }
function requestStop() {
  stopping = true;
  if (timer) clearTimeout(timer);
  try { db.prepare("UPDATE workers SET status = 'stopping', updated_at = ? WHERE pid = ?").run(now(), process.pid); } catch {}
  if (!currentChild) { unregister(); process.exit(0); }
}
process.on('SIGTERM', requestStop); process.on('SIGINT', requestStop);
process.on('exit', unregister);

function complete(job, result) {
  const timestamp = now();
  if (result.code === 0) {
    db.prepare("UPDATE jobs SET state = 'completed', locked_by = NULL, updated_at = ?, last_error = NULL WHERE id = ? AND locked_by = ?").run(timestamp, job.id, workerId);
    return;
  }
  const attempts = job.attempts + 1;
  const error = result.error || `Command exited with code ${result.code}`;
  if (attempts >= job.max_retries) {
    db.prepare("UPDATE jobs SET state = 'dead', attempts = ?, locked_by = NULL, last_error = ?, updated_at = ? WHERE id = ? AND locked_by = ?").run(attempts, error, timestamp, job.id, workerId);
  } else {
    const base = Number(getConfig(db, 'backoff-base'));
    const available = new Date(Date.now() + backoffSeconds(base, attempts) * 1000).toISOString();
    db.prepare("UPDATE jobs SET state = 'failed', attempts = ?, locked_by = NULL, last_error = ?, available_at = ?, updated_at = ? WHERE id = ? AND locked_by = ?").run(attempts, error, available, timestamp, job.id, workerId);
  }
}

function runJob(job) {
  currentChild = spawn(job.command, { shell: true, stdio: 'ignore' });
  currentChild.on('error', (error) => {
    complete(job, { code: 1, error: error.message }); currentChild = null; next();
  });
  currentChild.on('close', (code) => {
    complete(job, { code: code === null ? 1 : code }); currentChild = null; next();
  });
}
function next() {
  if (stopping) { unregister(); process.exit(0); return; }
  let job;
  try { job = claimNextJob(db, workerId); } catch { timer = setTimeout(next, 250); return; }
  if (job) runJob(job); else timer = setTimeout(next, 150);
}
next();

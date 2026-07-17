'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db');

const root = path.resolve(__dirname, '..');
function cli(db, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/queuectl.js', '--db', db, ...args], { cwd: root });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; }); child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr || stdout)));
  });
}
async function freshDb() { const directory = await mkdtemp(path.join(tmpdir(), 'queuectl-test-')); return path.join(directory, 'queue.db'); }
async function waitFor(dbPath, id, state, timeout = 7000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const db = openDatabase(dbPath); const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id); db.close();
    if (job && job.state === state) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${id} to become ${state}`);
}
async function stop(db) { await cli(db, 'worker', 'stop'); await new Promise((resolve) => setTimeout(resolve, 150)); }

test('basic command job completes', async (t) => {
  const db = await freshDb(); t.after(() => stop(db));
  await cli(db, 'enqueue', '{"id":"basic","command":"exit 0"}');
  await cli(db, 'worker', 'start', '--count', '1');
  const job = await waitFor(db, 'basic', 'completed');
  assert.equal(job.attempts, 0);
});

test('failure uses persisted exponential backoff and reaches DLQ', async (t) => {
  const db = await freshDb(); t.after(() => stop(db));
  await cli(db, 'config', 'set', 'backoff-base', '1');
  await cli(db, 'config', 'set', 'max-retries', '2');
  await cli(db, 'enqueue', '{"id":"fails","command":"exit 9"}');
  await cli(db, 'worker', 'start', '--count', '1');
  const failed = await waitFor(db, 'fails', 'failed');
  assert.equal(failed.attempts, 1);
  assert.ok(Date.parse(failed.available_at) - Date.parse(failed.updated_at) >= 950);
  const dead = await waitFor(db, 'fails', 'dead');
  assert.equal(dead.attempts, 2);
  assert.match(dead.last_error, /code 9/);
  const dlq = await cli(db, 'dlq', 'list'); assert.equal(dlq.length, 1);
});

test('multiple forked workers claim each job exactly once', async (t) => {
  const db = await freshDb(); const marker = path.join(path.dirname(db), 'executions.txt'); t.after(() => stop(db));
  for (let i = 0; i < 12; i += 1) await cli(db, 'enqueue', JSON.stringify({ id: `batch-${i}`, command: `echo batch-${i} >> ${marker}` }));
  await cli(db, 'worker', 'start', '--count', '3');
  for (let i = 0; i < 12; i += 1) await waitFor(db, `batch-${i}`, 'completed');
  const lines = (await readFile(marker, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 12); assert.equal(new Set(lines).size, 12);
});

test('nonexistent command fails gracefully without killing the worker', async (t) => {
  const db = await freshDb(); t.after(() => stop(db));
  await cli(db, 'config', 'set', 'backoff-base', '1'); await cli(db, 'config', 'set', 'max-retries', '1');
  await cli(db, 'enqueue', '{"id":"missing","command":"queuectl_this_command_does_not_exist"}');
  await cli(db, 'worker', 'start', '--count', '1');
  const job = await waitFor(db, 'missing', 'dead'); assert.equal(job.attempts, 1);
  const current = await cli(db, 'status'); assert.equal(current.workers.length, 1);
});

test('jobs persist across database reopen and process later', async (t) => {
  const db = await freshDb(); t.after(() => stop(db));
  await cli(db, 'enqueue', '{"id":"durable","command":"exit 0"}');
  const reopened = openDatabase(db); assert.equal(reopened.prepare('SELECT state FROM jobs WHERE id = ?').get('durable').state, 'pending'); reopened.close();
  await cli(db, 'worker', 'start', '--count', '1');
  await waitFor(db, 'durable', 'completed');
});

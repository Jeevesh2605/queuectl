'use strict';
const { fork } = require('node:child_process');
const path = require('node:path');
function startWorkers(dbPath, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error('--count must be a positive integer');
  const workerFile = path.resolve(__dirname, '../worker/workerProcess.js');
  const workers = [];
  for (let i = 0; i < count; i += 1) {
    const child = fork(workerFile, [], { detached: true, stdio: 'ignore', env: { ...process.env, QUEUECTL_DB: dbPath } });
    // fork creates an IPC handle by default; disconnect it so the short-lived CLI
    // can return while the detached worker keeps running.
    child.disconnect();
    child.unref(); workers.push(child.pid);
  }
  return workers;
}
function stopWorkers(db) {
  const workers = db.prepare("SELECT pid FROM workers WHERE status IN ('running','stopping')").all();
  const mark = db.prepare("UPDATE workers SET status = 'stopping', updated_at = ? WHERE pid = ?");
  const removed = db.prepare('DELETE FROM workers WHERE pid = ?');
  const timestamp = new Date().toISOString();
  const stopped = [];
  for (const { pid } of workers) {
    try { process.kill(pid, 'SIGTERM'); mark.run(timestamp, pid); stopped.push(pid); } catch { removed.run(pid); }
  }
  return stopped;
}
module.exports = { startWorkers, stopWorkers };

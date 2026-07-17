'use strict';
function processExists(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function status(db) {
  const workers = db.prepare('SELECT * FROM workers ORDER BY pid').all();
  const dead = workers.filter((worker) => !processExists(worker.pid));
  if (dead.length) db.prepare(`DELETE FROM workers WHERE pid IN (${dead.map(() => '?').join(',')})`).run(...dead.map((worker) => worker.pid));
  const counts = Object.fromEntries(db.prepare('SELECT state, COUNT(*) AS count FROM jobs GROUP BY state').all().map((r) => [r.state, r.count]));
  for (const state of ['pending', 'processing', 'completed', 'failed', 'dead']) counts[state] ||= 0;
  return { jobs: counts, workers: db.prepare('SELECT * FROM workers ORDER BY pid').all() };
}
module.exports = { status };

'use strict';
const STATES = new Set(['pending', 'processing', 'completed', 'failed', 'dead']);
function listJobs(db, state) {
  if (state && !STATES.has(state)) throw new Error(`Invalid state "${state}"`);
  return state ? db.prepare('SELECT * FROM jobs WHERE state = ? ORDER BY created_at').all(state) : db.prepare('SELECT * FROM jobs ORDER BY created_at').all();
}
module.exports = { listJobs, STATES };

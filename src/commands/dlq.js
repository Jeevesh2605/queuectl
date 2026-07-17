'use strict';
const { now } = require('../db');
function listDlq(db) { return db.prepare("SELECT * FROM jobs WHERE state = 'dead' ORDER BY updated_at").all(); }
function retryDlq(db, id) {
  const timestamp = now();
  const result = db.prepare(`UPDATE jobs SET state = 'pending', attempts = 0, available_at = ?, locked_by = NULL,
    last_error = NULL, updated_at = ? WHERE id = ? AND state = 'dead'`).run(timestamp, timestamp, id);
  if (!result.changes) throw new Error(`No dead-letter job found with id "${id}"`);
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}
module.exports = { listDlq, retryDlq };

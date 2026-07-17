#!/usr/bin/env node
'use strict';
const { Command } = require('commander');
const { openDatabase, databasePath, configObject } = require('../src/db');
const { enqueue } = require('../src/commands/enqueue');
const { startWorkers, stopWorkers } = require('../src/commands/worker');
const { status } = require('../src/commands/status');
const { listJobs } = require('../src/commands/list');
const { listDlq, retryDlq } = require('../src/commands/dlq');
const { setConfig } = require('../src/commands/config');

function output(value) { console.log(JSON.stringify(value, null, 2)); }
const program = new Command();
program.name('queuectl').description('Durable local command job queue').option('--db <path>', 'SQLite database path (default: ./queuectl.db)');
function withDb(handler) { return (...args) => { const db = openDatabase(program.opts().db); try { handler(db, ...args); } finally { db.close(); } }; }
program.command('enqueue <job>').description('Add a JSON job to the queue').action(withDb((db, job) => output(enqueue(db, job))));
const worker = program.command('worker').description('Manage forked worker processes');
worker.command('start').description('Start detached workers').requiredOption('--count <number>', 'number of workers', Number).action(() => output({ started: startWorkers(databasePath(program.opts().db), worker.commands.find((c) => c.name() === 'start').opts().count) }));
worker.command('stop').description('Request graceful shutdown of all active workers').action(withDb((db) => output({ stopping: stopWorkers(db) })));
program.command('status').description('Show job and active-worker counts').action(withDb((db) => output(status(db))));
program.command('list').description('List jobs').option('--state <state>', 'filter by lifecycle state').action(withDb((db, options) => output(listJobs(db, options.state))));
const dlq = program.command('dlq').description('Manage dead-letter jobs');
dlq.command('list').description('List dead-letter jobs').action(withDb((db) => output(listDlq(db))));
dlq.command('retry <id>').description('Return a DLQ job to pending').action(withDb((db, id) => output(retryDlq(db, id))));
const config = program.command('config').description('View or persist queue configuration');
config.command('list').description('Show configuration').action(withDb((db) => output(configObject(db))));
config.command('set <key> <value>').description('Set max-retries or backoff-base').action(withDb((db, key, value) => output(setConfig(db, key, value))));
program.configureOutput({ outputError: (str, write) => write(str) });
program.parseAsync().catch((error) => { console.error(`Error: ${error.message}`); process.exitCode = 1; });

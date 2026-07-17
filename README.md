# queuectl

`queuectl` is a fully local, durable command job queue. It stores jobs and configuration in a SQLite database and executes commands in detached Node worker processes. No cloud services are used.

## Setup

```sh
npm install
npm link                 # optional: makes `queuectl` available on PATH
# or use: node bin/queuectl.js ...
```

By default the database is `./queuectl.db`. Pass `--db /path/to/queue.db` before any command to choose a different database.

## Usage

```sh
queuectl enqueue '{"id":"job1","command":"sleep 2"}'
# { "id": "job1", "state": "pending", "attempts": 0, ... }

queuectl worker start --count 3
# { "started": [ 12345, 12346, 12347 ] }

queuectl status
# { "jobs": { "pending": 0, "processing": 1, "completed": 0, "failed": 0, "dead": 0 }, "workers": [...] }

queuectl list --state pending
# [{ "id": "job1", "command": "sleep 2", "state": "pending", ... }]

queuectl config set max-retries 3
queuectl config set backoff-base 2
queuectl config list
# { "backoff-base": "2", "max-retries": "3" }

queuectl dlq list
# [{ "id": "failed-job", "state": "dead", "last_error": "Command exited with code 1", ... }]

queuectl dlq retry failed-job
# { "id": "failed-job", "state": "pending", "attempts": 0, ... }

queuectl worker stop
# { "stopping": [12345, 12346, 12347] }
```

Every command supports `--help`; use `queuectl --help` or, for example, `queuectl dlq --help`.

## Architecture

Jobs have the lifecycle `pending → processing → completed`. A non-zero shell exit changes the job to `failed`, scheduling it with `available_at`; after the configured number of failed attempts it becomes `dead` (the DLQ). `dlq retry` resets a dead job to `pending`.

SQLite is the source of truth for jobs, configuration, and worker PIDs. Each worker has its own SQLite connection and is a separate OS process created with `child_process.fork`. Claiming uses a SQLite immediate write transaction: it selects an eligible job and conditionally changes it to `processing` before releasing the transaction. This prevents two workers from claiming the same job.

On failure, workers read the persisted `backoff-base` at runtime and schedule the next attempt with `base ^ attempts` seconds. `max-retries` is read from persisted configuration when a job is enqueued (unless the submitted job explicitly provides `max_retries`). Fresh databases receive bootstrap values of 3 and 2, which can be changed immediately and are then persisted.

Workers receive `SIGTERM`/`SIGINT`, stop claiming new work, and wait for their in-flight shell command to close before exiting. On startup, workers return only jobs owned by missing worker PIDs to `pending`, allowing recovery after an unclean process stop.

## Assumptions and trade-offs

- `max_retries` means the maximum total failed executions, so `max_retries: 3` permits three attempts before DLQ.
- Shell commands are intentionally run through the local shell; only enqueue commands from trusted users.
- Atomic claiming provides at-most-one active worker claim. As with any process-based command runner, a hard machine kill after the shell has started can require recovery and cannot make an arbitrary shell command exactly-once.
- SQLite WAL mode and a five-second busy timeout are used for practical local multi-process concurrency.

## Tests

```sh
npm test
```

The automated suite verifies: successful completion; exponential retry timing and DLQ movement; concurrent processing by three workers with no duplicate command execution; graceful handling of an invalid command; and persistence across a database reopen before processing.

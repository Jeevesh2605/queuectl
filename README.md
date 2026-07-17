# queuectl

`queuectl` is a fully local, durable command job queue. It stores jobs and configuration in SQLite and executes commands in detached Node worker processes. No cloud services are used.

## Demo

[Watch the demo](https://drive.google.com/file/d/1ki5zDswtWzcRDpJVvhGmBw91ZgKVUbEC/view)

## Quick start

```sh
# Install dependencies.
npm install

# Optional: make `queuectl` available on your PATH.
npm link

# Configure durable queue settings.
queuectl config set max-retries 3
queuectl config set backoff-base 2

# Add a job, start a worker, inspect it, and stop cleanly.
queuectl enqueue '{"id":"hello","command":"echo Hello World"}'
queuectl worker start --count 1
queuectl status
queuectl worker stop
```

If you do not use `npm link`, replace `queuectl` in every example with `node bin/queuectl.js`.

By default, the database is `./queuectl.db` in the current directory. To use another database, pass `--db` before the command name every time:

```sh
queuectl --db ./data/jobs.db enqueue '{"id":"job1","command":"echo hello"}'
queuectl --db ./data/jobs.db worker start --count 2
queuectl --db ./data/jobs.db status
```

## Command reference

### Enqueue jobs

```sh
queuectl enqueue '{"id":"job1","command":"sleep 2"}'
# { "id": "job1", "state": "pending", "attempts": 0, ... }
```

The required fields are a unique string `id` and a shell `command`. Override retry settings for one job with `max_retries`:

```sh
queuectl enqueue '{"id":"important","command":"./run-report.sh","max_retries":5}'
```

Commands run through the local shell. Only enqueue commands from trusted users.

### Start and stop workers

```sh
# Start three detached OS worker processes.
queuectl worker start --count 3
# { "started": [12345, 12346, 12347] }

# Ask all active workers to shut down gracefully.
queuectl worker stop
# { "stopping": [12345, 12346, 12347] }
```

`worker stop` returns once it has sent the stop request. It does not kill commands currently running: workers finish their in-flight job, exit, and do not claim another job. For long-running jobs, wait until `queuectl status` shows an empty `workers` array.

### Inspect queue and workers

```sh
queuectl status
# { "jobs": { "pending": 0, "processing": 1, "completed": 0, "failed": 0, "dead": 0 }, "workers": [...] }

# List all jobs.
queuectl list

# List only one lifecycle state.
queuectl list --state pending
```

Valid state filters: `pending`, `processing`, `completed`, `failed`, and `dead`.

### Configure retries and backoff

```sh
# Maximum failed executions before a job moves to the DLQ.
queuectl config set max-retries 3

# Backoff base: attempt 1 waits base^1 seconds, attempt 2 waits base^2 seconds.
queuectl config set backoff-base 2

queuectl config list
# { "backoff-base": "2", "max-retries": "3" }
```

Values are persisted in SQLite and retained across restarts. New databases begin with `max-retries = 3` and `backoff-base = 2`.

### Work with the dead-letter queue

```sh
# List jobs that exhausted their retries.
queuectl dlq list
# [{ "id": "failed-job", "state": "dead", "last_error": "Command exited with code 1", ... }]

# Reset a dead job to pending with zero attempts.
queuectl dlq retry failed-job
# { "id": "failed-job", "state": "pending", "attempts": 0, ... }
```

### Get help

```sh
queuectl --help
queuectl worker --help
queuectl worker start --help
queuectl dlq --help
queuectl config --help
```

## Typical workflow

```sh
# 1. Configure this queue database.
queuectl config set max-retries 3
queuectl config set backoff-base 2

# 2. Start workers; they continue after this command returns.
queuectl worker start --count 2

# 3. Enqueue work.
queuectl enqueue '{"id":"report-001","command":"./scripts/generate-report.sh"}'
queuectl enqueue '{"id":"cleanup-001","command":"./scripts/cleanup.sh"}'

# 4. Monitor, inspect failures, then stop workers.
queuectl status
queuectl dlq list
queuectl worker stop
```

## Architecture

Jobs follow `pending → processing → completed`. A non-zero command exit changes a job to `failed` and schedules it with `available_at`; after the configured number of failed executions it becomes `dead` (the DLQ). `dlq retry` resets a dead job to `pending`.

SQLite is the source of truth for jobs, configuration, and worker PIDs. Every worker is a separate process created with `child_process.fork` and uses its own database connection. Claiming is done in a SQLite immediate write transaction: an eligible job is selected and conditionally changed to `processing` before the transaction is released. This prevents two workers from claiming one job.

On failure, workers read the persisted `backoff-base` at runtime and schedule the next attempt for `base ^ attempts` seconds later. `max-retries` is read from persisted configuration when a job is enqueued unless that job sets `max_retries` explicitly. If a worker stops uncleanly, a later worker returns only work owned by missing worker PIDs to `pending`.

## Assumptions and trade-offs

- `max_retries` is the maximum total number of failed executions. `max_retries: 3` allows three failed attempts before DLQ.
- Atomic claiming ensures only one active worker claims a job. A hard machine kill after a shell command has started cannot make an arbitrary external command exactly-once.
- SQLite WAL mode and a five-second busy timeout support practical local multi-process concurrency.

## Testing

```sh
npm test
```

The automated suite verifies successful completion; exponential retry timing and DLQ movement; concurrent workers with no duplicate command execution; graceful handling of an invalid command; and persistence across a database reopen.

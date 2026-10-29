import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null) return false;
  return 'at' in value && typeof value.at === 'string'
    && 'job' in value && typeof value.job === 'string'
    && 'status' in value && (value.status === 'ok' || value.status === 'retry' || value.status === 'fail')
    && 'owner' in value && (value.owner === null || typeof value.owner === 'string')
    && (!('error' in value) || typeof value.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let content: string;
  try {
    content = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = {
    night,
    rows: [],
    badLines: 0,
    counts: { ok: 0, retry: 0, fail: 0 },
  };
  const rows = new Map<string, DigestRow>();
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      digest.badLines++;
      continue;
    }
    if (!isRunEvent(event)) {
      digest.badLines++;
      continue;
    }

    digest.counts[event.status]++;
    const row = rows.get(event.job);
    if (row) {
      row.owner = event.owner;
      row.runs++;
      if (event.status === 'retry') row.retries++;
      row.lastStatus = event.status;
      if (event.error) row.lastError = event.error;
      row.lastAt = event.at;
    } else {
      rows.set(event.job, {
        job: event.job,
        owner: event.owner,
        runs: 1,
        retries: event.status === 'retry' ? 1 : 0,
        lastStatus: event.status,
        lastError: event.error || null,
        firstAt: event.at,
        lastAt: event.at,
      });
    }
  }

  digest.rows = [...rows.values()].sort((a, b) => a.job.localeCompare(b.job));
  return digest;
};

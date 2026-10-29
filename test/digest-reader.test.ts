import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const fixtures = fileURLToPath(new URL('../runs/', import.meta.url));
const tempDirs: string[] = [];

function tempRuns(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-reader-'));
  tempDirs.push(dir);
  if (content !== undefined) writeFileSync(join(dir, '2026-10-28.jsonl'), content);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('reads every job and event from the October 28 fixture without losing its bad line', () => {
    expect(readNight(fixtures, '2026-10-28')).toEqual({
      night: '2026-10-28',
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
          lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1,
          lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });

  it('reads the seven successful events in the October 27 fixture', () => {
    const digest = readNight(fixtures, '2026-10-27');
    expect(digest?.badLines).toBe(0);
    expect(digest?.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
    expect(digest?.rows.map((row) => [row.job, row.runs, row.retries, row.lastStatus, row.lastError])).toEqual([
      ['fixtures/refresh', 1, 0, 'ok', null],
      ['lane/sync', 4, 0, 'ok', null],
      ['notes/backup', 1, 0, 'ok', null],
      ['rig/rotate-logs', 1, 0, 'ok', null],
    ]);
  });

  it('returns null for a missing file or runs directory', () => {
    const dir = tempRuns();
    expect(readNight(dir, '2026-10-28')).toBeNull();
    expect(readNight(join(dir, 'missing'), '2026-10-28')).toBeNull();
  });

  it.each(['', '2026-1-28', '2026-10-28.jsonl', '2026-10-28\n'])(
    'rejects an invalid night even if its file exists: %j', (night) => {
      const dir = tempRuns();
      writeFileSync(join(dir, `${night}.jsonl`), '');
      expect(readNight(dir, night)).toBeNull();
    },
  );

  it('rejects traversal and absolute paths to an existing log', () => {
    const dir = tempRuns('{"at":"now","job":"outside","status":"ok","owner":null}\n');
    expect(readNight(join(dir, 'nested'), '../2026-10-28')).toBeNull();
    expect(readNight(dir, join(dir, '2026-10-28'))).toBeNull();
  });

  it('returns an empty digest for an existing empty file', () => {
    expect(readNight(tempRuns(''), '2026-10-28')).toEqual({
      night: '2026-10-28', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed JSON and invalid event shapes while preserving surrounding valid events', () => {
    const valid = { at: '2026-10-28T23:00:00-04:00', job: 'job', status: 'ok', owner: null };
    const invalid: unknown[] = [
      null, [], 1, 'event', {},
      { ...valid, at: 1 }, { ...valid, job: null },
      { ...valid, status: 'unknown' }, { ...valid, owner: 1 },
      { at: valid.at, job: valid.job, status: valid.status },
      { ...valid, error: null }, { ...valid, error: 1 },
    ];
    const lines = [JSON.stringify(valid), '{broken', '', ...invalid.map((value) => JSON.stringify(value)), JSON.stringify(valid)];
    const digest = readNight(tempRuns(`${lines.join('\r\n')}\r\n`), '2026-10-28');
    expect(digest?.badLines).toBe(invalid.length + 2);
    expect(digest?.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.rows[0]).toMatchObject({ owner: null, runs: 2, firstAt: valid.at, lastAt: valid.at });
  });

  it('uses append order and retains the latest nonempty error after success', () => {
    const events = [
      { at: '2026-10-28T23:00:00+02:00', job: 'z-job', status: 'retry', owner: 'rook', error: 'first error' },
      { at: '2026-10-28T23:01:00+02:00', job: 'z-job', status: 'fail', owner: 'rook', error: 'latest error' },
      { at: '2026-10-28T22:00:00-04:00', job: 'z-job', status: 'ok', owner: 'rook', error: '' },
      { at: '2026-10-28T22:01:00-04:00', job: 'z-job', status: 'ok', owner: 'rook' },
      { at: '2026-10-28T23:02:00+02:00', job: 'a-job', status: 'ok', owner: null },
    ];
    const digest = readNight(tempRuns(events.map((event) => JSON.stringify(event)).join('\n')), '2026-10-28');
    expect(digest?.badLines).toBe(0);
    expect(digest?.counts).toEqual({ ok: 3, retry: 1, fail: 1 });
    expect(digest?.rows.map((row) => row.job)).toEqual(['a-job', 'z-job']);
    expect(digest?.rows[1]).toEqual({
      job: 'z-job', owner: 'rook', runs: 4, retries: 1,
      lastStatus: 'ok', lastError: 'latest error',
      firstAt: events[0].at, lastAt: events[3].at,
    });
  });
});

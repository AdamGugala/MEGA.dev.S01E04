import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};

const directories: string[] = [];

async function runsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function requestBoth(dir: string, night: string) {
  const app = createApp({ ...config, runsDir: dir });
  const [html, json] = await Promise.all([
    app.request(`/digest/${night}`),
    app.request(`/api/digest/${night}`),
  ]);
  return { html, json };
}

describe('digest routes', () => {
  it('renders and returns the same sorted digest data, preserving row values and offsets', async () => {
    const dir = await runsDir();
    const night = '2026-10-28';
    await writeFile(join(dir, `${night}.jsonl`), [
      JSON.stringify({ at: '2026-10-28T08:00:00-04:00', job: 'zeta', status: 'retry', owner: null }),
      JSON.stringify({ at: '2026-10-28T09:00:00+02:00', job: 'alpha', status: 'ok', owner: 'Ada' }),
      JSON.stringify({ at: '2026-10-28T08:05:00-04:00', job: 'zeta', status: 'retry', owner: null }),
      JSON.stringify({ at: '2026-10-28T08:10:00-04:00', job: 'zeta', status: 'fail', owner: null, error: 'boom' }),
      JSON.stringify({ at: 'not-json', job: 'ignored' }),
    ].join('\n'));

    const { html, json } = await requestBoth(dir, night);
    expect(html.status).toBe(200);
    expect(json.status).toBe(200);

    const digest = (await json.json()) as NightDigest;
    expect(digest).toEqual({
      night,
      rows: [
        {
          job: 'alpha', owner: 'Ada', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T09:00:00+02:00', lastAt: '2026-10-28T09:00:00+02:00',
        },
        {
          job: 'zeta', owner: null, runs: 3, retries: 2, lastStatus: 'fail', lastError: 'boom',
          firstAt: '2026-10-28T08:00:00-04:00', lastAt: '2026-10-28T08:10:00-04:00',
        },
      ],
      badLines: 1,
      counts: { ok: 1, retry: 2, fail: 1 },
    });

    const htmlText = await html.text();
    expect(htmlText.indexOf('alpha')).toBeLessThan(htmlText.indexOf('zeta'));
    expect(htmlText).toContain('—');
    expect(htmlText).toContain('2026-10-28T08:00:00-04:00');
    expect(htmlText).toContain('2026-10-28T08:10:00-04:00');
    expect(htmlText).toMatch(/class="[^"]*warn[^"]*"[^>]*>\s*(?:zeta|3)/i);
    expect(digest.rows.map((row) => row.job)).toEqual(['alpha', 'zeta']);
  });

  it('returns 404 from both routes when the night file is missing', async () => {
    const { html, json } = await requestBoth(await runsDir(), '2026-10-28');
    expect(html.status).toBe(404);
    expect(json.status).toBe(404);
  });

  it('renders an empty night with no jobs and zero event counts', async () => {
    const dir = await runsDir();
    const night = '2026-10-28';
    await writeFile(join(dir, `${night}.jsonl`), '');

    const { html, json } = await requestBoth(dir, night);
    expect(html.status).toBe(200);
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } } satisfies NightDigest);
    expect(await html.text()).toContain('nothing ran');
  });

  it('counts a malformed line and still serves valid rows in HTML and JSON', async () => {
    const dir = await runsDir();
    const night = '2026-10-28';
    await writeFile(join(dir, `${night}.jsonl`), [
      JSON.stringify({ at: '2026-10-28T08:00:00+01:00', job: 'kept', status: 'ok', owner: null }),
      '{malformed',
    ].join('\n'));

    const { html, json } = await requestBoth(dir, night);
    expect(html.status).toBe(200);
    expect(json.status).toBe(200);
    const digest = (await json.json()) as NightDigest;
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((row) => row.job)).toEqual(['kept']);
    expect((await html.text())).toContain('kept');
  });
});

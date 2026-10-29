export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  // Latest nonempty error, retained even after a later success.
  lastError: string | null;
  // Timestamp strings keep their original offsets.
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  // One row per job, sorted by job.
  rows: DigestRow[];
  badLines: number;
  // Event counts, not job counts.
  counts: { ok: number; retry: number; fail: number };
};

// Implemented as readNight in ./read-night.ts.
// Missing file or invalid night: null. Existing empty file: empty rows and zero counts.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;

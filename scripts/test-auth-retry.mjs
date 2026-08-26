// Retry auth integration tests until production reflects the latest deploy.
// CI runs immediately on git push; Vercel production lags ~30–90s behind.
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_ATTEMPTS = 12;
const DELAY_MS = 15_000;

function runOnce() {
  const r = spawnSync(
    process.execPath,
    ['--test', 'test/auth/logout.test.mjs', 'test/auth/me.test.mjs', 'test/auth/request-link.test.mjs', 'test/auth/verify.test.mjs', 'test/connect-onboarding.test.mjs'],
    { cwd: ROOT, stdio: 'inherit', env: process.env }
  );
  return r.status === 0;
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  console.log(`test-auth attempt ${attempt}/${MAX_ATTEMPTS}`);
  if (runOnce()) {
    console.log(`test-auth passed on attempt ${attempt}`);
    process.exit(0);
  }
  if (attempt < MAX_ATTEMPTS) {
    console.log(`Waiting ${DELAY_MS / 1000}s for Vercel production deploy…`);
    await sleep(DELAY_MS);
  }
}

console.error(`test-auth failed after ${MAX_ATTEMPTS} attempts`);
process.exit(1);
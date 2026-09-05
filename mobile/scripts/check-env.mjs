#!/usr/bin/env node
/**
 * Diagnose .env without echoing key values.
 * Prints: env var present? length? prefix? format-check?
 * Also makes a single round-trip to PostgREST to verify the key actually works.
 */

import 'dotenv/config';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function describe(name, val, expectedPrefix) {
  if (!val) {
    console.log(`  ${name}: ❌ MISSING`);
    return;
  }
  const len = val.length;
  const prefix = val.slice(0, 16);
  const tail = val.slice(-4);
  const matches = expectedPrefix ? val.startsWith(expectedPrefix) : true;
  const mark = matches ? '✅' : '⚠️';
  const reason = matches ? '' : ` (expected prefix "${expectedPrefix}")`;
  console.log(`  ${name}: ${mark} length=${len}, "${prefix}…${tail}"${reason}`);
}

console.log('Environment:');
console.log(`  SUPABASE_URL: ${url || '❌ MISSING'}`);
describe('SUPABASE_ANON_KEY        ', anonKey, 'sb_publishable_');
describe('SUPABASE_SERVICE_ROLE_KEY', serviceKey, 'sb_secret_');

// Whitespace / newline check — common paste bug.
function whitespaceCheck(name, val) {
  if (!val) return;
  if (val !== val.trim()) {
    console.log(`  ⚠️  ${name} has leading/trailing whitespace`);
  }
  if (val.includes('\n') || val.includes('\r')) {
    console.log(`  ⚠️  ${name} contains a newline`);
  }
  if (val.includes(' ')) {
    console.log(`  ⚠️  ${name} contains a space`);
  }
}
whitespaceCheck('SUPABASE_ANON_KEY', anonKey);
whitespaceCheck('SUPABASE_SERVICE_ROLE_KEY', serviceKey);

if (!url || !serviceKey) {
  console.log('\nMissing required vars — cannot test.');
  process.exit(1);
}

console.log('\nTest: GET /rest/v1/processors?limit=1 with service_role key…');
try {
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/processors?limit=1`, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
    },
  });
  const text = await res.text();
  console.log(`  HTTP ${res.status} ${res.statusText}`);
  if (res.ok) {
    const rows = JSON.parse(text);
    console.log(`  ✅ Key works. Found ${rows.length} row(s) in processors table.`);
  } else {
    console.log(`  ❌ Body: ${text}`);
    console.log('\nLikely causes:');
    console.log('  • You pasted the publishable key into the secret slot or vice versa');
    console.log('  • Whitespace/newline in the pasted value (see whitespace check above)');
    console.log('  • A new secret key needs to be generated (current shows revealed dots only)');
    console.log('  • The key was copied while the masking dots were active');
  }
} catch (err) {
  console.log(`  ❌ Network error: ${err.message}`);
}

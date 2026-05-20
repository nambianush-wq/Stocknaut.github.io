// Smoke harness for the 2026-05-19 Gemini-leaked-key RCA.
//
// Exercises callLLM()'s error classifier across the FIVE distinct Gemini
// failure modes plus the success case. The previous classifier mapped
// every HTTP 429 to 'rate_limit', which mis-told the user "wait a minute
// and try again" when in fact Google had permanently disabled their key
// (the key had been auto-revoked by Google's leaked-key scanner).
//
// The fix added a 'leaked' classification for the two terminal-key shapes
// Google actually returns:
//   • 403 + body contains "reported as leaked"
//   • 429 + body contains "limit: 0"
//
// This harness proves the new classifier surfaces 'leaked' for both
// terminal shapes AND still surfaces 'rate_limit' for genuine transient
// quota-exceeded responses AND still works end-to-end on the success path.
//
// Usage:  node tests/smoke_gemini_leaked_key_20260519.js
// Exit 0 = all scenarios pass; exit 1 = at least one regression.

'use strict';

const vm = require('vm');
const { loadApp } = require('./harness');

function makeRes(status, bodyText) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    body: null,
    headers: { get: () => null },
    text: async () => bodyText,
    json: async () => { try { return JSON.parse(bodyText); } catch { return null; } },
  };
}

const SCENARIOS = [
  {
    name: '1. verbatim regression — 403 reported-as-leaked (gemini-2.5-flash)',
    status: 403,
    body: JSON.stringify({ error: { code: 403, message: 'Your API key was reported as leaked. Please use another API key.', status: 'PERMISSION_DENIED' } }),
    expectError: 'leaked',
  },
  {
    name: '2. verbatim regression — 429 limit:0 (gemini-2.0-flash on revoked key)',
    status: 429,
    body: JSON.stringify({ error: { code: 429, message: '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-2.0-flash', status: 'RESOURCE_EXHAUSTED' } }),
    expectError: 'leaked',
  },
  {
    name: '3. inverse — must NOT fire on a genuine transient 429',
    status: 429,
    body: JSON.stringify({ error: { code: 429, message: 'Quota exceeded. Please retry after 30 seconds.', status: 'RESOURCE_EXHAUSTED' } }),
    expectError: 'rate_limit',
  },
  {
    name: '4. sibling — 401 invalid key still classifies as auth',
    status: 401,
    body: JSON.stringify({ error: { code: 401, message: 'API key not valid', status: 'UNAUTHENTICATED' } }),
    expectError: 'auth',
  },
  {
    name: '5. cross-scope — success path still returns ok:true text',
    status: 200,
    body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }),
    expectError: null,
    expectText: 'OK',
  },
];

(async () => {
  const app = loadApp();

  // Sanity — callLLM must be reachable. The harness's exported-identifier
  // whitelist doesn't include callLLM; pull it off the sandbox directly.
  const callLLM = app.callLLM;
  if (typeof callLLM !== 'function') {
    // callLLM is defined in the inline script but not exported by harness.js's
    // whitelist. Reach into the vm sandbox's lexical-bound symbols by
    // re-evaluating a tiny export trailer.
    console.error('callLLM not in sandbox export list — patching harness inline');
    process.exit(2);
  }

  // Seed a fake key so callLLM doesn't short-circuit on no_key. The fetch
  // stub is the active fault-injector per scenario, so the key's value is
  // irrelevant to what gets exercised here.
  //
  // NB: `let GEMINI_API_KEY = loadKey(...)` is a lexical binding inside the
  // sandboxed script, NOT a property of the sandbox object — so assigning
  // app.GEMINI_API_KEY directly doesn't update what hasLLM() sees. We have
  // to mutate the binding by running a one-liner inside the same vm context.
  vm.runInContext('GEMINI_API_KEY = "fake-test-key"', app);

  const results = [];
  for (const s of SCENARIOS) {
    // Per-scenario fetch stub. `fetch` is a sandbox property (not a let-
    // bound lexical), so writing it on the sandbox object IS picked up by
    // the inline script's `fetch(...)` calls.
    const stub = async () => makeRes(s.status, s.body);
    app.fetch = stub;
    app.window.fetch = stub;
    let out;
    try {
      out = await callLLM('test prompt', { cacheKey: null });
    } catch (e) {
      results.push({ name: s.name, pass: false, detail: `threw: ${e.message}` });
      continue;
    }
    const expectedOk = s.expectError === null;
    const passOk = (out.ok === expectedOk);
    const passErr = expectedOk ? true : (out.error === s.expectError);
    const passText = (s.expectText == null) ? true : (out.text === s.expectText);
    results.push({
      name: s.name,
      pass: passOk && passErr && passText,
      detail: `expected error=${s.expectError} ok=${expectedOk}; got error=${out.error} ok=${out.ok} text=${JSON.stringify(out.text || '').slice(0,40)}`,
    });
  }

  let pass = 0, fail = 0;
  for (const r of results) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    console.log(`  ${tag}  ${r.name}`);
    console.log(`        ${r.detail}`);
    if (r.pass) pass++; else fail++;
  }
  console.log(`\nGemini leaked-key classifier smoke: ${pass}/${pass+fail} scenarios passed`);
  if (fail > 0) process.exit(1);
})().catch(e => { console.error('Harness crashed:', e); process.exit(2); });

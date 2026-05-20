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
  // Scenarios 1-5 test the Gemini classifier in isolation. The 2026-05-20
  // "seamless" change auto-promotes LOCAL_LLM_ENABLED on terminal errors —
  // which is the BEHAVIOUR we want in production but masks the underlying
  // classifier verdict in this harness. Force the flag OFF for 1-5 so the
  // raw Gemini error is what reaches the assertion. Scenarios 6+7 below
  // explicitly test the auto-promote path with their own setup.
  vm.runInContext('LOCAL_LLM_ENABLED = false; localStorage.setItem("sp_local_llm_enabled", "0");', app);
  // Clear any dead-key cache between scenarios so each one re-exercises
  // the Gemini classifier instead of being short-circuited by a prior
  // scenario's _markGeminiKeyDead.
  const resetBetweenScenarios = () => {
    app.localStorage.removeItem('sp_gemini_dead_keys');
    vm.runInContext('LOCAL_LLM_ENABLED = false', app);
  };

  const results = [];
  for (const s of SCENARIOS) {
    resetBetweenScenarios();
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

  // ---- Additional 2026-05-20 scenarios for the "seamless" pass ----
  //
  // 6. Dead-key short-circuit: once 'leaked' is detected, the SAME key's
  //    fingerprint is cached in LS so the NEXT call skips Gemini entirely
  //    and routes to local. We assert fetch is NOT invoked on the second
  //    call when LOCAL_LLM_ENABLED was auto-promoted by the first call.
  //
  // 7. Auto-enable of LOCAL_LLM_ENABLED: after a 'leaked' response and
  //    when the user has NOT explicitly set LS_KEY_LOCAL_LLM to '0', the
  //    flag flips to true in memory and in LS — proving the seamless
  //    fallback fired without any user action.

  // Reset for scenario 6+7
  app.localStorage.removeItem('sp_gemini_dead_keys');
  app.localStorage.removeItem('sp_local_llm_enabled');
  // Make LOCAL_LLM_ENABLED false at the binding level — would otherwise
  // be set by earlier scenarios.
  vm.runInContext('LOCAL_LLM_ENABLED = false', app);
  // Trap _loadLocalLLM so the fallback call doesn't actually try to
  // import @huggingface/transformers (no CDN reach from Node).
  vm.runInContext(`_loadLocalLLM = async () => ({ tokenizer: null });
  callLocalLLM = async (prompt, opts) => {
    if (opts && opts.onChunk) try { opts.onChunk('FALLBACK-OK'); } catch (e) {}
    return { ok: true, text: 'FALLBACK-OK', source: 'local' };
  };`, app);

  // Scenario 6 — first call returns leaked, dead-key cache + auto-enable
  let fetchCalls = 0;
  app.fetch = async () => { fetchCalls++; return makeRes(429, JSON.stringify({ error: { message: 'limit: 0 quota' } })); };
  app.window.fetch = app.fetch;
  const r6a = await callLLM('test', { cacheKey: null });
  const localEnabledAfter = vm.runInContext('LOCAL_LLM_ENABLED', app);
  const deadCacheRaw = app.localStorage.getItem('sp_gemini_dead_keys') || '';
  const r6_pass = r6a.ok === true
               && r6a.source === 'local'
               && r6a.fellBackFrom === 'leaked'
               && localEnabledAfter === true
               && deadCacheRaw.length > 0;
  console.log(`  ${r6_pass ? 'PASS' : 'FAIL'}  6. seamless: leaked → auto-enable local + cache dead key + fall back same call`);
  console.log(`        ok=${r6a.ok} src=${r6a.source} fellBack=${r6a.fellBackFrom} localEnabled=${localEnabledAfter} deadCacheSet=${deadCacheRaw.length>0}`);

  // Scenario 7 — second call MUST skip Gemini (no fetch hit)
  const fetchCallsBefore = fetchCalls;
  const r7 = await callLLM('test 2', { cacheKey: null });
  const r7_pass = r7.ok === true && r7.source === 'local' && fetchCalls === fetchCallsBefore;
  console.log(`  ${r7_pass ? 'PASS' : 'FAIL'}  7. dead-key short-circuit: second call routes straight to local, no fetch`);
  console.log(`        ok=${r7.ok} src=${r7.source} fetchCalls(before/after)=${fetchCallsBefore}/${fetchCalls}`);

  results.push({ name: '6. seamless leaked → auto-enable + fallback', pass: r6_pass, detail: '' });
  results.push({ name: '7. dead-key short-circuit', pass: r7_pass, detail: '' });

  // ---- 2026-05-20 Groq scenarios ----
  //
  // 8. Gemini dead → Groq tried next, succeeds (chain priority works).
  // 9. No Gemini key, only Groq key set → Groq is tried directly, no
  //    spurious Gemini round-trip.
  // 10. Both Gemini AND Groq dead → falls through to local model.

  // Reset state for scenario 8.
  app.localStorage.removeItem('sp_gemini_dead_keys');
  app.localStorage.removeItem('sp_local_llm_enabled');
  vm.runInContext('LOCAL_LLM_ENABLED = false; GEMINI_API_KEY = "gem-test-key"; GROQ_API_KEY = "grq-test-key";', app);

  // Scenario 8 — Gemini returns leaked, Groq returns 200 OK
  let s8_geminiCalls = 0, s8_groqCalls = 0;
  app.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      s8_geminiCalls++;
      return makeRes(403, JSON.stringify({ error: { message: 'API key reported as leaked' } }));
    }
    if (String(url).includes('api.groq.com')) {
      s8_groqCalls++;
      return makeRes(200, JSON.stringify({ choices: [{ message: { content: 'Groq response OK' } }] }));
    }
    return makeRes(500, 'unexpected URL');
  };
  app.window.fetch = app.fetch;
  const r8 = await callLLM('test 8', { cacheKey: null });
  const r8_pass = r8.ok === true && r8.source === 'groq' && s8_geminiCalls === 1 && s8_groqCalls === 1 && r8.text === 'Groq response OK';
  console.log(`  ${r8_pass ? 'PASS' : 'FAIL'}  8. Groq fallback: Gemini leaked → Groq tried + succeeds`);
  console.log(`        ok=${r8.ok} src=${r8.source} geminiCalls=${s8_geminiCalls} groqCalls=${s8_groqCalls} text="${(r8.text||'').slice(0,30)}"`);

  // Scenario 9 — No Gemini key, Groq directly
  app.localStorage.removeItem('sp_gemini_dead_keys');
  vm.runInContext('GEMINI_API_KEY = ""; GROQ_API_KEY = "grq-test-key";', app);
  let s9_geminiCalls = 0, s9_groqCalls = 0;
  app.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) { s9_geminiCalls++; return makeRes(500, 'should not be called'); }
    if (String(url).includes('api.groq.com')) { s9_groqCalls++; return makeRes(200, JSON.stringify({ choices: [{ message: { content: 'direct Groq' } }] })); }
    return makeRes(500, 'unexpected URL');
  };
  app.window.fetch = app.fetch;
  const r9 = await callLLM('test 9', { cacheKey: null });
  const r9_pass = r9.ok === true && r9.source === 'groq' && s9_geminiCalls === 0 && s9_groqCalls === 1;
  console.log(`  ${r9_pass ? 'PASS' : 'FAIL'}  9. Groq-only: no Gemini key → Groq called directly (no Gemini round-trip)`);
  console.log(`        ok=${r9.ok} src=${r9.source} geminiCalls=${s9_geminiCalls} groqCalls=${s9_groqCalls}`);

  // Scenario 10 — Both remotes dead → falls back to local
  app.localStorage.removeItem('sp_gemini_dead_keys');
  app.localStorage.removeItem('sp_local_llm_enabled');
  vm.runInContext('GEMINI_API_KEY = "gem-test-key"; GROQ_API_KEY = "grq-test-key"; LOCAL_LLM_ENABLED = false;', app);
  app.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) return makeRes(403, JSON.stringify({ error: { message: 'API key reported as leaked' } }));
    if (String(url).includes('api.groq.com')) return makeRes(401, JSON.stringify({ error: { message: 'Invalid API Key' } }));
    return makeRes(500, 'unexpected URL');
  };
  app.window.fetch = app.fetch;
  const r10 = await callLLM('test 10', { cacheKey: null });
  const localEnabledAfter10 = vm.runInContext('LOCAL_LLM_ENABLED', app);
  const r10_pass = r10.ok === true && r10.source === 'local' && r10.fellBackFrom === 'leaked' && localEnabledAfter10 === true;
  console.log(`  ${r10_pass ? 'PASS' : 'FAIL'}  10. Both remotes dead → falls back to local + auto-enables LOCAL_LLM_ENABLED`);
  console.log(`        ok=${r10.ok} src=${r10.source} fellBack=${r10.fellBackFrom} localEnabled=${localEnabledAfter10}`);

  results.push({ name: '8. Groq fallback after Gemini leaked', pass: r8_pass, detail: '' });
  results.push({ name: '9. Groq-only direct path', pass: r9_pass, detail: '' });
  results.push({ name: '10. Both remotes dead → local', pass: r10_pass, detail: '' });

  let pass = 0, fail = 0;
  for (const r of results) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    if (!r.detail) continue;   // already printed inline for 6/7
    console.log(`  ${tag}  ${r.name}`);
    console.log(`        ${r.detail}`);
  }
  for (const r of results) { if (r.pass) pass++; else fail++; }
  console.log(`\nGemini leaked-key + seamless-fallback smoke: ${pass}/${pass+fail} scenarios passed`);
  if (fail > 0) process.exit(1);
})().catch(e => { console.error('Harness crashed:', e); process.exit(2); });

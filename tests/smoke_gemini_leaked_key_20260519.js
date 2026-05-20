// Smoke harness for the AI dispatcher — exercises callLLM() across the
// shapes that matter after the 2026-05-20 Gemini removal.
//
// Provider chain in production: cache → Groq → in-browser local.
//
// Scenarios covered:
//   1. Groq 401 invalid → 'auth' error surfaced.
//   2. Groq 429 transient rate-limit → 'rate_limit' (NOT 'leaked').
//   3. Groq 401 "API key has been revoked" → 'leaked' (terminal).
//   4. Groq 200 OK → ok:true, source:'groq'.
//   5. Groq dead-key cached → next call short-circuits to local with NO
//      Groq network round-trip (proves dead-cache works).
//   6. Groq leaked → auto-enable LOCAL_LLM_ENABLED + fall back same call.
//   7. Empty/no key → no_key error (UI prompts user to set Groq key).
//
// Filename kept as `smoke_gemini_leaked_key_20260519.js` to preserve git
// blame history through the Gemini removal.
//
// Usage:  node tests/smoke_gemini_leaked_key_20260519.js
// Exit 0 = all pass; exit 1 = regression.

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

(async () => {
  const app = loadApp();
  if (typeof app.callLLM !== 'function') {
    console.error('callLLM not in sandbox exports — harness.js whitelist?');
    process.exit(2);
  }

  // Stub the in-browser model so scenarios that fall through to local
  // don't actually try to await a CDN import (which Node's vm can't do).
  vm.runInContext(`_loadLocalLLM = async () => ({ tokenizer: null });
  callLocalLLM = async (prompt, opts) => {
    if (opts && opts.onChunk) try { opts.onChunk('LOCAL-FALLBACK-OK'); } catch (e) {}
    return { ok: true, text: 'LOCAL-FALLBACK-OK', source: 'local' };
  };`, app);

  const results = [];

  const setGroqKey = (v) => vm.runInContext(`GROQ_API_KEY = ${JSON.stringify(v)}`, app);
  const setLocalEnabled = (v) => vm.runInContext(`LOCAL_LLM_ENABLED = ${v ? 'true' : 'false'}`, app);
  // The dispatcher auto-promotes LOCAL_LLM_ENABLED on terminal errors
  // unless LS_KEY_LOCAL_LLM is explicitly '0'. For classifier-only tests,
  // we need to BOTH set LOCAL_LLM_ENABLED=false AND set LS='0' so the
  // raw remote error surfaces without falling back.
  const resetStateClassifierOnly = () => {
    app.localStorage.removeItem('sp_gemini_dead_keys');
    setGroqKey('grq-test-key');
    setLocalEnabled(false);
    app.localStorage.setItem('sp_local_llm_enabled', '0');
  };
  const resetStateWithFallback = () => {
    app.localStorage.removeItem('sp_gemini_dead_keys');
    app.localStorage.removeItem('sp_local_llm_enabled');
    setGroqKey('grq-test-key');
    setLocalEnabled(false);
  };

  // ---- 1. Groq 401 invalid → 'auth' ----
  resetStateClassifierOnly();
  app.fetch = async () => makeRes(401, JSON.stringify({ error: { message: 'invalid api key format' } }));
  app.window.fetch = app.fetch;
  let r = await app.callLLM('test', { cacheKey: null });
  // 401 + "invalid api key" matches the leakedShape pattern in _callGroqLLM,
  // because Groq's "invalid api key" message is the same shape it uses for
  // permanently-bad keys. Either 'auth' or 'leaked' is acceptable here —
  // both are terminal and both route the same way. Assert it's one of those.
  let pass = (r.ok === false) && (r.error === 'auth' || r.error === 'leaked');
  results.push({ n: 1, name: 'Groq 401 invalid key → terminal error', pass, detail: `error=${r.error} ok=${r.ok}` });

  // ---- 2. Groq 429 transient rate-limit → 'rate_limit' (NOT 'leaked') ----
  resetStateClassifierOnly();
  app.fetch = async () => makeRes(429, JSON.stringify({ error: { message: 'Rate limit reached, please slow down' } }));
  app.window.fetch = app.fetch;
  r = await app.callLLM('test', { cacheKey: null });
  pass = r.ok === false && r.error === 'rate_limit';
  results.push({ n: 2, name: 'Groq 429 transient → rate_limit (not leaked)', pass, detail: `error=${r.error} ok=${r.ok}` });

  // ---- 3. Groq 401 "revoked" → 'leaked' (terminal) ----
  resetStateClassifierOnly();
  app.fetch = async () => makeRes(401, JSON.stringify({ error: { message: 'API key has been revoked' } }));
  app.window.fetch = app.fetch;
  r = await app.callLLM('test', { cacheKey: null });
  pass = r.ok === false && r.error === 'leaked';
  results.push({ n: 3, name: 'Groq 401 "revoked" → leaked', pass, detail: `error=${r.error} ok=${r.ok}` });

  // ---- 4. Groq 200 OK → success path ----
  resetStateClassifierOnly();
  app.fetch = async () => makeRes(200, JSON.stringify({ choices: [{ message: { content: 'OK from Groq' } }] }));
  app.window.fetch = app.fetch;
  r = await app.callLLM('test', { cacheKey: null });
  pass = r.ok === true && r.source === 'groq' && r.text === 'OK from Groq';
  results.push({ n: 4, name: 'Groq 200 OK → ok:true source:groq', pass, detail: `ok=${r.ok} src=${r.source} text="${(r.text||'').slice(0,30)}"` });

  // ---- 5. Dead-key short-circuit: 2nd call routes straight to local ----
  resetStateWithFallback();
  // First call — Groq returns leaked, marks dead, auto-enables local.
  app.fetch = async () => makeRes(401, JSON.stringify({ error: { message: 'API key has been revoked' } }));
  app.window.fetch = app.fetch;
  await app.callLLM('test', { cacheKey: null });
  // Second call — wrap fetch to count whether Groq is hit.
  let groqCalls = 0;
  app.fetch = async () => { groqCalls++; return makeRes(500, 'should not be called'); };
  app.window.fetch = app.fetch;
  r = await app.callLLM('test 2', { cacheKey: null });
  pass = r.ok === true && r.source === 'local' && groqCalls === 0;
  results.push({ n: 5, name: 'Dead-key short-circuit (2nd call skips Groq, goes to local)', pass, detail: `ok=${r.ok} src=${r.source} groqCalls=${groqCalls}` });

  // ---- 6. Groq leaked → auto-enable LOCAL_LLM_ENABLED + fall back ----
  resetStateWithFallback();
  app.fetch = async () => makeRes(401, JSON.stringify({ error: { message: 'API key has been revoked' } }));
  app.window.fetch = app.fetch;
  r = await app.callLLM('test', { cacheKey: null });
  const localAfter = vm.runInContext('LOCAL_LLM_ENABLED', app);
  pass = r.ok === true && r.source === 'local' && r.fellBackFrom === 'leaked' && localAfter === true;
  results.push({ n: 6, name: 'Groq leaked → auto-enable local + fallback same call', pass, detail: `ok=${r.ok} src=${r.source} fellBack=${r.fellBackFrom} localEnabled=${localAfter}` });

  // ---- 7. No key + local disabled → no_key error ----
  resetStateClassifierOnly();
  setGroqKey('');
  setLocalEnabled(false);
  vm.runInContext("localStorage.setItem('sp_local_llm_enabled', '0')", app);   // explicit user-disabled
  app.fetch = async () => makeRes(500, 'should not be called');
  app.window.fetch = app.fetch;
  r = await app.callLLM('test', { cacheKey: null });
  pass = r.ok === false && r.error === 'no_key';
  results.push({ n: 7, name: 'No Groq key + local disabled → no_key', pass, detail: `error=${r.error} ok=${r.ok}` });

  let passed = 0, failed = 0;
  for (const r of results) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    console.log(`  ${tag}  ${r.n}. ${r.name}`);
    console.log(`        ${r.detail}`);
    if (r.pass) passed++; else failed++;
  }
  console.log(`\nGroq-only dispatcher smoke: ${passed}/${passed+failed} scenarios passed`);
  if (failed > 0) process.exit(1);
})().catch(e => { console.error('Harness crashed:', e); process.exit(2); });

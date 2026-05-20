// Stale-content audit for user-visible strings in index.html.
//
// Problem this solves (2026-05-20): the Gemini-removal commit cd96945
// stripped the active code paths but left the TIP dictionary, modal
// empty-state messages, and a couple of error messages still saying
// "Asks Google Gemini..." — the user only caught it by hovering a
// tooltip and pointing at the screen. A human sweep missed it because
// the file is 22k+ lines and `grep "Gemini"` returns ~30 hits, most of
// which are legitimate code comments and legacy storage references.
//
// This audit greps for explicitly deny-listed terms ONLY in user-visible
// content — code comments, legacy storage slot names, and legacy alias
// declarations are whitelisted so they don't false-positive. When a
// feature is removed in the future, add its name(s) to DENYLIST and
// every subsequent commit's smoke run will catch any forgotten copy.
//
// Usage:
//   node tests/audit_stale_content.js
// Exit 0 = clean. Exit 1 = at least one violation. Re-run after every
// significant copy change (or wire into CI).

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Files to scan. The static HTML at the top of index.html is technically
// replaced by the JS template on first render, but on the very first paint
// (before JS runs) the user sees the raw static HTML — so it's still
// user-visible and gets scanned.
const TARGETS = [
  { file: 'index.html', kind: 'inline-js + html' },
];

// Terms that MUST NOT appear in user-visible content. Each entry carries a
// short reason so future maintainers know why it's flagged.
const DENYLIST = [
  {
    term: 'Gemini',
    why: 'Removed 2026-05-20 — Groq is the sole remote LLM provider. See CLAUDE.md "AI features — where they live".',
  },
  {
    term: 'aistudio.google.com',
    why: 'Gemini signup URL; users should be pointed at console.groq.com/keys.',
  },
  {
    term: 'gemini-2.5',
    why: 'Deprecated Gemini model name.',
  },
  {
    term: 'gemini-2.0',
    why: 'Deprecated Gemini model name.',
  },
];

// Allowance patterns — if a line matches ANY of these regexes, denylist
// hits on that line are considered legitimate (legacy storage slot names,
// legacy alias declarations, internal identifiers that the rest of the
// codebase depends on for back-compat).
//
// Add entries here ONLY when the match is genuinely legacy / internal.
// User-visible tooltips, error messages, modal copy, and Settings help
// text never qualify — fix those at the source.
const LINE_ALLOWANCES = [
  /LS_KEY_GEMINI/,                // Legacy storage constant (declared but no longer read)
  /sp_gemini_key/,                // Legacy localStorage slot name
  /sp_gemini_dead_keys/,          // Legacy LS slot, now holds all-provider dead keys
  /_isGeminiKeyDead/,             // Legacy alias for _isRemoteKeyDead('gemini', ...)
  /_markGeminiKeyDead/,           // Legacy alias
  /_clearAllGeminiDeadCache/,     // Legacy alias
];

// JS string-aware comment stripper. Returns the code-only portion of a
// line PLUS the updated block-comment state (carried across lines). The
// stripper tracks string-literal state so URLs inside strings (https://...)
// are NOT mistaken for `//` line comments.
function stripCommentsLexer(line, inBlock) {
  let out = '';
  let i = 0;
  let inStr = false;
  let strCh = '';
  let escape = false;
  while (i < line.length) {
    const c = line[i];
    const n = line[i + 1];
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; i += 2; }
      else i++;
      continue;
    }
    if (inStr) {
      out += c;
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === strCh) inStr = false;
      i++;
      continue;
    }
    if (c === '/' && n === '/') break;                       // line comment
    if (c === '/' && n === '*') { inBlock = true; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      inStr = true; strCh = c; out += c; i++; continue;
    }
    out += c;
    i++;
  }
  return { code: out, inBlock };
}

function auditFile(relPath) {
  const fullPath = path.join(ROOT, relPath);
  const text = fs.readFileSync(fullPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const hits = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i];
    const { code, inBlock: nextBlock } = stripCommentsLexer(raw, inBlock);
    inBlock = nextBlock;
    if (!code.trim()) continue;
    for (const entry of DENYLIST) {
      if (code.includes(entry.term)) {
        // Whitelist legacy / internal lines.
        if (LINE_ALLOWANCES.some(rx => rx.test(raw))) continue;
        hits.push({
          file: relPath,
          line: lineNum,
          term: entry.term,
          why: entry.why,
          snippet: raw.trim().slice(0, 200),
        });
      }
    }
  }
  return hits;
}

(function main() {
  console.log('[audit_stale_content] scanning for stale terms in user-visible content...\n');
  let total = 0;
  for (const t of TARGETS) {
    const hits = auditFile(t.file);
    total += hits.length;
    for (const h of hits) {
      console.log(`  ✗  ${h.file}:${h.line}  term="${h.term}"`);
      console.log(`     ${h.snippet}`);
      console.log(`     why: ${h.why}\n`);
    }
  }
  if (total === 0) {
    console.log('✓ Clean — no stale user-visible terms found.');
    console.log('  Scanned: ' + TARGETS.map(t => `${t.file} (${t.kind})`).join(', '));
    console.log('  Denylist: ' + DENYLIST.map(d => '"' + d.term + '"').join(', '));
    process.exit(0);
  }
  console.log(`✗ ${total} violation${total === 1 ? '' : 's'} found.`);
  console.log('  Either:');
  console.log('    • Update the user-visible string to remove the stale term, or');
  console.log('    • Extend LINE_ALLOWANCES if the match is legitimate (legacy alias, storage slot, etc.).');
  process.exit(1);
})();

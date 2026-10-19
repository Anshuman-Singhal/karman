#!/usr/bin/env node
/* ==========================================================================
   KÁRMÁN · tools/source.mjs
   Read a question's source page from the shell, so the weekly content run
   never needs the web-fetch tool (which can stop an unattended run to ask
   for permission). Wikipedia and most reference sites work.

     node tools/source.mjs <url>                     page text (first 6,000 chars)
     node tools/source.mjs <url> "term" "other"      only the sentences with a term
     node tools/source.mjs --batch content/batches/2026-10-19.json
                                                     every question's source, with the
                                                     sentences that mention its answer

   Uses curl (it honours the sandbox proxy), a polite User-Agent, and backs
   off and retries on 429/503. Exit code 1 if the page can't be read.
   ========================================================================== */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const UA = 'KarmanContentBot/1.0 (https://karman.day; hello@karman.day)';
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function get(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let out;
    try {
      out = execFileSync('curl', ['-sSL', '--max-time', '30', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
    } catch (e) {
      if (attempt === 4) throw new Error(`can't reach ${url}: ${e.message.split('\n')[0]}`);
      sleep(2000 * (attempt + 1));
      continue;
    }
    const i = out.lastIndexOf('\n');
    const code = Number(out.slice(i + 1));
    const body = out.slice(0, i);
    if (code === 429 || code === 503) { sleep(3000 * (attempt + 1)); continue; }
    if (code >= 400) throw new Error(`${url} answered ${code}`);
    return body;
  }
  throw new Error(`${url} kept answering 429 (rate limited); wait a minute and retry`);
}

function text(html) {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/gi, '')   // Wikipedia [12] markers
    .replace(/<br\s*\/?>|<\/(p|li|tr|h\d|div|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&minus;|&#8722;/g, '-').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function sentencesWith(t, terms) {
  const low = terms.map((x) => x.toLowerCase());
  return t.split(/(?<=[.!?])\s+|\n/).filter((s) => low.some((x) => s.toLowerCase().includes(x))).map((s) => s.trim()).filter(Boolean);
}

/* Ways an answer may be written on a page: 6000, 6,000, 6 000, 6.0 */
function answerTerms(a) {
  const n = Number(a);
  const out = new Set([String(a), n.toLocaleString('en-US')]);
  if (Number.isInteger(n)) out.add(n.toLocaleString('en-US').replace(/,/g, ' '));
  else out.add(String(Number(n.toPrecision(3))));
  return [...out];
}

const args = process.argv.slice(2);
try {
  if (args[0] === '--batch') {
    const qs = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    let bad = 0;
    for (const q of qs) {
      console.log(`\n## ${q.id || ''} ${q.q}\n   answer ${q.answer} ${q.unit || ''} · ${q.source}`);
      try {
        const hits = sentencesWith(text(get(q.source)), answerTerms(q.answer)).slice(0, 4);
        if (!hits.length) { bad++; console.log('   ! answer not found verbatim on the page: check it by reading the page'); }
        hits.forEach((s) => console.log(`   > ${s.slice(0, 300)}`));
      } catch (e) { bad++; console.log(`   ! ${e.message}`); }
      sleep(400);   // be polite to Wikipedia
    }
    console.log(`\n${qs.length} sources read, ${bad} need a manual look.`);
  } else if (args[0]) {
    const t = text(get(args[0]));
    const terms = args.slice(1);
    if (terms.length) sentencesWith(t, terms).forEach((s) => console.log(`> ${s}`));
    else console.log(t.slice(0, 6000));
  } else {
    console.log('usage: node tools/source.mjs <url> [term …] | --batch <batch.json>');
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

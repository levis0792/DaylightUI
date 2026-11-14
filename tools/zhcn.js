"use strict";
// Maintain the zhCN localization in a fork of DaylightUI.
//
// Commands:
//   node tools/zhcn.js check
//   node tools/zhcn.js missing
//   node tools/zhcn.js translate
//   node tools/zhcn.js apply translations/zhCN-<version>.json
//
// translate needs an OpenAI-compatible chat endpoint:
//   OPENAI_API_KEY=...
//   OPENAI_BASE_URL=https://api.openai.com/v1   (optional)
//   OPENAI_MODEL=gpt-4.1-mini                    (optional)
//
// Existing reviewed entries are the translation memory. Only keys absent from
// zhCN.lua are sent to the model, in small batches, and every result is checked
// for placeholders and color codes before it is written.
const fs = require("node:fs");
const path = require("node:path");

const defaultRoot = path.resolve(__dirname, "..");
const root = path.resolve(process.env.ZHCN_ROOT || defaultRoot);
const localePath = path.join(root, "Locales", "zhCN.lua");
const toolRoot = process.env.ZHCN_TOOL_ROOT
  ? path.resolve(process.env.ZHCN_TOOL_ROOT)
  : defaultRoot;
const { extract } = require(path.join(toolRoot, "tools", "lib", "catalog"));
const { luaQuote } = require(path.join(toolRoot, "tools", "lib", "lua"));
const { formatOk, specifiers } = require(path.join(toolRoot, "tools", "lib", "format"));

function readLocale() {
  const src = fs.readFileSync(localePath, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const entries = new Map();
  const duplicates = [];
  for (const line of src.split("\n")) {
    const m = line.match(/^L\[("(?:\\.|[^"\\])*")\]\s*=\s*("(?:\\.|[^"\\])*")$/);
    if (!m) continue;
    const key = JSON.parse(m[1]);
    const value = JSON.parse(m[2]);
    if (entries.has(key)) duplicates.push(key);
    else entries.set(key, value);
  }
  return { src, entries, duplicates };
}

const ALLOWED_ENGLISH = new Set([
  "PvP", "PvE", "RP", "DPS", "HPS", "NPC", "UI", "AFK", "AP", "AOE", "AoE",
  "GUID", "ID", "PVP", "PVE", "Daylight UI", "Daylight", "TW", "CN", "US", "EU",
  "Alt", "Ctrl", "Shift", "Esc",
  // AddOn and font names stay as published so players can find them.
  "Ace3", "Attune", "Baganator", "Bagnon", "BuffLedger", "Deadly Boss Mods",
  "Dewdrop", "OPie", "Plater", "Platynator", "PrettyTooltip", "Questie",
  "RestedXP Guides", "Threat Plates", "Archivo Narrow", "Arial Narrow",
  "Barlow Condensed", "Expressway", "Fira Sans", "Lato", "PT Sans Narrow",
  "Poppins", "Russo One", "DaylightUI", "DaylightUI Discord",
  // Style and addon names users see in the UI, plus the donation page.
  "Jiberish", "Fabled", "Icons", "JiberishUI", "Calm", "Punchy", "Classic",
  "Flat", "Custom", "Patreon", "Ko-fi", "EllesmereUI", "DaylightMogul",
  // Rank is a fixed game term; keep it as the client prints it.
  "Rank",
  // Keyboard labels are shown in uppercase by the game.
  "ALT", "CTRL", "SHIFT", "shop",
]);

function hasHan(s) {
  return /[\u3400-\u9fff]/.test(String(s));
}

// Words that are actual UI actions. Brand names, addon names, key names and
// command arguments do not belong in this list, so a mixed translation such as
// "Open 商店" is still caught while "DaylightUI" and "/dui install" are not.
const UI_ACTION_WORDS = new Set([
  "open", "close", "save", "cancel", "apply", "reset", "enable", "enabled",
  "disable", "disabled", "show", "hide", "load", "delete", "remove", "edit",
  "copy", "paste", "search", "select", "clear", "next", "previous", "back",
  "yes", "no", "on", "off", "default", "advanced", "general", "profile",
  "profiles", "import", "export", "update", "install", "ready", "warning",
  "error", "settings", "setting",
]);

// Short ASCII bits that legitimately sit inside a Chinese sentence:
// search syntax (q>rare, ilvl>20), key names (Alt+Up, Ctrl+C), dimensions
// (240 x 60), channel tags ([1. G]), and the like. They count as allowed
// words, not as untranslated English.
const MIXED_ASCII_WORDS = new Set([
  'q', 'ilvl', 'x', 'g', 't', 'p', 's', 'y', 'w', 'c', 'a', 'z', 'n',
  'boe', 'bou', 'set', 'h', 'm', 'k', 'id', 'frame', 'npcs', 'npc',
  'up', 'down', 'left', 'right', 'zoom', 'in', 'out', 'shift',
  'ctrl', 'alt', 'esc', 'del', 'ins', 'tab', '1k', '2k', '3k', '4k',
  '5k', '6k', '7k', '8k', '9k',
]);

function stripCommandsAndCode(value) {
  return String(value)
    .replace(/\|c[0-9a-fA-F]{8}|\|r|\|T[^|]*\|t/g, "")
    .replace(/%(?:%|[-+0#]*\d*(?:\.\d+)?[cdiouxXeEfgGqs])/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`[^`]*`/g, "")
    // Remove a command and its ASCII arguments; the rest of the sentence is
    // still checked, so text after a command is not silently skipped.
    .replace(/\/[A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z0-9_%<>=|.-]+)*/g, "")
    .replace(/[/_.[\]{}()<>:=+*\-：、，。；！？（）【】《》〈〉“”‘’…—]+/g, " ")
    .trim();
}

function englishLeftover(key, value) {
  if (!value || !/[A-Za-z]/.test(value)) return false;
  const stripped = stripCommandsAndCode(value);
  if (!stripped) return false;
  const words = stripped.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (!words.length) return false;
  if (ALLOWED_ENGLISH.has(String(value).trim())) return false;
  if (String(key).startsWith("Daylight UI: ") && String(value).startsWith("Daylight UI")) return false;
  if (words.every((w) => ALLOWED_ENGLISH.has(w))) return false;
  // Proper names, slash commands and addon commands intentionally stay as written.
  if (String(key).startsWith("/") || String(value).startsWith("/")) return false;
  if (/^Daylight UI\s*:/i.test(String(value))) return false;
  if (/^[\w.-]+\.(?:png|tga|blp|ttf|otf)$/i.test(String(value))) return false;
  if (/^skins profile\b/i.test(String(value))) return false;
  if (/^skins\s+[a-z]/i.test(String(value))) return false;
  // A value with Chinese must not still contain English. Two checks:
  // 1) three or more ordinary English words in a row means an untranslated
  //    sentence such as "types: gear, weapon, armor";
  // 2) a single UI action word such as "Open" or "Save" is never allowed.
  if (hasHan(value)) {
    const isOrdinary = (w) =>
      !ALLOWED_ENGLISH.has(w) &&
      !MIXED_ASCII_WORDS.has(w.toLowerCase()) &&
      !UI_ACTION_WORDS.has(w.toLowerCase());
    // Count only pure-ASCII tokens. "Calm 小而缓慢" is one Han-mixed
    // token, not English; a real leak is several English words in a row,
    // like "gear, weapon, armor".
    const ascii = words.filter((w) => !hasHan(w));
    let run = 0;
    let longest = 0;
    for (const w of ascii) {
      run = isOrdinary(w) ? run + 1 : 0;
      if (run > longest) longest = run;
    }
    if (longest >= 3) return true;
    return words.some((w) => UI_ACTION_WORDS.has(w.toLowerCase()));
  }
  return words.some((w) => w.length >= 2);
}

function catalog() {
  return extract(root);
}

function report({ missingOnly = false } = {}) {
  const cat = catalog();
  const { entries, duplicates } = readLocale();
  const missing = [...cat.keys()].filter((k) => !entries.has(k));
  const bad = [...entries].filter(([k, v]) => !v.trim() || !formatOk(k, v));
  const untranslatedValues = [...cat.keys()].filter((k) => entries.has(k) && englishLeftover(k, entries.get(k)));
  const english = untranslatedValues;
  console.log(`Current UI strings: ${cat.size}`);
  console.log(`zhCN entries: ${entries.size}`);
  console.log(`Missing keys: ${missing.length}`);
  console.log(`Untranslated: ${missing.length + english.length}`);
  console.log(`English leftovers: ${english.length}`);
  console.log(`Duplicate keys: ${duplicates.length}`);
  console.log(`Format/empty errors: ${bad.length}`);
  if (duplicates.length) for (const k of duplicates) console.log(`  duplicate ${JSON.stringify(k)}`);
  if (bad.length) for (const [k, v] of bad.slice(0, 80)) console.log(`  invalid ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
  if (english.length && !missingOnly) for (const k of english) console.log(`  english ${JSON.stringify(k)} -> ${JSON.stringify(entries.get(k))}`);
  if (missing.length && !missingOnly) for (const k of missing) console.log(`  missing ${JSON.stringify(k)}`);
  if (missing.length) {
    const out = path.join(root, "tools", "reports", "zhcn-missing.tsv");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, missing.map((k) => `${JSON.stringify(k)}\t${cat.get(k).refs.join(",")}`).join("\n") + "\n", "utf8");
    console.log(`Report: ${path.relative(root, out)}`);
  }
  return { cat, entries, duplicates, missing, bad, english };
}

function applyData(data, label, opts = {}) {
  const { src, entries } = readLocale();
  const toApply = Object.entries(data).filter(([k]) => opts.replace || !entries.has(k));
  const bad = toApply.filter(([k, v]) => typeof v !== "string" || !v.trim() || !formatOk(k, v));
  if (bad.length) {
    console.error(`Refusing to apply ${bad.length} invalid entries:`);
    for (const [k, v] of bad.slice(0, 40)) console.error(`  ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
    process.exit(1);
  }
  let out = src.replace(/\n?$/, "\n");
  for (const [k, v] of toApply) {
    if (!entries.has(k)) continue;
    const quoted = luaQuote(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lineRe = new RegExp("^L\\[" + quoted + "\\]\\s*=\\s*\"(?:\\\\.|[^\"\\\\])*\"\\s*$", "m");
    out = out.replace(lineRe, `L[${luaQuote(k)}] = ${luaQuote(v)}`);
  }
  const toAdd = toApply.filter(([k]) => !entries.has(k));
  if (toAdd.length) {
    out += `\n-- DaylightUI translations from ${label}.\n`;
    out += toAdd.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => `L[${luaQuote(k)}] = ${luaQuote(v)}`).join("\n") + "\n";
  }
  fs.writeFileSync(localePath, out, "utf8");
  console.log(`Added ${toAdd.length} entries; ${toApply.length - toAdd.length} replaced.`);
  return toApply.length;
}

function parseLocaleFile(file) {
  const src = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const entries = new Map();
  for (const line of src.split("\n")) {
    const m = line.match(/^L\[("(?:\\.|[^"\\])*")\]\s*=\s*("(?:\\.|[^"\\])*")$/);
    if (!m) continue;
    try { entries.set(JSON.parse(m[1]), JSON.parse(m[2])); } catch (e) {}
  }
  return entries;
}

// Add only the entries the current locale does not have yet. Upstream keeps
// whatever it already translated, so a merged upstream never gets rewritten.
function merge(file) {
  const source = path.resolve(root, file || "");
  const entries = parseLocaleFile(source);
  if (!entries.size) throw new Error("no locale entries in " + source);
  applyData(Object.fromEntries(entries), "merged " + path.basename(source));
  report();
}

// Force reviewed values (for example fixed game terms) over upstream/AI ones.
function override(file) {
  const data = JSON.parse(fs.readFileSync(path.resolve(root, file || ""), "utf8"));
  applyData(data, "overrides " + path.basename(file), { replace: true });
  report();
}
function apply(file) {
  const data = JSON.parse(fs.readFileSync(path.resolve(root, file || ""), "utf8"));
  applyData(data, path.basename(file));
  report();
}

function normal(s) {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function translationMemory(entries) {
  const exact = new Map(entries);
  const approx = new Map();
  for (const [k, v] of entries) {
    const n = normal(k);
    if (!approx.has(n)) approx.set(n, v);
  }
  return { exact, approx };
}

function readGlossary() {
  const glossaryPath = path.join(toolRoot, 'tools', 'zhcn-glossary.json');
  if (!fs.existsSync(glossaryPath)) throw new Error('zhCN glossary is missing: ' + glossaryPath);
  let glossary;
  try {
    glossary = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
  } catch (e) {
    throw new Error('zhCN glossary is invalid JSON: ' + glossaryPath + ': ' + e.message);
  }
  if (!glossary || typeof glossary !== 'object' || Array.isArray(glossary) || !Object.keys(glossary).length) {
    throw new Error('zhCN glossary must be a non-empty JSON object: ' + glossaryPath);
  }
  return glossary;
}

function retryable(error) {
  return error && (error.retryable === true || error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || error.status >= 500);
}

async function requestOnce(batch, memory, fetchImpl = globalThis.fetch) {
  const key = process.env.API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Repository secret API_KEY is not set');
  const base = (process.env.OPENAI_BASE_URL || 'https://ai.levis0792.cn:18787/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL || 'deepseek-v4.1-flash';
  const context = [];
  for (const [k, v] of [...memory.exact].slice(-250)) context.push([k, v]);
  const glossary = readGlossary();
  const system = [
    'You translate World of Warcraft addon UI text from English to Simplified Chinese.',
    'Return only a JSON object mapping every input key to a Chinese string; no markdown.',
    'Preserve every printf placeholder exactly: %s, %d, %.0f, %.2f, %%.',
    'Preserve color and texture codes exactly: |cAARRGGBB, |r, |T...|t.',
    'Use concise, natural mainland Chinese UI language.',
    'Use these approved terms: 爆击, 微缩地图, 鼠标提示, 潜行者.',
    'Keep PvP, PvE, RP, DPS, HPS, NPC, UI and addon names in English.',
    'Do not translate slash commands, setting keys, font names, URLs or code identifiers.',
    'If a string is a full sentence, keep its meaning and all conditions; do not omit clauses.',
    'Use the supplied reviewed pairs as translation memory for terminology.',
    'Each requested row has original_english and source_location. Translate original_english; source_location is only a file reference and must never be returned as a translation.',
    'Required glossary: ' + JSON.stringify(glossary),
  ].join(' ');
  const requested = batch.map(([original_english, source_location]) => ({ original_english, source_location }));
  const user = JSON.stringify({ approved_translation_memory: context, strings_to_translate: requested }, null, 2);
  const res = await fetchImpl(base + '/chat/completions', {
    signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || 120000)),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    const error = new Error('AI request failed (' + res.status + '): ' + text.slice(0, 1000));
    error.status = res.status;
    throw error;
  }
  let parsed;
  try {
    const data = JSON.parse(text);
    let content = data.choices[0].message.content.trim();
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const first = content.indexOf('{');
    const last = content.lastIndexOf('}');
    if (first >= 0 && last > first) content = content.slice(first, last + 1);
    parsed = JSON.parse(content);
  } catch (e) {
    // Some models answer a one-string request with the translated string
    // itself instead of a JSON object. Accept that only for a single row;
    // multi-row requests still require the complete key mapping.
    if (batch.length === 1) {
      try {
        const data = JSON.parse(text);
        const content = data.choices[0].message.content.trim();
        parsed = { [batch[0][0]]: content };
      } catch (_) {
        throw new Error('AI returned invalid JSON: ' + text.slice(0, 1000));
      }
    } else {
      throw new Error('AI returned invalid JSON: ' + text.slice(0, 1000));
    }
  }
  const out = {};
  for (const [k] of batch) {
    let v = parsed[k];
    if ((typeof v !== 'string' || !v.trim()) && batch.length === 1) {
      const values = Object.values(parsed).filter((item) => typeof item === 'string' && item.trim());
      if (values.length === 1) v = values[0];
    }
    if (typeof v !== 'string' || !v.trim()) throw new Error('AI omitted: ' + JSON.stringify(k) + '; returned keys: ' + JSON.stringify(Object.keys(parsed)));
    if (!formatOk(k, v)) throw new Error('Placeholder mismatch: ' + JSON.stringify(k) + ' -> ' + JSON.stringify(v));
    if (englishLeftover(k, v)) throw new Error('AI left the string in English: ' + JSON.stringify(k) + ' -> ' + JSON.stringify(v));
    out[k] = v;
  }
  return out;
}

function integerEnv(name, fallback, minimum) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum) {
    throw new Error(name + ' must be an integer >= ' + minimum);
  }
  return value;
}

async function requestBatch(batch, memory, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const tries = opts.retries || integerEnv('AI_RETRIES', 3, 1);
  const wait = opts.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await requestOnce(batch, memory, fetchImpl);
    } catch (e) {
      last = e;
      const canRetry = retryable(e);
      const message = 'AI batch attempt ' + attempt + '/' + tries + ' failed: ' + (e.message || e);
      console.error(message);
      console.log('::error::' + message)
      if (!canRetry || attempt === tries) break;
      const delay = Math.min(30000, integerEnv('AI_RETRY_BASE_MS', 1500, 0) * (2 ** (attempt - 1)));
      console.error('Retrying in ' + delay + 'ms');
      await wait(delay);
    }
  }
  // A validation error (English left, placeholder mismatch, omitted key) is
  // deterministic for a whole batch. Retry each string alone so one awkward
  // line does not block every new string in the release.
  if (last && !retryable(last) && batch.length > 1) {
    console.error('Retrying the failed batch one string at a time.');
    const out = {};
    for (const row of batch) Object.assign(out, await requestBatch([row], memory, { ...opts, retries: tries, wait }));
    return out;
  }
  if (last && !retryable(last)) throw last;
  throw new Error('AI batch failed after ' + tries + ' attempts: ' + (last && (last.message || last)));
}

async function translate() {
  const { cat, entries, english } = report({ missingOnly: true });
  const missing = [...new Set([
    ...[...cat.keys()].filter((k) => !entries.has(k)),
    ...english,
  ])];
  if (!missing.length) return;
  const memory = translationMemory(entries);
  const result = {};
  for (const k of missing) {
    const hit = memory.approx.get(normal(k));
    if (hit) result[k] = hit;
  }
  const remaining = missing.filter((k) => !(k in result));
  console.log(`Translation memory reused: ${missing.length - remaining.length}`);
  console.log(`AI translation needed: ${remaining.length}`);
  const size = Math.max(1, Number(process.env.ZHCN_BATCH_SIZE || 20));
  const failed = [];
  for (let i = 0; i < remaining.length; i += size) {
    const batch = remaining.slice(i, i + size).map((k) => [k, cat.get(k).refs.slice(0, 3).join(", ")]);
    console.log(`AI batch ${i / size + 1}/${Math.ceil(remaining.length / size)} (${batch.length} strings)`);
    try {
      Object.assign(result, await requestBatch(batch, memory));
    } catch (e) {
      console.error(`AI batch ${i / size + 1} still failed: ${e.message || e}`);
      for (const [key] of batch) failed.push({ key, error: String(e.message || e) });
    }
  }
  const reportPath = path.join(root, "tools", "reports", "zhcn-ai.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ translations: result, failed }, null, 2) + "\n", "utf8");
  applyData(result, "AI translation", { replace: true });
  const after = report();
  if (failed.length || after.missing.length || after.english.length) {
    console.error(`Translation incomplete: ${failed.length} AI failures, ${after.missing.length} missing, ${after.english.length} English leftovers.`);
    process.exit(1);
  }
}

if (require.main === module) {
  const cmd = process.argv[2] || "check";
  if (cmd === "missing") report({ missingOnly: true });
  else if (cmd === "check") {
    const result = report();
    if (result.missing.length || result.english.length || result.bad.length || result.duplicates.length) process.exit(1);
  }
  else if (cmd === "apply") apply(process.argv[3]);
  else if (cmd === "merge") merge(process.argv[3]);
  else if (cmd === "override") override(process.argv[3]);
  else if (cmd === "translate") translate().catch((e) => { console.error(e.stack || e); process.exit(1); });
  else {
    console.error("Usage: node tools/zhcn.js check|missing|translate|apply|merge|override <json>");
    process.exit(2);
  }
}

module.exports = { readGlossary, retryable, requestOnce, requestBatch, integerEnv, englishLeftover };
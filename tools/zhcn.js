"use strict";
// Maintain the zhCN localization in a fork of DaylightUI. (runtime keys, forced backfill)
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
const { decodeShortString, luaQuote } = require(path.join(toolRoot, "tools", "lib", "lua"));
const { formatOk, specifiers } = require(path.join(toolRoot, "tools", "lib", "format"));

function readLocale() {
  const src = fs.readFileSync(localePath, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const entries = new Map();
  const duplicates = [];
  for (const line of src.split("\n")) {
    const m = line.match(/^L\[("(?:\\.|[^"\\])*")\]\s*=\s*("(?:\\.|[^"\\])*")$/);
    if (!m) continue;
    const key = decodeShortString(m[1]);
    const value = decodeShortString(m[2]);
    if (entries.has(key)) duplicates.push(key);
    else entries.set(key, value);
  }
  return { src, entries, duplicates };
}

const ALLOWED_ENGLISH = new Set([
  "PvP", "PvE", "RP", "DPS", "HPS", "NPC", "UI", "AFK", "AP", "AOE", "AoE",
  "GUID", "ID", "PVP", "PVE", "Daylight UI", "Daylight", "TW", "CN", "US", "EU",
  "CDM",
  "Alt", "Ctrl", "Shift", "Esc", "Delete", "DELETE",
  // AddOn and font names stay as published so players can find them.
  "Ace3", "Attune", "Baganator", "Bagnon", "BuffLedger", "Deadly Boss Mods",
  "Dewdrop", "OPie", "Plater", "Platynator", "PrettyTooltip", "Questie",
  "RestedXP Guides", "Threat Plates", "Archivo Narrow", "Arial Narrow",
  "Barlow Condensed", "Expressway", "Fira Sans", "Lato", "PT Sans Narrow",
  "Poppins", "Russo One", "DaylightUI", "DaylightUI Discord",
  // Style and addon names users see in the UI, plus the donation page.
  "Jiberish", "Fabled", "Icons", "JiberishUI", "Calm", "Punchy", "Classic",
  "Alfa Slab One", "Anton", "Archivo Black", "Audiowide", "Baloo 2", "Bangers", "Bebas Neue", "Big Shoulders", "Black Ops One", "Bowlby One", "Bungee", "Chakra Petch", "Changa One", "Chewy", "Cinzel", "Coiny", "Comfortaa", "Delius", "Dosis", "Fabled Class", "Fabled Core", "Fabled Dimension", "Fabled Myth", "Fabled Pixels", "Fabled Pixels v2", "Fabled Realm", "Fabled Realm v2", "Fabled Regalia", "Fizzle", "Fredoka", "Gluten", "Grandstander", "Itim", "Kanit Black Italic", "Lilita One", "Luckiest Guy", "M PLUS Rounded", "Mali", "MedievalSharp", "Metamorphous", "Nunito Black", "Orbitron", "Oswald", "Passion One", "Permanent Marker", "Pirata One", "Press Start 2P", "Quicksand", "Righteous", "Rubik", "Rubik Glitch", "Rubik Mono", "Sniglet", "Squada One", "Staatliches", "Teko", "Titan One", "Varela Round",
  "Flat", "Custom", "Patreon", "Ko-fi", "EllesmereUI", "DaylightMogul", "SkillUp", "SkillUp Forever",
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

// Remove duplicate `L["..."]` definitions while keeping the last one, which
// is the value Lua actually uses. Upstream occasionally adds a string that
// already exists near the top of the locale file; without this, every later
// strict check fails even when coverage is complete.
function dedupe() {
  const { src, duplicates } = readLocale();
  if (!duplicates.length) return 0;
  const lines = src.split("\n");
  const last = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^L\[("(?:\\.|[^"\\])*")\]\s*=\s*("(?:\\.|[^"\\])*")$/);
    if (!m) continue;
    try { last.set(decodeShortString(m[1]), i); } catch (e) {}
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^L\[("(?:\\.|[^"\\])*")\]\s*=\s*("(?:\\.|[^"\\])*")$/);
    if (m) {
      try {
        if (last.get(decodeShortString(m[1])) !== i) continue;
      } catch (e) {}
    }
    out.push(lines[i]);
  }
  fs.writeFileSync(localePath, out.join("\n"), "utf8");
  const removed = duplicates.length;
  console.log(`Removed ${removed} duplicate locale entr${removed === 1 ? "y" : "ies"} (kept the last definition).`);
  return removed;
}
function report({ missingOnly = false } = {}) {
  const cat = catalog();
  const { entries, duplicates } = readLocale();
  const missing = [...cat.keys()].filter((k) => !entries.has(k));
  const bad = [...entries].filter(([k, v]) => !v.trim() || v.includes("\uFFFD") || !formatOk(k, v));
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
  const bad = toApply.filter(([k, v]) => typeof v !== "string" || !v.trim() || v.includes("\uFFFD") || !formatOk(k, v));
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

// Keep the author's locale exactly as written. Only keys the runtime now ships
// and the current file is missing are appended at the end, in alphabetical
// order, from the reviewed fork baseline. Existing order, comments and
// translations are never rewritten.
function baseline(file) {
  const source = path.resolve(root, file || "");
  const from = parseLocaleFile(source);
  if (!from.size) throw new Error("no locale entries in " + source);
  const { cat } = report({ missingOnly: true });
  const { src, entries } = readLocale();
  for (const [key, value] of entries) {
    if (!value.trim() || value.includes("\uFFFD") || !formatOk(key, value)) throw new Error("Invalid baseline translation for " + JSON.stringify(key));
  }
  const additions = [];
  for (const key of cat.keys()) {
    if (entries.has(key) || !from.has(key)) continue;
    const value = from.get(key);
    if (!value.trim() || value.includes("\uFFFD") || !formatOk(key, value)) throw new Error("Invalid baseline translation for " + JSON.stringify(key));
    additions.push([key, value]);
  }
  additions.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (!additions.length) {
    console.log("Baseline adds no new entries; the author file is unchanged.");
    return 0;
  }
  let text = src.replace(/\n?$/, "\n");
  text += "\n-- New strings appended by the zhCN maintenance workflow; existing lines are unchanged.\n";
  text += additions.map(([key, value]) => "L[" + luaQuote(key) + "] = " + luaQuote(value)).join("\n") + "\n";
  fs.writeFileSync(localePath, text, "utf8");
  console.log("Baseline appended " + additions.length + " new entries; existing file kept byte-for-byte.");
  return additions.length;
}
function parseLocaleFile(file) {
  const src = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const entries = new Map();
  for (const line of src.split("\n")) {
    const m = line.match(/^L\[("(?:\\.|[^"\\])*")\]\s*=\s*("(?:\\.|[^"\\])*")$/);
    if (!m) continue;
    try { entries.set(decodeShortString(m[1]), decodeShortString(m[2])); } catch (e) {}
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

// Add reviewed values only for keys missing from the author-copy. Existing
// lines keep their order, comments and wording byte-for-byte; new keys are
// appended. This is the append-only mode used by the maintenance workflow.
function sync(file) {
  const source = path.resolve(root, file || "");
  const from = parseLocaleFile(source);
  if (!from.size) throw new Error("no locale entries in " + source);
  const { cat } = report({ missingOnly: true });
  const allowed = new Set(cat.keys());
  const data = Object.fromEntries([...from].filter(([k]) => allowed.has(k)));
  applyData(data, "synced " + path.basename(source));
  report();
}

// Force reviewed values (for example fixed game terms) over upstream/AI ones.
function override(file) {
  const data = JSON.parse(fs.readFileSync(path.resolve(root, file || ""), "utf8"));
  const { cat } = report({ missingOnly: true });
  const allowed = new Set(cat.keys());
  const reviewed = Object.fromEntries(Object.entries(data).filter(([key]) => allowed.has(key)));
  applyData(reviewed, "overrides " + path.basename(file), { replace: true });
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

// Pull only related reviewed pairs for this batch, rather than resending the
// whole memory table on every request.
function relatedMemory(memory, batch, limit = 24) {
  const words = new Set();
  for (const [key] of batch) {
    for (const word of String(key).toLowerCase().match(/[a-z]{3,}/g) || []) words.add(word);
  }
  if (!words.size) return [];
  const scored = [];
  for (const [key, value] of memory.exact) {
    const lower = String(key).toLowerCase();
    let score = 0;
    for (const word of words) if (lower.includes(word)) score += 1;
    if (score) scored.push([score, key, value]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
  return scored.slice(0, limit).map(([, key, value]) => [key, value]);
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
  return error && (error.retryable === true || error.timeout === true || error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || error.status >= 500);
}

function requestModel() {
  return process.env.OPENAI_MODEL || 'deepseek-v4.1-flash';
}

function reviewModels() {
  const configured = [
    process.env.ZHCN_REVIEW_MODEL || 'deepseek-v4.1-flash',
    process.env.ZHCN_REVIEW_FALLBACK_MODEL || 'deepseek-v4.1-flash',
    process.env.ZHCN_REVIEW_LAST_MODEL || 'deepseek-v4.1-flash',
    requestModel(),
  ];
  return [...new Set(configured.filter(Boolean))];
}

function reviewModel() {
  return reviewModels()[0];
}

function batchSize() {
  return integerEnv('ZHCN_BATCH_SIZE', 12, 1);
}

function contextWindow() {
  return integerEnv('ZHCN_CONTEXT_LINES', 6, 0);
}

function highRisk(key, ref) {
  const text = String(key);
  const holes = (text.match(/%(?:%|[-+0#]*\d*(?:\.\d+)?[cdiouxXeEfgGqs])/g) || []).length;
  const clauses = (text.match(/[.;:!?]|\b(?:and|or|but|if|when|while|unless|before|after)\b/gi) || []).length;
  const moduleName = String(ref || '').split(/[/:]/)[0];
  return text.length >= 80 || holes >= 2 || clauses >= 2 || /(?:^|[/_-])(?:new|unreleased)(?:[/_.-]|$)/i.test(moduleName);
}

function nearbyContext(cat, key, refs) {
  const window = contextWindow();
  if (!window) return [];
  const anchor = String((refs && refs[0]) || '');
  if (!anchor) return [];
  const file = anchor.replace(/:\d+$/, '');
  const line = Number((anchor.match(/:(\d+)$/) || [])[1] || 0);
  if (!file || !line) return [];
  const rows = [];
  for (const [other, item] of cat) {
    for (const at of item.refs) {
      const m = String(at).match(/^(.*):(\d+)$/);
      if (!m || m[1] !== file) continue;
      const n = Number(m[2]);
      if (other === key || Math.abs(n - line) > window) continue;
      rows.push([Math.abs(n - line), n, other]);
    }
  }
  rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return rows.slice(0, window).map((row) => row[2]);
}

async function requestOnce(batch, memory, fetchImpl = globalThis.fetch, opts = {}) {
  const key = process.env.API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Repository secret API_KEY is not set');
  const base = (process.env.OPENAI_BASE_URL || 'https://ai.levis0792.cn:18787/v1').replace(/\/$/, '');
  const model = opts.model || (opts.review ? reviewModel() : requestModel());
  const context = relatedMemory(memory, batch);
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
    'Use nearby_ui_text only to keep the same terminology and tone; never return it as a translation.',
    'Each requested row has original_english, source_location and nearby_ui_text. Translate original_english; source_location is only a file reference and must never be returned as a translation.',
    'Required glossary: ' + JSON.stringify(glossary),
  ].join(' ');
  const requested = batch.map(([original_english, source_location, nearby_ui_text]) => ({ original_english, source_location, nearby_ui_text: nearby_ui_text || [] }));
  const user = JSON.stringify({ approved_translation_memory: context, strings_to_translate: requested }, null, 2);
  let res;
  try {
    res = await fetchImpl(base + '/chat/completions', {
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || 120000)),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) e.timeout = true;
    throw e;
  }
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
    content = content.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '');
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
        throw Object.assign(new Error('AI returned invalid JSON: ' + text.slice(0, 1000)), { outputError: true });
      }
    } else {
      throw Object.assign(new Error('AI returned invalid JSON: ' + text.slice(0, 1000)), { outputError: true });
    }
  }
  const out = {};
  for (const [k] of batch) {
    let v = parsed[k];
    if ((typeof v !== 'string' || !v.trim()) && batch.length === 1) {
      const values = Object.values(parsed).filter((item) => typeof item === 'string' && item.trim());
      if (values.length === 1) v = values[0];
    }
    if (typeof v !== 'string' || !v.trim()) throw Object.assign(new Error('AI omitted: ' + JSON.stringify(k) + '; returned keys: ' + JSON.stringify(Object.keys(parsed))), { outputError: true });
    if (v.includes('\uFFFD')) throw Object.assign(new Error('AI returned a replacement character: ' + JSON.stringify(k)), { outputError: true });
    if (!formatOk(k, v)) throw Object.assign(new Error('Placeholder mismatch: ' + JSON.stringify(k) + ' -> ' + JSON.stringify(v)), { outputError: true });
    if (englishLeftover(k, v)) throw Object.assign(new Error('AI left the string in English: ' + JSON.stringify(k) + ' -> ' + JSON.stringify(v)), { outputError: true });
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
      return await requestOnce(batch, memory, fetchImpl, { review: opts.review === true, model: opts.model });
    } catch (e) {
      last = e;
      if (e.outputError) break;
      const canRetry = retryable(e);
      const message = 'AI batch attempt ' + attempt + '/' + tries + ' failed: ' + (e.message || e);
      console.error(message);
      console.log('::error::' + message);
      if (!canRetry || attempt === tries) break;
      const delay = Math.min(30000, integerEnv('AI_RETRY_BASE_MS', 1500, 0) * (2 ** (attempt - 1)));
      console.error('Retrying in ' + delay + 'ms');
      await wait(delay);
    }
  }
  // Model-output problems (malformed JSON, an omitted key, a placeholder error,
  // an English sentence or a replacement character) can be isolated to one
  // string. Split the batch once so one awkward line does not block the rest.
  if (last && last.outputError && batch.length > 1) {
    console.error('Retrying the failed batch one string at a time.');
    const out = {};
    for (const row of batch) Object.assign(out, await requestBatch([row], memory, { ...opts, retries: tries, wait }));
    return out;
  }
  if (last && last.outputError) throw last;
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
  const size = batchSize();
  const failed = [];
  for (let i = 0; i < remaining.length; i += size) {
    const batch = remaining.slice(i, i + size).map((k) => [k, cat.get(k).refs.slice(0, 3).join(", "), nearbyContext(cat, k, cat.get(k).refs)]);
    console.log(`AI batch ${i / size + 1}/${Math.ceil(remaining.length / size)} (${batch.length} strings)`);
    try {
      Object.assign(result, await requestBatch(batch, memory));
    } catch (e) {
      console.error(`AI batch ${i / size + 1} still failed: ${e.message || e}`);
      for (const [key] of batch) failed.push({ key, error: String(e.message || e) });
    }
  }
  if (failed.length) {
    console.error(`Translation incomplete: ${failed.length} AI failures.`);
    process.exit(1);
  }

  // Second pass: only long, multi-placeholder or condition-heavy rows go to
  // the review model. Ordinary short labels stay on the fast model.
  const risky = remaining.filter((k) => highRisk(k, (cat.get(k).refs || [])[0]));
  const reviewFailures = [];
  if (risky.length && process.env.ZHCN_REVIEW !== 'false') {
    const reviewMemory = translationMemory(new Map([...entries, ...Object.entries(result)]));
    const models = reviewModels();
    const reviewBatchSize = integerEnv('ZHCN_REVIEW_BATCH_SIZE', 6, 1);
    for (let i = 0; i < risky.length; i += reviewBatchSize) {
      const keys = risky.slice(i, i + reviewBatchSize);
      const rows = keys.map((k) => [k, cat.get(k).refs.slice(0, 3).join(', '), nearbyContext(cat, k, cat.get(k).refs)]);
      let reviewed;
      let lastError;
      for (const model of models) {
        try {
          reviewed = await requestBatch(rows, reviewMemory, { review: true, model });
          break;
        } catch (e) {
          lastError = e;
          console.error('Review model ' + model + ' failed for batch ' + (i / reviewBatchSize + 1) + ': ' + (e.message || e));
        }
      }
      if (reviewed) Object.assign(result, reviewed);
      else for (const k of keys) reviewFailures.push({ key: k, error: String((lastError && lastError.message) || lastError || 'review omitted') });
    }
  }
  console.log('High-risk strings reviewed: ' + risky.length + (reviewFailures.length ? ' (' + reviewFailures.length + ' failed)' : ''));
  const reportPath = path.join(root, "tools", "reports", "zhcn-ai.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ translations: result, failed, reviewFailures }, null, 2) + "\n", "utf8");

  // Write the locale only after every batch succeeded, and run the strict
  // check once more right before writing. A failed run leaves the file
  // untouched, so a retry always starts from a clean base.
  applyData(result, "AI translation", { replace: true });
  const after = report();
  if (after.missing.length || after.english.length) {
    console.error(`Translation incomplete: ${after.missing.length} missing, ${after.english.length} English leftovers.`);
    process.exit(1);
  }
}

// Full consensus pass: ask several models for the same source, then ask a
// judge model to choose the best candidate. Progress is checkpointed so a
// GitHub job timeout can resume on the next run instead of starting over.
function consensusFile() {
  return path.join(root, "tools", "reports", "zhcn-consensus.json");
}

function readConsensus() {
  const file = consensusFile();
  if (!fs.existsSync(file)) return { batches: {} };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeConsensus(data) {
  const file = consensusFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function translateConsensus() {
  const { cat, entries } = report({ missingOnly: true });
  const missing = [...cat.keys()].filter((k) => !entries.has(k));
  if (!missing.length) {
    console.log("Consensus pass: nothing missing.");
    return;
  }
  const size = integerEnv("ZHCN_CONSENSUS_BATCH_SIZE", 10, 1);
  const judge = process.env.ZHCN_JUDGE_MODEL || "deepseek-v4.1-flash";
  const models = (process.env.ZHCN_CONSENSUS_MODELS || "deepseek-v4.1-flash")
    .split(",").map((x) => x.trim()).filter(Boolean);
  const state = readConsensus();
  state.batches = state.batches || {};
  const total = Math.ceil(missing.length / size);
  for (let i = 0; i < missing.length; i += size) {
    const keys = missing.slice(i, i + size);
    const id = keys[0];
    if (state.batches[id] && state.batches[id].complete) {
      console.log(`Consensus batch ${i / size + 1}/${total}: already done.`);
      continue;
    }
    const memory = translationMemory(entries);
    const rows = keys.map((k) => [k, cat.get(k).refs.slice(0, 3).join(", "), nearbyContext(cat, k, cat.get(k).refs)]);
    const candidates = {};
    for (const model of models) {
      console.log(`Consensus batch ${i / size + 1}/${total}: ${model}`);
      try {
        candidates[model] = await requestBatch(rows, memory, { model });
      } catch (e) {
        console.error(`Candidate ${model} failed: ${e.message || e}`);
      }
    }
    if (!Object.keys(candidates).length) throw new Error("Every consensus candidate failed for this batch");
    const data = JSON.stringify(candidates, null, 2);
    const prompt = [
      { role: "system", content: "You are the senior Simplified Chinese reviewer for a World of Warcraft addon. Pick or merge the best translation for each English key. Preserve every printf placeholder and color code exactly. Return only JSON mapping each English key to the final Chinese string." },
      { role: "user", content: JSON.stringify({ candidates: JSON.parse(data) }, null, 2) },
    ];
    const key = process.env.API_KEY || process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Repository secret API_KEY is not set");
    const base = (process.env.OPENAI_BASE_URL || "https://ai.levis0792.cn:18787/v1").replace(/\/$/, "");
    const res = await fetch(base + "/chat/completions", {
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || 120000)),
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model: judge, messages: prompt }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Judge ${judge} failed (${res.status}): ${text.slice(0, 1000)}`);
    const parsed = JSON.parse(JSON.parse(text).choices[0].message.content);
    for (const k of keys) {
      if (typeof parsed[k] !== "string" || !formatOk(k, parsed[k]) || englishLeftover(k, parsed[k])) {
        throw new Error("Judge returned an invalid translation for " + JSON.stringify(k));
      }
    }
    state.batches[id] = { complete: true, translations: parsed };
    writeConsensus(state);
  }
  const final = {};
  for (const batch of Object.values(state.batches)) Object.assign(final, batch.translations || {});
  applyData(final, "multi-model consensus", { replace: true });
  console.log(`Consensus pass wrote ${Object.keys(final).length} entries.`);
}
function consensusAllFile() {
  return path.join(root, "tools", "reports", "zhcn-consensus-all.json");
}

function readConsensusAll() {
  const file = consensusAllFile();
  if (!fs.existsSync(file)) return { batches: {} };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeConsensusAll(data) {
  const file = consensusAllFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// Rebuild every key through several models and a judge. Only this mode
// retranslates text that the author already has. Progress is checkpointed.
async function rebuildAll() {
  const { cat } = report({ missingOnly: true });
  const keys = [...cat.keys()];
  const size = integerEnv("ZHCN_REBUILD_BATCH_SIZE", 10, 1);
  const judge = process.env.ZHCN_JUDGE_MODEL || "deepseek-v4.1-flash";
  const models = (process.env.ZHCN_CONSENSUS_MODELS || "deepseek-v4.1-flash")
    .split(",").map((x) => x.trim()).filter(Boolean);
  const state = readConsensusAll();
  state.batches = state.batches || {};
  const total = Math.ceil(keys.length / size);
  for (let i = 0; i < keys.length; i += size) {
    const batchKeys = keys.slice(i, i + size);
    const id = batchKeys[0];
    if (state.batches[id] && state.batches[id].complete) {
      console.log(`Rebuild batch ${i / size + 1}/${total}: already done.`);
      continue;
    }
    const emptyMemory = translationMemory(new Map());
    const rows = batchKeys.map((k) => [k, cat.get(k).refs.slice(0, 3).join(", "), nearbyContext(cat, k, cat.get(k).refs)]);
    const candidates = {};
    for (const model of models) {
      console.log(`Rebuild batch ${i / size + 1}/${total}: ${model}`);
      try { candidates[model] = await requestBatch(rows, emptyMemory, { model }); }
      catch (e) { console.error(`Candidate ${model} failed: ${e.message || e}`); }
    }
    if (!Object.keys(candidates).length) throw new Error("Every rebuild candidate failed for this batch");
    const key = process.env.API_KEY || process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Repository secret API_KEY is not set");
    const base = (process.env.OPENAI_BASE_URL || "https://ai.levis0792.cn:18787/v1").replace(/\/$/, "");
    const prompt = [
      { role: "system", content: "You are the senior Simplified Chinese reviewer for a World of Warcraft addon. Pick or merge the best translation for each English key. Preserve every printf placeholder and color code exactly. Return only JSON mapping each English key to the final Chinese string." },
      { role: "user", content: JSON.stringify({ candidates }, null, 2) },
    ];
    const res = await fetch(base + "/chat/completions", {
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || 120000)),
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model: judge, messages: prompt }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Judge ${judge} failed (${res.status}): ${text.slice(0, 1000)}`);
    const parsed = JSON.parse(JSON.parse(text).choices[0].message.content);
    for (const k of batchKeys) {
      if (typeof parsed[k] !== "string" || !formatOk(k, parsed[k]) || englishLeftover(k, parsed[k])) {
        throw new Error("Judge returned an invalid translation for " + JSON.stringify(k));
      }
    }
    state.batches[id] = { complete: true, translations: parsed };
    writeConsensusAll(state);
  }
  const final = {};
  for (const batch of Object.values(state.batches)) Object.assign(final, batch.translations || {});
  console.log(`Rebuild finished with ${Object.keys(final).length} entries.`);
  const ordered = Object.keys(final).sort().map((k) => `L[${luaQuote(k)}] = ${luaQuote(final[k])}`);
  fs.writeFileSync(localePath, "-- Simplified Chinese (zhCN).\nlocal _, DUI = ...\nif DUI.LOCALE ~= \"zhCN\" then return end\nlocal L = DUI.L\n\n" + ordered.join("\n") + "\n", "utf8");
  report();
}
if (require.main === module) {
  const cmd = process.argv[2] || "check";
  if (cmd === "missing") report({ missingOnly: true });
  else if (cmd === "check") {
    const result = report();
    if (result.missing.length || result.english.length || result.bad.length || result.duplicates.length) process.exit(1);
  }
  else if (cmd === "apply") apply(process.argv[3]);
  else if (cmd === "baseline") baseline(process.argv[3]);
  else if (cmd === "sync") sync(process.argv[3]);
  else if (cmd === "merge") merge(process.argv[3]);
  else if (cmd === "dedupe") dedupe();
  else if (cmd === "override") override(process.argv[3]);
  else if (cmd === "translate") translate().catch((e) => { console.error(e.stack || e); process.exit(1); });
  else if (cmd === "consensus") translateConsensus().catch((e) => { console.error(e.stack || e); process.exit(1); });
  else if (cmd === "rebuild") rebuildAll().catch((e) => { console.error(e.stack || e); process.exit(1); });
  else {
    console.error("Usage: node tools/zhcn.js check|missing|translate|consensus|rebuild|apply|baseline <file>|sync <file>|merge|dedupe|override <json>");
    process.exit(2);
  }
}

module.exports = { readGlossary, retryable, requestOnce, requestBatch, integerEnv, englishLeftover, dedupe, highRisk, nearbyContext, relatedMemory, requestModel, reviewModel, reviewModels, batchSize, translateConsensus, rebuildAll, baseline, sync };




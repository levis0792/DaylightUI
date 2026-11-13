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

const root = path.resolve(__dirname, "..");
const localePath = path.join(root, "Locales", "zhCN.lua");
const { extract } = require(path.join(root, "tools", "lib", "catalog"));
const { luaQuote } = require(path.join(root, "tools", "lib", "lua"));
const { formatOk, specifiers } = require(path.join(root, "tools", "lib", "format"));

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
  // Keyboard labels are shown in uppercase by the game.
  "ALT", "CTRL", "SHIFT",
]);

function hasHan(s) {
  return /[\u3400-\u9fff]/.test(String(s));
}

function englishLeftover(key, value) {
  if (!value || !/[A-Za-z]/.test(value)) return false;
  if (hasHan(value)) return false;
  const stripped = String(value)
    .replace(/\|c[0-9a-fA-F]{8}|\|r|\|T[^|]*\|t/g, "")
    .replace(/%(?:%|[-+0#]*\d*(?:\.\d+)?[cdiouxXeEfgGqs])/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[/_.[\]{}()<>:=+*\-]+/g, " ")
    .trim();
  if (!stripped) return false;
  const words = stripped.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (!words.length) return false;
  if (ALLOWED_ENGLISH.has(String(value).trim())) return false;
  if (String(key).startsWith("Daylight UI: ") && String(value).startsWith("Daylight UI")) return false;
  if (words.every((w) => ALLOWED_ENGLISH.has(w))) return false;
  // Proper names and slash commands intentionally stay as written.
  if (String(key).startsWith("/") || String(value).startsWith("/")) return false;
  if (/^Daylight UI\s*:/i.test(String(value))) return false;
  if (/^[\w.-]+\.(?:png|tga|blp|ttf|otf)$/i.test(String(value))) return false;
  if (/^(?:shop|tab|filter|none|auto)$/i.test(String(value))) return false;
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

async function requestBatch(batch, memory) {
  const key = process.env.API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("API_KEY is not set");
  const base = (process.env.OPENAI_BASE_URL || "https://ai.levis0792.cn:18787/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "deepseek-v4.1-flash";
  const context = [];
  for (const [k, v] of [...memory.exact].slice(-250)) context.push([k, v]);
  const glossary = fs.existsSync(path.join(root, "tools", "zhcn-glossary.json"))
    ? JSON.parse(fs.readFileSync(path.join(root, "tools", "zhcn-glossary.json"), "utf8"))
    : {};
  const system = [
    "You translate World of Warcraft addon UI text from English to Simplified Chinese.",
    "Return only a JSON object mapping every input key to a Chinese string; no markdown.",
    "Preserve every printf placeholder exactly: %s, %d, %.0f, %.2f, %%.",
    "Preserve color and texture codes exactly: |cAARRGGBB, |r, |T...|t.",
    "Use concise, natural mainland Chinese UI language.",
    "Use these approved terms: 爆击, 微缩地图, 鼠标提示, 潜行者.",
    "Keep PvP, PvE, RP, DPS, HPS, NPC, UI and addon names in English.",
    "Do not translate slash commands, setting keys, font names, URLs or code identifiers.",
    "If a string is a full sentence, keep its meaning and all conditions; do not omit clauses.",
    "Use the supplied reviewed pairs as translation memory for terminology.",
    "Required glossary: " + JSON.stringify(glossary),
  ].join(" ");
  const user = JSON.stringify({ approved_translation_memory: context, strings_to_translate: batch }, null, 2);
  const res = await fetch(base + "/chat/completions", {
    signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || 120000)),
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI request failed (${res.status}): ${text.slice(0, 1000)}`);
  let parsed;
  try {
    const data = JSON.parse(text);
    let content = data.choices[0].message.content.trim();
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error("AI returned invalid JSON: " + text.slice(0, 1000));
  }
  const out = {};
  for (const [k] of batch) {
    const v = parsed[k];
    if (typeof v !== "string" || !v.trim()) throw new Error(`AI omitted: ${JSON.stringify(k)}`);
    if (!formatOk(k, v)) throw new Error(`Placeholder mismatch: ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
    if (v === k) throw new Error(`AI left the string in English: ${JSON.stringify(k)}`);
    out[k] = v;
  }
  return out;
}

async function translate() {
  const { cat, entries } = report({ missingOnly: true });
  const missing = [...cat.keys()].filter((k) => !entries.has(k));
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
  for (let i = 0; i < remaining.length; i += size) {
    const batch = remaining.slice(i, i + size).map((k) => [k, cat.get(k).refs.slice(0, 3).join(", ")]);
    console.log(`AI batch ${i / size + 1}/${Math.ceil(remaining.length / size)} (${batch.length} strings)`);
    Object.assign(result, await requestBatch(batch, memory));
  }
  const reportPath = path.join(root, "tools", "reports", "zhcn-ai.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  applyData(result, "AI translation", { replace: true });
  report();
}

const cmd = process.argv[2] || "check";
if (cmd === "missing") report({ missingOnly: true });
else if (cmd === "check") {
  const result = report();
  if (result.missing.length || result.english.length || result.bad.length || result.duplicates.length) process.exit(1);
}
else if (cmd === "apply") apply(process.argv[3]);
else if (cmd === "translate") translate().catch((e) => { console.error(e.stack || e); process.exit(1); });
else {
  console.error("Usage: node tools/zhcn.js check|missing|translate|apply <json>");
  process.exit(2);
}

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
//   OPENAI_MODEL=gpt-4.1-mini                   (optional)
//
// Existing reviewed entries are the translation memory. Only keys absent from
// zhCN.lua are sent to the model, in small batches, and every result is checked
// for placeholders and color codes before it is written.

const fs = require("node:fs");
const path = require("node:path");
const defaultRoot = path.resolve(__dirname, "..");
const root = path.resolve(process.env.ZHCN_ROOT || defaultRoot);
const localePath = path.join(root, "Locales", "zhCN.lua");
const toolRoot = process.env.ZHCN_TOOL_ROOT ? path.resolve(process.env.ZHCN_TOOL_ROOT) : defaultRoot;
const { extract } = require(path.join(toolRoot, "tools", "lib", "catalog"));
const { decodeShortString, luaQuote } = require(path.join(toolRoot, "tools", "lib", "lua"));
const { formatOk, specifiers, codesOk } = require(path.join(toolRoot, "tools", "lib", "format"));
const LOCALE_LINE = /^L\[("(?:\\.|[^"\\])*")\]\s*=\s*("(?:\\.|[^"\\])*")$/;
const checkpointPath = process.env.ZHCN_CHECKPOINT
  ? path.resolve(process.env.ZHCN_CHECKPOINT)
  : path.join(root, ".zhcn-cache", "checkpoint.json");

// One locale line, decoded with Lua's escaping rules. Keeping one parser means
// check, sync, dedupe and apply cannot disagree about what the file contains.
function localeLine(line) {
  const m = line.match(LOCALE_LINE);
  if (!m) return null;
  try {
    return { key: decodeShortString(m[1]), value: decodeShortString(m[2]) };
  } catch (e) {
    return null;
  }
}

function edgeSpacesMatch(key, value) {
  const leadKey = String(key).match(/^\s*/)[0];
  const leadVal = String(value).match(/^\s*/)[0];
  const trailKey = String(key).match(/\s*$/)[0];
  const trailVal = String(value).match(/\s*$/)[0];
  return leadKey === leadVal && trailKey === trailVal;
}

function sameEdgeFormat(srcKey, memKey) {
  const leadSrc = String(srcKey).match(/^\s*/)[0];
  const leadMem = String(memKey).match(/^\s*/)[0];
  const trailSrc = String(srcKey).match(/[\s.:!?…]*$/)[0];
  const trailMem = String(memKey).match(/[\s.:!?…]*$/)[0];
  return leadSrc === leadMem && trailSrc === trailMem;
}

function validTranslation(key, value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\uFFFD")) return false;
  if (!formatOk(key, value) || !codesOk(key, value)) return false;
  if (!edgeSpacesMatch(key, value)) return false;
  return !englishLeftover(key, value);
}

function readLocale() {
  const src = fs.readFileSync(localePath, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const entries = new Map();
  const duplicates = [];
  for (const line of src.split("\n")) {
    const row = localeLine(line);
    if (!row) continue;
    const { key, value } = row;
    if (entries.has(key)) duplicates.push(key);
    else entries.set(key, value);
  }
  return { src, entries, duplicates };
}

const ALLOWED_ENGLISH = new Set([
  "PvP", "PvE", "RP", "DPS", "HPS", "NPC", "UI", "AFK", "AP", "AOE", "AoE", "GUID", "ID", "PVP", "PVE",
  "Daylight UI", "Daylight", "TW", "CN", "US", "EU", "CDM",
  // Client terms and units that are correct and clearer in English.
  "PTR", "Beta", "WoW", "XP", "HUD", "ms", "Alt", "Ctrl", "Shift", "Esc", "Delete", "DELETE",
  // AddOn and font names stay as published so players can find them.
  "Ace3", "Attune", "Auctionator", "Baganator", "Bagnon", "BuffLedger", "Deadly Boss Mods", "Dewdrop", "OPie",
  "Plater", "Platynator", "PrettyTooltip", "Questie", "Raider.IO", "RestedXP Guides", "Threat Plates", "TSM",
  "Archivo Narrow", "Arial Narrow", "Barlow Condensed", "Expressway",
  "Fira Sans", "Lato", "PT Sans Narrow", "Poppins", "Russo One",
  "DaylightUI", "DaylightUI Discord",
  // Style and addon names users see in the UI, plus the donation page.
  "Jiberish", "Fabled", "Icons", "JiberishUI", "Calm", "Punchy", "Classic",
  "Alfa Slab One", "Anton", "Archivo Black", "Audiowide", "Baloo 2", "Bangers",
  "Bebas Neue", "Big Shoulders", "Black Ops One", "Bowlby One", "Bungee",
  "Chakra Petch", "Changa One", "Chewy", "Cinzel", "Coiny", "Comfortaa",
  "Delius", "Dosis", "Fabled Class", "Fabled Core", "Fabled Dimension",
  "Fabled Myth", "Fabled Pixels", "Fabled Pixels v2", "Fabled Realm",
  "Fabled Realm v2", "Fabled Regalia", "Fizzle", "Fredoka", "Gluten",
  "Grandstander", "Itim", "Kanit Black Italic", "Lilita One", "Luckiest Guy",
  "M PLUS Rounded", "Mali", "MedievalSharp", "Metamorphous", "Nunito Black",
  "Orbitron", "Oswald", "Passion One", "Permanent Marker", "Pirata One",
  "Press Start 2P", "Quicksand", "Righteous", "Rubik", "Rubik Glitch",
  "Rubik Mono", "Sniglet", "Squada One", "Staatliches", "Teko", "Titan One",
  "Varela Round", "Flat", "Custom", "Patreon", "Ko-fi",
  "EllesmereUI", "DaylightMogul", "SkillUp", "SkillUp Forever",
  // Real addon names that are allowed to appear untranslated in a Chinese sentence.
  "Clique", "Bartender", "Blizzard", "ElvUI", "WeakAuras", "Details", "OmniCC", "Masque",
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
  'q', 'ilvl', 'x', 'g', 't', 'p', 's', 'y', 'w', 'c', 'a', 'z', 'n', 'boe', 'bou',
  'set', 'h', 'm', 'k', 'id', 'frame', 'npcs', 'npc', 'up', 'down', 'left', 'right',
  'zoom', 'in', 'out', 'shift', 'ctrl', 'alt', 'esc', 'del', 'ins', 'tab', '1c',
  '1k', '2k', '3k', '4k', '5k', '6k', '7k', '8k', '9k',
]);

// These are vocabulary values in a technical enum, not prose. They are
// allowed only when the English key actually contains "kind (...)".
const TECHNICAL_ENUM_WORDS = new Set(['unit', 'item', 'spell', 'world', 'compare', 'kind', 'function']);

function stripCommandsAndCode(value) {
  return String(value)
    .replace(/\|c[0-9a-fA-F]{8}|\|r|\|T[^|]*\|t/g, "")
    .replace(/%(?:%|[-+0#]*\d*(?:\.\d+)?[cdiouxXeEfgGqs])/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`[^`]*`/g, "")
    // Remove a command and its ASCII arguments; the rest of the sentence is
    // still checked, so text after a command is not silently skipped.
    .replace(/\/[A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z0-9_%<>=|.-]+)*/g, "")
    .replace(/[/_.\[\]{}()<>:=+*\-:、。；！？（）【】《》“”‘’…—]+/g, " ")
    .trim();
}

function englishLeftover(key, value) {
  if (!value || !/[A-Za-z]/.test(value)) return false;
  // Placeholder labels such as "G%d" and "%s x%d" have no prose. English
  // letters inside a printf specifier are not an untranslated sentence.
  if (/^[%A-Za-z0-9_+./ ()-]*$/.test(String(key)) && !String(key).replace(/%%|%(?:[-+0#]*\d*(?:\.\d+)?[cdiouxXeEfgGqs])/g, "").trim().match(/[A-Za-z]{2,}/)) return false;
  const stripped = stripCommandsAndCode(value);
  if (!stripped) return false;
  const words = stripped.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (!words.length) return false;
  // A cached value exactly equal to its English source is not a translation.
  // Missing keys are handled separately. Bare permitted terms (PTR, PvP) are
  // the exception: those are intentionally unchanged labels.
  const exactKey = String(value).trim() === String(key).trim();
  if (exactKey && !/^[\w.-]+\.(?:png|tga|blp|ttf|otf)$/i.test(String(value).trim()) && !/^[A-Za-z0-9]+ PvP$/.test(String(value).trim()) && !ALLOWED_ENGLISH.has(String(value).trim())) return true;
  if (ALLOWED_ENGLISH.has(String(value).trim())) return false;
  if (String(key).startsWith("Daylight UI: ") && String(value).startsWith("Daylight UI")) return false;
  if (words.every((w) => ALLOWED_ENGLISH.has(w))) return false;
  // Proper names, slash commands and addon commands intentionally stay as written.
  if (String(key).startsWith("/") || String(value).startsWith("/")) return false;
  if (/^Daylight UI\s*:/.test(String(value))) return false;
  if (/^[\w.-]+\.(?:png|tga|blp|ttf|otf)$/i.test(String(value))) return false;
  if (/^[A-Za-z0-9]+ PvP$/.test(String(value))) return false;
  if (/^skins profile\b/i.test(String(value))) return false;
  if (/^skins\s+[a-z]/i.test(String(value))) return false;
  if (/^(?:BFD|RFC|VC|DM|WC|SFK|RFK|ULD|ZF|ST|Mara|BRD|LBRS|UBRS|DME|DMN|DMW|Scholo|Strat|Live|UD|BRS|MC|BWL|AQ20|AQ40|NAXX|PSI|SSC|TK|BH|BT|SWP)$/i.test(String(value))) return false;

  // A value with Chinese must not still contain English. Two checks:
  // 1) three or more ordinary English words in a row means an untranslated
  //    sentence such as "types: gear, weapon, armor";
  // 2) a single UI action word such as "Open" or "Save" is never allowed.
  if (hasHan(value)) {
    // The search grammar is deliberately documented in English. Its words
    // are keywords, not an untranslated sentence; ordinary prose still fails.
    const isTechnicalEnum = /\bkind\s*\(/i.test(String(key));
    const isAllowedTechnical = (w) => isTechnicalEnum && TECHNICAL_ENUM_WORDS.has(w.toLowerCase());
    const isOrdinary = (w) =>
      !ALLOWED_ENGLISH.has(w) &&
      !MIXED_ASCII_WORDS.has(w.toLowerCase()) &&
      !isAllowedTechnical(w) &&
      !UI_ACTION_WORDS.has(w.toLowerCase());
    const isKeywordPage = /\b(?:q>|ilvl>|boe\s*&|gear\s*,)/i.test(String(key));
    const ascii = words.map((w) => (w.match(/[A-Za-z]+/g) || []).join(" ")).map((w) => w.trim()).filter(Boolean).flatMap((w) => w.split(/\s+/));
    const isBoundary = (w) => !isOrdinary(w);
    if (ascii.length && words.some((w) => hasHan(w)) && ascii.every((w) => ALLOWED_ENGLISH.has(w) || MIXED_ASCII_WORDS.has(w.toLowerCase()) || isAllowedTechnical(w))) return false;
    let run = 0;
    let longest = 0;
    for (const w of ascii) {
      run = isOrdinary(w) && !isBoundary(w) ? run + 1 : 0;
      if (run > longest) longest = run;
    }
    if (longest >= 3 && !isKeywordPage) return true;
    const englishProse = ascii.filter((w) => !MIXED_ASCII_WORDS.has(w.toLowerCase()) && !ALLOWED_ENGLISH.has(w) && !isAllowedTechnical(w));
    if (englishProse.some((w) => /^(?:by|from|with|for|and|or|the|of)$/i.test(w))) return true;
    return words.some((w) => UI_ACTION_WORDS.has(w.toLowerCase()) && !ALLOWED_ENGLISH.has(w));
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
    const row = localeLine(lines[i]);
    if (row) last.set(row.key, i);
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const row = localeLine(lines[i]);
    if (row && last.get(row.key) !== i) continue;
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
  const stale = [...entries.keys()].filter((k) => !cat.has(k));
  const bad = [...entries].filter(([k, v]) => !v.trim() || v.includes("\uFFFD") || !formatOk(k, v) || !codesOk(k, v));
  const untranslatedValues = [...cat.keys()].filter((k) => entries.has(k) && englishLeftover(k, entries.get(k)));
  const english = untranslatedValues;
  const terminology = terminologyViolations(entries);

  console.log(`Current UI strings: ${cat.size}`);
  console.log(`zhCN entries: ${entries.size}`);
  console.log(`Missing keys: ${missing.length}`);
  console.log(`Removed keys: ${stale.length}`);
  console.log(`Untranslated: ${missing.length + english.length}`);
  console.log(`English leftovers: ${english.length}`);
  console.log(`Duplicate keys: ${duplicates.length}`);
  console.log(`Format/empty errors: ${bad.length}`);
  console.log(`Terminology violations: ${terminology.length}`);

  if (duplicates.length) for (const k of duplicates) console.log(`  duplicate ${JSON.stringify(k)}`);
  if (bad.length) for (const [k, v] of bad.slice(0, 80)) console.log(`  invalid ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
  if (english.length && !missingOnly) for (const k of english) console.log(`  english ${JSON.stringify(k)} -> ${JSON.stringify(entries.get(k))}`);
  if (missing.length && !missingOnly) for (const k of missing) console.log(`  missing ${JSON.stringify(k)}`);
  if (terminology.length && !missingOnly) {
    for (const item of terminology.slice(0, 80)) {
      console.log(`  terminology ${JSON.stringify(item.key)} -> ${JSON.stringify(item.value)} expected ${JSON.stringify(item.expected)}`);
    }
  }
  if (stale.length && !missingOnly && stale.length <= 80) for (const k of stale) console.log(`  removed ${JSON.stringify(k)}`);

  if (missing.length) {
    const out = path.join(root, "tools", "reports", "zhcn-missing.tsv");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, missing.map((k) => `${JSON.stringify(k)}\t${cat.get(k).refs.join(",")}`).join("\n") + "\n", "utf8");
    console.log(`Report: ${path.relative(root, out)}`);
  }

  return { cat, entries, duplicates, missing, stale, bad, english, terminology };
}

// High-precision multi-word or domain-specific terms that must also be enforced
// inside longer sentences (using whole-term boundary matching and longest-match
// masking so "General channel" does not trigger "General").
const PROSE_LOCKED_TERMS = new Set([
  "usual price", "buyout", "deposit", "undercut", "full scan", "price memory",
  "auction length", "deal price", "loot rolls", "pick ticks", "roll bars",
  "flight timer", "welcome on landing", "landing welcome", "flight point",
  "swing timer", "main hand bar", "off hand bar", "ranged bar", "power bar",
  "power text", "personal display", "own angle", "fight pill", "full card key",
  "portrait look", "portrait ring", "set into the frame", "micro menu",
  "layer flattening", "auction house", "cast bar", "cast bars", "nameplates",
  "unit frames", "combat text", "scrolling combat text", "minimap", "tooltip",
  "critical strike", "rogue", "air totem", "earth totem", "fire totem",
  "water totem", "general channel",
]);

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termBoundary(term) {
  const escaped = escapeRegExp(term);
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "ig");
}

// Locked glossary terms are checked across both exact keys and prose sentences.
// Reviewed overrides take precedence so intentional exceptions never false-alarm.
function terminologyViolations(entries) {
  let glossary;
  try {
    glossary = readGlossary();
  } catch (e) {
    return [{ key: "<glossary>", value: e.message, expected: "valid JSON glossary" }];
  }
  const overrides = readReviewedOverrides();
  const violations = [];
  const straighten = (s) => String(s)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  const hasRemainder = (actual, term) => {
    const simple = /^[A-Za-z][A-Za-z -]*$/.test(term);
    if (!simple) return false;
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    return words.every((word) => new RegExp("\\b" + escapeRegExp(word) + "\\b", "i").test(actual));
  };

  // 1) Exact-key check for every glossary entry with Chinese target.
  for (const [term, expectedRaw] of Object.entries(glossary)) {
    const expected = straighten(expectedRaw);
    if (!hasHan(expected)) continue;
    if (!entries.has(term)) continue;
    if (Object.prototype.hasOwnProperty.call(overrides, term)) continue;
    const rawActual = String(entries.get(term) || "");
    const actual = straighten(rawActual);
    if (actual === expected) continue;
    if (!actual.includes(expected)) {
      violations.push({ key: term, term, value: rawActual, expected: expectedRaw });
    } else if (hasRemainder(actual, term)) {
      violations.push({ key: term, term, value: rawActual, expected: expectedRaw + " (no English remainder)" });
    }
  }

  // 2) Prose scan for high-precision domain terms, sorted longest-first so a
  //    longer phrase masks its sub-phrases on the same text span.
  const proseRules = [];
  const seenLower = new Set();
  for (const [term, expectedRaw] of Object.entries(glossary)) {
    const lower = term.toLowerCase();
    const expected = straighten(expectedRaw);
    if (!hasHan(expected) || !PROSE_LOCKED_TERMS.has(lower) || seenLower.has(lower)) continue;
    seenLower.add(lower);
    proseRules.push({ term, expected, expectedRaw, re: termBoundary(term) });
  }
  proseRules.sort((a, b) => b.term.length - a.term.length);

  for (const [key, rawActual] of entries.entries()) {
    if (Object.prototype.hasOwnProperty.call(glossary, key)) continue;
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    const actual = straighten(rawActual || "");
    if (!actual) continue;
    let maskedKey = String(key);
    for (const rule of proseRules) {
      rule.re.lastIndex = 0;
      if (!rule.re.test(maskedKey)) continue;
      maskedKey = maskedKey.replace(rule.re, (m) => " ".repeat(m.length));
      if (!actual.includes(rule.expected)) {
        violations.push({ key, term: rule.term, value: rawActual, expected: rule.expectedRaw });
      }
    }
  }
  return violations;
}

// Remove translations whose English key the author no longer ships. This is
// the one operation that must delete lines from the author's file; everything
// else is append/replace so comments and order stay intact.
function prune() {
  const cat = catalog();
  const { src } = readLocale();
  const out = [];
  let removed = 0;
  for (const line of src.split("\n")) {
    const row = localeLine(line);
    if (row && !cat.has(row.key)) {
      removed++;
      continue;
    }
    out.push(line);
  }
  if (removed) fs.writeFileSync(localePath, out.join("\n"), "utf8");
  console.log(`Removed ${removed} locale entr${removed === 1 ? "y" : "ies"} no longer in the author's source.`);
  return removed;
}

function appendMoreLinesMarker(text) {
  const marker = "-- More translated lines.";
  let out = text.replace(/\n?$/, "\n");
  if (!out.includes(marker)) {
    out += "\n" + marker + "\n";
  }
  return out;
}

function applyData(data, label, opts = {}) {
  const { src, entries } = readLocale();
  const toApply = Object.entries(data).filter(([k]) => opts.replace || !entries.has(k));
  const bad = toApply.filter(([k, v]) => typeof v !== "string" || !v.trim() || v.includes("\uFFFD") || !formatOk(k, v) || !codesOk(k, v));
  if (bad.length) {
    console.error(`Refusing to apply ${bad.length} invalid entries:`);
    for (const [k, v] of bad.slice(0, 40)) console.error(`  ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
    process.exit(1);
  }

  let out = src.replace(/\n?$/, "\n");
  for (const [k, v] of toApply) {
    if (!entries.has(k)) continue;
    const quoted = escapeRegExp(luaQuote(k));
    const lineRe = new RegExp("^L\\[" + quoted + "\\]\\s*=\\s*\"(?:\\\\.|[^\"\\\\])*\"\\s*$", "m");
    // Use a replacement callback so '$' sequences in translations are never
    // interpreted as RegExp replacement tokens ($&, $$, $1, etc.).
    out = out.replace(lineRe, () => `L[${luaQuote(k)}] = ${luaQuote(v)}`);
  }

  const toAdd = toApply.filter(([k]) => !entries.has(k));
  if (toAdd.length) {
    out = appendMoreLinesMarker(out);
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
    if (!value.trim() || value.includes("\uFFFD") || !formatOk(key, value) || !codesOk(key, value)) throw new Error("Invalid baseline translation for " + JSON.stringify(key));
  }
  const additions = [];
  for (const key of cat.keys()) {
    if (entries.has(key) || !from.has(key)) continue;
    const value = from.get(key);
    if (!value.trim() || value.includes("\uFFFD") || !formatOk(key, value) || !codesOk(key, value)) throw new Error("Invalid baseline translation for " + JSON.stringify(key));
    additions.push([key, value]);
  }
  additions.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (!additions.length) {
    console.log("Baseline adds no new entries; the author file is unchanged.");
    return 0;
  }
  let text = appendMoreLinesMarker(src);
  text += additions.map(([key, value]) => "L[" + luaQuote(key) + "] = " + luaQuote(value)).join("\n") + "\n";
  fs.writeFileSync(localePath, text, "utf8");
  console.log("Baseline appended " + additions.length + " new entries; existing file kept byte-for-byte.");
  return additions.length;
}

function parseLocaleFile(file) {
  const src = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const entries = new Map();
  for (const line of src.split("\n")) {
    const row = localeLine(line);
    if (row) entries.set(row.key, row.value);
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

// Bring the reviewed baseline into the author's current file. Exact source
// keys win; baseline fills missing keys and repairs empty, malformed, stale
// English values. There is no case-insensitive matching: the game looks up the
// exact Lua string, so "search" does not satisfy "Search".
function sync(file) {
  const source = path.resolve(root, file || "");
  const from = parseLocaleFile(source);
  if (!from.size) throw new Error("no locale entries in " + source);
  const { cat, entries } = report({ missingOnly: true });
  const allowed = new Set(cat.keys());
  const data = {};
  for (const [key, baselineVal] of from) {
    if (!allowed.has(key)) continue;
    if (!validTranslation(key, entries.get(key))) data[key] = baselineVal;
  }
  applyData(data, "synced " + path.basename(source), { replace: true });
  prune();
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
    if (!approx.has(n)) approx.set(n, { key: k, value: v });
  }
  return { exact, approx };
}

function readGlossary() {
  const glossaryPath = path.join(toolRoot, "tools", "zhcn-glossary.json");
  if (!fs.existsSync(glossaryPath)) throw new Error("zhCN glossary is missing: " + glossaryPath);
  let glossary;
  try {
    glossary = JSON.parse(fs.readFileSync(glossaryPath, "utf8"));
  } catch (e) {
    throw new Error("zhCN glossary is invalid JSON: " + glossaryPath + ": " + e.message);
  }
  if (!glossary || typeof glossary !== "object" || Array.isArray(glossary) || !Object.keys(glossary).length) {
    throw new Error("zhCN glossary must be a non-empty JSON object: " + glossaryPath);
  }
  return glossary;
}

function readReviewedOverrides() {
  // Exact reviewed translations are the highest priority source. The workflow
  // applies this file before translating, and every model path re-applies it
  // afterward so a model can never downgrade a vetted line.
  const file = path.join(toolRoot, "tools", "zhcn-overrides.json");
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return data;
}

function enforceReviewedOverrides(data, allowedKeys) {
  const overrides = readReviewedOverrides();
  let locked = 0;
  for (const [key, value] of Object.entries(overrides)) {
    if (!allowedKeys.has(key)) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    data[key] = value;
    locked++;
  }
  if (locked) console.log(`Reviewed override lock: ${locked} entr${locked === 1 ? "y" : "ies"}`);
  return data;
}

function retryable(error) {
  return error && (error.retryable === true || error.timeout === true || error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || error.status >= 500);
}

function requestModel() {
  return process.env.OPENAI_MODEL || "deepseek-v4.1-flash";
}

function reviewModels() {
  const configured = [
    process.env.ZHCN_REVIEW_MODEL || "deepseek-v4.1-flash",
    process.env.ZHCN_REVIEW_FALLBACK_MODEL || "deepseek-v4.1-flash",
    process.env.ZHCN_REVIEW_LAST_MODEL || "deepseek-v4.1-flash",
    requestModel(),
  ];
  return [...new Set(configured.filter(Boolean))];
}

function reviewModel() {
  return reviewModels()[0];
}

function batchSize() {
  return integerEnv("ZHCN_BATCH_SIZE", 12, 1);
}

function contextWindow() {
  return integerEnv("ZHCN_CONTEXT_LINES", 6, 0);
}

function requestTemperature() {
  const raw = process.env.AI_TEMPERATURE;
  if (raw == null || raw === "") return 0.15;
  const val = Number(raw);
  return Number.isFinite(val) && val >= 0 && val <= 2 ? val : 0.15;
}

function highRisk(key, ref) {
  const text = String(key);
  const holes = (text.match(/%(?:%|[-+0#]*\d*(?:\.\d+)?[cdiouxXeEfgGqs])/g) || []).length;
  const clauses = (text.match(/[.;:!?]|\b(?:and|or|but|if|when|while|unless|before|after)\b/gi) || []).length;
  const moduleName = String(ref || "").split(/[/:]/)[0];
  const technicalEnum = /\bkind\s*\([^)]*\b(?:unit|item|spell|world|compare)\b/i.test(text);
  const commandHeavy = /^\/[A-Za-z]/.test(text) && (/--/.test(text) || clauses >= 1 || text.length >= 40);
  // Short domain-sensitive terms frequently mistranslated out of context.
  const domainSensitive = /\b(?:passed|pass|roll|rolled|rolling|need|greed|post|posted|posting|buyout|deal|undercut|pill|ring|ticks|flight|landing|swing|usual)\b/i.test(text)
    || /\bpassed\b/i.test(String(ref || ""));
  return text.length >= 80 || holes >= 2 || clauses >= 2 || /(?:^|[/_-])(?:new|unreleased)(?:[/_.-]|$)/i.test(moduleName) || technicalEnum || commandHeavy || domainSensitive;
}

function nearbyContext(cat, key, refs) {
  const window = contextWindow();
  if (!window) return [];
  const anchor = String((refs && refs[0]) || "");
  if (!anchor) return [];
  const file = anchor.replace(/:\d+$/, "");
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

function readCheckpoint() {
  try {
    const data = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    const sha = process.env.ZHCN_CHECKPOINT_SHA || "";
    if (sha && data.sha && data.sha !== sha) return { sha, translations: {} };
    return { sha, translations: data.translations && typeof data.translations === "object" ? data.translations : {} };
  } catch (e) {
    return { sha: process.env.ZHCN_CHECKPOINT_SHA || "", translations: {} };
  }
}

function writeCheckpoint(translations) {
  const clean = {};
  for (const [key, value] of Object.entries(translations || {})) {
    if (validTranslation(key, value)) clean[key] = value;
  }
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(checkpointPath, JSON.stringify({ sha: process.env.ZHCN_CHECKPOINT_SHA || "", translations: clean }, null, 2) + "\n", "utf8");
}

function clearCheckpoint() {
  try { fs.rmSync(checkpointPath, { force: true }); } catch (e) {}
}

function parseModelJson(responseText, singleKey = null) {
  let content;
  try {
    const data = JSON.parse(responseText);
    content = String(data.choices[0].message.content || "").trim();
  } catch (e) {
    throw Object.assign(new Error("AI returned unreadable response wrapper: " + String(responseText).slice(0, 1000)), { outputError: true });
  }
  const stripped = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let candidate = stripped;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first >= 0 && last > first) candidate = candidate.slice(first, last + 1);
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch (_) {}
  if (singleKey !== null && stripped && !stripped.startsWith("{")) {
    return { [singleKey]: stripped };
  }
  throw Object.assign(new Error("AI returned invalid JSON: " + String(responseText).slice(0, 1000)), { outputError: true });
}

function buildSystemPrompt(glossary, opts = {}) {
  const baseRules = [
    "You translate World of Warcraft addon UI text (DaylightUI) from English to Simplified Chinese (zhCN).",
    "Return ONLY a valid JSON object mapping every input original_english key to its Simplified Chinese string; no markdown fences or extra commentary.",
    "Preserve every printf placeholder (%s, %d, %.1f, %02d, %%) and WoW color/texture code (|cAARRGGBB, |r, |T...|t) in the EXACT same count and order (do not rewrite as %1$s because LuaJIT tests run against standard format).",
    "While keeping placeholder order unchanged, structure the Chinese sentence naturally so each %s/%d refers to the exact same semantic role as in English (e.g. 'put up %s at %s' -> '上架了 %s，单价 %s', never swap item and price).",
    "Preserve exact leading and trailing whitespace of original_english (e.g. ' You passed.' -> ' 你已放弃。').",
    "Use natural, concise mainland Chinese World of Warcraft UI wording, full-width Chinese punctuation (，。：（）“”), ASCII ellipsis (...), and consistent terminology across both short labels and long descriptions.",
    "Domain disambiguation rules:",
    "- Auction House: Post=上架 (never 邮寄), Buyout=一口价 (never 直购价), Deposit=保管费, Undercut=压价, Undercut by (setting)=压价幅度, Deal price=优惠价阈值 (never 成交价), Usual price=常规价格 (never mix 通常/常见/平时).",
    "- Loot Rolls: Need=需求, Greed=贪婪, Pass=放弃 (never 通过), Pick ticks=选择标记 (never 跳数), With one roll=单个掷骰时.",
    "Match the reviewed tone of the #138 auction-house and loot-roll strings: concise, natural zhCN WoW UI wording.",
    "- UI & Bars: Fight pill=战斗胶囊 (never 药丸), portrait ring=头像环 (never 光环), Flight timer=飞行计时器, Welcome on landing=抵达欢迎, Swing timer=攻击计时条, Power bar=资源条, bar=计量条/计时条 (never 动作条 unless English says action bar), handle=控制柄.",
    "- Totems: Air totem=空气图腾, Earth totem=大地图腾, Fire totem=火焰图腾, Water totem=水之图腾.",
    "Keep PvP, PvE, RP, DPS, HPS, NPC, UI, addon names (Raider.IO, Auctionator, TSM, Questie, etc.), slash commands, font names, URLs and code identifiers in English.",
    "Exact reviewed entries in approved_translation_memory outrank guesses. Use source_location and nearby_ui_text to disambiguate short UI labels; never return them as translations.",
  ];

  if (opts.review) {
    baseRules.unshift(
      "You are the senior Simplified Chinese reviewer for DaylightUI. Each item includes original_english, source_location, nearby_ui_text, and draft_zhCN. Review draft_zhCN carefully: fix any out-of-context mistranslations, swapped placeholder semantics, glossary inconsistencies, or missing leading/trailing spaces; keep accurate drafts intact."
    );
  }

  if (opts.feedback) {
    baseRules.push("A previous validated attempt failed: " + opts.feedback);
    baseRules.push("Correct that exact problem and return the full JSON object again.");
  }

  baseRules.push("Required glossary: " + JSON.stringify(glossary));
  return baseRules.join("\n");
}

async function requestOnce(batch, memory, fetchImpl = globalThis.fetch, opts = {}) {
  const key = process.env.API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Repository secret API_KEY is not set");
  const base = (process.env.OPENAI_BASE_URL || "https://ai.levis0792.cn:18787/v1").replace(/\/$/, "");
  const model = opts.model || (opts.review ? reviewModel() : requestModel());
  const context = relatedMemory(memory, batch);
  const glossary = readGlossary();
  const system = buildSystemPrompt(glossary, opts);
  const requested = batch.map(([original_english, source_location, nearby_ui_text, draft_zhCN]) => {
    const row = { original_english, source_location, nearby_ui_text: nearby_ui_text || [] };
    if (opts.review && typeof draft_zhCN === "string" && draft_zhCN) {
      row.draft_zhCN = draft_zhCN;
    }
    return row;
  });
  const user = JSON.stringify({ approved_translation_memory: context, strings_to_translate: requested }, null, 2);
  const payload = {
    model,
    temperature: requestTemperature(),
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  };
  if (process.env.AI_JSON_MODE === "true") {
    payload.response_format = { type: "json_object" };
  }
  let res;
  try {
    res = await fetchImpl(base + "/chat/completions", {
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || 120000)),
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    if (e && (e.name === "TimeoutError" || e.name === "AbortError")) e.timeout = true;
    throw e;
  }
  const text = await res.text();
  if (!res.ok) {
    const error = new Error("AI request failed (" + res.status + "): " + text.slice(0, 1000));
    error.status = res.status;
    throw error;
  }
  const parsed = parseModelJson(text, batch.length === 1 ? batch[0][0] : null);
  const out = {};
  for (const [k] of batch) {
    let v = parsed[k];
    if ((typeof v !== "string" || !v.trim()) && batch.length === 1) {
      const values = Object.entries(parsed).filter(
        ([, item]) => typeof item === "string" && item.trim(),
      );
      if (
        values.length === 1 &&
        (values[0][0] === k || normal(values[0][0]) === normal(k))
      ) {
        v = values[0][1];
      }
    }
    if (typeof v !== "string" || !v.trim()) throw Object.assign(new Error("AI omitted: " + JSON.stringify(k) + "; returned keys: " + JSON.stringify(Object.keys(parsed))), { outputError: true });
    if (v.includes("\uFFFD")) throw Object.assign(new Error("AI returned a replacement character: " + JSON.stringify(k)), { outputError: true });
    if (!formatOk(k, v)) throw Object.assign(new Error("Placeholder mismatch: " + JSON.stringify(k) + " -> " + JSON.stringify(v)), { outputError: true });
    if (!codesOk(k, v)) throw Object.assign(new Error("Color/texture code mismatch: " + JSON.stringify(k) + " -> " + JSON.stringify(v)), { outputError: true });
    if (!edgeSpacesMatch(k, v)) throw Object.assign(new Error("Leading/trailing space mismatch: " + JSON.stringify(k) + " -> " + JSON.stringify(v)), { outputError: true });
    if (englishLeftover(k, v)) throw Object.assign(new Error("AI left the string in English: " + JSON.stringify(k) + " -> " + JSON.stringify(v)), { outputError: true });
    out[k] = v;
  }
  return out;
}

function integerEnv(name, fallback, minimum) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum) {
    throw new Error(name + " must be an integer >= " + minimum);
  }
  return value;
}

async function requestBatch(batch, memory, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const tries = opts.retries || integerEnv("AI_RETRIES", 3, 1);
  const wait = opts.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await requestOnce(batch, memory, fetchImpl, { review: opts.review === true, model: opts.model, feedback: opts.feedback });
    } catch (e) {
      last = e;
      if (e.outputError) break;
      const canRetry = retryable(e);
      const message = "AI batch attempt " + attempt + "/" + tries + " failed: " + (e.message || e);
      console.error(message);
      console.log("::error::" + message);
      if (!canRetry || attempt === tries) break;
      const delay = Math.min(30000, integerEnv("AI_RETRY_BASE_MS", 1500, 0) * (2 ** (attempt - 1)));
      console.error("Retrying in " + delay + "ms");
      await wait(delay);
    }
  }
  if (last && last.outputError && batch.length > 1) {
    console.error("Retrying the failed batch one string at a time.");
    const out = {};
    const failed = [];
    for (const row of batch) {
      try { Object.assign(out, await requestBatch([row], memory, { ...opts, retries: tries, wait })); }
      catch (e) { failed.push({ key: row[0], error: e.message || String(e) }); }
    }
    if (!failed.length) return out;
    const error = new Error("AI failed for " + failed.length + " of " + batch.length + " strings: " + failed.map((x) => JSON.stringify(x.key)).join(", "));
    error.outputError = true;
    error.translations = out;
    error.failedKeys = failed.map((x) => x.key);
    throw error;
  }
  if (last && last.outputError) throw last;
  if (last && !retryable(last)) throw last;
  const deferred = new Error("AI batch failed after " + tries + " attempts: " + (last && (last.message || last)));
  deferred.deferred = true;
  deferred.retryable = true;
  if (last) {
    deferred.status = last.status;
    deferred.timeout = last.timeout;
  }
  throw deferred;
}

async function translate(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const { cat, entries, english } = report({ missingOnly: true });
  const missing = [...new Set([
    ...[...cat.keys()].filter((k) => !entries.has(k)),
    ...english,
  ])];
  if (!missing.length) return;

  const memory = translationMemory(entries);
  const checkpoint = readCheckpoint();
  const result = {};
  for (const k of missing) {
    const saved = checkpoint.translations[k];
    const hit = memory.approx.get(normal(k));
    if (saved && validTranslation(k, saved)) {
      result[k] = saved;
    } else if (hit && sameEdgeFormat(k, hit.key) && validTranslation(k, hit.value)) {
      result[k] = hit.value;
    }
  }
  writeCheckpoint(result);

  const remaining = missing.filter((k) => !(k in result));
  console.log(`Translation memory reused: ${missing.length - remaining.length}`);
  console.log(`AI translation needed: ${remaining.length}`);

  const size = batchSize();
  const failed = [];
  for (let i = 0; i < remaining.length; i += size) {
    const batch = remaining.slice(i, i + size).map((k) => [k, cat.get(k).refs.slice(0, 3).join(", "), nearbyContext(cat, k, cat.get(k).refs)]);
    console.log(`AI batch ${i / size + 1}/${Math.ceil(remaining.length / size)} (${batch.length} strings)`);
    try {
      Object.assign(result, await requestBatch(batch, memory, { fetchImpl }));
      writeCheckpoint(result);
    } catch (e) {
      console.error(`AI batch ${i / size + 1} still failed: ${e.message || e}`);
      const recovered = e.translations || {};
      Object.assign(result, recovered);
      writeCheckpoint(result);
      const retryRows = batch.filter(([key]) => !(key in recovered));
      let repaired = {};
      if (retryRows.length) {
        try {
          repaired = await requestBatch(retryRows, translationMemory(new Map([...entries, ...Object.entries(result)])), { fetchImpl, feedback: String(e.message || e) });
          Object.assign(result, repaired);
          writeCheckpoint(result);
        } catch (repairError) {
          if (repairError.deferred === true || retryable(repairError)) {
            console.error(`AI repair pass deferred: ${repairError.message || repairError}`);
          } else {
            console.error(`AI repair pass failed: ${repairError.message || repairError}`);
          }
        }
      }
      for (const [key] of retryRows) {
        if (!(key in repaired)) {
          failed.push({
            key,
            error: String(e.message || e),
            deferred: e.deferred === true || retryable(e),
          });
        }
      }
    }
  }

  if (failed.length) {
    const deferred = failed.filter((item) => item.deferred).length;
    const reportPath = path.join(root, "tools", "reports", "zhcn-ai.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({
      status: deferred === failed.length ? "deferred" : "failed",
      translations: result,
      failed,
      reviewFailures: [],
    }, null, 2) + "\n", "utf8");
    if (deferred === failed.length) {
      console.error(`Translation deferred: ${deferred} temporary API failure(s). Progress checkpoint kept for the next run.`);
      console.log("::notice::Translation deferred because of a temporary API issue; this run is not a translation-quality failure.");
      process.exit(2);
    }
    console.error(`Translation incomplete: ${failed.length} AI failures (${deferred} deferred). Progress checkpoint kept for the next run.`);
    process.exit(1);
  }

  // Second pass (Draft-Review): send high-risk rows AND any rows flagged by
  // terminologyViolations along with their first-pass draft for targeted review.
  const preReviewMap = new Map(Object.entries(result));
  const termViolationKeys = new Set(terminologyViolations(preReviewMap).map((item) => item.key));
  const risky = remaining.filter((k) => highRisk(k, (cat.get(k).refs || [])[0]) || termViolationKeys.has(k));
  const reviewFailures = [];
  if (risky.length && process.env.ZHCN_REVIEW !== "false") {
    const reviewMemory = translationMemory(new Map([...entries, ...Object.entries(result)]));
    const models = reviewModels();
    const reviewBatchSize = integerEnv("ZHCN_REVIEW_BATCH_SIZE", 6, 1);
    for (let i = 0; i < risky.length; i += reviewBatchSize) {
      const keys = risky.slice(i, i + reviewBatchSize);
      const rows = keys.map((k) => [
        k,
        cat.get(k).refs.slice(0, 3).join(", "),
        nearbyContext(cat, k, cat.get(k).refs),
        result[k],
      ]);
      let reviewed;
      let lastError;
      for (const model of models) {
        try {
          reviewed = await requestBatch(rows, reviewMemory, { fetchImpl, review: true, model });
          break;
        } catch (e) {
          lastError = e;
          console.error("Review model " + model + " failed for batch " + (i / reviewBatchSize + 1) + ": " + (e.message || e));
        }
      }
      if (reviewed) Object.assign(result, reviewed);
      else for (const k of keys) reviewFailures.push({ key: k, error: String((lastError && lastError.message) || lastError || "review omitted") });
    }
  }
  console.log("High-risk strings reviewed: " + risky.length + (reviewFailures.length ? " (" + reviewFailures.length + " failed)" : ""));

  enforceReviewedOverrides(result, new Set(cat.keys()));
  const terminology = terminologyViolations(new Map([...entries, ...Object.entries(result)]));

  const reportPath = path.join(root, "tools", "reports", "zhcn-ai.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    status: "success",
    translations: result,
    failed,
    reviewFailures,
    terminology,
  }, null, 2) + "\n", "utf8");

  applyData(result, "AI translation", { replace: true });
  const after = report();
  if (after.missing.length || after.english.length || after.bad.length || after.stale.length) {
    console.error(`Translation incomplete: ${after.missing.length} missing, ${after.english.length} English leftovers, ${after.bad.length} invalid, ${after.stale.length} removed. Progress checkpoint kept for the next run.`);
    process.exit(1);
  }
  clearCheckpoint();
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

async function judgeCandidates(judge, candidates, keys, fetchImpl = globalThis.fetch) {
  const key = process.env.API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Repository secret API_KEY is not set");
  const base = (process.env.OPENAI_BASE_URL || "https://ai.levis0792.cn:18787/v1").replace(/\/$/, "");
  const glossary = readGlossary();
  const prompt = [
    {
      role: "system",
      content: [
        "You are the senior Simplified Chinese reviewer for a World of Warcraft addon (DaylightUI).",
        "Pick or merge the best translation for each English key.",
        "Preserve every printf placeholder, color/texture code, and leading/trailing whitespace exactly.",
        "Return ONLY a valid JSON object mapping each English key to the final Chinese string; no markdown.",
        "Required glossary: " + JSON.stringify(glossary),
      ].join("\n"),
    },
    { role: "user", content: JSON.stringify({ candidates }, null, 2) },
  ];
  const payload = { model: judge, temperature: requestTemperature(), messages: prompt };
  if (process.env.AI_JSON_MODE === "true") {
    payload.response_format = { type: "json_object" };
  }
  const res = await fetchImpl(base + "/chat/completions", {
    signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || 120000)),
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Judge ${judge} failed (${res.status}): ${text.slice(0, 1000)}`);
  const parsed = parseModelJson(text, keys.length === 1 ? keys[0] : null);
  for (const k of keys) {
    if (!validTranslation(k, parsed[k])) {
      throw new Error("Judge returned an invalid translation for " + JSON.stringify(k));
    }
  }
  return parsed;
}

async function translateConsensus(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
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
      try { candidates[model] = await requestBatch(rows, memory, { fetchImpl, model }); }
      catch (e) { console.error(`Candidate ${model} failed: ${e.message || e}`); }
    }
    if (!Object.keys(candidates).length) throw new Error("Every consensus candidate failed for this batch");
    const parsed = await judgeCandidates(judge, candidates, keys, fetchImpl);
    state.batches[id] = { complete: true, translations: parsed };
    writeConsensus(state);
  }
  const allowed = new Set(cat.keys());
  const final = {};
  for (const batch of Object.values(state.batches)) {
    for (const [key, value] of Object.entries(batch.translations || {})) {
      if (allowed.has(key)) final[key] = value;
    }
  }
  enforceReviewedOverrides(final, allowed);
  applyData(final, "multi-model consensus", { replace: true });
  prune();
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
async function rebuildAll(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
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
      try { candidates[model] = await requestBatch(rows, emptyMemory, { fetchImpl, model }); }
      catch (e) { console.error(`Candidate ${model} failed: ${e.message || e}`); }
    }
    if (!Object.keys(candidates).length) throw new Error("Every rebuild candidate failed for this batch");
    const parsed = await judgeCandidates(judge, candidates, batchKeys, fetchImpl);
    state.batches[id] = { complete: true, translations: parsed };
    writeConsensusAll(state);
  }
  const allowed = new Set(cat.keys());
  const final = {};
  for (const batch of Object.values(state.batches)) {
    for (const [key, value] of Object.entries(batch.translations || {})) {
      if (allowed.has(key)) final[key] = value;
    }
  }
  console.log(`Rebuild finished with ${Object.keys(final).length} entries.`);
  enforceReviewedOverrides(final, allowed);
  const ordered = Object.keys(final).sort().map((k) => `L[${luaQuote(k)}] = ${luaQuote(final[k])}`);
  fs.writeFileSync(localePath, "-- Simplified Chinese (zhCN).\nlocal _, DUI = ...\nif DUI.LOCALE ~= \"zhCN\" then return end\nlocal L = DUI.L\n\n" + ordered.join("\n") + "\n", "utf8");
  report();
}

if (require.main === module) {
  const cmd = process.argv[2] || "check";
  if (cmd === "missing") report({ missingOnly: true });
  else if (cmd === "check") {
    const result = report();
    if (result.missing.length || result.english.length || result.bad.length || result.duplicates.length || result.stale.length) process.exit(1);
  }
  else if (cmd === "apply") apply(process.argv[3]);
  else if (cmd === "baseline") baseline(process.argv[3]);
  else if (cmd === "sync") sync(process.argv[3]);
  else if (cmd === "prune") prune();
  else if (cmd === "merge") merge(process.argv[3]);
  else if (cmd === "dedupe") dedupe();
  else if (cmd === "override") override(process.argv[3]);
  else if (cmd === "translate") translate().catch((e) => { console.error(e.stack || e); process.exit(1); });
  else if (cmd === "consensus") translateConsensus().catch((e) => { console.error(e.stack || e); process.exit(1); });
  else if (cmd === "rebuild") rebuildAll().catch((e) => { console.error(e.stack || e); process.exit(1); });
  else {
    console.error("Usage: node tools/zhcn.js check|missing|translate|consensus|rebuild|apply|baseline <file>|sync <file>|prune|merge|dedupe|override <json>");
    process.exit(2);
  }
}

module.exports = { readGlossary, readReviewedOverrides, enforceReviewedOverrides, retryable, requestOnce, requestBatch, integerEnv, englishLeftover, terminologyViolations, dedupe, highRisk, nearbyContext, relatedMemory, requestModel, reviewModel, reviewModels, batchSize, translate, translateConsensus, rebuildAll, baseline, sync, prune, validTranslation, readCheckpoint, writeCheckpoint, clearCheckpoint, applyData, parseModelJson, edgeSpacesMatch, sameEdgeFormat, buildSystemPrompt };
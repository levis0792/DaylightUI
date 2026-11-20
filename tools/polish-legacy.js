"use strict";
// Conservative polish pass for reviewed zhCN translations.
// Commands:
//   node tools/polish-legacy.js scan
//   node tools/polish-legacy.js run
//   node tools/polish-legacy.js apply
//
// Stage contract:
//   scan  -> tools/reports/zhcn-polish-scan.json (candidate list, no AI)
//   run   -> tools/reports/zhcn-polish-diff.json + zhcn-polish-review.md (NO locale edit)
//   apply -> writes confirmed diff back via tools/zhcn.js applyData
//
// Resume state lives in tools/reports/zhcn-polish-checkpoint.json.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const defaultRoot = path.resolve(__dirname, "..");
if (!process.env.ZHCN_ROOT) process.env.ZHCN_ROOT = defaultRoot;
if (!process.env.ZHCN_TOOL_ROOT) process.env.ZHCN_TOOL_ROOT = defaultRoot;
const root = path.resolve(process.env.ZHCN_ROOT);
const toolRoot = path.resolve(process.env.ZHCN_TOOL_ROOT);

const zhcn = require(path.join(toolRoot, "tools", "zhcn.js"));
const { decodeShortString } = require(path.join(toolRoot, "tools", "lib", "lua"));

const localePath = path.join(root, "Locales", "zhCN.lua");
const reportDir = path.join(root, "tools", "reports");
const scanPath = path.join(reportDir, "zhcn-polish-scan.json");
const checkpointPath = path.join(reportDir, "zhcn-polish-checkpoint.json");
const diffPath = path.join(reportDir, "zhcn-polish-diff.json");
const reviewPath = path.join(reportDir, "zhcn-polish-review.md");
const LOCALE_LINE = /^L\[("(?:\\.|[^"\\])*")\]\s*=\s*("(?:\\.|[^"\\])*")$/;

function readLocale() {
  const src = fs.readFileSync(localePath, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const entries = new Map();
  for (const line of src.split("\n")) {
    const m = line.match(LOCALE_LINE);
    if (!m) continue;
    try {
      const key = decodeShortString(m[1]);
      const value = decodeShortString(m[2]);
      if (!entries.has(key)) entries.set(key, value);
    } catch (_) {}
  }
  return { src, entries };
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function localeSha() {
  return sha256(readLocale().src);
}

function hasHan(s) {
  return /\p{Script=Han}/u.test(String(s));
}

function ensureReportDir() {
  fs.mkdirSync(reportDir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureReportDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function countSimplePlaceholders(s) {
  return (String(s).match(/%[sd]/g) || []).length;
}

// High precision short-label list: ordinary one-to-three-word UI labels whose
// English meaning shifts easily in WoW/Auction/HUD context. Generic proper
// nouns and addon names are intentionally excluded.
const AMBIGUOUS_SHORT = new Set([
  "accept", "action", "actions", "active", "add", "addon", "addons", "advanced", "alert", "alerts",
  "align", "anchor", "apply", "area", "back", "background", "bar", "bars", "blizzard", "button",
  "buttons", "cast", "center", "change", "channel", "chat", "check", "clear", "click", "close",
  "color", "colors", "column", "combat", "command", "commands", "confirm", "copy", "count", "current",
  "custom", "dark", "data", "default", "delete", "disable", "display", "down", "drag", "drop",
  "edit", "enable", "enter", "exit", "export", "filter", "filters", "find", "finish", "follow",
  "font", "forward", "frame", "frames", "general", "global", "go", "group", "groups", "header",
  "help", "hide", "highlight", "icon", "icons", "import", "info", "input", "install", "keep",
  "label", "layer", "layers", "left", "level", "light", "link", "list", "load", "lock", "main",
  "menu", "menus", "mode", "modes", "module", "modules", "move", "name", "names", "next", "normal",
  "off", "on", "open", "option", "options", "order", "other", "outline", "own", "page", "pass",
  "passed", "pick", "pill", "play", "player", "players", "post", "posted", "preview", "profile",
  "profiles", "quick", "read", "record", "remove", "rename", "reset", "restore", "reverse", "right",
  "roll", "rolled", "save", "scale", "scan", "search", "select", "set", "settings", "show", "size",
  "slot", "slots", "sort", "space", "speed", "start", "state", "status", "stop", "style", "swap",
  "swing", "tab", "target", "targets", "test", "text", "texture", "tick", "ticks", "toggle", "top",
  "tracker", "type", "unlock", "up", "use", "user", "users", "value", "values", "view", "warning",
  "welcome", "width", "window", "windows", "word", "words", "work", "zone"
]);

function shortLabelRisk(key, value) {
  const cleaned = String(key)
    .replace(/\|c[0-9a-fA-F]{8}/g, " ")
    .replace(/\|r/g, " ")
    .replace(/\|T[^|]*/g, " ")
    .replace(/[%s%d]/g, " ")
    .trim();
  const words = cleaned.split(/[\s/_-]+/).filter(Boolean);
  if (!words.length || words.length > 3) return false;
  if (/[.!?。！？]$/.test(cleaned)) return false;
  if (countSimplePlaceholders(key) || /\|/.test(key)) return false;
  const normalized = words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (normalized.some((w) => AMBIGUOUS_SHORT.has(w))) {
    return hasHan(value) || /[A-Za-z]/.test(value);
  }
  return false;
}

function collectCandidates() {
  const { src, entries } = readLocale();
  const sha = sha256(src);
  const overrides = zhcn.readReviewedOverrides();
  const locked = (key) => Object.prototype.hasOwnProperty.call(overrides, key);

  const reasonsByKey = new Map();
  const add = (key, category, detail) => {
    if (locked(key)) return;
    if (!reasonsByKey.has(key)) reasonsByKey.set(key, []);
    reasonsByKey.get(key).push({ category, detail });
  };

  for (const violation of zhcn.terminologyViolations(entries)) {
    if (!entries.has(violation.key)) continue;
    add(violation.key, "terminology", violation.expected || violation.term || "glossary term");
  }

  for (const [key, value] of entries) {
    if (locked(key)) continue;
    if (countSimplePlaceholders(key) >= 2) add(key, "placeholders", `${countSimplePlaceholders(key)} placeholders`);
    if (shortLabelRisk(key, value)) add(key, "short-label", "ambiguous UI label");
    if (String(key).length >= 100) add(key, "long-description", `${String(key).length} chars`);
  }

  const candidates = [];
  for (const [key, reasons] of reasonsByKey) {
    const categories = [...new Set(reasons.map((r) => r.category))];
    candidates.push({
      key,
      current: entries.get(key),
      categories,
      details: reasons.map((r) => `${r.category}: ${r.detail}`),
    });
  }
  candidates.sort((a, b) => a.key.localeCompare(b.key));
  return { sha, entries, candidates };
}

function doScan() {
  const { sha, candidates } = collectCandidates();
  writeJson(scanPath, {
    sha,
    count: candidates.length,
    generatedAt: new Date().toISOString(),
    candidates,
  });
  console.log(`scan: ${candidates.length} high-risk entr${candidates.length === 1 ? "y" : "ies"}`);
  for (const row of candidates.slice(0, 25)) {
    console.log(`  [${row.categories.join(",")}] ${JSON.stringify(row.key)}`);
  }
  if (candidates.length > 25) console.log(`  ... ${candidates.length - 25} more (see tools/reports/zhcn-polish-scan.json)`);
  return candidates.length;
}

function readCheckpoint(sha) {
  const data = readJson(checkpointPath, null);
  if (!data || data.sha !== sha) return { sha, done: {}, changes: {}, kept: {}, model: "" };
  return {
    sha,
    done: data.done && typeof data.done === "object" ? data.done : {},
    changes: data.changes && typeof data.changes === "object" ? data.changes : {},
    kept: data.kept && typeof data.kept === "object" ? data.kept : {},
    model: data.model || "",
  };
}

function writeCheckpoint(cp) {
  writeJson(checkpointPath, cp);
}

function integerEnv(name, fallback, minimum) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMessages(batch, glossary, entries) {
  const system = [
    "You are polishing an existing Simplified Chinese World of Warcraft addon localization.",
    "Conservative rules: keep any translation that is already accurate and natural; do not restyle it.",
    "Only change obvious mistranslation, placeholder/semantic mismatch, glossary terminology violation, or severe machine-translation wording.",
    "Never drop, add, reorder, or alter %s/%d placeholders, color codes, texture codes, or leading/trailing spaces.",
    "Follow the glossary exactly for the terms it covers. Preserve proper nouns and addon names.",
    "Return ONLY a JSON object. For each source key return either {\"action\":\"keep\"} or {\"action\":\"change\",\"suggested\":\"...\",\"reason\":\"short Chinese reason\"}.",
    "Every supplied key must appear exactly once as a JSON object key.",
    "Glossary: " + JSON.stringify(glossary),
  ].join("\n");

  const rows = batch.map((row) => ({
    key: row.key,
    current_translation: row.current,
    scan_reasons: row.details,
    glossary_hints: Object.fromEntries(
      Object.entries(glossary).filter(([term]) => String(row.key).toLowerCase().includes(term.toLowerCase())),
    ),
  }));
  const user = JSON.stringify({ entries: rows, translation_memory_sample: [...entries].slice(0, 0) }, null, 2);
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

async function requestBatch(batch, glossary, entries, model, fetchImpl) {
  const key = process.env.API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("API_KEY / OPENAI_API_KEY is not set in this process");
  const base = (process.env.OPENAI_BASE_URL || "https://ai.levis0792.cn:18787/v1").replace(/\/$/, "");
  const messages = buildMessages(batch, glossary, entries);
  const payload = {
    model,
    temperature: 0.1,
    messages,
  };
  if (process.env.AI_JSON_MODE === "true") payload.response_format = { type: "json_object" };

  const tries = integerEnv("POLISH_RETRIES", 3, 1);
  const waitMs = integerEnv("POLISH_RETRY_BASE_MS", 1500, 0);
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetchImpl(base + "/chat/completions", {
        signal: AbortSignal.timeout(Number(process.env.POLISH_TIMEOUT_MS || 180000)),
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (!res.ok) {
        const error = new Error(`AI request failed (${res.status}): ${text.slice(0, 800)}`);
        error.status = res.status;
        throw error;
      }
      return zhcn.parseModelJson(text, batch.length === 1 ? batch[0].key : null);
    } catch (error) {
      last = error;
      const retryable = zhcn.retryable(error) || error.name === "TimeoutError" || error.name === "AbortError";
      if (!retryable || attempt === tries) break;
      console.error(`  batch retry ${attempt}/${tries}: ${error.message || error}`);
      await sleep(Math.min(30000, waitMs * (2 ** (attempt - 1))));
    }
  }
  throw last;
}

function normalizeSuggestion(raw) {
  if (typeof raw === "string") return { action: raw.trim() ? "change" : "keep", suggested: raw, reason: "" };
  if (!raw || typeof raw !== "object") return { action: "keep", suggested: "", reason: "" };
  const action = String(raw.action || "").toLowerCase();
  if (action === "keep" || action === "unchanged" || action === "no change" || action === "no-change") {
    return { action: "keep", suggested: "", reason: String(raw.reason || "kept by review") };
  }
  if (action !== "change" && !raw.suggested) return { action: "keep", suggested: "", reason: String(raw.reason || "kept by review") };
  return { action: "change", suggested: String(raw.suggested || ""), reason: String(raw.reason || "obvious issue") };
}

async function doRun() {
  let scan = readJson(scanPath, null);
  if (!scan || !Array.isArray(scan.candidates) || scan.sha !== localeSha()) {
    console.log("scan cache is missing or stale; refreshing candidate list");
    doScan();
    scan = readJson(scanPath, null);
  }

  const model = process.env.POLISH_MODEL || zhcn.requestModel();
  const glossary = zhcn.readGlossary();
  const { entries } = readLocale();
  const baselineViolations = new Set(zhcn.terminologyViolations(entries).map((v) => `${v.key}\u0000${v.term}\u0000${v.expected}`));
  const cp = readCheckpoint(scan.sha);
  cp.model = model;

  const pending = scan.candidates.filter((row) => !cp.done[row.key] && zhcn.validTranslation(row.key, row.current) !== undefined);
  const batchSize = integerEnv("POLISH_BATCH_SIZE", 10, 1);
  const fetchImpl = globalThis.fetch;
  console.log(`run: model=${model}, temperature=0.1, candidates=${scan.candidates.length}, pending=${pending.length}, batch=${batchSize}`);

  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    console.log(`  polishing ${offset + 1}-${offset + batch.length} of ${pending.length}`);
    const parsed = await requestBatch(batch, glossary, entries, model, fetchImpl);
    for (const row of batch) {
      const suggestion = normalizeSuggestion(parsed[row.key]);
      let decision;
      if (suggestion.action !== "change" || !suggestion.suggested || suggestion.suggested === row.current) {
        decision = { action: "keep", key: row.key, current: row.current, reason: suggestion.reason || "already accurate" };
      } else if (!zhcn.validTranslation(row.key, suggestion.suggested)) {
        decision = { action: "keep", key: row.key, current: row.current, reason: "rejected: failed placeholder/format/English validation" };
      } else {
        const probe = new Map(entries);
        probe.set(row.key, suggestion.suggested);
        const introduced = zhcn.terminologyViolations(probe)
          .filter((v) => v.key === row.key)
          .map((v) => `${v.key}\u0000${v.term}\u0000${v.expected}`)
          .filter((signature) => !baselineViolations.has(signature));
        if (introduced.length) {
          decision = { action: "keep", key: row.key, current: row.current, reason: "rejected: introduced glossary violation" };
        } else {
          decision = {
            action: "change",
            key: row.key,
            current: row.current,
            suggested: suggestion.suggested,
            reason: suggestion.reason || row.details.join("; "),
            categories: row.categories,
          };
        }
      }
      cp.done[row.key] = true;
      if (decision.action === "change") cp.changes[row.key] = decision;
      else cp.kept[row.key] = decision;
    }
    writeCheckpoint(cp);
  }

  const changes = Object.values(cp.changes).sort((a, b) => a.key.localeCompare(b.key));
  const kept = Object.values(cp.kept).sort((a, b) => a.key.localeCompare(b.key));
  const diff = {
    sha: scan.sha,
    generatedAt: new Date().toISOString(),
    model,
    temperature: 0.1,
    candidates: scan.candidates.length,
    reviewed: Object.keys(cp.done).length,
    changeCount: changes.length,
    changes,
    kept,
  };
  writeJson(diffPath, diff);

  const lines = [
    "# zhCN polish-legacy review",
    "",
    `- Candidate entries: ${diff.candidates}`,
    `- Reviewed entries: ${diff.reviewed}`,
    `- Suggested changes: ${diff.changeCount}`,
    `- Model: ${model}`,
    `- Generated: ${diff.generatedAt}`,
    "",
    "| Key | Current | Suggested | Reason |",
    "| --- | --- | --- | --- |",
  ];
  const md = (s) => String(s).replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\|/g, "\\|");
  for (const row of changes) {
    lines.push(`| \`${md(row.key)}\` | ${md(row.current)} | ${md(row.suggested)} | ${md(row.reason)} |`);
  }
  if (!changes.length) lines.push("| _none_ | | | |");
  lines.push("", "Review file: `tools/reports/zhcn-polish-review.md`.", "Apply only after explicit confirmation.", "");
  ensureReportDir();
  fs.writeFileSync(reviewPath, lines.join("\n"), "utf8");

  console.log(`run complete: ${diff.changeCount} suggested change(s)`);
  console.log(`  diff:   tools/reports/zhcn-polish-diff.json`);
  console.log(`  review: tools/reports/zhcn-polish-review.md`);
}

function doApply() {
  const diff = readJson(diffPath, null);
  if (!diff || !Array.isArray(diff.changes)) throw new Error("zhcn-polish-diff.json is missing or invalid");
  const currentSha = localeSha();
  if (diff.sha !== currentSha) throw new Error("zhcn-polish-diff.json is stale: Locales/zhCN.lua changed since run");
  const overrides = zhcn.readReviewedOverrides();
  const data = {};
  for (const row of diff.changes) {
    if (row.action !== "change" || !row.suggested) continue;
    if (Object.prototype.hasOwnProperty.call(overrides, row.key)) continue;
    if (!zhcn.validTranslation(row.key, row.suggested)) throw new Error(`refusing invalid polish for ${JSON.stringify(row.key)}`);
    data[row.key] = row.suggested;
  }
  const count = Object.keys(data).length;
  if (!count) {
    console.log("apply: no confirmed changes to write");
    return;
  }
  zhcn.applyData(data, "polish-legacy", { replace: true });
  console.log(`apply: wrote ${count} reviewed polish entr${count === 1 ? "y" : "ies"}`);
}

const command = process.argv[2];
if (command === "scan") doScan();
else if (command === "run") doRun().catch((error) => { console.error(error.stack || error); process.exit(1); });
else if (command === "apply") { try { doApply(); } catch (error) { console.error(error.stack || error); process.exit(1); } }
else {
  console.error("Usage: node tools/polish-legacy.js scan|run|apply");
  process.exit(2);
}


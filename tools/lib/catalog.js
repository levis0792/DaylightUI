"use strict";
// Build the translation catalog from shipped DaylightUI sources. A string is
// UI text when the runtime looks it up through L[...] or when an options helper
// stores it as a label/description/choice. The helpers below intentionally cover
// all current label/desc factories, not only literal `label = "..."` rows.

const fs = require("node:fs");
const path = require("node:path");
const { tokenize } = require("./lua");

const FIELDS = new Set([
  "label", "desc", "pitch", "title", "short", "blurb", "hint", "help",
  "note", "text", "sub", "empty", "more", "confirm", "tooltip", "tips", "mouseover", "explanation",
]);
const WALKED = new Set(["values", "choices", "labels", "STRATA_LABELS"]);
const ORDER_ONLY = new Set(["order"]);
const HELPERS = new Set([
  "strataRow", "mediaRow", "barRows", "fontRow", "backRow", "labelRow",
  "toggleRow", "sliderRow", "dropdownRow", "buttonRow", "colorRow", "textRow",
]);

function listFiles(root) {
  const out = [];
  const skip = new Set(["Libs", "Locales", "tests", "tools", "docs", "screenshots", "DaylightUI_Dev"]);
  (function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name.startsWith(".")) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (!skip.has(item.name)) walk(full);
      } else if (item.name.endsWith(".lua") && item.name !== "PatchNotes.lua") {
        out.push(full);
      }
    }
  })(root);
  return out.sort();
}

function previousValue(tokens, i, n = 3) {
  return tokens.slice(Math.max(0, i - n), i).map((x) => x.value);
}

function isUiString(tokens, i, stack) {
  const before = previousValue(tokens, i, 6);
  const prev = before[before.length - 1];
  const prev2 = before[before.length - 2];
  if (prev2 === "L" && prev === "[") return "locale";
  if (prev === "=" && FIELDS.has(prev2)) return "display";
  if (stack.some((s) => s === "values" || s === "labels" || s === "STRATA_LABELS")) {
    if (prev === "=" && before[before.length - 3] !== "key" && i + 1 < tokens.length && !["=", "]"].includes(tokens[i + 1].value)) return "choice";
    return null;
  }
  if (stack.some((s) => s === "choices")) {
    // choices = { "all", "dispel" } lists setting values, not labels.
    return null;
  }
  if (prev === "(" && ["T", "Text"].includes(prev2)) return "display";
  // Label factories pass display text after a setting key or size argument.
  // Mark literals in their argument list, then drop obvious config strings.
  if (prev === "," && before.includes("(") && HELPERS.has(before.find((v) => HELPERS.has(v)))) return "helper-label";
  return null;
}

function extract(root) {
  const data = new Map();
  for (const file of listFiles(root)) {
    const source = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const tokens = tokenize(source);
    const stack = [];
    const lines = source.split(/\r?\n/);
    const rel = path.relative(root, file).replace(/\\/g, "/");
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const before = previousValue(tokens, i, 3);
      if (t.kind === "tok" && t.value === "{") {
        stack.push(before.length > 1 && before[before.length - 1] === "=" ? before[before.length - 2] : "");
        if (ORDER_ONLY.has(stack[stack.length - 1])) stack[stack.length - 1] = "";
      }
      if (t.kind === "tok" && t.value === "}" && stack.length) stack.pop();
      if (t.kind !== "str") continue;
      const value = t.value;
      let reason = isUiString(tokens, i, stack);
      if (!reason && /\b(?:values|labels|STRATA_LABELS)\s*=\s*\{/.test(lines[t.line - 1] || "") && !/\border\s*=/.test(lines[t.line - 1] || "") && !/\bkey\s*=/.test(lines[t.line - 1] || "") && !/\btype\s*\(/.test(lines[t.line - 1] || "")) reason = "choice";
      if (!reason) continue;
      if (!/[A-Za-z]/.test(value)) continue;
      if (value.includes("\\")) continue;
      if (value.startsWith("Interface/") || value.startsWith("Fonts/")) continue;
      let item = data.get(value);
      if (!item) { item = { reasons: [], refs: [] }; data.set(value, item); }
      if (!item.reasons.includes(reason)) item.reasons.push(reason);
      const ref = rel + ":" + t.line;
      if (!item.refs.includes(ref)) item.refs.push(ref);
    }
  }
  return new Map([...data.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

module.exports = { extract, listFiles, FIELDS, HELPERS };

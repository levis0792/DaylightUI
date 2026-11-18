#!/usr/bin/env node
"use strict";

// Summarize the locale-only change carried by a rolling translation PR.
// Input is a unified diff on stdin. Output is Markdown on stdout.
const fs = require("node:fs");
const { decodeShortString } = require("./lib/lua");

const diff = fs.readFileSync(0, "utf8");

function assertCleanText(label, text) {
  if (String(text).includes("\uFFFD")) {
    throw new Error(label + " contains U+FFFD; refusing to publish a corrupt PR description");
  }
}

assertCleanText("diff", diff);

const lineRe = /^([+-])L\[("(?:\\.|[^"\\])*")\]\s*=\s*("(?:\\.|[^"\\])*")$/;
const added = new Map();
const removed = new Set();
let otherLines = 0;

for (const line of diff.split(/\r?\n/)) {
  const m = line.match(lineRe);
  if (!m) {
    if (/^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line) && line.trim() !== "+" && line.trim() !== "-") otherLines++;
    continue;
  }
  const [, sign, rawKey, rawValue] = m;
  const key = decodeShortString(rawKey);
  if (sign === "+") added.set(key, decodeShortString(rawValue));
  else removed.add(key);
}

const modified = [];
const created = [];
for (const [key, value] of added) {
  if (removed.has(key)) modified.push([key, value]);
  else created.push([key, value]);
}

function cell(value, limit = 500) {
  const text = String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return text.length > limit ? text.slice(0, limit - 1) + "..." : text;
}

console.log(`Added ${created.length}, updated ${modified.length}.`);
if (otherLines) console.log(`Other changed lines: ${otherLines}.`);
if (!created.length && !modified.length) process.exit(0);

function compact(items, limit) {
  const parts = items.slice(0, limit).map(([key, value]) => `${cell(key)} → ${cell(value)}`);
  if (items.length > limit) parts.push(`...and ${items.length - limit} more`);
  return parts.map((x) => `- ${x}`).join("\n");
}

console.log("");
if (created.length) {
  console.log("<details>");
  console.log(`<summary>New translations (${created.length})</summary>`);
  console.log("");
  console.log("| English | 简体中文 |");
  console.log("| --- | --- |");
  for (const [key, value] of created) console.log(`| ${cell(key)} | ${cell(value)} |`);
  console.log("");
  console.log("</details>");
  console.log("");
}
if (modified.length) {
  console.log("<details>");
  console.log(`<summary>Updated translations (${modified.length})</summary>`);
  console.log("");
  console.log("| Key | New 简体中文 |");
  console.log("| --- | --- |");
  for (const [key, value] of modified) console.log(`| ${cell(key)} | ${cell(value)} |`);
  console.log("");
  console.log("</details>");
  console.log("");
}

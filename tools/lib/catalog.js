const fs = require("fs");
const path = require("path");
const { tokenize } = require("./lua");

// Authoritative key file exported by the author's own runtime walker
// (`luajit tools/locale.lua keys`). One JSON-encoded key per line.
// The runner sets ZHCN_KEYS_FILE to this file; without it, `check` must fail
// closed instead of guessing from source patterns.

function readKeysFile() {
  const file = process.env.ZHCN_KEYS_FILE;
  if (!file || !fs.existsSync(file)) {
    throw new Error("ZHCN_KEYS_FILE is missing: the author's runtime key extractor must run before check.");
  }
  return fs.readFileSync(file, "utf8");
}

function parseKeys(text) {
  const keys = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    keys.push(JSON.parse(s));
  }
  return keys;
}

function extract(root) {
  const text = readKeysFile();
  const keys = parseKeys(text);
  const map = new Map();
  for (const key of keys) {
    if (typeof key === "string" && /[A-Za-z]/.test(key)) map.set(key, { reasons: ["runtime"], refs: ["locale.lua keys"] });
  }
  return map;
}

module.exports = { extract };

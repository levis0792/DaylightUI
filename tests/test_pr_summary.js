"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const tool = path.join(root, "tools", "pr-summary.js");

function run(text) {
  return spawnSync(process.execPath, [tool], { input: text, encoding: "utf8" });
}

const diff = [
  "diff --git a/Locales/zhCN.lua b/Locales/zhCN.lua",
  "--- a/Locales/zhCN.lua",
  "+++ b/Locales/zhCN.lua",
  '+L["Completed"] = "已完成"',
  '-L["Old"] = "旧译文"',
  '+L["Old"] = "新译文"',
  '+L["A | B"] = "甲 | 乙"',
  "",
].join("\n");

let out = run(diff);
assert.equal(out.status, 0, out.stderr);
assert.match(out.stdout, /Added 2, updated 1/);
assert.match(out.stdout, /\*\*New translations \(2\)\*\*/);
assert.match(out.stdout, /\*\*Updated translations \(1\)\*\*/);
assert.match(out.stdout, /\| Completed \| 已完成 \|/);
assert.match(out.stdout, /\| Old \| 新译文 \|/);
assert.match(out.stdout, /A \\\| B/);

out = run("");
assert.equal(out.status, 0, out.stderr);
assert.equal(out.stdout.trim(), "Added 0, updated 0.");

console.log("PR summary tests passed");

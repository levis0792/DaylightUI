"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const toolPath = path.join(root, "tools", "zhcn.js");



function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
  };
}

function completion(text) {
  return { choices: [{ message: { content: text } }] };
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  assert.equal(spawnSync(process.execPath, ["--check", toolPath], { encoding: "utf8" }).status, 0,
    "tools/zhcn.js must parse");
  const luaStrings = require(path.join(root, "tools", "lib", "lua"));
  const escapedLua = "L[\"Its name in the AddOns list should read \\\"%s %s\\\": every plugin\\'s does.\"] = \"它在插件列表中的名称应为“%s %s”：每个插件都是如此。\"";
  const localeLine = /^L\[("(?:\\.|[^"\\])*")\]\s*=\s*("(?:\\.|[^"\\])*")$/;
  const m = escapedLua.match(localeLine);
  assert.ok(m, "the regression fixture must stay a quoted locale entry");
  assert.throws(() => JSON.parse(m[1]), /Bad escaped character/, "JSON.parse must reject the Lua escaped apostrophe");
  assert.equal(luaStrings.decodeShortString(m[1]), "Its name in the AddOns list should read \"%s %s\": every plugin's does.");
  const os = require("node:os");
  const dedupeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhcn-dedupe-"));
  fs.mkdirSync(path.join(dedupeRoot, "Locales"), { recursive: true });
  fs.writeFileSync(path.join(dedupeRoot, "Locales", "zhCN.lua"), [
    'L["%d days ago"] = "旧译文"',
    'L["Keep"] = "保留"',
    'L["%d days ago"] = "新译文"',
    "",
  ].join("\n"), "utf8");
  process.env.ZHCN_ROOT = dedupeRoot;
  delete require.cache[require.resolve(toolPath)];
  const deduped = require(toolPath);
  assert.equal(deduped.dedupe(), 1);
  const dedupeText = fs.readFileSync(path.join(dedupeRoot, "Locales", "zhCN.lua"), "utf8");
  assert.equal((dedupeText.match(/%d days ago/g) || []).length, 1);
  assert.match(dedupeText, /新译文/);
  assert.doesNotMatch(dedupeText, /旧译文/);
  delete process.env.ZHCN_ROOT;
  fs.rmSync(dedupeRoot, { recursive: true, force: true });
  delete require.cache[require.resolve(toolPath)];
  const baselineRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhcn-baseline-"));
  const baselineKeys = path.join(baselineRoot, "keys.txt");
  fs.mkdirSync(path.join(baselineRoot, "Locales"), { recursive: true });
  fs.writeFileSync(baselineKeys, ['Keep','New'].map((key) => JSON.stringify(key)).join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(baselineRoot, "Locales", "zhCN.lua"), [
    'L["Keep"] = "保留"',
    'L["New"] = "新增"',
    "",
  ].join("\n"), "utf8");
  process.env.ZHCN_ROOT = baselineRoot;
  process.env.ZHCN_KEYS_FILE = baselineKeys;
  delete require.cache[require.resolve(toolPath)];
  const baselined = require(toolPath);
  assert.equal(baselined.baseline(path.join(baselineRoot, "Locales", "zhCN.lua")), 0);
  const baselineText = fs.readFileSync(path.join(baselineRoot, "Locales", "zhCN.lua"), "utf8");
  assert.match(baselineText, /L\["Keep"\] = "保留"/);
  assert.match(baselineText, /L\["New"\] = "新增"/);
  fs.writeFileSync(path.join(baselineRoot, "Locales", "zhCN.lua"), 'L["Keep"] = "\uFFFD"' + String.fromCharCode(10), "utf8");
  assert.throws(() => baselined.baseline(path.join(baselineRoot, "Locales", "zhCN.lua")), /Invalid baseline translation/);
  delete process.env.ZHCN_ROOT;
  delete process.env.ZHCN_KEYS_FILE;
  fs.rmSync(baselineRoot, { recursive: true, force: true });
  delete require.cache[require.resolve(toolPath)];
  const { highRisk, batchSize, requestModel, reviewModel, reviewModels } = require(toolPath);

  assert.equal(highRisk('Short label', 'Bags/Options.lua:1'), false);
  assert.equal(highRisk('A sentence with a long explanation, a condition and another condition, so it needs a careful second pass.', 'Bags/Options.lua:1'), true, 'long conditional sentences are high risk');
  assert.equal(highRisk('%s and %d', 'Bags/Options.lua:1'), true, 'multiple placeholders are high risk');

  const oldBatch = process.env.ZHCN_BATCH_SIZE;
  delete process.env.ZHCN_BATCH_SIZE;
  assert.equal(batchSize(), 12, 'default batch size is 12');
  process.env.ZHCN_BATCH_SIZE = '7';
  assert.equal(batchSize(), 7);
  if (oldBatch === undefined) delete process.env.ZHCN_BATCH_SIZE; else process.env.ZHCN_BATCH_SIZE = oldBatch;
  const oldModelForRouting = process.env.OPENAI_MODEL;
  const oldReview = process.env.ZHCN_REVIEW_MODEL;
  const oldFallback = process.env.ZHCN_REVIEW_FALLBACK_MODEL;
  const oldLast = process.env.ZHCN_REVIEW_LAST_MODEL;
  const oldReviewEnabled = process.env.ZHCN_REVIEW;
  const oldReviewBatch = process.env.ZHCN_REVIEW_BATCH_SIZE;
  delete process.env.ZHCN_REVIEW;
  delete process.env.ZHCN_REVIEW_BATCH_SIZE;
  delete process.env.OPENAI_MODEL;
  delete process.env.ZHCN_REVIEW_MODEL;
  delete process.env.ZHCN_REVIEW_FALLBACK_MODEL;
  delete process.env.ZHCN_REVIEW_LAST_MODEL;
  assert.equal(requestModel(), 'deepseek-v4.1-flash');
  assert.equal(reviewModel(), 'deepseek-v4.1-flash');
  const models = reviewModels();
  assert.equal(models[0], reviewModel());
  assert.deepEqual(models, ['deepseek-v4.1-flash']);
  assert.ok(models.includes('deepseek-v4.1-flash'));
  if (oldModelForRouting === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = oldModelForRouting;
  if (oldReview === undefined) delete process.env.ZHCN_REVIEW_MODEL; else process.env.ZHCN_REVIEW_MODEL = oldReview;
  if (oldFallback === undefined) delete process.env.ZHCN_REVIEW_FALLBACK_MODEL; else process.env.ZHCN_REVIEW_FALLBACK_MODEL = oldFallback;
  if (oldLast === undefined) delete process.env.ZHCN_REVIEW_LAST_MODEL; else process.env.ZHCN_REVIEW_LAST_MODEL = oldLast;

  const { translateConsensus } = require(toolPath);
  assert.equal(typeof translateConsensus, "function", "consensus pass is available");
  const { relatedMemory } = require(toolPath);
  assert.deepEqual(relatedMemory({ exact: new Map([["Bar animation", "状态条动画"], ["Unrelated", "无关"]]) }, [["Bar styles", "x"]]), [["Bar animation", "状态条动画"]]);
  const { requestOnce, requestBatch, readGlossary, retryable } = require(toolPath);
  const { englishLeftover } = require(toolPath);

  const glossary = readGlossary();
  assert.equal(glossary["Focus Target"], "焦点目标");
  assert.equal(glossary["tooltip"], "鼠标提示");

  assert.equal(retryable({ status: 429 }), true);
  assert.equal(retryable({ status: 503 }), true);
  assert.equal(retryable({ status: 400 }), false);

  assert.equal(englishLeftover("Open", "Open 商店"), true, "mixed English UI action words must be caught");
  assert.equal(englishLeftover("Open", "打开商店"), false);
  assert.equal(englishLeftover("test off", "/dui buffs test off 停止"), false, "command arguments are not UI text");
  assert.equal(englishLeftover("skins profile off", "skins profile 已关闭"), false, "addon command is not UI text");
  assert.equal(englishLeftover("Daylight UI: Bags", "Daylight UI: 背包"), false, "brand prefix stays English");
  assert.equal(retryable({ status: 401 }), false);

  // Regression: whole English sentences left inside Chinese text.
  assert.equal(englishLeftover("Kinds", "类型：gear, weapon, armor、食物"), true, "English word runs must be caught");
  assert.equal(englishLeftover("Kinds", "类型：gear, weapon, armor, consumable"), true, "longer English runs are caught");
  assert.equal(englishLeftover("Kinds", "类型：装备、武器、护甲"), false, "full Chinese stays fine");
  assert.equal(englishLeftover("Quality", "品质：q>稀有、q>=优秀、q<史诗"), false, "search syntax tokens are not English");
  assert.equal(englishLeftover("Keys", "Alt+上和Alt+下仍然有效。"), false, "key names are not English");
  assert.equal(englishLeftover("Bars", "大条：240 x 60，3D头像"), false, "dimensions are not English");
  assert.equal(englishLeftover("Channels", "[1. G] 为综合，[2. T] 为交易。"), false, "channel tags are not English");
  assert.equal(englishLeftover("Icons", "安装 Jiberish Fabled Icons 插件"), false, "addon names stay English");
  assert.equal(englishLeftover("Skins", "skins dump <Frame> [depth]：列出一个窗口"), false, "command docs stay English");
  assert.equal(englishLeftover("Copy", "选中文字后按Ctrl+C复制。"), false, "Ctrl+C is not English");
  assert.equal(englishLeftover("Support", "在Ko-fi上支持DaylightUI"), false, "donation platform stays English");

  const oldKey = process.env.API_KEY;
  const oldBase = process.env.OPENAI_BASE_URL;
  const oldModelForRequest = process.env.OPENAI_MODEL;
  process.env.API_KEY = "test-key";
  process.env.OPENAI_MODEL = "test-model";

  try {
    await withServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        assert.equal(req.url, "/chat/completions");
        assert.equal(req.headers.authorization, "Bearer test-key");
        const payload = JSON.parse(body);
        assert.equal(payload.model, "test-model");
        assert.match(payload.messages[0].content, /Required glossary:/);
        assert.match(payload.messages[0].content, /"Focus Target":"焦点目标"/);
        assert.match(payload.messages[0].content, /"tooltip":"鼠标提示"/);
        const userPayload = JSON.parse(payload.messages[1].content);
        assert.equal(userPayload.strings_to_translate[0].source_location, "Some.lua:10");
        assert.ok(Array.isArray(userPayload.strings_to_translate[0].nearby_ui_text), "nearby context must be sent");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(completion(JSON.stringify({ "Press %s": "按下 %s" }))));
      });
    }, async (port) => {
      process.env.OPENAI_BASE_URL = "http://127.0.0.1:" + port;
      const memory = { exact: new Map([["Focus", "焦点"]]) };
      const out = await requestOnce([["Press %s", "Some.lua:10"]], memory);
      assert.deepEqual(out, { "Press %s": "按下 %s" });
    });

    let calls = 0;
    const waits = [];
    const response = await requestBatch([["Ready", "Some.lua:10"]], { exact: new Map() }, {
      retries: 3,
      wait: async (ms) => { waits.push(ms); },
      fetchImpl: async () => {
        calls += 1;
        if (calls < 3) return fakeResponse(503, "try again");
        return fakeResponse(200, completion(JSON.stringify({ Ready: "就绪" })));
      },
    });
    assert.deepEqual(response, { Ready: "就绪" });
    assert.equal(calls, 3);
    assert.deepEqual(waits, [1500, 3000]);

    calls = 0;
    await assert.rejects(() => requestBatch([["Ready", "Some.lua:10"]], { exact: new Map() }, {
      retries: 3,
      wait: async () => {},
      fetchImpl: async () => {
        calls += 1;
        return fakeResponse(200, completion(JSON.stringify({ Ready: "Ready." })));
      },
    }), /left the string in English/);
    assert.equal(calls, 1, "an English-only retranslation must fail, not reach the PR");

    calls = 0;
    await assert.rejects(() => requestBatch([["Ready", "Some.lua:10"]], { exact: new Map() }, {
      retries: 3,
      wait: async () => {},
      fetchImpl: async () => {
        calls += 1;
        return fakeResponse(400, "bad request");
      },
    }), /AI request failed \(400\)/);
    assert.equal(calls, 1, "4xx input errors must not be retried");

    calls = 0;
    await assert.rejects(() => requestBatch([["Ready", "Some.lua:10"]], { exact: new Map() }, {
      retries: 3,
      wait: async () => {},
      fetchImpl: async () => {
        calls += 1;
        return fakeResponse(200, completion(JSON.stringify({ Ready: "Ready." })));
      },
    }), /left the string in English/);
    assert.equal(calls, 1, "an English-only retranslation must fail, not reach the PR");

    calls = 0;
    await assert.rejects(() => requestBatch([["Ready", "Some.lua:10"]], { exact: new Map() }, {
      retries: 2,
      wait: async () => {},
      fetchImpl: async () => {
        calls += 1;
        return fakeResponse(503, "still down");
      },
    }), /failed after 2 attempts/);
    assert.equal(calls, 2);

    calls = 0;
    const splitWaits = [];
    const split = await requestBatch([["One", "Some.lua:1"], ["Two", "Some.lua:2"]], { exact: new Map() }, {
      retries: 2,
      wait: async (ms) => { splitWaits.push(ms); },
      fetchImpl: async (_url, options) => {
        calls += 1;
        const payload = JSON.parse(options.body);
        const rows = JSON.parse(payload.messages[1].content).strings_to_translate;
        if (rows.length > 1) return fakeResponse(200, completion(JSON.stringify({ One: "一", Two: "Two." })));
        const key = rows[0].original_english;
        return fakeResponse(200, completion(JSON.stringify({ [key]: key === "One" ? "一" : "二" })));
      },
    });
    assert.deepEqual(split, { One: "一", Two: "二" });
    assert.equal(calls, 3, "the bad batch is split into two single-key requests");
    assert.deepEqual(splitWaits, [], "a deterministic model-output error is not retried with backoff");

    calls = 0;
    await assert.rejects(() => requestBatch([["Ready", "Some.lua:10"]], { exact: new Map() }, {
      retries: 3,
      wait: async () => {},
      fetchImpl: async () => { calls += 1; return fakeResponse(200, completion("not json")); },
    }), /left the string in English|invalid JSON/);
    assert.equal(calls, 1, "invalid model JSON is not retried with backoff");

    calls = 0;
    await assert.rejects(() => requestBatch([["Ready", "Some.lua:10"]], { exact: new Map() }, {
      retries: 3,
      wait: async () => {},
      fetchImpl: async () => { calls += 1; return fakeResponse(200, completion(JSON.stringify({ Ready: String.fromCharCode(0xFFFD) }))); },
    }), /replacement character/);
    assert.equal(calls, 1, "a replacement character never reaches the locale");
  } finally {
    if (oldKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = oldKey;
    if (oldBase === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = oldBase;
    if (oldModelForRequest === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = oldModelForRequest;
  }

  console.log("zhCN tool tests: glossary path, request body, retry and failure handling passed");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});


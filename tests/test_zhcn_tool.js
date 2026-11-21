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
  fs.writeFileSync(path.join(baselineRoot, "Locales", "zhCN.lua"), "", "utf8");
  fs.writeFileSync(path.join(baselineRoot, "baseline.lua"), ['L["Keep"] = "保留"', 'L["New"] = "新增"', ""].join("\n"), "utf8");
  process.env.ZHCN_ROOT = baselineRoot;
  process.env.ZHCN_KEYS_FILE = baselineKeys;
  delete require.cache[require.resolve(toolPath)];
  const baselined = require(toolPath);
  assert.equal(baselined.baseline(path.join(baselineRoot, "baseline.lua")), 2);
  const baselineText = fs.readFileSync(path.join(baselineRoot, "Locales", "zhCN.lua"), "utf8");
  assert.match(baselineText, /L\["Keep"\] = "保留"/);
  assert.match(baselineText, /L\["New"\] = "新增"/);
  assert.match(baselineText, /-- More translated lines\./);
  assert.doesNotMatch(baselineText, /zhcn-fork|DaylightUI translations from/);
  fs.writeFileSync(path.join(baselineRoot, "Locales", "zhCN.lua"), 'L["Keep"] = "\uFFFD"' + String.fromCharCode(10), "utf8");
  assert.throws(() => baselined.baseline(path.join(baselineRoot, "baseline.lua")), /Invalid baseline translation/);
  delete process.env.ZHCN_ROOT;
  delete process.env.ZHCN_KEYS_FILE;
  fs.rmSync(baselineRoot, { recursive: true, force: true });
  delete require.cache[require.resolve(toolPath)];
  const checkpointRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhcn-checkpoint-"));
  fs.mkdirSync(path.join(checkpointRoot, "Locales"), { recursive: true });
  fs.writeFileSync(path.join(checkpointRoot, "Locales", "zhCN.lua"), "", "utf8");
  const checkpointFile = path.join(checkpointRoot, "checkpoint.json");
  const oldCheckpoint = process.env.ZHCN_CHECKPOINT;
  const oldCheckpointSha = process.env.ZHCN_CHECKPOINT_SHA;
  process.env.ZHCN_ROOT = checkpointRoot;
  process.env.ZHCN_CHECKPOINT = checkpointFile;
  process.env.ZHCN_CHECKPOINT_SHA = "sha-123";
  delete require.cache[require.resolve(toolPath)];
  const checkpointTool = require(toolPath);
  checkpointTool.writeCheckpoint({
    Ready: "就绪",
    Search: "Search",
    "Press %s": "按 %d",
  });
  assert.deepEqual(
    checkpointTool.readCheckpoint().translations,
    { Ready: "就绪" },
    "checkpoint writes must keep only valid translations",
  );
  fs.writeFileSync(checkpointFile, JSON.stringify({
    sha: "sha-other",
    translations: { Ready: "就绪" },
  }), "utf8");
  assert.deepEqual(
    checkpointTool.readCheckpoint().translations,
    {},
    "a checkpoint from another upstream SHA must not be reused",
  );
  checkpointTool.clearCheckpoint();
  assert.equal(fs.existsSync(checkpointFile), false, "clearCheckpoint must remove the file");
  if (oldCheckpoint === undefined) delete process.env.ZHCN_CHECKPOINT; else process.env.ZHCN_CHECKPOINT = oldCheckpoint;
  if (oldCheckpointSha === undefined) delete process.env.ZHCN_CHECKPOINT_SHA; else process.env.ZHCN_CHECKPOINT_SHA = oldCheckpointSha;
  delete process.env.ZHCN_ROOT;
  fs.rmSync(checkpointRoot, { recursive: true, force: true });
  delete require.cache[require.resolve(toolPath)];

  const { readTranslations } = luaStrings;
  const generatedTable = [
    "P.translations = {",
    "  [\"It\\'s ready\"] = \"已就绪\",",
    "}",
  ].join("\n");
  const generated = readTranslations(generatedTable);
  assert.equal(generated.get("It's ready"), "已就绪", "Lua escaped apostrophes are decoded");

  const { highRisk, batchSize, requestModel, reviewModel, reviewModels, terminologyViolations } = require(toolPath);

  assert.equal(highRisk('Short label', 'Bags/Options.lua:1'), true, 'short UI labels are high risk');
  assert.equal(highRisk('A sentence with a long explanation, a condition and another condition, so it needs a careful second pass.', 'Bags/Options.lua:1'), true, 'long conditional sentences are high risk');
  assert.equal(highRisk('%s and %d', 'Bags/Options.lua:1'), true, 'multiple placeholders are high risk');
  assert.equal(highRisk('Choose a kind (unit, item, spell, world or compare)', 'Tooltip.lua:10'), true, 'technical enum context is high risk');
  assert.equal(highRisk('/dui install --force and reload', 'Commands.lua:4'), true, 'command-heavy strings are high risk');
  assert.equal(highRisk('You passed.', 'LootRoll.lua:20'), true, 'loot-roll pass context is high risk');
  assert.equal(highRisk('Time ran out, so you passed.', 'LootRoll.lua:21'), true, 'timed-out loot-roll pass is high risk');

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
  const { requestOnce, requestBatch, readGlossary, retryable, enforceReviewedOverrides } = require(toolPath);
  const { englishLeftover } = require(toolPath);

  const glossary = readGlossary();
  assert.equal(glossary["Focus Target"], "焦点目标");
  assert.equal(glossary["tooltip"], "鼠标提示");
  const requiredGlossary = {
    "General": "常规",
    "General channel": "综合频道",
    "Whisper": "密语",
    "Whispers": "密语",
    "Bar icons": "伤害统计条图标",
    "Point 1": "第1点",
    "Point 2": "第2点",
    "Point 3": "第3点",
    "Point 4": "第4点",
    "Point 5": "第5点",
    "Combat text": "浮动战斗信息",
    "Scrolling combat text": "浮动战斗信息",
    "Loot": "拾取",
    "Cast bar": "施法条",
    "Cast bars": "施法条",
    "Cast Bars": "施法条",
    "Nameplates": "姓名板",
    "Unit Frames": "单位框体",
    "Party": "小队",
    "Raid": "团队",
    "Guild": "公会",
    "Battleground": "战场",
    "Battlegrounds": "战场",
    "Arena": "竞技场",
    "Arenas": "竞技场",
  };
  for (const [key, value] of Object.entries(requiredGlossary)) {
    assert.equal(glossary[key], value, "glossary must lock " + JSON.stringify(key));
  }
  const expandedGlossary = {
    "Buff": "增益",
    "Debuff": "减益",
    "Cooldown": "冷却",
    "Threat": "仇恨",
    "Tank": "坦克",
    "Healer": "治疗",
    "Damage": "伤害",
    "Gear": "装备",
    "Specialization": "专精",
    "Talent": "天赋",
    "Action bar": "动作条",
    "Auction House": "拍卖行",
    "Dungeon": "副本",
    "Haste": "急速",
    "Mastery": "精通",
    "Versatility": "全能",
    "Enchant": "附魔",
    "World quest": "世界任务",
  };
  for (const [key, value] of Object.entries(expandedGlossary)) {
    assert.equal(glossary[key], value, "expanded glossary must lock " + JSON.stringify(key));
  }

  assert.deepEqual(terminologyViolations(new Map([["General", "常规"]])), []);
  assert.equal(terminologyViolations(new Map([["General", "综合"]])).length, 1, "General must use 常规");
  assert.equal(terminologyViolations(new Map([["General channel", "综合频道"]])).length, 0);
  assert.equal(terminologyViolations(new Map([["Whispers", "密语"]])).length, 0);
  assert.equal(terminologyViolations(new Map([["Whispers", "私聊"]])).length, 0, "reviewed overrides stay exempt from terminology warnings");
  assert.equal(terminologyViolations(new Map([["Grow direction", "延伸方向"]])).length, 0);
  assert.equal(terminologyViolations(new Map([["Grow direction", "增长方向"]])).length, 0, "reviewed overrides stay exempt from terminology warnings");
  const lockedTranslations = enforceReviewedOverrides({
    Whispers: "私聊",
    "Grow direction": "增长方向",
    Extra: "额外",
  }, new Set(["Whispers", "Grow direction"]));
  assert.deepEqual(lockedTranslations, {
    Whispers: "密语",
    "Grow direction": "延伸方向",
    Extra: "额外",
  }, "reviewed overrides must lock approved wording");
  assert.equal(terminologyViolations(new Map([["A full scan reads the whole Auction House in about a minute.", "完整扫描会读取整个拍卖行。"]])).length, 0);
  assert.equal(terminologyViolations(new Map([["Auction House", "拍卖行需要一点时间"]])).length, 0);
  assert.equal(terminologyViolations(new Map([["Auction House", "Auction House 需要一点时间"]])).length, 1, "an English glossary term inside a Chinese value must be caught");
  assert.equal(terminologyViolations(new Map([["Request invite", "请求邀请"]])).length, 0, "verb need must not be mistaken for Need=需求");
  assert.equal(terminologyViolations(new Map([["%s needs a reload to take effect. Reload now?", "%s需要重载界面才能生效。现在重载吗？"]])).length, 0, "needs in prose must not be mistaken for Need=需求");

  assert.equal(retryable({ status: 429 }), true);
  assert.equal(retryable({ status: 503 }), true);
  assert.equal(retryable({ status: 400 }), false);

  assert.equal(englishLeftover("Open", "Open 商店"), true, "mixed English UI action words must be caught");
  assert.equal(englishLeftover("Open", "打开商店"), false);
  assert.equal(englishLeftover("Aa", "Aa"), false, "font preview label stays in English");
  assert.equal(englishLeftover("Bb", "Bb"), false, "font preview sample stays in English");
  assert.equal(englishLeftover("RGB", "RGB"), false, "technical abbreviation stays in English");
  assert.equal(englishLeftover("16:9", "16:9"), false, "aspect ratio stays unchanged");
  assert.equal(englishLeftover("12pt", "12pt"), false, "numeric unit stays unchanged");
  assert.equal(englishLeftover("Up", "Up"), true, "real English UI word is still caught");
  assert.equal(englishLeftover("Open", "Open"), true, "real English UI word is still caught");
  assert.equal(englishLeftover("Save", "Save"), true, "real English UI word is still caught");
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
  assert.equal(englishLeftover("Clique is on", "Clique 已启用，因此由 Clique 处理点击施法。Clique 继续生效。"), false, "repeated addon names are not an English sentence");
  assert.equal(englishLeftover("Kinds", "类型：gear weapon armor"), true, "ordinary leaked words still fail");
  assert.equal(englishLeftover("logo-title.png", "logo-title.png"), false, "texture filenames stay unchanged");
  assert.equal(englishLeftover("Search", "Search"), true, "a cached English key is still untranslated");
  assert.equal(englishLeftover("Addon list", "插件列表 (by DaylightUI)"), true, "a short English attribution is caught");
  assert.equal(englishLeftover("%s: tooltip lines need a kind (unit, item, spell, world or compare) and a function.", "%s：鼠标提示行需要类型（unit、item、spell、world 或 compare）和函数。"), false, "technical kind values stay English inside the enum context");
  assert.equal(englishLeftover("Unrelated label", "无关标签：unit item spell world compare"), true, "technical enum values are not globally allowed");


  // Author-source changes: removed keys must go, changed English keys must be
  // translated, and an English value must never be reused as memory.
  const { validTranslation, prune, sync } = require(toolPath);
  assert.equal(validTranslation("Search", "Search"), false, "an English value is not reusable memory");
  assert.equal(validTranslation("Search", "搜索"), true);
  assert.equal(validTranslation("|cff00ff00Hi|r", "你好"), false, "a dropped color code is invalid");

  const authorRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhcn-author-"));
  const authorKeys = path.join(authorRoot, "keys.txt");
  fs.mkdirSync(path.join(authorRoot, "Locales"), { recursive: true });
  fs.writeFileSync(authorKeys, ["Visible", "Changed", "|cff00ff00Code|r"].map((k) => JSON.stringify(k)).join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(authorRoot, "Locales", "zhCN.lua"), [
    'L["Visible"] = "可见"',
    'L["Changed"] = "Changed"',
    'L["|cff00ff00Code|r"] = "你好"',
    'L["Removed"] = "旧死键"',
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(authorRoot, "baseline.lua"), [
    'L["Visible"] = "可见"',
    'L["Changed"] = "已更改"',
    'L["|cff00ff00Code|r"] = "|cff00ff00你好|r"',
    'L["Removed"] = "旧死键"',
    "",
  ].join("\n"), "utf8");
  process.env.ZHCN_ROOT = authorRoot;
  process.env.ZHCN_KEYS_FILE = authorKeys;
  delete require.cache[require.resolve(toolPath)];
  const authorTool = require(toolPath);
  authorTool.sync(path.join(authorRoot, "baseline.lua"));
  const authorText = fs.readFileSync(path.join(authorRoot, "Locales", "zhCN.lua"), "utf8");
  assert.match(authorText, /L\["Changed"\] = "已更改"/, "a new English key receives a translation");
  assert.match(authorText, /L\["\|cff00ff00Code\|r"\] = "\|cff00ff00你好\|r"/, "a dropped color code is repaired");
  assert.doesNotMatch(authorText, /L\["Removed"\]/, "a translation for a deleted source key is pruned");
  assert.equal(authorTool.prune(), 0, "pruning twice is a no-op");
  // Author changes can remove a key while introducing a new one. The old key
  // must be pruned and the new exact key must be filled from the reviewed baseline.
  fs.writeFileSync(authorKeys, ["Visible", "New label"].map((k) => JSON.stringify(k)).join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(authorRoot, "Locales", "zhCN.lua"), [
    'L["Visible"] = "可见"',
    'L["Removed"] = "旧标签"',
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(authorRoot, "baseline.lua"), [
    'L["Visible"] = "可见"',
    'L["New label"] = "新标签"',
    "",
  ].join("\n"), "utf8");
  delete require.cache[require.resolve(toolPath)];
  const authorChanged = require(toolPath);
  authorChanged.sync(path.join(authorRoot, "baseline.lua"));
  const authorChangedText = fs.readFileSync(path.join(authorRoot, "Locales", "zhCN.lua"), "utf8");
  assert.match(authorChangedText, /L\["New label"\] = "新标签"/, "a new exact key receives its reviewed translation");
  assert.doesNotMatch(authorChangedText, /L\["Removed"\]/, "a removed source key is pruned");
  delete require.cache[require.resolve(toolPath)];
  delete process.env.ZHCN_ROOT;
  delete process.env.ZHCN_KEYS_FILE;
  fs.rmSync(authorRoot, { recursive: true, force: true });
  fs.rmSync(path.join(root, "tools", "reports"), { recursive: true, force: true });
  delete require.cache[require.resolve(toolPath)];

  // A stale English value persisted by an earlier run must not be reused as
  // translation memory; otherwise no HTTP request is made and the job loops.
  const retryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhcn-retry-"));
  fs.mkdirSync(path.join(retryRoot, "Locales"), { recursive: true });
  fs.writeFileSync(path.join(retryRoot, "keys.txt"), JSON.stringify("Search") + "\n", "utf8");
  fs.writeFileSync(path.join(retryRoot, "Locales", "zhCN.lua"), 'L["Search"] = "Search"\n', "utf8");
  process.env.ZHCN_ROOT = retryRoot;
  process.env.ZHCN_KEYS_FILE = path.join(retryRoot, "keys.txt");
  process.env.API_KEY = "retry-key";
  process.env.OPENAI_MODEL = "test-model";
  delete require.cache[require.resolve(toolPath)];
  const { requestBatch: retryBatch } = require(toolPath);
  const retried = await retryBatch([["Search", "Some.lua:1"]], { exact: new Map() }, {
    retries: 1,
    fetchImpl: async (_url, options) => {
      const rows = JSON.parse(JSON.parse(options.body).messages[1].content).strings_to_translate;
      assert.equal(rows.some((r) => r.original_english === "Search"), true, "a pure-English value must be retranslated");
      return fakeResponse(200, completion(JSON.stringify({ Search: "搜索" })));
    },
  });
  assert.deepEqual(retried, { Search: "搜索" });
  delete process.env.ZHCN_ROOT;
  delete process.env.ZHCN_KEYS_FILE;
  fs.rmSync(retryRoot, { recursive: true, force: true });
  fs.rmSync(path.join(root, "tools", "reports"), { recursive: true, force: true });
  delete require.cache[require.resolve(toolPath)];

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
        assert.doesNotMatch(payload.messages[0].content, /Match the reviewed tone of the #138 auction-house and loot-roll strings/);
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
    let deferredError;
    try {
      await requestBatch([["Ready", "Some.lua:10"]], { exact: new Map() }, {
        retries: 2,
        wait: async () => {},
        fetchImpl: async () => {
          calls += 1;
          return fakeResponse(503, "still down");
        },
      });
    } catch (e) {
      deferredError = e;
    }
    assert.match(deferredError && deferredError.message, /failed after 2 attempts/);
    assert.equal(deferredError && deferredError.deferred, true, "a temporary API failure must be deferred");
    assert.equal(deferredError && deferredError.status, 503);
    assert.equal(calls, 2);

    let deterministicError;
    try {
      await requestBatch([["Ready", "Some.lua:10"]], { exact: new Map() }, {
        retries: 3,
        wait: async () => {},
        fetchImpl: async () => {
          calls += 1;
          return fakeResponse(200, completion(JSON.stringify({ Ready: "Ready." })));
        },
      });
    } catch (e) {
      deterministicError = e;
    }
    assert.match(deterministicError && deterministicError.message, /left the string in English/);
    assert.notEqual(deterministicError && deterministicError.deferred, true, "a quality failure must not be deferred");

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
      fetchImpl: async () => {
        calls += 1;
        return fakeResponse(200, completion(JSON.stringify({ CompletelyDifferent: "就绪" })));
      },
    }), /AI omitted/);
    assert.equal(calls, 1, "a single-key response under the wrong key must not be accepted");

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


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
  const { requestOnce, requestBatch, readGlossary, retryable } = require(toolPath);

  const glossary = readGlossary();
  assert.equal(glossary["Focus Target"], "焦点目标");
  assert.equal(glossary["tooltip"], "鼠标提示");

  assert.equal(retryable({ status: 429 }), true);
  assert.equal(retryable({ status: 503 }), true);
  assert.equal(retryable({ status: 400 }), false);
  assert.equal(retryable({ status: 401 }), false);

  const oldKey = process.env.API_KEY;
  const oldBase = process.env.OPENAI_BASE_URL;
  const oldModel = process.env.OPENAI_MODEL;
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
  } finally {
    if (oldKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = oldKey;
    if (oldBase === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = oldBase;
    if (oldModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = oldModel;
  }

  console.log("zhCN tool tests: glossary path, request body, retry and failure handling passed");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
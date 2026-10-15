const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const assistantRoutes = require("../src/assistant/routes");

async function withAssistantServer(run) {
  const app = express();
  app.use(express.json());
  app.use("/api/assistant", assistantRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("assistant clearly reports missing provider configuration", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;

  try {
    await withAssistantServer(async (baseUrl) => {
      const statusResponse = await fetch(`${baseUrl}/api/assistant/status`);
      assert.equal(statusResponse.status, 200);
      assert.deepEqual(await statusResponse.json(), { configured: false });

      const response = await fetch(`${baseUrl}/api/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "General health education question", language: "en" }),
      });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        code: "AI_NOT_CONFIGURED",
        error: "The administrator has not configured the assistant provider.",
      });
    });
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalModel;
  }
});

test("assistant rejects empty or unsupported requests before provider access", async () => {
  await withAssistantServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "  ", language: "en" }),
    });
    assert.equal(response.status, 400);
  });
});

test("assistant calls a configured HTTPS provider without logging or returning credentials", async () => {
  const savedEnvironment = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
    endpoint: process.env.OPENAI_BASE_URL,
  };
  const originalFetch = global.fetch;
  let providerRequest;
  process.env.OPENAI_API_KEY = "test-only-not-a-real-secret";
  process.env.OPENAI_MODEL = "test-model";
  process.env.OPENAI_BASE_URL = "https://provider.example.test/v1/chat/completions";
  global.fetch = async (url, options) => {
    providerRequest = { url: String(url), options };
    return new Response(JSON.stringify({
      choices: [{ message: { content: "General educational reply." } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await withAssistantServer(async (baseUrl) => {
      const response = await originalFetch(`${baseUrl}/api/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "A general question", language: "en" }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { reply: "General educational reply." });
    });
    assert.equal(providerRequest.url, process.env.OPENAI_BASE_URL);
    assert.equal(providerRequest.options.headers.Authorization, `Bearer ${process.env.OPENAI_API_KEY}`);
    const requestBody = JSON.parse(providerRequest.options.body);
    assert.equal(requestBody.messages[0].role, "system");
    assert.equal(requestBody.messages[1].content, "A general question");
  } finally {
    global.fetch = originalFetch;
    if (savedEnvironment.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedEnvironment.key;
    if (savedEnvironment.model === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = savedEnvironment.model;
    if (savedEnvironment.endpoint === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = savedEnvironment.endpoint;
  }
});

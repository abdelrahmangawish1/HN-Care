const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const medicationRoutes = require("../src/medications/routes");

async function withMedicationServer(run) {
  const app = express();
  app.use("/api/medications", medicationRoutes);
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

function label(name, drugInteractions) {
  return {
    results: [{
      id: `label-${name}`,
      openfda: { generic_name: [name.toUpperCase()] },
      drug_interactions: [drugInteractions],
    }],
  };
}

test("interaction endpoint validates names before querying FDA", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => {
    called = true;
    throw new Error("Unexpected FDA request");
  };
  try {
    await withMedicationServer(async (baseUrl) => {
      const response = await originalFetch(`${baseUrl}/api/medications/interactions?medications=warfarin`);
      assert.equal(response.status, 400);
    });
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("interaction endpoint returns only explicit FDA label mentions with source excerpts", async () => {
  const originalFetch = global.fetch;
  const requestedUrls = [];
  global.fetch = async (url) => {
    requestedUrls.push(String(url));
    const name = new URL(url).searchParams.get("search").split(":")[1].replaceAll('"', "");
    const body = name === "aspirin"
      ? label("aspirin", "Drug interactions include warfarin, which may increase bleeding risk.")
      : label("warfarin", "Monitor treatment and consult the full prescribing information.");
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    await withMedicationServer(async (baseUrl) => {
      const query = new URLSearchParams({ medications: "aspirin|warfarin" });
      const response = await originalFetch(`${baseUrl}/api/medications/interactions?${query}`);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.medications.length, 2);
      assert.equal(result.interactions.length, 1);
      assert.equal(result.interactions[0].warning, "label-mentions-combination");
      assert.match(result.interactions[0].excerpt, /warfarin/i);
      assert.match(result.interactions[0].sourceUrl, /^https:\/\/api\.fda\.gov\//);
      assert.match(result.note, /does not mean a combination is safe/);
    });
    assert.equal(requestedUrls.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("interaction endpoint does not report an unmentioned pair as a found interaction", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const name = new URL(url).searchParams.get("search").split(":")[1].replaceAll('"', "");
    return new Response(JSON.stringify(label(name, "Review the complete prescribing information.")), { status: 200 });
  };
  try {
    await withMedicationServer(async (baseUrl) => {
      const query = new URLSearchParams({ medications: "medicine one|medicine two" });
      const response = await originalFetch(`${baseUrl}/api/medications/interactions?${query}`);
      const result = await response.json();
      assert.equal(result.interactions.length, 0);
      assert.match(result.note, /no mention does not mean a combination is safe/);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("interaction endpoint reports upstream failures explicitly", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response("unavailable", { status: 503 });
  try {
    await withMedicationServer(async (baseUrl) => {
      const query = new URLSearchParams({ medications: "aspirin|warfarin" });
      const response = await originalFetch(`${baseUrl}/api/medications/interactions?${query}`);
      assert.equal(response.status, 502);
      assert.equal((await response.json()).code, "INTERACTION_SOURCE_UNAVAILABLE");
    });
  } finally {
    global.fetch = originalFetch;
  }
});

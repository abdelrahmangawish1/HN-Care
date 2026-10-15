const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pharmacyRoutes = require("../src/pharmacies/routes");

async function withPharmacyServer(run) {
  const app = express();
  app.use(express.json());
  app.use("/api/pharmacies", pharmacyRoutes);
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

test("pharmacy endpoint validates location and radius before contacting Overpass", async () => {
  const originalFetch = global.fetch;
  let upstreamCalled = false;
  global.fetch = async () => {
    upstreamCalled = true;
    throw new Error("Unexpected upstream request");
  };
  try {
    await withPharmacyServer(async (baseUrl) => {
      const response = await originalFetch(`${baseUrl}/api/pharmacies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: 95, longitude: 0, radiusKm: 3 }),
      });
      assert.equal(response.status, 400);
    });
    assert.equal(upstreamCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("pharmacy endpoint returns bounded OpenStreetMap pharmacy details", async () => {
  const originalFetch = global.fetch;
  let upstreamRequest;
  global.fetch = async (url, options) => {
    upstreamRequest = { url: String(url), options };
    return new Response(JSON.stringify({
      elements: [{
        id: 123,
        type: "node",
        lat: 48.85,
        lon: 2.35,
        tags: {
          amenity: "pharmacy",
          name: "Example Pharmacy",
          "addr:city": "Paris",
          opening_hours: "24/7",
          website: "https://example.test",
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await withPharmacyServer(async (baseUrl) => {
      const response = await originalFetch(`${baseUrl}/api/pharmacies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: 48.85, longitude: 2.35, radiusKm: 3 }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        elements: [{
          id: 123,
          type: "node",
          lat: 48.85,
          lon: 2.35,
          tags: {
            amenity: "pharmacy",
            name: "Example Pharmacy",
            "addr:city": "Paris",
            opening_hours: "24/7",
            website: "https://example.test",
          },
        }],
      });
    });
    assert.equal(upstreamRequest.url, "https://overpass-api.de/api/interpreter");
    assert.equal(upstreamRequest.options.headers.Accept, "application/json");
    assert.equal(upstreamRequest.options.headers["User-Agent"], "HN-Care/1.0 (pharmacy map)");
    assert.match(upstreamRequest.options.body.get("data"), /"amenity"="pharmacy"/);
    assert.match(upstreamRequest.options.body.get("data"), /around:3000,48\.85,2\.35/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("medical facility search queries hospitals, clinics, doctors, and emergency stations", async () => {
  const originalFetch = global.fetch;
  let queryText = "";
  global.fetch = async (_url, options) => {
    queryText = options.body.get("data");
    return new Response(JSON.stringify({ elements: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await withPharmacyServer(async (baseUrl) => {
      const response = await originalFetch(`${baseUrl}/api/pharmacies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: 30.0444,
          longitude: 31.2357,
          radiusKm: 5,
          facilityType: "medical",
        }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { elements: [] });
    });
    assert.match(queryText, /"amenity"="hospital"/);
    assert.match(queryText, /"amenity"="clinic"/);
    assert.match(queryText, /"amenity"="doctors"/);
    assert.match(queryText, /"amenity"="ambulance_station"/);
    assert.match(queryText, /"emergency"="ambulance_station"/);
    assert.match(queryText, /"healthcare"="hospital"/);
    assert.match(queryText, /around:5000,30\.0444,31\.2357/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("pharmacy endpoint rejects unknown facility types", async () => {
  const originalFetch = global.fetch;
  let upstreamCalled = false;
  global.fetch = async () => {
    upstreamCalled = true;
    throw new Error("Unexpected upstream request");
  };
  try {
    await withPharmacyServer(async (baseUrl) => {
      const response = await originalFetch(`${baseUrl}/api/pharmacies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: 30,
          longitude: 31,
          radiusKm: 5,
          facilityType: "anything",
        }),
      });
      assert.equal(response.status, 400);
    });
    assert.equal(upstreamCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("pharmacy endpoint reports an upstream outage without leaking provider details", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response("upstream details", { status: 503 });
  try {
    await withPharmacyServer(async (baseUrl) => {
      const response = await originalFetch(`${baseUrl}/api/pharmacies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: 48.85, longitude: 2.35, radiusKm: 3 }),
      });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        error: "Healthcare location data is temporarily unavailable.",
      });
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("place lookup validates input and returns geocoded coordinates", async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify([{ lat: "48.8566", lon: "2.3522" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await withPharmacyServer(async (baseUrl) => {
      const invalid = await originalFetch(`${baseUrl}/api/pharmacies/geocode?q=&language=en`);
      assert.equal(invalid.status, 400);

      const response = await originalFetch(
        `${baseUrl}/api/pharmacies/geocode?q=Paris%2C%20France&language=fr`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { latitude: 48.8566, longitude: 2.3522 });
    });
    assert.equal(request.url, "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=Paris%2C+France");
    assert.equal(request.options.headers["Accept-Language"], "fr");
    assert.match(request.options.headers["User-Agent"], /^HN-Care\//);
  } finally {
    global.fetch = originalFetch;
  }
});

const express = require("express");
const { rateLimit } = require("express-rate-limit");

const router = express.Router();
const pharmacyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const pharmacyTags = [
  "amenity",
  "healthcare",
  "emergency",
  "name",
  "name:en",
  "name:ar",
  "addr:street",
  "addr:housenumber",
  "addr:city",
  "opening_hours",
  "phone",
  "website",
];

const geocodingLanguages = {
  en: "en",
  ar: "ar",
  fr: "fr",
  it: "it",
  zh: "zh-CN",
};

router.get("/geocode", pharmacyRateLimit, async (request, response) => {
  const place = typeof request.query.q === "string" ? request.query.q.trim() : "";
  const language = typeof request.query.language === "string"
    ? geocodingLanguages[request.query.language]
    : "en";
  if (!place || place.length > 160 || !language) {
    response.status(400).json({ error: "Enter a place and supported language." });
    return;
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ format: "jsonv2", limit: "1", q: place }).toString();
  try {
    const upstream = await fetch(url, {
      headers: {
        "Accept-Language": language,
        "User-Agent": "HN-Care/1.0 (pharmacy map search)",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      console.error("Nominatim returned HTTP", upstream.status);
      response.status(502).json({ error: "Place lookup is temporarily unavailable." });
      return;
    }
    const [result] = await upstream.json();
    if (!result) {
      response.json({ location: null });
      return;
    }
    const latitude = Number(result.lat);
    const longitude = Number(result.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      response.status(502).json({ error: "Place lookup returned invalid coordinates." });
      return;
    }
    response.json({ latitude, longitude });
  } catch (error) {
    console.error("Nominatim request failed:", error.name || "unknown error");
    response.status(502).json({ error: "Place lookup is temporarily unavailable." });
  }
});

router.post("/", pharmacyRateLimit, async (request, response) => {
  const { latitude, longitude, radiusKm, facilityType = "pharmacy" } = request.body || {};
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    typeof radiusKm !== "number" ||
    !Number.isFinite(radiusKm) ||
    radiusKm < 1 ||
    radiusKm > 20 ||
    !["pharmacy", "medical"].includes(facilityType)
  ) {
    response.status(400).json({ error: "A valid location and search radius are required." });
    return;
  }

  const radiusMeters = Math.round(radiusKm * 1000);
  const around = `(around:${radiusMeters},${latitude},${longitude})`;
  const targets = facilityType === "pharmacy"
    ? [`node["amenity"="pharmacy"]${around};`, `way["amenity"="pharmacy"]${around};`, `relation["amenity"="pharmacy"]${around};`]
    : [
        ...["hospital", "clinic", "doctors", "health_centre", "ambulance_station"]
          .flatMap((amenity) => [
            `node["amenity"="${amenity}"]${around};`,
            `way["amenity"="${amenity}"]${around};`,
            `relation["amenity"="${amenity}"]${around};`,
          ]),
        ...["hospital", "clinic", "doctor", "centre"]
          .flatMap((healthcare) => [
            `node["healthcare"="${healthcare}"]${around};`,
            `way["healthcare"="${healthcare}"]${around};`,
            `relation["healthcare"="${healthcare}"]${around};`,
          ]),
        `node["emergency"="ambulance_station"]${around};`,
        `way["emergency"="ambulance_station"]${around};`,
        `relation["emergency"="ambulance_station"]${around};`,
      ];
  const queryText = `[out:json][timeout:25];(${targets.join("")});out center tags 200;`;
  try {
    const upstream = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": "HN-Care/1.0 (pharmacy map)",
      },
      body: new URLSearchParams({ data: queryText }),
      signal: AbortSignal.timeout(30000),
    });
    if (!upstream.ok) {
      console.error("Overpass returned HTTP", upstream.status);
      response.status(502).json({ error: "Healthcare location data is temporarily unavailable." });
      return;
    }
    const result = await upstream.json();
    if (!Array.isArray(result.elements)) {
      response.status(502).json({ error: "Healthcare location data was invalid." });
      return;
    }

    const elements = result.elements.slice(0, 200).flatMap((entry) => {
      const point = entry.center || entry;
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return [];
      const tags = {};
      for (const key of pharmacyTags) {
        if (typeof entry.tags?.[key] === "string") tags[key] = entry.tags[key].slice(0, 250);
      }
      return [{
        id: entry.id,
        type: entry.type,
        lat: point.lat,
        lon: point.lon,
        tags,
      }];
    });
    response.json({ elements });
  } catch (error) {
    console.error("Overpass request failed:", error.name || "unknown error");
    response.status(502).json({ error: "Healthcare location data is temporarily unavailable." });
  }
});

module.exports = router;

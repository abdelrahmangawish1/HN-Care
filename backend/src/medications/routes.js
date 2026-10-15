const express = require("express");
const { rateLimit } = require("express-rate-limit");

const router = express.Router();
const interactionRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const FDA_LABEL_API = "https://api.fda.gov/drug/label.json";
const MAX_MEDICATIONS = 5;

function normalizeName(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionedName(section, names) {
  const normalizedSection = section.toLocaleLowerCase();
  return names.some((name) => {
    const normalized = normalizeName(name);
    if (normalized.length < 2) return false;
    const expression = new RegExp(`(^|[^a-z0-9])${escapeRegex(normalized).replace(/\s+/g, "\\s+")}($|[^a-z0-9])`, "i");
    return expression.test(normalizedSection);
  });
}

function matchingSentences(section, names) {
  const sentences = section.match(/[^.!?]+(?:[.!?]+|$)/g) || [section];
  const matching = sentences.filter((sentence) => mentionedName(sentence, names));
  return matching.join(" ").trim().slice(0, 1200);
}

function sourceWarning(section) {
  if (/\bcontraindicat(?:ed|ion|ions)\b|\bshould not be used with\b|\bavoid concomitant(?:ly)?\b/i.test(section)) {
    return "avoid-combination";
  }
  return "label-mentions-combination";
}

async function fetchDrugLabel(name) {
  const normalized = normalizeName(name);
  const queryTerm = normalized.replace(/"/g, "");
  if (!queryTerm) return null;

  for (const field of ["openfda.generic_name", "openfda.brand_name"]) {
    const url = new URL(FDA_LABEL_API);
    url.searchParams.set("search", `${field}:"${queryTerm}"`);
    url.searchParams.set("limit", "1");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (response.status === 404) continue;
      if (!response.ok) {
        console.error("FDA label service returned HTTP", response.status);
        throw new Error("FDA_LABEL_UNAVAILABLE");
      }
      const result = await response.json();
      const label = result.results?.[0];
      if (label) {
        return {
          id: label.id,
          genericNames: label.openfda?.generic_name || [],
          brandNames: label.openfda?.brand_name || [],
          interactionText: (label.drug_interactions || []).join("\n").slice(0, 30000),
          labelUrl: `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(`${field}:"${queryTerm}"`)}&limit=1`,
        };
      }
    } catch (error) {
      if (error.message === "FDA_LABEL_UNAVAILABLE") throw error;
      console.error("FDA label lookup failed:", error.name || "unknown error");
      throw new Error("FDA_LABEL_UNAVAILABLE");
    }
  }
  return null;
}

router.get("/interactions", interactionRateLimit, async (request, response) => {
  const medications = typeof request.query.medications === "string"
    ? request.query.medications.split("|").map((name) => name.trim())
    : [];
  const uniqueNames = [...new Map(medications.map((name) => [normalizeName(name), name])).values()];
  if (
    uniqueNames.length < 2 ||
    uniqueNames.length > MAX_MEDICATIONS ||
    uniqueNames.some((name) => name.length < 2 || name.length > 80 || !/^[\p{Script=Latin}\p{N} .+'()/-]+$/u.test(name))
  ) {
    response.status(400).json({
      error: `Enter between 2 and ${MAX_MEDICATIONS} valid medication names.`,
    });
    return;
  }

  try {
    const labels = await Promise.all(uniqueNames.map(fetchDrugLabel));
    const matchedMedications = uniqueNames.map((name, index) => ({
      name,
      found: Boolean(labels[index]),
    }));
    const interactions = [];

    for (let first = 0; first < uniqueNames.length; first += 1) {
      for (let second = first + 1; second < uniqueNames.length; second += 1) {
        const candidates = [
          { index: first, counterpart: second },
          { index: second, counterpart: first },
        ];
        for (const { index, counterpart } of candidates) {
          const label = labels[index];
          if (!label?.interactionText) continue;
          const counterpartNames = [
            uniqueNames[counterpart],
            ...(labels[counterpart]?.genericNames || []),
            ...(labels[counterpart]?.brandNames || []),
          ];
          const excerpt = matchingSentences(label.interactionText, counterpartNames);
          if (!excerpt) continue;
          interactions.push({
            medications: [uniqueNames[first], uniqueNames[second]],
            sourceMedication: uniqueNames[index],
            warning: sourceWarning(excerpt),
            excerpt,
            source: "U.S. FDA drug label (openFDA)",
            sourceUrl: label.labelUrl,
          });
          break;
        }
      }
    }

    response.json({
      source: "U.S. FDA drug labels via openFDA",
      medications: matchedMedications,
      interactions,
      note: "FDA labels are not a complete interaction checker. A label mention is not a personalized severity assessment, and no mention does not mean a combination is safe.",
    });
  } catch {
    response.status(502).json({
      code: "INTERACTION_SOURCE_UNAVAILABLE",
      error: "FDA drug label information is temporarily unavailable.",
    });
  }
});

module.exports = router;

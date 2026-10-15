const express = require("express");
const { rateLimit } = require("express-rate-limit");

const router = express.Router();
const assistantRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many assistant requests. Try again later." },
});

const supportedLanguages = new Set(["en", "ar", "fr", "it", "zh"]);
const systemInstruction = [
  "You provide general health education only.",
  "Do not diagnose, prescribe, recommend doses, or tell users to start, stop, or change treatment.",
  "Encourage users to consult a qualified healthcare professional for personal medical decisions.",
  "For possible emergencies, advise contacting local emergency services immediately.",
  "State uncertainty and do not invent medical facts or sources.",
  "Do not request or infer personal health records.",
].join(" ");

router.get("/status", (_request, response) => {
  response.json({
    configured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
  });
});

router.post("/", assistantRateLimit, async (request, response) => {
  const message = typeof request.body?.message === "string" ? request.body.message.trim() : "";
  const language = typeof request.body?.language === "string" ? request.body.language : "en";
  if (!message || message.length > 2000 || !supportedLanguages.has(language)) {
    response.status(400).json({ error: "Enter a valid message and supported language." });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) {
    response.status(503).json({
      code: "AI_NOT_CONFIGURED",
      error: "The administrator has not configured the assistant provider.",
    });
    return;
  }

  const configuredEndpoint = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions";
  let endpoint;
  try {
    endpoint = new URL(configuredEndpoint);
  } catch {
    response.status(500).json({ error: "Assistant provider configuration is invalid." });
    return;
  }
  if (endpoint.protocol !== "https:") {
    response.status(500).json({ error: "Assistant provider endpoint must use HTTPS." });
    return;
  }

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: "system", content: `${systemInstruction} Respond in language code ${language}.` },
          { role: "user", content: message },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!upstream.ok) {
      console.error("Assistant provider returned HTTP", upstream.status);
      response.status(502).json({ error: "The assistant provider is unavailable." });
      return;
    }
    const result = await upstream.json();
    const reply = result?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      response.status(502).json({ error: "The assistant provider returned an empty response." });
      return;
    }
    response.json({ reply: reply.trim() });
  } catch (error) {
    console.error("Assistant provider request failed:", error.name || "unknown error");
    response.status(502).json({ error: "The assistant provider is unavailable." });
  }
});

module.exports = router;

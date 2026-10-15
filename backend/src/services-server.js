const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const express = require("express");
const helmet = require("helmet");
const assistantRoutes = require("./assistant/routes");
const pharmacyRoutes = require("./pharmacies/routes");
const medicationRoutes = require("./medications/routes");

const app = express();
const port = Number(process.env.API_PORT) || 3001;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://www.gstatic.com", "https://www.googletagmanager.com", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org", "https://unpkg.com"],
      connectSrc: [
        "'self'",
        "https://*.googleapis.com",
        "https://www.google-analytics.com",
        "https://www.googletagmanager.com",
        "https://region1.google-analytics.com",
        "https://rxnav.nlm.nih.gov",
      ],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: "8kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "HN-Care public API" });
});
app.use("/api/assistant", assistantRoutes);
app.use("/api/pharmacies", pharmacyRoutes);
app.use("/api/medications", medicationRoutes);
app.use(express.static(path.resolve(__dirname, "../../Frontend/dist")));

app.listen(port, () => {
  console.log(`HN-Care API listening on http://localhost:${port}`);
});

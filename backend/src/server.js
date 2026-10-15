require("dotenv").config();

const express = require("express");
const path = require("node:path");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const helmet = require("helmet");
const pool = require("./config/database");
const authRoutes = require("./auth/routes");
const assistantRoutes = require("./assistant/routes");
const pharmacyRoutes = require("./pharmacies/routes");

const app = express();
const port = Number(process.env.PORT) || 3000;
const sessionSecret = process.env.SESSION_SECRET;

if (
  !sessionSecret ||
  sessionSecret.length < 32 ||
  sessionSecret === "replace_with_a_random_secret_generated_for_this_installation"
) {
  throw new Error(
    "SESSION_SECRET is missing or too short. Generate a random secret and set it in backend/.env.",
  );
}

const PostgreSqlSessionStore = connectPgSimple(session);

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
        "https://nominatim.openstreetmap.org",
        "https://rxnav.nlm.nih.gov",
      ],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: "16kb" }));
app.use(
  session({
    name: "hncare.sid",
    store: new PostgreSqlSessionStore({
      pool,
      createTableIfMissing: true,
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "HN-Care API" });
});

app.get("/api/db-health", async (_request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/assistant", assistantRoutes);
app.use("/api/pharmacies", pharmacyRoutes);
app.use(express.static(path.resolve(__dirname, "../../Frontend/dist")));

app.use((error, _request, response, _next) => {
  console.error("Request failed:", error);
  response.status(500).json({ error: "حدث خطأ غير متوقع. حاول مرة أخرى." });
});

app.listen(port, () => {
  console.log(`HN-Care API listening on http://localhost:${port}`);
});

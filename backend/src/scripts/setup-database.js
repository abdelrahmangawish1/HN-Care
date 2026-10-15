require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("../config/database");

async function setupDatabase() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "db",
    "migrations",
    "001_create_users.sql",
  );

  try {
    const migration = await fs.readFile(migrationPath, "utf8");
    await pool.query(migration);
    console.log("Database setup completed: users table is ready.");
  } catch (error) {
    const details =
      error instanceof Error
        ? error.message || error.stack || error.name
        : String(error);
    console.error("Database setup failed:", details);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

setupDatabase();

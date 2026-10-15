require("dotenv").config();

const pool = require("../config/database");

const message =
  process.argv.slice(2).join(" ") || "HN-Care database connection test";

async function checkDatabase() {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database_name, $1::text AS message",
      [message],
    );

    console.log("Connected to database:", result.rows[0].database_name);
    console.log("Parameterized value returned:", result.rows[0].message);
  } catch (error) {
    const details =
      error instanceof Error
        ? error.message || error.stack || error.name
        : String(error);
    console.error("Database connection check failed:", details);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

checkDatabase();

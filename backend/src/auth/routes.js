const express = require("express");
const { rateLimit } = require("express-rate-limit");
const pool = require("../config/database");
const { hashPassword, verifyPassword } = require("./passwords");

const router = express.Router();
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "تجاوزت عدد المحاولات. حاول مرة أخرى لاحقاً." },
});

function publicUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
  };
}

function validateCredentials(body, includeName) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "أدخل بيانات الحساب المطلوبة.";
  }

  if (
    includeName &&
    (typeof body.fullName !== "string" ||
      body.fullName.trim().length < 2 ||
      body.fullName.trim().length > 100)
  ) {
    return "يجب أن يكون الاسم بين حرفين و100 حرف.";
  }

  if (
    typeof body.email !== "string" ||
    body.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
  ) {
    return "أدخل بريداً إلكترونياً صالحاً.";
  }

  if (
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    body.password.length > 128
  ) {
    return "يجب أن تتكون كلمة المرور من 12 إلى 128 حرفاً.";
  }

  return null;
}

function saveNewSession(request, userId) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((regenerateError) => {
      if (regenerateError) {
        reject(regenerateError);
        return;
      }

      request.session.userId = String(userId);
      request.session.save((saveError) => {
        if (saveError) {
          reject(saveError);
          return;
        }

        resolve();
      });
    });
  });
}

router.post("/register", authRateLimit, async (request, response, next) => {
  const validationError = validateCredentials(request.body, true);
  if (validationError) {
    response.status(400).json({ error: validationError });
    return;
  }

  const fullName = request.body.fullName.trim();
  const email = request.body.email.trim().toLowerCase();

  try {
    const passwordHash = await hashPassword(request.body.password);
    const result = await pool.query(
      `INSERT INTO users (full_name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, full_name, email`,
      [fullName, email, passwordHash],
    );

    await saveNewSession(request, result.rows[0].id);
    response.status(201).json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    if (error.code === "23505") {
      response.status(409).json({ error: "تعذر إنشاء الحساب بهذه البيانات." });
      return;
    }
    next(error);
  }
});

router.post("/login", authRateLimit, async (request, response, next) => {
  const validationError = validateCredentials(request.body, false);
  if (validationError) {
    response.status(400).json({ error: validationError });
    return;
  }

  const email = request.body.email.trim().toLowerCase();

  try {
    const result = await pool.query(
      `SELECT id, full_name, email, password_hash
       FROM users
       WHERE email = $1`,
      [email],
    );

    const user = result.rows[0];
    if (!user || !(await verifyPassword(request.body.password, user.password_hash))) {
      response.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة." });
      return;
    }

    await saveNewSession(request, user.id);
    response.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", (request, response, next) => {
  if (!request.session) {
    response.sendStatus(204);
    return;
  }

  request.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }

    response.clearCookie("hncare.sid");
    response.sendStatus(204);
  });
});

router.get("/me", async (request, response, next) => {
  if (!request.session.userId) {
    response.status(401).json({ error: "يلزم تسجيل الدخول." });
    return;
  }

  try {
    const result = await pool.query(
      "SELECT id, full_name, email FROM users WHERE id = $1",
      [request.session.userId],
    );

    if (!result.rows[0]) {
      request.session.destroy(() => {});
      response.status(401).json({ error: "يلزم تسجيل الدخول." });
      return;
    }

    response.json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

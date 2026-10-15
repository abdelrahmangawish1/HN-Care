const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, verifyPassword } = require("../src/auth/passwords");

test("password hashes can be verified without storing the original password", async () => {
  const password = "a-long-example-password";
  const storedHash = await hashPassword(password);

  assert.notEqual(storedHash, password);
  assert.match(storedHash, /^[a-f0-9]{32}:[a-f0-9]{128}$/i);
  assert.equal(await verifyPassword(password, storedHash), true);
  assert.equal(await verifyPassword("a-different-password", storedHash), false);
});

test("malformed stored hashes are rejected", async () => {
  assert.equal(await verifyPassword("password", "not-a-valid-hash"), false);
});

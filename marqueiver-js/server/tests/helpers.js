/**
 * Integration test harness (scope §19).
 *
 * These tests run against a **real MongoDB** and a real Express app — they are
 * the "test role-based access from both UI and direct API requests" and "test
 * campaign/deal state transitions so invalid actions cannot be performed"
 * requirements from §19, which code review alone cannot satisfy.
 *
 * No test framework is installed: Node's built-in runner is used, so there is
 * nothing new to add to package.json.
 *
 *   MONGO_URI="mongodb://127.0.0.1:27017/marqueiver_test" npm test
 *
 * IMPORTANT: point MONGO_URI at a scratch database. `resetDb()` drops
 * collections between tests and will destroy data in whatever database it is
 * given. It refuses to run against a URI whose database name does not contain
 * "test" as a guard against pointing it at production by accident.
 */
import http from 'node:http';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { signAccess } from '../src/utils/tokens.js';
import { User } from '../src/models/index.js';

let server;
let baseUrl;

export async function startTestServer() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('Set MONGO_URI to a scratch database before running tests.');

  const dbName = uri.split('/').pop().split('?')[0];
  if (!/test/i.test(dbName))
    throw new Error(
      `Refusing to run: database "${dbName}" does not look like a test database. ` +
      'These tests drop collections. Use a database with "test" in its name.',
    );

  if (mongoose.connection.readyState === 0)
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  server = http.createServer(createApp());
  await new Promise((res) => server.listen(0, res));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

export async function stopTestServer() {
  if (server) await new Promise((res) => server.close(res));
  if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
}

/** Wipe every collection between tests so cases cannot leak into each other. */
export async function resetDb() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

/**
 * Create a user and return a ready-to-use bearer token. Tokens are signed
 * directly rather than going through the OTP flow — these tests are about
 * authorization, not about re-testing login on every case.
 */
export async function makeUser(role, overrides = {}) {
  const user = await User.create({
    role,
    phone: `+9199${Math.floor(1000000 + Math.random() * 8999999)}`,
    onboardingComplete: true,
    ...overrides,
  });
  const token = signAccess({ sub: user.id, role });
  return { user, token, id: user.id };
}

/** Thin fetch wrapper that returns status and parsed body together. */
export async function call(method, path, { token, body } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body is fine */ }
  return { status: res.status, body: json };
}

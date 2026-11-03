// Use the runtime and bundler shipped with the locked Wrangler version.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { pbkdf2Sync } from "node:crypto";

const require = createRequire(import.meta.url);
const wranglerRoot = dirname(require.resolve("wrangler/package.json"));
const runtime = await import(pathToFileURL(require.resolve("miniflare", { paths: [wranglerRoot] })));
const { build } = await import(pathToFileURL(require.resolve("esbuild", { paths: [wranglerRoot] })));
const { Miniflare } = runtime;
const serve = process.argv.includes("--serve");
const base = serve ? "http://127.0.0.1:5173/kintore-log" : "https://example.com/kintore-log";
const origin = new URL(base).origin;
const { outputFiles } = await build({
  entryPoints: ["worker/index.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});
const options = {
  modules: true,
  script: outputFiles[0].text,
  compatibilityDate: "2026-09-15",
  d1Databases: { DB: "oauth-isolated-test" },
  serviceBindings: {
    ASSETS: () => new Response('<link rel="stylesheet" href="/kintore-log/assets/index-test.css">'),
  },
  port: serve ? 8787 : 0,
  bindings: {
    OAUTH_ENABLED: "true",
    OAUTH_ISSUER: base,
  },
};
const mf = new Miniflare(
  runtime.convertV4MiniflareOptions ? runtime.convertV4MiniflareOptions(options) : options,
);

const hash = async (value) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const verifier = "v".repeat(43);
const challenge = Buffer.from(
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
).toString("base64url");
const callback = "https://muse.example/callback";
async function call(path, user = 1, { method = "GET", json, form, headers = {} } = {}) {
  return mf.dispatchFetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(user ? { cookie: `kintore_session=d1-session-${user}` } : {}),
      ...(json
        ? { "content-type": "application/json" }
        : form
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {}),
      ...headers,
    },
    body: json ? JSON.stringify(json) : form ? new URLSearchParams(form).toString() : undefined,
  });
}
async function mutate(path, user, json, method = "POST") {
  const { csrfToken } = await (await call("/api/oauth/csrf", user)).json();
  return call(path, user, { method, json, headers: { origin, "x-csrf-token": csrfToken } });
}

let serving = false;
try {
  const db = await mf.getD1Database("DB");
  const runSql = (sql) =>
    db.batch(
      sql
        .replace(/^\s*--.*$/gm, "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => db.prepare(part)),
    );
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    // These migrations contain no triggers or semicolons inside literals.
    await runSql(readFileSync(new URL(file, migrations), "utf8"));
  }
  const salt = "0123456789abcdef0123456789abcdef";
  const passwordHash = pbkdf2Sync(
    "oauth-test-password",
    Buffer.from(salt, "hex"),
    100000,
    32,
    "sha256",
  ).toString("hex");
  for (const id of [1, 2]) {
    await db
      .prepare(
        "INSERT INTO users (id, account_name, password_hash, password_salt, is_admin) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(id, `oauth-test-${id}`, passwordHash, salt, id === 1 ? 1 : 0)
      .run();
    await db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, '9999-01-01')")
      .bind(await hash(`d1-session-${id}`), id)
      .run();
    await db
      .prepare(
        "INSERT INTO workout_records (user_id, exercise_id, workout_date, weight_kg, reps, sets) VALUES (?, 1, '2026-10-01', ?, 10, 3)",
      )
      .bind(id, id === 1 ? 60 : 999)
      .run();
  }
  const registration = await mutate("/api/admin/oauth/clients", 1, {
    name: "D1 test Muse",
    authMethod: "none",
    redirectUris: [callback],
  });
  assert.equal(registration.status, 201);
  const { clientId } = await registration.json();
  async function getCode(user) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callback,
      response_type: "code",
      scope: "workouts:read",
      state: "d1-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const page = await call(`/oauth/authorize?${params}`, user);
    assert.equal(page.status, 200);
    const html = await page.text();
    const response = await call("/oauth/authorize", user, {
      method: "POST",
      headers: { origin },
      form: {
        request: html.match(/name="request" value="([^"]+)"/)[1],
        csrf: html.match(/name="csrf" value="([^"]+)"/)[1],
        decision: "allow",
      },
    });
    assert.equal(response.status, 303);
    return new URL(response.headers.get("location")).searchParams.get("code");
  }
  function exchange(code) {
    return call("/oauth/token", null, {
      method: "POST",
      form: {
        client_id: clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: callback,
        code_verifier: verifier,
      },
    });
  }
  function refresh(refresh_token) {
    return call("/oauth/token", null, {
      method: "POST",
      form: { client_id: clientId, grant_type: "refresh_token", refresh_token },
    });
  }
  function records(accessToken) {
    return call("/api/v1/records?date=2026-10-01", null, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  }
  async function tokens(user) {
    const response = await exchange(await getCode(user));
    assert.equal(response.status, 200);
    return response.json();
  }

  const a = await tokens(1);
  const b = await tokens(2);
  assert.deepEqual(
    (await (await records(a.access_token)).json()).records.filter((r) => r.recorded).map((r) => r.weightKg),
    [60],
  );
  assert.deepEqual(
    (await (await records(b.access_token)).json()).records.filter((r) => r.recorded).map((r) => r.weightKg),
    [999],
  );
  await db
    .prepare(
      `INSERT INTO workout_records
    (user_id, exercise_id, workout_date, weight_kg, reps, sets)
    VALUES (1, 2, '2026-10-01', 0, 10, 3)`,
    )
    .run();
  const dayA = await (await records(a.access_token)).json();
  const dayB = await (await records(b.access_token)).json();
  const exerciseCount = (await db.prepare("SELECT count(*) AS n FROM exercises").first()).n;
  assert.equal(dayA.date, "2026-10-01");
  assert.equal(dayA.records.length, exerciseCount);
  assert.equal("nextCursor" in dayA, false);
  assert.equal(dayA.records.find((r) => r.exerciseId === 2).weightKg, 0);
  assert.equal(dayA.records.find((r) => r.exerciseId === 2).recorded, true);
  const missing = dayB.records.find((r) => r.exerciseId === 2);
  assert.equal(missing.recorded, false);
  for (const key of ["id", "weightKg", "reps", "sets", "distanceKm", "durationMinutes"])
    assert.equal(missing[key], null);
  const range = await (
    await call("/api/v1/records?from=2026-10-01&to=2026-10-02", null, {
      headers: { authorization: `Bearer ${a.access_token}` },
    })
  ).json();
  assert.equal(range.days.length, 2);
  assert.deepEqual(range.days[0], dayA);
  assert.equal(range.days[1].records.length, exerciseCount);
  assert.ok(range.days[1].records.every((r) => !r.recorded && r.id === null && r.weightKg === null));
  const leap = await (
    await call("/api/v1/records?from=2024-01-01&to=2024-12-31", null, {
      headers: { authorization: `Bearer ${b.access_token}` },
    })
  ).json();
  assert.equal(leap.days.length, 366);
  assert.equal(leap.days.at(-1).date, "2024-12-31");
  await db
    .prepare(
      "INSERT INTO body_weights(user_id, measured_date, weight_kg) VALUES (1, '2026-10-01', 65), (2, '2026-10-01', 100)",
    )
    .run();
  const statsQuery = "?exerciseId=1&from=2026-10-01&to=2026-10-31";
  const statsA = await call(`/api/v1/stats${statsQuery}`, null, {
    headers: { authorization: `Bearer ${a.access_token}` },
  });
  assert.equal(statsA.status, 200);
  const statsDataA = await statsA.json();
  assert.deepEqual(statsDataA, await (await call(`/api/stats${statsQuery}`, 1)).json());
  assert.deepEqual(
    statsDataA.exercise.map((r) => r.weightKg),
    [60],
  );
  assert.deepEqual(statsDataA.bodyWeights, [{ date: "2026-10-01", weightKg: 65 }]);
  const statsDataB = await (
    await call(`/api/v1/stats${statsQuery}`, null, { headers: { authorization: `Bearer ${b.access_token}` } })
  ).json();
  assert.deepEqual(
    statsDataB.exercise.map((r) => r.weightKg),
    [999],
  );
  assert.deepEqual(statsDataB.bodyWeights, [{ date: "2026-10-01", weightKg: 100 }]);
  const weightsResponse = await call("/api/v1/body-weights?from=2026-10-01&to=2026-10-31", null, {
    headers: { authorization: `Bearer ${a.access_token}` },
  });
  assert.equal(weightsResponse.status, 200);
  assert.deepEqual(await weightsResponse.json(), { bodyWeights: statsDataA.bodyWeights });
  await db
    .prepare(
      `WITH RECURSIVE days(date) AS (
    SELECT '2024-01-01' UNION ALL SELECT date(date, '+1 day') FROM days WHERE date < '2024-12-31'
  ) INSERT INTO body_weights(user_id, measured_date, weight_kg) SELECT 1, date, 65 FROM days`,
    )
    .run();
  const fullWeightsResponse = await call("/api/v1/body-weights?from=2024-01-01&to=2024-12-31", null, {
    headers: { authorization: `Bearer ${a.access_token}` },
  });
  assert.equal(fullWeightsResponse.status, 200);
  const fullWeights = await fullWeightsResponse.json();
  assert.equal(fullWeights.bodyWeights.length, 366);
  assert.equal("nextCursor" in fullWeights, false);
  assert.deepEqual(fullWeights.bodyWeights[0], { date: "2024-01-01", weightKg: 65 });
  assert.deepEqual(fullWeights.bodyWeights.at(-1), { date: "2024-12-31", weightKg: 65 });
  const code = await getCode(1);
  const parallelCode = await Promise.all([exchange(code), exchange(code)]);
  assert.deepEqual(parallelCode.map((r) => r.status).sort(), [200, 400]);
  const codeTokens = await parallelCode.find((r) => r.status === 200).json();
  assert.equal((await records(codeTokens.access_token)).status, 401);
  const parallelRefresh = await Promise.all([refresh(a.refresh_token), refresh(a.refresh_token)]);
  assert.deepEqual(parallelRefresh.map((r) => r.status).sort(), [200, 400]);
  const rotated = await parallelRefresh.find((r) => r.status === 200).json();
  assert.equal((await records(rotated.access_token)).status, 401);

  // A uniqueness violation after consumption must roll back the whole D1 batch.
  const rollbackCode = await getCode(1);
  const codeHash = await hash(rollbackCode);
  await assert.rejects(
    db.batch([
      db
        .prepare("UPDATE oauth_authorization_codes SET consumed_by = 'rollback-test' WHERE code_hash = ?")
        .bind(codeHash),
      db.prepare("INSERT INTO oauth_clients SELECT * FROM oauth_clients WHERE client_id = ?").bind(clientId),
    ]),
  );
  assert.equal(
    (
      await db
        .prepare("SELECT consumed_by FROM oauth_authorization_codes WHERE code_hash = ?")
        .bind(codeHash)
        .first()
    ).consumed_by,
    null,
  );
  assert.equal((await exchange(rollbackCode)).status, 200);

  const pendingCode = await getCode(2);
  const { connections } = await (await call("/api/oauth/connections", 2)).json();
  for (const connection of connections)
    assert.equal(
      (await mutate(`/api/oauth/connections/${connection.id}`, 2, undefined, "DELETE")).status,
      200,
    );
  assert.equal((await records(b.access_token)).status, 401);
  assert.equal((await refresh(b.refresh_token)).status, 400);
  assert.equal((await exchange(pendingCode)).status, 400);
  const preserved = await (
    await mutate("/api/admin/oauth/clients", 1, {
      name: "preserved client",
      authMethod: "none",
      redirectUris: [callback],
    })
  ).json();
  const workoutCount = (await db.prepare("SELECT count(*) AS n FROM workout_records").first()).n;
  const deletePath = `/api/admin/oauth/clients/${clientId}`;
  assert.equal((await mutate(deletePath, 2, undefined, "DELETE")).status, 403);
  assert.equal((await mutate(deletePath, 1, undefined, "DELETE")).status, 200);
  for (const table of [
    "oauth_authorization_requests",
    "oauth_grants",
    "oauth_authorization_codes",
    "oauth_access_tokens",
    "oauth_refresh_tokens",
  ])
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 0);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM workout_records").first()).n, workoutCount);
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM oauth_clients WHERE client_id = ?")
        .bind(preserved.clientId)
        .first()
    ).n,
    1,
  );
  assert.equal((await records(b.access_token)).status, 401);
  assert.equal((await refresh(b.refresh_token)).status, 401);
  assert.equal((await mutate(deletePath, 1, undefined, "DELETE")).status, 404);
  console.log(
    "PASS: real D1 owner isolation, concurrent code/refresh exchange, replay revocation, transactional rollback, disconnect and client deletion",
  );
  if (serve) {
    serving = true;
    console.log("Isolated Worker ready on http://127.0.0.1:8787. Start Vite on 127.0.0.1:5173.");
    console.log("Local UI test accounts: oauth-test-1 (admin), oauth-test-2 / oauth-test-password");
    console.log(`Local test client: ${preserved.clientId}`);
    const stop = () => {
      mf.dispose().finally(() => process.exit());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
} finally {
  if (!serving) await mf.dispose();
}

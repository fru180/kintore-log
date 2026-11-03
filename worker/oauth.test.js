import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index.js";
import { cleanupOAuth } from "./oauth.js";
import { nowSeconds, pkceChallenge, sha256 } from "./oauth-security.js";

// Real SQLite statements and transactional batches; also exercised against workerd/D1 separately.
function d1Adapter(database) {
  return {
    prepare(sql) {
      let params = [];
      const execute = () => {
        const results = database.prepare(sql).all(...params);
        return { results, meta: { changes: Number(database.prepare("SELECT changes() AS n").get().n) } };
      };
      return {
        bind(...values) {
          params = values;
          return this;
        },
        async first() {
          return execute().results[0] ?? null;
        },
        async all() {
          return execute();
        },
        async run() {
          return execute();
        },
        execute,
      };
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

describe("OAuth and external read APIs", () => {
  let database;
  let env;
  let client;
  const base = "https://example.com/kintore-log";
  const callback = "https://muse.example/callback";
  const verifier = "v".repeat(43);

  async function call(path, { user, method = "GET", body, headers = {}, form } = {}) {
    if (user) headers = { cookie: `kintore_session=session-${user}`, ...headers };
    if (form) {
      body = new URLSearchParams(form).toString();
      headers = { "content-type": "application/x-www-form-urlencoded", ...headers };
    } else if (body !== undefined) {
      body = JSON.stringify(body);
      headers = { "content-type": "application/json", ...headers };
    }
    return worker.fetch(new Request(`${base}${path}`, { method, headers, body }), env);
  }
  async function csrf(user = 1) {
    const response = await call("/api/oauth/csrf", { user });
    return (await response.json()).csrfToken;
  }
  async function mutation(path, user, body, method = "POST", extras = {}) {
    return call(path, {
      user,
      method,
      body,
      headers: { origin: "https://example.com", "x-csrf-token": await csrf(user), ...extras },
    });
  }
  async function register(authMethod = "none") {
    const response = await mutation("/api/admin/oauth/clients", 1, {
      name: "Muse <test>",
      authMethod,
      redirectUris: [callback, "https://muse.example/second"],
    });
    expect(response.status).toBe(201);
    return response.json();
  }
  async function start(user = 1, overrides = {}) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: callback,
      scope: "workouts:read",
      state: "original-state",
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: "S256",
      ...overrides,
    });
    return call(`/oauth/authorize?${params}`, { user });
  }
  async function consent(user = 1) {
    const response = await start(user);
    expect(response.status).toBe(200);
    const html = await response.text();
    return {
      request: html.match(/name="request" value="([^"]+)"/)[1],
      csrf: html.match(/name="csrf" value="([^"]+)"/)[1],
    };
  }
  async function code(user = 1) {
    const form = { ...(await consent(user)), decision: "allow" };
    const response = await call("/oauth/authorize", {
      user,
      method: "POST",
      form,
      headers: { origin: "https://example.com" },
    });
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location"));
    expect(location.searchParams.get("state")).toBe("original-state");
    expect(location.searchParams.get("iss")).toBe(base);
    return location.searchParams.get("code");
  }
  function exchange(codeValue, extra = {}, headers = {}) {
    return call("/oauth/token", {
      method: "POST",
      headers,
      form: {
        grant_type: "authorization_code",
        client_id: client.clientId,
        code: codeValue,
        redirect_uri: callback,
        code_verifier: verifier,
        ...extra,
      },
    });
  }
  async function tokens(user = 1) {
    const response = await exchange(await code(user));
    expect(response.status).toBe(200);
    return response.json();
  }
  function api(token, path = "/records?date=2026-10-01", options = {}) {
    return call(`/api/v1${path}`, {
      ...options,
      headers: { authorization: `Bearer ${token}`, ...options.headers },
    });
  }
  function refresh(token, extra = {}) {
    return call("/oauth/token", {
      method: "POST",
      form: { grant_type: "refresh_token", client_id: client.clientId, refresh_token: token, ...extra },
    });
  }

  beforeEach(async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    database = new DatabaseSync(":memory:");
    const migrations = new URL("../migrations/", import.meta.url);
    for (const name of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort())
      database.exec(`BEGIN;\n${readFileSync(new URL(name, migrations), "utf8")}\nCOMMIT;`);
    env = {
      DB: d1Adapter(database),
      OAUTH_ENABLED: "true",
      OAUTH_ISSUER: base,
      ASSETS: {
        fetch: () =>
          new Response('<link rel="stylesheet" crossorigin href="/kintore-log/assets/index-test.css">'),
      },
    };
    database.exec(`
      INSERT INTO users (id, account_name, password_hash, password_salt, is_admin) VALUES (1, 'admin-A', 'unused', 'unused', 1), (2, 'user-B', 'unused', 'unused', 0);
      INSERT INTO workout_records (user_id, exercise_id, workout_date, weight_kg, reps, sets) VALUES
        (1, 1, '2026-10-01', -10, 10, 3), (1, 2, '2026-10-01', 0, 8, 2), (1, 1, '2026-10-31', 60, 6, 4),
        (1, 1, '2026-11-01', 65, 5, 3), (2, 1, '2026-10-01', 999, 99, 9);
      INSERT INTO workout_records (user_id, exercise_id, workout_date, distance_km, duration_minutes) VALUES (1, 16, '2026-10-15', 5, 30);
      INSERT INTO body_weights (user_id, measured_date, weight_kg) VALUES (1, '2026-10-01', 60), (1, '2026-10-02', 61), (2, '2026-10-01', 100);
      INSERT INTO exercise_weight_increase_marks (user_id, exercise_id) VALUES (1, 1), (2, 2);
    `);
    for (const id of [1, 2])
      database
        .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, '9999-01-01')")
        .run(await sha256(`session-${id}`), id);
    client = await register();
  });
  afterEach(() => {
    database.close();
    vi.restoreAllMocks();
  });

  it("publishes metadata at the RFC 8414 path and keeps the existing public health route", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/.well-known/oauth-authorization-server/kintore-log"),
      env,
    );
    expect(await response.json()).toMatchObject({
      issuer: base,
      token_endpoint: `${base}/oauth/token`,
      code_challenge_methods_supported: ["S256"],
    });
    expect((await call("/api/health")).status).toBe(200);
  });

  it("registers one client row with several exact redirect URIs and shows secrets only once", async () => {
    const confidential = await register("client_secret_basic");
    expect(confidential.clientSecret).toMatch(/^cs_/);
    const row = database
      .prepare("SELECT * FROM oauth_clients WHERE client_id = ?")
      .get(confidential.clientId);
    expect(row.client_secret_hash).toBe(await sha256(confidential.clientSecret));
    expect(row).not.toHaveProperty("auth_method");
    expect(row).not.toHaveProperty("secret_hash");
    expect(JSON.parse(row.redirect_uris)).toEqual([callback, "https://muse.example/second"]);
    const listed = await (await call("/api/admin/oauth/clients", { user: 1 })).text();
    expect(listed).not.toContain(confidential.clientSecret);
    expect(listed).not.toContain(row.client_secret_hash);
    expect(database.prepare("SELECT count(*) AS n FROM oauth_grants").get().n).toBe(0);
  });

  it("restricts registration and disable operations to administrators with CSRF and Origin checks", async () => {
    expect((await mutation("/api/admin/oauth/clients", 2, {})).status).toBe(403);
    expect((await call("/api/admin/oauth/clients")).status).toBe(401);
    expect((await call("/api/admin/oauth/clients", { user: 1, method: "POST", body: {} })).status).toBe(403);
    expect(
      (await mutation("/api/admin/oauth/clients", 1, {}, "POST", { origin: "https://attacker.example" }))
        .status,
    ).toBe(403);
    expect((await mutation(`/api/admin/oauth/clients/${client.clientId}/disable`, 2)).status).toBe(403);
  });

  it("accepts a same-origin browser mutation when Wrangler rewrites the local URL and Origin", async () => {
    env.OAUTH_ISSUER = "http://127.0.0.1:8787/kintore-log";
    const response = await worker.fetch(
      new Request("https://curiosk.com/kintore-log/api/admin/oauth/clients", {
        method: "POST",
        headers: {
          cookie: "kintore_session=session-1",
          origin: "https://curiosk.com",
          "content-type": "application/json",
          "x-csrf-token": await csrf(1),
        },
        body: JSON.stringify({ name: "Local browser", authMethod: "none", redirectUris: [callback] }),
      }),
      env,
    );
    expect(response.status).toBe(201);
  });

  it("distinguishes invalid Origin from invalid CSRF and accepts the configured frontend proxy", async () => {
    env.OAUTH_ISSUER = "http://127.0.0.1:5173/kintore-log";
    const send = async (origin, token) =>
      worker.fetch(
        new Request("http://127.0.0.1:8787/kintore-log/api/admin/oauth/clients", {
          method: "POST",
          headers: {
            cookie: "kintore_session=session-1",
            origin,
            "content-type": "application/json",
            "x-csrf-token": token,
          },
          body: JSON.stringify({ name: "Local frontend", authMethod: "none", redirectUris: [callback] }),
        }),
        env,
      );
    const token = await csrf(1);
    expect((await send("http://127.0.0.1:5173", token)).status).toBe(201);
    expect((await send("http://127.0.0.1:8787", token)).status).toBe(201);
    for (const origin of ["null", "https://attacker.example", "http://localhost:5173"]) {
      const response = await send(origin, token);
      expect(response.status).toBe(403);
      expect((await response.json()).error).toContain("アクセス元のURL");
    }
    const invalidCsrf = await send("http://127.0.0.1:8787", "invalid-token");
    expect(invalidCsrf.status).toBe(403);
    expect((await invalidCsrf.json()).error).toContain("認証情報");
  });

  it.each([
    "http://muse.example/cb",
    "https://muse.example/*",
    "https://muse.example/cb#",
    "https://u:p@muse.example/cb",
    "not-a-url",
  ])("rejects unsafe redirect registration: %s", async (uri) => {
    expect(
      (
        await mutation("/api/admin/oauth/clients", 1, {
          name: "bad",
          authMethod: "none",
          redirectUris: [uri],
        })
      ).status,
    ).toBe(400);
  });

  it("resumes an unauthenticated request after login without accepting an arbitrary return URL", async () => {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: callback,
      scope: "workouts:read",
      state: "s",
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: "S256",
    });
    const anonymous = await call(`/oauth/authorize?${params}`);
    expect(anonymous.status).toBe(303);
    const location = new URL(anonymous.headers.get("location"));
    expect(location.origin + location.pathname).toBe(`${base}/`);
    const request = location.searchParams.get("oauth_request");
    expect((await call(`/oauth/authorize?request=${request}`, { user: 2 })).status).toBe(200);
  });

  it("escapes client names, binds consent to the browser session, and supports denial", async () => {
    const response = await start(1);
    const html = await response.text();
    expect(html).toContain("Muse &lt;test&gt;");
    expect(html).toContain('<link rel="stylesheet" href="/kintore-log/assets/index-test.css">');
    expect(html).not.toContain("<style>");
    expect(html).not.toContain("アプリに戻る");
    expect(response.headers.get("content-security-policy")).toContain("style-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://muse.example;",
    );
    const form = {
      request: html.match(/name="request" value="([^"]+)"/)[1],
      csrf: html.match(/name="csrf" value="([^"]+)"/)[1],
      decision: "deny",
    };
    expect(
      (
        await call("/oauth/authorize", {
          user: 2,
          method: "POST",
          form,
          headers: { origin: "https://example.com" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("/oauth/authorize", {
          user: 1,
          method: "POST",
          form,
          headers: { origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    const denied = await call("/oauth/authorize", {
      user: 1,
      method: "POST",
      form,
      headers: { origin: "https://example.com" },
    });
    expect(new URL(denied.headers.get("location")).searchParams.get("error")).toBe("access_denied");
    expect(database.prepare("SELECT count(*) AS n FROM oauth_grants").get().n).toBe(0);
    expect(
      (
        await call("/oauth/authorize", {
          user: 1,
          method: "POST",
          form,
          headers: { origin: "https://example.com" },
        })
      ).status,
    ).toBe(400);
  });

  it("rejects session switching even with the new user's valid CSRF token", async () => {
    const form = { ...(await consent(1)), decision: "allow", csrf: await csrf(2) };
    expect(
      (
        await call("/oauth/authorize", {
          user: 2,
          method: "POST",
          form,
          headers: { origin: "https://example.com" },
        })
      ).status,
    ).toBe(400);
    expect((await call(`/oauth/authorize?request=${form.request}`, { user: 2 })).status).toBe(400);
  });

  it("never redirects an invalid redirect URI", async () => {
    for (const uri of [
      callback + "/extra",
      "https://evil.example/callback",
      "https://muse.example/callback?extra=1",
    ]) {
      const response = await start(1, { redirect_uri: uri });
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it.each([
    { scope: "workouts:write" },
    { code_challenge_method: "plain" },
    { code_challenge: "" },
    { state: "" },
    { response_type: "token" },
  ])("rejects unsupported authorization parameters %j", async (params) => {
    const response = await start(1, params);
    expect(new URL(response.headers.get("location")).searchParams.has("error")).toBe(true);
    expect(database.prepare("SELECT count(*) AS n FROM oauth_grants").get().n).toBe(0);
  });

  it("does not leak other users' records, body weights or personal exercise settings, including for administrators", async () => {
    const a = await tokens(1);
    const b = await tokens(2);
    const recordsA = await (await api(a.access_token)).json();
    expect(recordsA.date).toBe("2026-10-01");
    expect(recordsA.records.filter((r) => r.recorded).map((r) => r.weightKg)).toEqual([-10, 0]);
    expect(recordsA.records[0]).toMatchObject({ reps: 10, sets: 3, distanceKm: null, durationMinutes: null });
    const cardio = await (await api(a.access_token, "/records?date=2026-10-15")).json();
    expect(cardio.records.find((r) => r.exerciseId === 16)).toMatchObject({
      recorded: true,
      distanceKm: 5,
      durationMinutes: 30,
      weightKg: null,
    });
    expect(
      (await (await api(b.access_token)).json()).records.filter((r) => r.recorded).map((r) => r.weightKg),
    ).toEqual([999]);
    const weightsA = await (await api(a.access_token, "/body-weights?from=2026-10-01&to=2026-10-31")).json();
    expect(weightsA.bodyWeights).toEqual([
      { date: "2026-10-01", weightKg: 60 },
      { date: "2026-10-02", weightKg: 61 },
    ]);
    for (const [token, readyId] of [
      [a.access_token, 1],
      [b.access_token, 2],
    ]) {
      const data = await (await api(token, "/exercises")).json();
      expect(data.exercises.filter((e) => e.readyForWeightIncrease).map((e) => e.id)).toEqual([readyId]);
    }
    const me = await api(a.access_token, "/me", { user: 2 });
    expect(await me.json()).toEqual({ user: { id: 1, accountName: "admin-A" } });
    expect(me.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    "",
    "from=2026-10-01",
    "to=2026-10-31",
    "from=2026-02-30&to=2026-03-01",
    "from=2026-10-31&to=2026-10-01",
    "from=2024-01-01&to=2026-01-01",
    "from=2026-10-01&to=2026-10-31&limit=201",
    "from=2026-10-01&to=2026-10-31&limit=0",
    "from=2026-10-01&to=2026-10-31&user_id=2",
    "from=2026-10-01&to=2026-10-31&userId=2",
    "from=2026-10-01&from=2026-10-02&to=2026-10-31",
  ])("rejects invalid or owner-changing queries: %s", async (query) => {
    expect((await api((await tokens()).access_token, `/body-weights?${query}`)).status).toBe(400);
  });

  it("returns the entire body-weight period without a cursor key or pagination, limited to its owner", async () => {
    const a = await tokens(1);
    const b = await tokens(2);
    // Insert 366 days out of order, exceeding both former page-size limits.
    database.exec(`WITH RECURSIVE days(date) AS (
      SELECT '2024-01-01' UNION ALL SELECT date(date, '+1 day') FROM days WHERE date < '2024-12-31'
    ) INSERT INTO body_weights(user_id, measured_date, weight_kg)
      SELECT 1, date, 65 FROM days ORDER BY date DESC`);
    const query = "/body-weights?from=2024-01-01&to=2024-12-31";
    const response = await api(a.access_token, query, { user: 2 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = await response.json();
    expect(data).not.toHaveProperty("nextCursor");
    expect(data.bodyWeights).toHaveLength(366);
    expect(data.bodyWeights[0]).toEqual({ date: "2024-01-01", weightKg: 65 });
    expect(data.bodyWeights.at(-1)).toEqual({ date: "2024-12-31", weightKg: 65 });
    expect(data.bodyWeights.map((w) => w.date)).toEqual(data.bodyWeights.map((w) => w.date).toSorted());
    expect(data.bodyWeights.every((w) => Object.keys(w).length === 2)).toBe(true);
    expect(await (await api(b.access_token, query)).json()).toEqual({ bodyWeights: [] });
    expect(await (await api(a.access_token, "/body-weights?from=2026-10-01&to=2026-10-01")).json()).toEqual({
      bodyWeights: [{ date: "2026-10-01", weightKg: 60 }],
    });
    for (const extra of ["limit=1", "cursor=old-cursor"])
      expect((await api(a.access_token, `${query}&${extra}`)).status).toBe(400);
  });

  it("returns every exercise for one day and distinguishes zero-weight records from missing records", async () => {
    const token = (await tokens()).access_token;
    const data = await (await api(token)).json();
    expect(data).not.toHaveProperty("nextCursor");
    expect(data.records).toHaveLength(database.prepare("SELECT count(*) AS n FROM exercises").get().n);
    expect(data.records.find((r) => r.exerciseId === 2)).toMatchObject({
      recorded: true,
      weightKg: 0,
      reps: 8,
      sets: 2,
    });
    expect(data.records.find((r) => r.exerciseId === 3)).toMatchObject({
      recorded: false,
      id: null,
      date: "2026-10-01",
      weightKg: null,
      reps: null,
      sets: null,
      distanceKm: null,
      durationMinutes: null,
    });
    const empty = await (await api(token, "/records?date=2020-01-01")).json();
    expect(empty.records).toHaveLength(data.records.length);
    expect(empty.records.every((r) => r.recorded === false && r.id === null)).toBe(true);
    database.exec(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<205)
      INSERT INTO exercises(name, kind, sort_order) SELECT 'extra-' || i, 'strength', 1000+i FROM n`);
    database.exec(`INSERT INTO workout_records(user_id, exercise_id, workout_date, weight_kg, reps, sets)
      SELECT 1, id, '2026-10-01', 0, 10, 1 FROM exercises WHERE sort_order > 1000`);
    const full = await (await api(token)).json();
    expect(full.records).toHaveLength(data.records.length + 205);
    expect(full.records.filter((r) => r.recorded)).toHaveLength(207);
    expect(full).not.toHaveProperty("nextCursor");
    const range = await (await api(token, "/records?from=2026-10-01&to=2026-10-02")).json();
    expect(range.days[0].records).toEqual(full.records);
    expect(range.days[1].records).toHaveLength(full.records.length);
    expect(range.days[1].records.every((r) => r.recorded === false)).toBe(true);
    expect(range).not.toHaveProperty("nextCursor");
  });

  it("returns inclusive chronological day groups, including empty days, without mixing owners", async () => {
    const a = await tokens(1);
    const b = await tokens(2);
    const path = "/records?from=2026-10-01&to=2026-10-31";
    const data = await (await api(a.access_token, path)).json();
    expect(data.from).toBe("2026-10-01");
    expect(data.to).toBe("2026-10-31");
    expect(data.days).toHaveLength(31);
    expect(data.days[0].date).toBe("2026-10-01");
    expect(data.days.at(-1).date).toBe("2026-10-31");
    const count = database.prepare("SELECT count(*) AS n FROM exercises").get().n;
    for (const day of data.days) {
      expect(day.records).toHaveLength(count);
      expect(day.records.every((r) => r.date === day.date)).toBe(true);
    }
    expect(data.days[0].records.find((r) => r.exerciseId === 2)).toMatchObject({
      recorded: true,
      weightKg: 0,
    });
    expect(data.days[1].records.every((r) => !r.recorded && r.weightKg === null)).toBe(true);
    expect(data.days[14].records.find((r) => r.exerciseId === 16)).toMatchObject({
      recorded: true,
      distanceKm: 5,
    });
    expect(data.days[30].records.find((r) => r.exerciseId === 1)).toMatchObject({
      recorded: true,
      weightKg: 60,
    });
    const other = await (await api(b.access_token, path)).json();
    expect(
      other.days
        .flatMap((d) => d.records)
        .filter((r) => r.recorded)
        .map((r) => r.weightKg),
    ).toEqual([999]);
    const single = await (await api(a.access_token)).json();
    const oneDay = await (await api(a.access_token, "/records?from=2026-10-01&to=2026-10-01")).json();
    expect(oneDay.days).toEqual([single]);
  });

  it("supports leap days, the inclusive 366-day boundary and days with no exercises", async () => {
    const token = (await tokens()).access_token;
    const leap = await (await api(token, "/records?from=2024-02-28&to=2024-03-01")).json();
    expect(leap.days.map((d) => d.date)).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
    const year = await (await api(token, "/records?from=2024-01-01&to=2024-12-31")).json();
    expect(year.days).toHaveLength(366);
    expect(year.days.at(-1).date).toBe("2024-12-31");
    database.exec(
      "DELETE FROM exercise_weight_increase_marks; DELETE FROM workout_records; DELETE FROM exercises;",
    );
    const empty = await (await api(token, "/records?from=2026-10-01&to=2026-10-02")).json();
    expect(empty.days).toEqual([
      { date: "2026-10-01", records: [] },
      { date: "2026-10-02", records: [] },
    ]);
    expect(await (await api(token)).json()).toEqual({ date: "2026-10-01", records: [] });
  });

  it.each([
    "",
    "date=2026-02-30",
    "date=2026-2-01",
    "date=2026-13-01",
    "date=2026-10-01&date=2026-10-02",
    "date=2026-10-01&limit=1",
    "date=2026-10-01&cursor=x",
    "date=2026-10-01&user_id=2",
    "date=2026-10-01&userId=2",
    "from=2026-10-01",
    "to=2026-10-31",
    "from=&to=2026-10-31",
    "from=2026-02-30&to=2026-03-01",
    "from=2026-10-02&to=2026-10-01",
    "from=2024-01-01&to=2025-01-01",
    "date=2026-10-01&from=2026-10-01",
    "date=2026-10-01&to=2026-10-01",
    "from=2026-10-01&from=2026-10-02&to=2026-10-31",
    "from=2026-10-01&to=2026-10-31&limit=1",
    "from=2026-10-01&to=2026-10-31&cursor=x",
    "from=2026-10-01&to=2026-10-31&user_id=2",
    "from=2026-10-01&to=2026-10-31&userId=2",
  ])("rejects invalid daily record queries: %s", async (query) => {
    expect((await api((await tokens()).access_token, `/records?${query}`)).status).toBe(400);
  });

  it("returns the same exercise and body-weight series as the app's charts, scoped to the bearer owner", async () => {
    const a = await tokens(1);
    const b = await tokens(2);
    const query = "?exerciseId=1&from=2026-10-01&to=2026-10-31";
    const response = await api(a.access_token, `/stats${query}`, { user: 2 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = await response.json();
    expect(data).toEqual(await (await call(`/api/stats${query}`, { user: 1 })).json());
    expect(data).toEqual({
      exercise: [
        { date: "2026-10-01", weightKg: -10, reps: 10, sets: 3, distanceKm: null, durationMinutes: null },
        { date: "2026-10-31", weightKg: 60, reps: 6, sets: 4, distanceKm: null, durationMinutes: null },
      ],
      bodyWeights: [
        { date: "2026-10-01", weightKg: 60 },
        { date: "2026-10-02", weightKg: 61 },
      ],
    });
    expect(await (await api(b.access_token, `/stats${query}`)).json()).toEqual({
      exercise: [
        { date: "2026-10-01", weightKg: 999, reps: 99, sets: 9, distanceKm: null, durationMinutes: null },
      ],
      bodyWeights: [{ date: "2026-10-01", weightKg: 100 }],
    });
    const zero = await (
      await api(a.access_token, "/stats?exerciseId=2&from=2026-10-01&to=2026-10-01")
    ).json();
    expect(zero.exercise).toEqual([
      { date: "2026-10-01", weightKg: 0, reps: 8, sets: 2, distanceKm: null, durationMinutes: null },
    ]);
    const cardio = await (
      await api(a.access_token, "/stats?exerciseId=16&from=2026-10-01&to=2026-10-31")
    ).json();
    expect(cardio.exercise).toEqual([
      { date: "2026-10-15", weightKg: null, reps: null, sets: null, distanceKm: 5, durationMinutes: 30 },
    ]);
    const missing = await (
      await api(a.access_token, "/stats?exerciseId=999999&from=2026-10-01&to=2026-10-31")
    ).json();
    expect(missing).toEqual({ exercise: [], bodyWeights: data.bodyWeights });
    expect(
      await (await api(a.access_token, "/stats?exerciseId=1&from=2020-01-01&to=2020-01-31")).json(),
    ).toEqual({ exercise: [], bodyWeights: [] });
    expect((await api(a.access_token, "/stats?exerciseId=1&from=2024-01-01&to=2024-12-31")).status).toBe(200);
    expect((await call(`/api/v1/stats${query}`, { user: 1 })).status).toBe(401);
    expect((await api(a.access_token, `/stats${query}`, { method: "POST" })).status).toBe(405);
    database.exec("UPDATE oauth_grants SET scope = 'other:read'");
    expect((await api(a.access_token, `/stats${query}`)).status).toBe(403);
  });

  it.each([
    "",
    "from=2026-10-01&to=2026-10-31",
    "exerciseId=0",
    "exerciseId=-1",
    "exerciseId=1.5",
    "exerciseId=1e2",
    "exerciseId=9007199254740992",
    "exerciseId=1&from=2026-02-30&to=2026-03-01",
    "exerciseId=1&from=2026-10-02&to=2026-10-01",
    "exerciseId=1&from=2024-01-01&to=2025-01-01",
    "exerciseId=1&from=2026-10-01&to=2026-10-31&userId=2",
    "exerciseId=1&exerciseId=2&from=2026-10-01&to=2026-10-31",
    "exerciseId=1&from=2026-10-01&to=2026-10-31&limit=1",
  ])("rejects invalid trend queries: %s", async (query) => {
    expect((await api((await tokens()).access_token, `/stats?${query}`)).status).toBe(400);
  });

  it("keeps Cookie and Bearer authentication separate and external APIs read only", async () => {
    const token = (await tokens()).access_token;
    expect((await call("/api/v1/me", { user: 1 })).status).toBe(401);
    expect((await api("session-1", "/me")).status).toBe(401);
    for (const method of ["POST", "PATCH", "DELETE", "PUT"])
      expect((await api(token, "/records", { method })).status).toBe(405);
    for (const path of ["/api/records", "/api/exercises", "/api/admin/oauth/clients"])
      expect(
        (await call(path, { method: "POST", body: {}, headers: { authorization: `Bearer ${token}` } }))
          .status,
      ).toBe(401);
    expect(
      (await call("/api/oauth/connections", { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(401);
    expect(
      (
        await call(`/api/oauth/connections/cl_${"a".repeat(64)}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(401);
    expect((await api(token, "/unknown")).status).toBe(404);
  });

  it("rejects wrong verifier, redirect URI and client before consuming a code", async () => {
    const value = await code();
    expect((await exchange(value, { code_verifier: "w".repeat(43) })).status).toBe(400);
    expect((await exchange(value, { redirect_uri: "https://evil.example" })).status).toBe(400);
    const other = await register();
    expect((await exchange(value, { client_id: other.clientId })).status).toBe(400);
    expect((await exchange(value)).status).toBe(200);
  });

  it("enforces confidential client authentication and rejects downgrades", async () => {
    client = await register("client_secret_basic");
    const value = await code();
    expect((await exchange(value)).status).toBe(401);
    const basic = (secret) => ({ authorization: `Basic ${btoa(`${client.clientId}:${secret}`)}` });
    expect((await exchange(value, {}, basic("bad"))).status).toBe(401);
    expect((await exchange(value, {}, basic(client.clientSecret))).status).toBe(200);
  });

  it("consumes a code only once under concurrent exchange and revokes its grant on reuse", async () => {
    const value = await code();
    const responses = await Promise.all([exchange(value), exchange(value)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    const issued = await responses.find((r) => r.status === 200).json();
    expect((await api(issued.access_token)).status).toBe(401);
    expect(database.prepare("SELECT count(*) AS n FROM oauth_access_tokens").get().n).toBe(1);
  });

  it("rotates refresh tokens and revokes every token in a replayed family", async () => {
    const first = await tokens();
    const response = await refresh(first.refresh_token);
    expect(response.status).toBe(200);
    const second = await response.json();
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await api(second.access_token)).status).toBe(200);
    expect((await refresh(first.refresh_token)).status).toBe(400);
    expect((await api(first.access_token)).status).toBe(401);
    expect((await api(second.access_token)).status).toBe(401);
    expect((await refresh(second.refresh_token)).status).toBe(400);
  });

  it("prevents refresh scope escalation and use by another client", async () => {
    const first = await tokens();
    expect((await refresh(first.refresh_token, { scope: "workouts:write" })).status).toBe(400);
    const other = await register();
    expect((await refresh(first.refresh_token, { client_id: other.clientId })).status).toBe(400);
    expect((await refresh(first.refresh_token)).status).toBe(200);
  });

  it("does not accept an expired ISO session timestamp on the same calendar day", async () => {
    database
      .prepare("UPDATE sessions SET expires_at = ? WHERE user_id = 1")
      .run(new Date(Date.now() - 1000).toISOString());
    expect(await (await call("/api/auth/me", { user: 1 })).json()).toEqual({ user: null });
  });

  it("does not double issue on concurrent refresh", async () => {
    const first = await tokens();
    const responses = await Promise.all([refresh(first.refresh_token), refresh(first.refresh_token)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(database.prepare("SELECT count(*) AS n FROM oauth_refresh_tokens").get().n).toBe(2);
    const second = await responses.find((r) => r.status === 200).json();
    expect((await api(second.access_token)).status).toBe(401);
  });

  it("rolls back consumption when token insertion fails", async () => {
    const value = await code();
    database.exec(
      "CREATE TRIGGER fail_access BEFORE INSERT ON oauth_access_tokens BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    );
    expect((await exchange(value)).status).toBe(500);
    expect(
      database.prepare("SELECT consumed_by FROM oauth_authorization_codes").get().consumed_by,
    ).toBeNull();
    expect(database.prepare("SELECT count(*) AS n FROM oauth_refresh_tokens").get().n).toBe(0);
    database.exec("DROP TRIGGER fail_access");
    expect((await exchange(value)).status).toBe(200);
  });

  it("enforces access, refresh, code, request and grant expiry", async () => {
    const first = await tokens();
    database.exec(`UPDATE oauth_access_tokens SET expires_at = ${nowSeconds()}`);
    expect((await api(first.access_token)).status).toBe(401);
    const rotatedResponse = await refresh(first.refresh_token);
    expect(rotatedResponse.status).toBe(200);
    const rotated = await rotatedResponse.json();
    database.exec(`UPDATE oauth_refresh_tokens SET expires_at = ${nowSeconds()}`);
    expect((await refresh(rotated.refresh_token)).status).toBe(400);
    const second = await tokens();
    database.exec(`UPDATE oauth_grants SET expires_at = ${nowSeconds()}`);
    expect((await api(second.access_token)).status).toBe(401);
    expect((await refresh(second.refresh_token)).status).toBe(400);
    const value = await code();
    database.exec(`UPDATE oauth_authorization_codes SET expires_at = ${nowSeconds()}`);
    expect((await exchange(value)).status).toBe(400);
    const pending = await consent();
    database.exec(`UPDATE oauth_authorization_requests SET expires_at = ${nowSeconds()}`);
    expect((await call(`/oauth/authorize?request=${pending.request}`, { user: 1 })).status).toBe(400);
  });

  it("checks scope and returns a Bearer challenge", async () => {
    const issued = await tokens();
    database.exec("UPDATE oauth_grants SET scope = 'other:read'");
    const response = await api(issued.access_token);
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain("insufficient_scope");
  });

  it("lists only the owner's connections and immediately revokes codes and tokens on disconnect", async () => {
    const a = await tokens(1);
    const b = await tokens(2);
    const pending = await code(1);
    const connections = (await (await call("/api/oauth/connections", { user: 1 })).json()).connections;
    expect(connections).toHaveLength(1);
    // The same client ID refers to B's own connection when B performs the operation.
    expect(
      (await mutation(`/api/oauth/connections/${connections[0].id}`, 2, undefined, "DELETE")).status,
    ).toBe(200);
    expect((await api(a.access_token)).status).toBe(200);
    expect((await api(b.access_token)).status).toBe(401);
    const reconnectedB = await tokens(2);
    expect(
      (await mutation(`/api/oauth/connections/cl_${"f".repeat(64)}`, 2, undefined, "DELETE")).status,
    ).toBe(404);
    for (const row of connections) {
      expect((await mutation(`/api/oauth/connections/${row.id}`, 1, undefined, "DELETE")).status).toBe(200);
    }
    expect((await api(a.access_token)).status).toBe(401);
    expect((await refresh(a.refresh_token)).status).toBe(400);
    expect((await exchange(pending)).status).toBe(400);
    expect((await api(reconnectedB.access_token)).status).toBe(200);
  });

  it("disables every flow for a disabled client without affecting another client", async () => {
    const firstClient = client;
    const a = await tokens();
    const pending = await code();
    client = await register();
    const other = await tokens();
    expect((await mutation(`/api/admin/oauth/clients/${firstClient.clientId}/disable`, 1)).status).toBe(200);
    expect((await api(a.access_token)).status).toBe(401);
    expect((await api(other.access_token)).status).toBe(200);
    client = firstClient;
    expect((await start()).status).toBe(400);
    expect((await exchange(pending)).status).toBe(401);
    expect((await refresh(a.refresh_token)).status).toBe(401);
  });

  it("restricts client deletion to administrators with valid browser mutation checks", async () => {
    const path = `/api/admin/oauth/clients/${client.clientId}`;
    expect((await call(path, { method: "DELETE" })).status).toBe(401);
    expect((await mutation(path, 2, undefined, "DELETE")).status).toBe(403);
    expect((await call(path, { user: 1, method: "DELETE" })).status).toBe(403);
    expect(
      (await mutation(path, 1, undefined, "DELETE", { origin: "https://attacker.example" })).status,
    ).toBe(403);
    expect((await mutation(path, 1, undefined, "DELETE", { "x-csrf-token": "invalid" })).status).toBe(403);
    expect(database.prepare("SELECT count(*) AS n FROM oauth_clients").get().n).toBe(1);
  });

  it("deletes clients and all users' associated requests, grants, codes and rotated tokens, preserving other data", async () => {
    const original = client;
    const a = await tokens(1);
    const b = await tokens(2);
    const rotated = await (await refresh(a.refresh_token)).json();
    const pendingCode = await code();
    const pendingRequest = await consent();
    client = await register();
    const other = await tokens(1);
    const counts = () =>
      ["workout_records", "body_weights", "users"].map(
        (table) => database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,
      );
    const before = counts();
    const response = await mutation(`/api/admin/oauth/clients/${original.clientId}`, 1, undefined, "DELETE");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(counts()).toEqual(before);
    for (const table of ["oauth_clients", "oauth_authorization_requests", "oauth_grants"])
      expect(
        database.prepare(`SELECT count(*) AS n FROM ${table} WHERE client_id = ?`).get(original.clientId).n,
      ).toBe(0);
    // Each remaining row belongs to the other client's one successful authorization.
    for (const table of [
      "oauth_clients",
      "oauth_grants",
      "oauth_authorization_codes",
      "oauth_access_tokens",
      "oauth_refresh_tokens",
    ])
      expect(database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n).toBe(1);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    for (const token of [a.access_token, b.access_token, rotated.access_token])
      expect((await api(token)).status).toBe(401);
    expect((await api(other.access_token)).status).toBe(200);
    client = original;
    expect((await start()).status).toBe(400);
    expect((await exchange(pendingCode)).status).toBe(401);
    expect((await refresh(rotated.refresh_token)).status).toBe(401);
    expect((await call(`/oauth/authorize?request=${pendingRequest.request}`, { user: 1 })).status).toBe(400);
    expect(
      (await (await call("/api/admin/oauth/clients", { user: 1 })).json()).clients.map((c) => c.clientId),
    ).not.toContain(original.clientId);
    expect(
      (await mutation(`/api/admin/oauth/clients/${original.clientId}`, 1, undefined, "DELETE")).status,
    ).toBe(404);
  });

  it("also deletes disabled clients and clients without grants", async () => {
    const first = client.clientId;
    expect((await mutation(`/api/admin/oauth/clients/${first}/disable`, 1)).status).toBe(200);
    expect((await mutation(`/api/admin/oauth/clients/${first}`, 1, undefined, "DELETE")).status).toBe(200);
    const empty = await register();
    expect(
      (await mutation(`/api/admin/oauth/clients/${empty.clientId}`, 1, undefined, "DELETE")).status,
    ).toBe(200);
    expect(database.prepare("SELECT count(*) AS n FROM oauth_clients").get().n).toBe(0);
  });

  it("rolls back related deletions if deleting the client fails", async () => {
    const issued = await tokens();
    const before = [
      "oauth_clients",
      "oauth_authorization_requests",
      "oauth_grants",
      "oauth_authorization_codes",
      "oauth_access_tokens",
      "oauth_refresh_tokens",
    ].map((table) => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() }));
    database.exec(
      "CREATE TRIGGER prevent_client_delete BEFORE DELETE ON oauth_clients BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      (await mutation(`/api/admin/oauth/clients/${client.clientId}`, 1, undefined, "DELETE")).status,
    ).toBe(500);
    for (const { table, rows } of before)
      expect(database.prepare(`SELECT * FROM ${table}`).all()).toEqual(rows);
    expect((await api(issued.access_token)).status).toBe(200);
  });

  it("supports standard revocation, unknown tokens and client ownership validation", async () => {
    const first = await tokens();
    const original = client;
    client = await register();
    const revoke = (token) =>
      call("/oauth/revoke", { method: "POST", form: { token, client_id: client.clientId } });
    expect((await revoke(first.refresh_token)).status).toBe(200);
    expect((await api(first.access_token)).status).toBe(200);
    client = original;
    expect((await revoke("unknown")).status).toBe(200);
    expect((await revoke(first.refresh_token)).status).toBe(200);
    expect((await api(first.access_token)).status).toBe(401);
    expect((await refresh(first.refresh_token)).status).toBe(400);
  });

  it("rejects duplicate token parameters, oversized forms and unsupported grants", async () => {
    expect(
      (
        await call("/oauth/token", {
          method: "POST",
          form: { client_id: client.clientId, grant_type: "password" },
        })
      ).status,
    ).toBe(400);
    const response = await worker.fetch(
      new Request(`${base}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `client_id=${client.clientId}&client_id=other`,
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(
      (
        await call("/oauth/token", {
          method: "POST",
          form: { client_id: client.clientId, x: "x".repeat(17000) },
        })
      ).status,
    ).toBe(413);
  });

  it("limits external requests and supports the emergency stop without disabling management", async () => {
    const issued = await tokens();
    database
      .prepare("INSERT INTO oauth_rate_limits VALUES (?, ?, 300)")
      .run(await sha256("external.ip:local"), Math.floor(nowSeconds() / 60));
    const limited = await api(issued.access_token);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    env.OAUTH_ENABLED = "false";
    expect((await api(issued.access_token)).status).toBe(503);
    expect((await refresh(issued.refresh_token)).status).toBe(503);
    expect((await call("/api/oauth/connections", { user: 1 })).status).toBe(200);
  });

  it("cleans expired grants and dependent data while retaining live refresh hashes", async () => {
    const first = await tokens();
    expect((await refresh(first.refresh_token)).status).toBe(200);
    await tokens(2);
    database.exec(`UPDATE oauth_grants SET expires_at = ${nowSeconds()} WHERE user_id = 1`);
    await cleanupOAuth(env);
    expect(database.prepare("SELECT count(*) AS n FROM oauth_grants").get().n).toBe(1);
    expect(database.prepare("SELECT count(*) AS n FROM oauth_refresh_tokens").get().n).toBe(1);
    expect(database.prepare("SELECT count(*) AS n FROM oauth_access_tokens").get().n).toBe(1);
  });
});

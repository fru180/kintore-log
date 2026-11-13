import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "./index.js";
import { sha256 } from "./oauth-security.js";

describe("body composition API and BMI history", () => {
  let database;
  let env;
  async function call(path = "?date=2026-10-01", { method = "GET", body, user = 1 } = {}) {
    const headers = user ? { cookie: `kintore_session=session-${user}` } : {};
    if (body !== undefined) headers["content-type"] = "application/json";
    return worker.fetch(
      new Request(`https://example.com/api/body-composition${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
  }
  async function save(metric, value, date = "2026-10-01", user = 1) {
    const response = await call("", { method: "POST", body: { date, metric, value }, user });
    expect(response.status).toBe(200);
  }
  async function stats(metric = "bmi", from = "2026-10-01", to = "2026-10-31", user = 1) {
    return (await call(`/stats?metric=${metric}&from=${from}&to=${to}`, { user })).json();
  }
  beforeEach(async () => {
    database = new DatabaseSync(":memory:");
    const migrations = new URL("../migrations/", import.meta.url);
    for (const name of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      database.exec(readFileSync(new URL(name, migrations), "utf8"));
    }
    env = {
      DB: {
        prepare(sql) {
          const statement = database.prepare(sql);
          let params = [];
          return {
            bind(...values) {
              params = values;
              return this;
            },
            async first() {
              return statement.get(...params) ?? null;
            },
            async all() {
              return { results: statement.all(...params) };
            },
            async run() {
              return statement.run(...params);
            },
          };
        },
      },
    };
    for (const id of [1, 2]) {
      database
        .prepare(
          "INSERT INTO users(id, account_name, password_hash, password_salt, is_admin) VALUES (?, ?, 'unused', 'unused', ?)",
        )
        .run(id, `user-${id}`, id === 1 ? 1 : 0);
      database
        .prepare("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, '9999-01-01')")
        .run(await sha256(`session-${id}`), id);
    }
  });
  afterEach(() => database.close());

  it("keeps existing weight records and stores each additional metric independently", async () => {
    database.exec("INSERT INTO body_weights(user_id, measured_date, weight_kg) VALUES (1, '2026-10-01', 60)");
    const values = {
      heightCm: 170,
      bodyFatPercent: 0,
      muscleMassKg: 40.5,
      visceralFatLevel: 3.5,
      basalMetabolismKcal: 1500,
    };
    for (const [metric, value] of Object.entries(values)) await save(metric, value);
    expect(await (await call()).json()).toEqual({
      values: { weightKg: 60, ...values },
      latestValues: { weightKg: 60, ...values },
      bmi: 20.8,
    });
    await save("muscleMassKg", 41);
    expect(await stats("muscleMassKg")).toEqual({ points: [{ date: "2026-10-01", value: 41 }] });
    await call("?date=2026-10-01&metric=muscleMassKg", { method: "DELETE" });
    expect(await stats("muscleMassKg")).toEqual({ points: [] });
    expect((await (await call()).json()).values.heightCm).toBe(170);
  });

  it("only calculates BMI on weight/height days after both inputs exist, never using future values", async () => {
    await save("weightKg", 60);
    await save("bodyFatPercent", 20, "2026-10-02");
    await save("heightCm", 170, "2026-10-03");
    await save("weightKg", 62, "2026-10-04");
    await save("heightCm", 172, "2026-10-05");
    await save("weightKg", 63, "2026-10-05");
    expect(await stats()).toEqual({
      points: [
        { date: "2026-10-03", value: 20.8 },
        { date: "2026-10-04", value: 21.5 },
        { date: "2026-10-05", value: 21.3 },
      ],
    });
    expect((await (await call()).json()).bmi).toBeNull();
    expect((await (await call("?date=2026-10-02")).json()).bmi).toBeNull();
    expect((await (await call("?date=2026-10-06")).json()).bmi).toBeNull();
  });

  it("seeds BMI with values preceding the interval and recalculates after edits and deletes", async () => {
    await save("weightKg", 60, "2025-01-01");
    await save("heightCm", 170, "2025-01-02");
    await save("heightCm", 175, "2026-10-03");
    await save("weightKg", 64, "2026-10-04");
    expect(await stats()).toEqual({
      points: [
        { date: "2026-10-03", value: 19.6 },
        { date: "2026-10-04", value: 20.9 },
      ],
    });
    await save("weightKg", 65, "2025-01-01");
    expect((await stats()).points[0].value).toBe(21.2);
    await call("?date=2026-10-03&metric=heightCm", { method: "DELETE" });
    expect(await stats()).toEqual({ points: [{ date: "2026-10-04", value: 22.1 }] });
    await call("?date=2025-01-02&metric=heightCm", { method: "DELETE" });
    expect(await stats()).toEqual({ points: [] });
  });

  it("shares the weight source with the legacy read and write API", async () => {
    await save("weightKg", 62);
    const legacy = (method, body, query = "") =>
      worker.fetch(
        new Request(`https://example.com/api/body-weight${query}`, {
          method,
          headers: { cookie: "kintore_session=session-1", "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        }),
        env,
      );
    expect(database.prepare("SELECT weight_kg FROM body_weights").get().weight_kg).toBe(62);
    expect((await legacy("POST", { date: "2026-10-01", weightKg: 63 })).status).toBe(200);
    expect(await stats("weightKg")).toEqual({ points: [{ date: "2026-10-01", value: 63 }] });
    await legacy("DELETE", null, "?date=2026-10-01");
    expect(await stats("weightKg")).toEqual({ points: [] });
  });

  it("isolates users including administrators and rejects anonymous access", async () => {
    await save("heightCm", 170, "2026-10-01", 2);
    await save("weightKg", 60, "2026-10-01", 2);
    expect(await (await call()).json()).toEqual({ values: {}, latestValues: {}, bmi: null });
    expect(await stats()).toEqual({ points: [] });
    await call("?date=2026-10-01&metric=heightCm", { method: "DELETE" });
    expect((await stats("bmi", "2026-10-01", "2026-10-31", 2)).points).toHaveLength(1);
    expect((await call(undefined, { user: null })).status).toBe(401);
    expect((await call("/stats?metric=bmi&from=2026-10-01&to=2026-10-31", { user: null })).status).toBe(401);
  });

  it.each([
    ["bmi", 20],
    ["unknown", 1],
    ["weightKg", 19],
    ["weightKg", 501],
    ["heightCm", 0],
    ["bodyFatPercent", -1],
    ["bodyFatPercent", 101],
    ["muscleMassKg", -1],
    ["visceralFatLevel", 0],
    ["basalMetabolismKcal", 0],
    ["heightCm", "170"],
    ["weightKg", null],
  ])("rejects invalid measurement %s=%s", async (metric, value) => {
    expect((await call("", { method: "POST", body: { date: "2026-10-01", metric, value } })).status).toBe(
      400,
    );
  });

  it("validates real dates, intervals and metric names", async () => {
    for (const path of [
      "?date=2026-02-30",
      "?date=wrong",
      "/stats?metric=unknown&from=2026-10-01&to=2026-10-31",
      "/stats?metric=bmi&from=2026-11-01&to=2026-10-01",
    ]) {
      expect((await call(path)).status).toBe(400);
    }
    expect((await call("?date=2026-10-01&metric=bmi", { method: "DELETE" })).status).toBe(400);
  });

  it.each([null, [], "invalid"])("rejects non-object request bodies: %j", async (body) => {
    expect((await call("", { method: "POST", body })).status).toBe(400);
  });

  it("returns each metric's latest saved value across all dates without creating a daily record or BMI", async () => {
    await save("weightKg", 60, "2026-09-01");
    await save("weightKg", 62, "2026-11-01");
    await save("heightCm", 170, "2026-09-02");
    await save("bodyFatPercent", 20, "2026-09-03");
    await save("bodyFatPercent", 0, "2026-11-02");
    await save("muscleMassKg", 40, "2026-09-04");
    await save("visceralFatLevel", 3.5, "2026-09-05");
    await save("basalMetabolismKcal", 1500, "2026-09-06");
    // Even a date before any records receives all-period defaults, just like workouts.
    for (const date of ["2025-01-01", "2026-10-01", "2027-01-01"]) {
      expect(await (await call(`?date=${date}`)).json()).toEqual({
        values: {},
        bmi: null,
        latestValues: {
          weightKg: 62,
          heightCm: 170,
          bodyFatPercent: 0,
          muscleMassKg: 40,
          visceralFatLevel: 3.5,
          basalMetabolismKcal: 1500,
        },
      });
      expect(await stats("bmi", date, date)).toEqual({ points: [] });
      expect(await stats("weightKg", date, date)).toEqual({ points: [] });
    }
    const day = await (await call("?date=2026-09-01")).json();
    expect(day.values).toEqual({ weightKg: 60 });
    expect(day.latestValues.weightKg).toBe(62);
    expect(day.bmi).toBeNull();
  });

  it("falls back to the remaining latest value after deleting a record, or omits a metric without history", async () => {
    await save("weightKg", 60, "2026-09-01");
    await save("weightKg", 62);
    await save("heightCm", 170);
    await call("?date=2026-10-01&metric=weightKg", { method: "DELETE" });
    await call("?date=2026-10-01&metric=heightCm", { method: "DELETE" });
    expect(await (await call()).json()).toEqual({ values: {}, latestValues: { weightKg: 60 }, bmi: null });
    await call("?date=2026-09-01&metric=weightKg", { method: "DELETE" });
    expect(await (await call()).json()).toEqual({ values: {}, latestValues: {}, bmi: null });
  });
});

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleWorkouts } from "./workouts.js";

describe("export API", () => {
  let database;
  let env;
  let request;

  beforeEach(async () => {
    database = new DatabaseSync(":memory:");
    database.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
    database.exec(`
      INSERT INTO users (id, account_name, password_hash, password_salt) VALUES
        (1, 'user-one', 'unused', 'unused'), (2, 'user-two', 'unused', 'unused');
      INSERT INTO workout_records (user_id, exercise_id, workout_date, weight_kg) VALUES
        (1, 1, '2020-01-01', 10), (1, 1, '2026-10-25', 87.5),
        (1, 2, '2026-10-25', 0), (2, 1, '2026-10-25', 999);
      INSERT INTO workout_records (user_id, exercise_id, workout_date, distance_km, duration_minutes)
        VALUES (1, 16, '2026-10-24', 5, 30);
      INSERT INTO body_weights (user_id, measured_date, weight_kg) VALUES (1, '2026-10-25', 60);
    `);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("test-session"));
    const tokenHash = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
    database
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, 1, '9999-01-01')")
      .run(tokenHash);

    env = {
      DB: {
        prepare(sql) {
          const statement = database.prepare(sql);
          let values = [];
          return {
            bind(...params) {
              values = params;
              return this;
            },
            async first() {
              return statement.get(...values) ?? null;
            },
            async all() {
              return { results: statement.all(...values) };
            },
          };
        },
        batch(statements) {
          return Promise.all(statements.map((statement) => statement.all()));
        },
      },
    };
    request = new Request("https://example.com/api/export", {
      headers: { cookie: "kintore_session=test-session" },
    });
  });

  afterEach(() => database.close());

  it("returns all dates for the authenticated user, excluding cardio, body weight and other users", async () => {
    const response = await handleWorkouts(request, env, new URL(request.url), "/api/export", "GET");
    const data = await response.json();
    expect(data.records).toEqual([
      { exerciseId: 1, date: "2020-01-01", weightKg: 10 },
      { exerciseId: 1, date: "2026-10-25", weightKg: 87.5 },
      { exerciseId: 2, date: "2026-10-25", weightKg: 0 },
    ]);
    expect(data.exercises).toHaveLength(15);
    expect(data.exercises[0]).toEqual({ id: 1, name: "レッグプレス", sortOrder: 1 });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects unauthenticated requests", async () => {
    const anonymous = new Request(request.url);
    await expect(
      handleWorkouts(anonymous, env, new URL(anonymous.url), "/api/export", "GET"),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("returns an empty history when the user has no strength records", async () => {
    database.exec("DELETE FROM workout_records WHERE user_id = 1 AND exercise_id != 16");
    const response = await handleWorkouts(request, env, new URL(request.url), "/api/export", "GET");
    expect((await response.json()).records).toEqual([]);
  });
});

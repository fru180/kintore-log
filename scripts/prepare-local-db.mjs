import { pbkdf2Sync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const databaseName = "kintore-log";
const accountName = "test";
const password = "test1234";
const salt = randomBytes(16).toString("hex");
const passwordHash = pbkdf2Sync(password, Buffer.from(salt, "hex"), 100_000, 32, "sha256").toString("hex");
const wranglerCommand = process.platform === "win32" ? "wrangler.cmd" : "wrangler";

function runWrangler(args) {
  const result = spawnSync(wranglerCommand, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runWrangler(["d1", "migrations", "apply", databaseName, "--local"]);

const sql = `
  INSERT INTO users (account_name, password_hash, password_salt)
  VALUES ('${accountName}', '${passwordHash}', '${salt}')
  ON CONFLICT(account_name) DO UPDATE SET
    password_hash = excluded.password_hash,
    password_salt = excluded.password_salt;
`;

runWrangler(["d1", "execute", databaseName, "--local", "--command", sql]);
console.log(`Local test account is ready: ${accountName} / ${password}`);

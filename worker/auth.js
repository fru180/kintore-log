import { ApiError, json, readJson } from "./http.js";

const encoder = new TextEncoder();
const SESSION_DAYS = 30;
const APP_BASE_PATH = "/kintore-log";
const PBKDF2_ITERATIONS = 100_000;

const toHex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (length) => toHex(crypto.getRandomValues(new Uint8Array(length)));
const sha256 = async (value) => toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

async function passwordHash(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return toHex(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
      key,
      256,
    ),
  );
}

function cookieValue(request, name) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `kintore_session=${encodeURIComponent(token)}; Path=${APP_BASE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function currentUser(request, env) {
  const token = cookieValue(request, "kintore_session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(
    `SELECT users.id, users.account_name AS accountName, users.is_admin AS isAdmin
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now')`,
  )
    .bind(tokenHash)
    .first();
}

export async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw new ApiError("ログインが必要です", 401);
  return user;
}

export async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (!user.isAdmin) throw new ApiError("管理者権限が必要です", 403);
  return user;
}

export async function handleAuth(request, env, path, method) {
  if (path === "/api/auth/me" && method === "GET") {
    return json({ user: await currentUser(request, env) });
  }

  if (path === "/api/auth/register" && method === "POST") {
    const body = await readJson(request);
    const accountName = String(body.accountName || "").trim();
    const password = String(body.password || "");
    if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(accountName)) {
      throw new ApiError("アカウント名は3〜32文字の英数字・日本語・._-で入力してください");
    }
    if (password.length < 8 || password.length > 128) {
      throw new ApiError("パスワードは8〜128文字で入力してください");
    }
    const existing = await env.DB.prepare("SELECT id FROM users WHERE account_name = ? COLLATE NOCASE")
      .bind(accountName)
      .first();
    if (existing) throw new ApiError("このアカウント名は使用されています", 409);
    const salt = randomHex(16);
    const hash = await passwordHash(password, salt);
    const result = await env.DB.prepare(
      "INSERT INTO users (account_name, password_hash, password_salt) VALUES (?, ?, ?)",
    )
      .bind(accountName, hash, salt)
      .run();
    return json({ id: result.meta.last_row_id, accountName }, 201);
  }

  if (path === "/api/auth/login" && method === "POST") {
    const body = await readJson(request);
    const accountName = String(body.accountName || "").trim();
    const password = String(body.password || "");
    const user = await env.DB.prepare(
      "SELECT id, account_name AS accountName, password_hash AS passwordHash, password_salt AS passwordSalt, is_admin AS isAdmin FROM users WHERE account_name = ? COLLATE NOCASE",
    )
      .bind(accountName)
      .first();
    if (!user || (await passwordHash(password, user.passwordSalt)) !== user.passwordHash) {
      throw new ApiError("アカウント名またはパスワードが違います", 401);
    }
    const token = randomHex(32);
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(
        await sha256(token),
        user.id,
        expires,
      ),
    ]);
    return json({ user: { id: user.id, accountName: user.accountName, isAdmin: user.isAdmin } }, 200, {
      "set-cookie": sessionCookie(request, token, SESSION_DAYS * 86400),
    });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const token = cookieValue(request, "kintore_session");
    if (token)
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(await sha256(token))
        .run();
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(request, "", 0) });
  }

  return null;
}

import { handleAuth } from "./auth.js";
import { handleExercises } from "./exercises.js";
import { ApiError, fail, json } from "./http.js";
import { handleWorkouts } from "./workouts.js";
import { cleanupOAuth, handleOAuth } from "./oauth.js";
import { handleOAuthManagement } from "./oauth-management.js";
import { handleExternalApi } from "./external-api.js";

const APP_BASE_PATH = "/kintore-log";

function withoutAppBasePath(pathname) {
  if (pathname === APP_BASE_PATH) return "/";
  if (pathname.startsWith(`${APP_BASE_PATH}/`)) return pathname.slice(APP_BASE_PATH.length);
  return pathname;
}

function requestWithoutAppBasePath(request) {
  const url = new URL(request.url);
  url.pathname = withoutAppBasePath(url.pathname);
  return new Request(url, request);
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health") return json({ ok: true });

  const response =
    (await handleOAuthManagement(request, env, path, method)) ??
    (await handleAuth(request, env, path, method)) ??
    (await handleExercises(request, env, path, method)) ??
    (await handleWorkouts(request, env, url, path, method));

  if (response) return response;
  throw new ApiError("APIが見つかりません", 404);
}

export default {
  async fetch(request, env) {
    const appRequest = requestWithoutAppBasePath(request);
    const url = new URL(appRequest.url);
    if (
      url.pathname.startsWith("/oauth/") ||
      url.pathname === "/.well-known/oauth-authorization-server/kintore-log"
    )
      return handleOAuth(appRequest, env, url.pathname);
    if (url.pathname.startsWith("/api/v1/")) return handleExternalApi(appRequest, env, url, url.pathname);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(appRequest);
    try {
      return await route(appRequest, env);
    } catch (error) {
      if (error instanceof ApiError)
        return fail(error.message, error.status, {
          "cache-control": "no-store",
          ...(error.status === 429 ? { "retry-after": "60" } : {}),
        });
      console.error("Unhandled API error");
      return fail("サーバーでエラーが発生しました", 500);
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupOAuth(env));
  },
};

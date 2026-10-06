export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

export const fail = (message, status = 400) => json({ error: message }, status);

export const readJson = async (request) => {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new ApiError("JSON形式で送信してください", 415);
  try {
    return await request.json();
  } catch {
    throw new ApiError("入力内容を読み取れませんでした", 400);
  }
};

export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const numberIn = (value, min, max) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: isForm || body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const result = await response.json() as { error?: string; message?: string; code?: string };
  if (!response.ok) {
    throw new ApiError(typeof result.error === "string" ? result.error : result.message || "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", response.status, result.code);
  }
  return result as T;
}

import type { ZodSchema } from "zod";
import { corsPreflightResponse, errorResponse, proxyJson } from "./config.server";

export function saasOptions(request: Request): Response | null {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }
  return null;
}

export async function saasProxy(
  path: string,
  request: Request,
  init?: RequestInit,
): Promise<Response> {
  const options = saasOptions(request);
  if (options) {
    return options;
  }
  return proxyJson(path, init, request);
}

export async function saasJsonAction<T>(
  request: Request,
  path: string,
  schema: ZodSchema<T>,
  method = "POST",
): Promise<Response> {
  const options = saasOptions(request);
  if (options) {
    return options;
  }
  if (request.method !== method) {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
  }
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.message, 422, request);
  }
  return proxyJson(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    },
    request,
  );
}

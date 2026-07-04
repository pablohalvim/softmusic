export interface ServerConfig {
  pythonAiUrl: string;
  redisUrl: string;
  webOrigin: string;
  adminOrigin: string;
}

export function getServerConfig(): ServerConfig {
  return {
    pythonAiUrl: process.env.PYTHON_AI_URL ?? "http://localhost:8000",
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379/0",
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    adminOrigin: process.env.ADMIN_ORIGIN ?? "http://localhost:5174",
  };
}

function allowedOrigins(): string[] {
  const { webOrigin, adminOrigin } = getServerConfig();
  return [webOrigin, adminOrigin];
}

export function corsHeaders(request?: Request): Headers {
  const headers = new Headers();
  const origin = request?.headers.get("Origin");
  const allowed = allowedOrigins();
  headers.set(
    "Access-Control-Allow-Origin",
    origin && allowed.includes(origin) ? origin : allowed[0],
  );
  headers.set("Vary", "Origin");
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept, X-Band-Id, asaas-access-token",
  );
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

/**
 * Copies the CORS headers onto an existing response. Used by the root
 * middleware so every response (including framework-generated errors and
 * preflight OPTIONS) carries the headers the browser requires cross-origin.
 */
export function applyCorsHeaders(response: Response, request?: Request): Response {
  const cors = corsHeaders(request);
  cors.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
}

export function upstreamAuthHeaders(request?: Request): Headers {
  const headers = new Headers();
  if (!request) {
    return headers;
  }
  const authorization = request.headers.get("Authorization");
  const bandId = request.headers.get("X-Band-Id");
  const asaasToken = request.headers.get("asaas-access-token");
  if (authorization) {
    headers.set("Authorization", authorization);
  }
  if (bandId) {
    headers.set("X-Band-Id", bandId);
  }
  if (asaasToken) {
    headers.set("asaas-access-token", asaasToken);
  }
  return headers;
}

function mergeHeaders(base: Headers, extra?: HeadersInit): Headers {
  const merged = new Headers(base);
  if (extra) {
    for (const [key, value] of new Headers(extra)) {
      merged.set(key, value);
    }
  }
  return merged;
}

export function corsPreflightResponse(request?: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function jsonResponse(data: unknown, init: ResponseInit = {}, request?: Request): Response {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/vnd.softmusic.v1+json");
  if (init.headers) {
    for (const [key, value] of new Headers(init.headers)) {
      headers.set(key, value);
    }
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(
  code: string,
  message: string,
  status = 400,
  request?: Request,
): Response {
  return jsonResponse({ error: { code, message } }, { status }, request);
}

export async function proxyJson(path: string, init?: RequestInit, request?: Request): Promise<Response> {
  const { pythonAiUrl } = getServerConfig();
  const headers = mergeHeaders(upstreamAuthHeaders(request), init?.headers);
  try {
    const response = await fetch(`${pythonAiUrl}/internal${path}`, { ...init, headers });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      return errorResponse(
        "UPSTREAM_ERROR",
        text || "Resposta inválida do serviço de IA",
        response.status || 502,
        request,
      );
    }
    return jsonResponse(payload, { status: response.status }, request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Serviço de IA indisponível";
    return errorResponse("UPSTREAM_UNAVAILABLE", message, 503, request);
  }
}

export async function proxyRaw(path: string, init?: RequestInit, request?: Request): Promise<Response> {
  const { pythonAiUrl } = getServerConfig();
  const headers = mergeHeaders(upstreamAuthHeaders(request), init?.headers);
  const response = await fetch(`${pythonAiUrl}/internal${path}`, { ...init, headers });
  const payload = await response.text();
  return new Response(payload, {
    status: response.status,
    headers: {
      "Content-Type": "application/vnd.softmusic.v1+json",
    },
  });
}

const BINARY_FORWARD_HEADERS = [
  "Content-Type",
  "Content-Length",
  "Content-Disposition",
  "Accept-Ranges",
  "Content-Range",
  "Cache-Control",
  "ETag",
  "Last-Modified",
] as const;

export async function proxyBinary(path: string, request?: Request): Promise<Response> {
  const { pythonAiUrl } = getServerConfig();
  const headers = upstreamAuthHeaders(request);
  const range = request?.headers.get("Range");
  if (range) {
    headers.set("Range", range);
  }

  // redirect:"manual" para NÃO seguir o 302 do python-ai internamente. Assim o
  // browser é redirecionado direto para a URL pré-assinada do R2 (offload de
  // banda da VPS). Em modo local o python-ai responde 200 e seguimos normal.
  const response = await fetch(`${pythonAiUrl}/internal${path}`, {
    headers,
    redirect: "manual",
  });
  const responseHeaders = new Headers();
  const origin = request?.headers.get("Origin");
  const allowed = allowedOrigins();
  responseHeaders.set(
    "Access-Control-Allow-Origin",
    origin && allowed.includes(origin) ? origin : allowed[0],
  );

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("Location");
    if (location) {
      responseHeaders.set("Location", location);
      return new Response(null, { status: response.status, headers: responseHeaders });
    }
  }

  for (const name of BINARY_FORWARD_HEADERS) {
    const value = response.headers.get(name);
    if (value) {
      responseHeaders.set(name, value);
    }
  }

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

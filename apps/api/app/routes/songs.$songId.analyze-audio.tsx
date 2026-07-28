import { z } from "zod";
import type { Route } from "./+types/songs.$songId.analyze-audio";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";

const Schema = z.object({
  source: z.object({
    type: z.enum(["youtube", "http", "s3", "azure_blob", "gcs"]),
    url: z.string().url().min(8),
  }),
  options: z.record(z.string(), z.unknown()).optional().nullable(),
});

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }

  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
  }

  const songId = params.songId;
  if (!songId) {
    return errorResponse("VALIDATION_ERROR", "songId is required", 422, request);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "JSON inválido", 422, request);
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.message, 422, request);
  }

  const url = new URL(request.url);
  const replace = url.searchParams.get("replace") === "true";
  const path = `/songs/${encodeURIComponent(songId)}/analyze-audio${replace ? "?replace=true" : ""}`;

  return proxyJson(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    },
    request,
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }
  return errorResponse("METHOD_NOT_ALLOWED", "Use POST", 405, request);
}

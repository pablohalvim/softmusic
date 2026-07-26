import type { Route } from "./+types/songs.$songId.analyze-audio-upload";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";

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

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return errorResponse("VALIDATION_ERROR", "file is required", 422, request);
  }

  const outbound = new FormData();
  outbound.set("file", file, file.name);
  const options = formData.get("options");
  if (typeof options === "string") {
    outbound.set("options", options);
  }

  const url = new URL(request.url);
  const replace = url.searchParams.get("replace") === "true" || formData.get("replace") === "true";
  const path = `/songs/${encodeURIComponent(songId)}/analyze-audio-upload${replace ? "?replace=true" : ""}`;

  return proxyJson(
    path,
    {
      method: "POST",
      body: outbound,
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

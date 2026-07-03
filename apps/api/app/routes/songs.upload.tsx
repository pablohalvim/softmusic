import type { Route } from "./+types/songs.upload";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }

  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
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

  return proxyJson(
    "/songs/upload",
    {
      method: "POST",
      body: outbound,
    },
    request,
  );
}

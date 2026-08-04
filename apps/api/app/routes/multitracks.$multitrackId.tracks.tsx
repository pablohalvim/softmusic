import type { Route } from "./+types/multitracks.$multitrackId.tracks";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";

export async function action({ request, params }: Route.ActionArgs) {
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
  const name = formData.get("name");
  const role = formData.get("role");
  if (typeof name === "string" && name.trim()) outbound.set("name", name.trim());
  if (typeof role === "string" && role.trim()) outbound.set("role", role.trim());

  return proxyJson(
    `/multitracks/${params.multitrackId}/tracks`,
    { method: "POST", body: outbound },
    request,
  );
}

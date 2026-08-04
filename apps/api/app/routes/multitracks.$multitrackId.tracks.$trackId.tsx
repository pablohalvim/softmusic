import type { Route } from "./+types/multitracks.$multitrackId.tracks.$trackId";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }
  if (request.method === "PATCH") {
    const body = await request.json();
    return proxyJson(
      `/multitracks/${params.multitrackId}/tracks/${params.trackId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      request,
    );
  }
  if (request.method === "DELETE") {
    return proxyJson(
      `/multitracks/${params.multitrackId}/tracks/${params.trackId}`,
      { method: "DELETE" },
      request,
    );
  }
  return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
}

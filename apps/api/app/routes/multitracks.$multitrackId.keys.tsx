import type { Route } from "./+types/multitracks.$multitrackId.keys";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return proxyJson(`/multitracks/${params.multitrackId}/keys`, undefined, request);
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }
  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
  }
  const body = await request.json();
  return proxyJson(
    `/multitracks/${params.multitrackId}/keys`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    request,
  );
}

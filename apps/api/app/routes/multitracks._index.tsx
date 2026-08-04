import type { Route } from "./+types/multitracks._index";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  return proxyJson(`/multitracks${qs ? `?${qs}` : ""}`, undefined, request);
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }
  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
  }
  const body = await request.json();
  return proxyJson(
    "/multitracks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    request,
  );
}

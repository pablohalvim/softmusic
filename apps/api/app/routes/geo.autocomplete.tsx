import type { Route } from "./+types/geo.autocomplete";
import { proxyJson } from "../server/config.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  return proxyJson(`/geo/autocomplete${query ? `?${query}` : ""}`, undefined, request);
}

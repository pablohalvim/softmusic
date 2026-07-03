import type { Route } from "./+types/songs._index";
import { proxyJson } from "../server/config.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  return proxyJson(`/songs${query ? `?${query}` : ""}`, undefined, request);
}

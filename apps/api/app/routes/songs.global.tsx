import type { Route } from "./+types/songs.global";
import { proxyJson } from "../server/config.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  return proxyJson(`/songs/global${query ? `?${query}` : ""}`, undefined, request);
}

import type { Route } from "./+types/songs.$songId.share";
import { proxyJson } from "../server/config.server";

export async function action({ request, params }: Route.ActionArgs) {
  return proxyJson(`/songs/${params.songId}/share`, { method: "POST" }, request);
}

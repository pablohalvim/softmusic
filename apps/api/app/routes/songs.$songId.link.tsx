import type { Route } from "./+types/songs.$songId.link";
import { proxyJson } from "../server/config.server";

export async function action({ request, params }: Route.ActionArgs) {
  return proxyJson(`/songs/${params.songId}/link`, { method: "POST" }, request);
}

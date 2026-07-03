import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("cadastro", "routes/cadastro.tsx"),
  route("convite", "routes/convite.tsx"),
  route("bandas", "routes/bandas.tsx"),
  route("faturas", "routes/faturas.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("library", "routes/library.tsx"),
  route("analyze", "routes/analyze.tsx"),
  route("jobs/:jobId", "routes/jobs.$jobId.tsx"),
  route("songs/:songId", "routes/songs.$songId.tsx"),
  route("songs/:songId/cifra", "routes/songs.$songId.cifra.tsx"),
] satisfies RouteConfig;

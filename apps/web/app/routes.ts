import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("esqueci-senha", "routes/esqueci-senha.tsx"),
  route("cadastro", "routes/cadastro.tsx"),
  route("convite", "routes/convite.tsx"),
  route("go/maps", "routes/go.maps.tsx"),
  route("bandas", "routes/bandas.tsx"),
  route("bandas/:bandId", "routes/bandas.$bandId.tsx"),
  route("bandas/:bandId/agenda/nova", "routes/bandas.$bandId.agenda.nova.tsx"),
  route(
    "bandas/:bandId/agenda/:scheduleId/editar",
    "routes/bandas.$bandId.agenda.$scheduleId.editar.tsx",
  ),
  route("faturas", "routes/faturas.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("agenda", "routes/agenda.tsx"),
  route("agenda/:bandId/:scheduleId", "routes/agenda.$bandId.$scheduleId.tsx"),
  route("library", "routes/library.tsx"),
  route("multitracks", "routes/multitracks.tsx"),
  route("multitracks/:multitrackId", "routes/multitracks.$multitrackId.tsx"),
  route("analyze", "routes/analyze.tsx"),
  route("jobs/:jobId", "routes/jobs.$jobId.tsx"),
  route("songs/:songId", "routes/songs.$songId.tsx"),
  route("songs/:songId/cifra", "routes/songs.$songId.cifra.tsx"),
] satisfies RouteConfig;

const appUrl = import.meta.env.VITE_APP_URL ?? "https://app.softmusic.com.br";

function appLink(path: string): string {
  return `${appUrl.replace(/\/$/, "")}${path}`;
}

for (const id of ["login-link", "footer-login"]) {
  const el = document.getElementById(id);
  if (el) el.setAttribute("href", appLink("/login"));
}

for (const id of ["signup-link", "hero-cta"]) {
  const el = document.getElementById(id);
  if (el) el.setAttribute("href", appLink("/cadastro"));
}

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

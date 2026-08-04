import { PendingInvitesCard } from "../components/PendingInvitesCard";
import { HomeBento } from "../components/ui/HomeBento";
import { useAuth } from "../lib/auth-context";

export default function Home() {
  const { user } = useAuth();

  return (
    <section className="space-y-6 sm-animate-in">
      {user ? <PendingInvitesCard /> : null}
      <HomeBento loggedIn={Boolean(user)} />
    </section>
  );
}

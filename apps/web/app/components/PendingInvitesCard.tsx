import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  acceptPendingInvite,
  declinePendingInvite,
  fetchPendingInvites,
  type PendingInvite,
} from "../lib/api";
import { useBand } from "../lib/band-context";
import { btnGhost, btnPrimary, panelClass } from "../lib/ui-classes";

export function PendingInvitesCard() {
  const queryClient = useQueryClient();
  const { refreshBands, setActiveBandId } = useBand();
  const [actionError, setActionError] = useState<string | null>(null);

  const invitesQuery = useQuery({
    queryKey: ["pending-invites"],
    queryFn: fetchPendingInvites,
    staleTime: 30_000,
  });

  const acceptMutation = useMutation({
    mutationFn: acceptPendingInvite,
    onSuccess: async (_data, inviteId) => {
      const invite = invitesQuery.data?.find((item) => item.id === inviteId);
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      await refreshBands();
      if (invite?.band_id) {
        setActiveBandId(invite.band_id);
      }
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Erro ao aceitar");
    },
  });

  const declineMutation = useMutation({
    mutationFn: declinePendingInvite,
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Erro ao recusar");
    },
  });

  const invites = invitesQuery.data ?? [];
  if (invitesQuery.isLoading || invites.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3" aria-label="Convites pendentes">
      {actionError ? <p className="text-sm text-red-400">{actionError}</p> : null}
      {invites.map((invite) => (
        <InviteCard
          key={invite.id}
          invite={invite}
          busy={acceptMutation.isPending || declineMutation.isPending}
          onAccept={() => acceptMutation.mutate(invite.id)}
          onDecline={() => declineMutation.mutate(invite.id)}
        />
      ))}
    </section>
  );
}

function InviteCard({
  invite,
  busy,
  onAccept,
  onDecline,
}: {
  invite: PendingInvite;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <article className={`${panelClass} border-green-500/25 bg-green-500/[0.06] p-4 sm:p-5`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-green-300/80">
            Convite pendente
          </p>
          <h2 className="truncate text-lg font-semibold text-slate-50">{invite.band_name}</h2>
          <p className="text-sm text-slate-400">
            Você foi convidado para entrar nesta banda
            {invite.can_analyze_songs ? " com permissão para analisar músicas" : ""}.
          </p>
        </div>
        <div className="flex w-full shrink-0 gap-2 sm:w-auto">
          <button
            type="button"
            disabled={busy}
            onClick={onDecline}
            className={`${btnGhost} flex-1 px-4 py-2.5 text-sm disabled:opacity-60 sm:flex-none`}
          >
            Recusar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onAccept}
            className={`${btnPrimary} flex-1 px-4 py-2.5 text-sm disabled:opacity-60 sm:flex-none`}
          >
            Aceitar
          </button>
        </div>
      </div>
    </article>
  );
}

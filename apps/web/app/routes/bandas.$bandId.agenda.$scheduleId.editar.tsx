import { Link, useParams, useSearchParams } from "react-router";

import { BandManageChrome, useCanManageBand } from "../components/BandManageChrome";
import { ScheduleForm } from "../components/ScheduleForm";
import { linkClass } from "../lib/ui-classes";

export default function EditarEscalaPage() {
  const { bandId = "", scheduleId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const occurrenceId = searchParams.get("occurrenceId");
  const canManage = useCanManageBand(bandId);

  return (
    <BandManageChrome bandId={bandId} activeTab="agenda">
      {canManage ? (
        <ScheduleForm
          bandId={bandId}
          mode="edit"
          scheduleId={scheduleId}
          occurrenceId={occurrenceId}
        />
      ) : (
        <p className="text-sm text-slate-400">
          Somente gestores podem editar escalas.{" "}
          <Link to={`/bandas/${bandId}?tab=agenda`} className={linkClass}>
            Voltar
          </Link>
        </p>
      )}
    </BandManageChrome>
  );
}

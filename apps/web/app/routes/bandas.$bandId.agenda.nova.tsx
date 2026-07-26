import { Link, useParams } from "react-router";

import { BandManageChrome, useCanManageBand } from "../components/BandManageChrome";
import { ScheduleForm } from "../components/ScheduleForm";
import { linkClass } from "../lib/ui-classes";

export default function NovaEscalaPage() {
  const { bandId = "" } = useParams();
  const canManage = useCanManageBand(bandId);

  return (
    <BandManageChrome bandId={bandId} activeTab="agenda">
      {canManage ? (
        <ScheduleForm bandId={bandId} mode="create" />
      ) : (
        <p className="text-sm text-slate-400">
          Somente gestores podem criar escalas.{" "}
          <Link to={`/bandas/${bandId}?tab=agenda`} className={linkClass}>
            Voltar
          </Link>
        </p>
      )}
    </BandManageChrome>
  );
}

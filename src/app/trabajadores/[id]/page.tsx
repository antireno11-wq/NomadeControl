import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdminRole, isSupervisorRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { updateWorkerAction } from "@/app/trabajadores/actions";
import { WorkerForm } from "@/app/trabajadores/worker-form";
import { formatDisplayDate, toInputDateValue } from "@/lib/report-utils";
import { getNearestDocument, getStaffDocumentEntries } from "@/lib/staff-docs";

export default async function EditarTrabajadorPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: { status?: string | string[] };
}) {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);

  const [worker, camps] = await Promise.all([
    db.staffMember.findUnique({
      where: { id: params.id },
      include: { camp: true }
    }),
    db.camp.findMany({
      where: { isActive: true, ...(isSupervisorRole(user.role) && user.campId ? { id: user.campId } : {}) },
      orderBy: { name: "asc" }
    })
  ]);

  if (!worker) notFound();
  if (isSupervisorRole(user.role) && worker.campId !== user.campId) {
    redirect("/trabajadores?status=forbidden");
  }

  const docs = getStaffDocumentEntries(worker);
  const nearest = getNearestDocument(worker);
  const statusRaw = searchParams?.status;
  const status = typeof statusRaw === "string" ? statusRaw : "";
  const alert =
    status === "updated"
      ? { type: "success", text: "Trabajador actualizado correctamente." }
      : status === "invalid"
        ? { type: "error", text: "Revisa los datos del trabajador." }
        : status === "forbidden"
          ? { type: "error", text: "No puedes editar trabajadores de otro campamento." }
          : null;

  return (
    <AppShell
      title="Editar trabajador"
      user={user}
      activeNav="trabajadores"
      showAdminSections={canSeeAdminSections}
      rightSlot={
        <Link href="/trabajadores">
          <button type="button" className="secondary">Volver</button>
        </Link>
      }
    >
      <div className="page-stack">
        {alert ? <div className={`alert ${alert.type}`}>{alert.text}</div> : null}

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Resumen documental</h2>
          <div className="summary-grid">
            <div className="metric">
              <div className="label">Trabajador</div>
              <div className="value" style={{ fontSize: "1rem" }}>{worker.fullName}</div>
            </div>
            <div className="metric">
              <div className="label">Campamento</div>
              <div className="value" style={{ fontSize: "1rem" }}>{worker.camp.name}</div>
            </div>
            <div className="metric">
              <div className="label">Próximo vencimiento</div>
              <div className="value" style={{ fontSize: "1rem" }}>
                {nearest?.date ? `${nearest.label} · ${formatDisplayDate(nearest.date)}` : "Sin fechas"}
              </div>
            </div>
            <div className="metric">
              <div className="label">Estado</div>
              <div className="value" style={{ fontSize: "1rem" }}>
                {docs.some((entry) => entry.status === "expired")
                  ? "Con vencidos"
                  : docs.some((entry) => entry.status === "dueSoon")
                    ? "Por vencer"
                    : "Al día"}
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ maxWidth: 860 }}>
          <h2 style={{ marginTop: 0 }}>Ficha del trabajador</h2>
          <WorkerForm
            action={updateWorkerAction}
            workerId={worker.id}
            camps={camps.map((camp) => ({ id: camp.id, name: camp.name }))}
            fixedCampId={isSupervisorRole(user.role) ? worker.campId : undefined}
            fixedCampName={isSupervisorRole(user.role) ? worker.camp.name : undefined}
            successRedirectTo={`/trabajadores/${worker.id}?status=updated`}
            errorRedirectTo={`/trabajadores/${worker.id}`}
            submitLabel="Guardar cambios"
            defaults={{
              campId: worker.campId,
              fullName: worker.fullName,
              role: worker.role ?? "",
              employerCompany: worker.employerCompany ?? "",
              nationalId: worker.nationalId ?? "",
              phone: worker.phone ?? "",
              personalEmail: worker.personalEmail ?? "",
              shiftPattern: worker.shiftPattern,
              shiftStartDate: toInputDateValue(worker.shiftStartDate),
              contractEndDate: worker.contractEndDate ? toInputDateValue(worker.contractEndDate) : "",
              altitudeExamDueDate: worker.altitudeExamDueDate ? toInputDateValue(worker.altitudeExamDueDate) : "",
              occupationalExamDueDate: worker.occupationalExamDueDate ? toInputDateValue(worker.occupationalExamDueDate) : "",
              inductionDueDate: worker.inductionDueDate ? toInputDateValue(worker.inductionDueDate) : "",
              accreditationDueDate: worker.accreditationDueDate ? toInputDateValue(worker.accreditationDueDate) : "",
              driversLicenseDueDate: worker.driversLicenseDueDate ? toInputDateValue(worker.driversLicenseDueDate) : "",
              notes: worker.notes ?? "",
              isActive: worker.isActive
            }}
          />
        </div>
      </div>
    </AppShell>
  );
}

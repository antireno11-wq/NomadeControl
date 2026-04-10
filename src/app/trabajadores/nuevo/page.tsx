import Link from "next/link";
import { isAdminRole, isSupervisorRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { createWorkerAction } from "@/app/trabajadores/actions";
import { WorkerForm } from "@/app/trabajadores/worker-form";
import { toInputDateValue } from "@/lib/report-utils";

export default async function NuevoTrabajadorPage({
  searchParams
}: {
  searchParams?: { status?: string | string[] };
}) {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);

  const camps = await db.camp.findMany({
    where: { isActive: true, ...(isSupervisorRole(user.role) && user.campId ? { id: user.campId } : {}) },
    orderBy: { name: "asc" }
  });

  const fixedCamp = isSupervisorRole(user.role) ? camps[0] ?? null : null;
  const statusRaw = searchParams?.status;
  const status = typeof statusRaw === "string" ? statusRaw : "";
  const alert =
    status === "invalid"
      ? { type: "error", text: "Revisa los datos del trabajador." }
      : status === "forbidden"
        ? { type: "error", text: "Solo puedes cargar trabajadores de tu campamento." }
        : status === "no-camp"
          ? { type: "error", text: "Tu usuario no tiene campamento asignado." }
          : null;

  return (
    <AppShell
      title="Nuevo trabajador"
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

        <div className="card" style={{ maxWidth: 860 }}>
          <h2 style={{ marginTop: 0 }}>Alta de trabajador</h2>
          <div className="section-caption" style={{ marginBottom: 12 }}>
            Carga la ficha base del trabajador y sus fechas de vencimiento para que el supervisor pueda controlar la documentación del proyecto.
          </div>
          <WorkerForm
            action={createWorkerAction}
            camps={camps.map((camp) => ({ id: camp.id, name: camp.name }))}
            fixedCampId={fixedCamp?.id}
            fixedCampName={fixedCamp?.name}
            successRedirectTo="/trabajadores?status=created"
            errorRedirectTo="/trabajadores/nuevo"
            submitLabel="Guardar trabajador"
            defaults={{
              campId: fixedCamp?.id ?? "",
              fullName: "",
              role: "",
              employerCompany: "",
              nationalId: "",
              phone: "",
              personalEmail: "",
              shiftPattern: "14x14",
              shiftStartDate: toInputDateValue(new Date()),
              contractEndDate: "",
              altitudeExamDueDate: "",
              occupationalExamDueDate: "",
              inductionDueDate: "",
              accreditationDueDate: "",
              driversLicenseDueDate: "",
              notes: "",
              isActive: true
            }}
          />
        </div>
      </div>
    </AppShell>
  );
}

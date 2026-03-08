import Image from "next/image";
import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { logoutAction } from "@/app/dashboard/actions";
import { OpsNav } from "@/components/ops-nav";
import { TasksForm } from "./tasks-form";

export default async function ControlTareasDiariasPage() {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;

  const [camps, recent] = await Promise.all([
    db.camp.findMany({
      where: {
        isActive: true,
        ...(campFilter ? { id: campFilter } : {})
      },
      orderBy: { name: "asc" }
    }),
    db.dailyTaskControl.findMany({
      where: campFilter ? { campId: campFilter } : undefined,
      take: 15,
      orderBy: [{ date: "desc" }, { camp: { name: "asc" } }],
      include: { camp: true, createdBy: true }
    })
  ]);

  return (
    <main>
      <div className="header">
        <div>
          <div className="brand-inline">
            <Link href="/" aria-label="Ir al inicio">
              <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
            </Link>
          </div>
          <h1>Control de tareas diarias</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Sesión: {user.name} ({user.role})
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <form action={logoutAction}>
            <button className="danger" type="submit">
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>

      <OpsNav active="tareas" showAdminSections={canSeeAdminSections} showLoadSection={!canSeeAdminSections} />

      {!canSeeAdminSections && !user.campId ? (
        <div className="alert error" style={{ marginBottom: 16 }}>
          Tu usuario supervisor no tiene campamento asignado. Pide al administrador que lo configure.
        </div>
      ) : null}

      <div className="grid two">
        {camps.length > 0 ? (
          <TasksForm camps={camps.map((camp) => ({ id: camp.id, name: camp.name }))} defaultDate={toInputDateValue(new Date())} />
        ) : (
          <div className="card">
            <div className="alert error">No hay campamento disponible para registrar tareas.</div>
          </div>
        )}

        <div className="card" style={{ overflowX: "auto" }}>
          <h2 style={{ marginTop: 0 }}>Últimos controles</h2>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Campamento</th>
                <th>Registrado por</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id}>
                  <td>{toInputDateValue(row.date)}</td>
                  <td>{row.camp.name}</td>
                  <td>{row.createdBy.name}</td>
                </tr>
              ))}
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ color: "var(--muted)" }}>
                    Aún no hay controles diarios cargados.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

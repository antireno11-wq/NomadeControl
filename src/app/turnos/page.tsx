import Image from "next/image";
import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { logoutAction } from "@/app/dashboard/actions";
import { OpsNav } from "@/components/ops-nav";
import { StaffForm } from "./staff-form";

const ON_DAYS = 14;
const OFF_DAYS = 14;
const CYCLE_DAYS = ON_DAYS + OFF_DAYS;

function daysBetween(dateA: Date, dateB: Date) {
  const a = new Date(Date.UTC(dateA.getUTCFullYear(), dateA.getUTCMonth(), dateA.getUTCDate()));
  const b = new Date(Date.UTC(dateB.getUTCFullYear(), dateB.getUTCMonth(), dateB.getUTCDate()));
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function cycleStatus(startDate: Date, today: Date) {
  const diff = daysBetween(today, startDate);
  const mod = ((diff % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
  const onShift = mod < ON_DAYS;
  const dayInBlock = onShift ? mod + 1 : mod - ON_DAYS + 1;
  const remaining = onShift ? ON_DAYS - dayInBlock : OFF_DAYS - dayInBlock;
  return { onShift, dayInBlock, remaining };
}

export default async function TurnosPage() {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;

  const [camps, staff] = await Promise.all([
    db.camp.findMany({
      where: {
        isActive: true,
        ...(campFilter ? { id: campFilter } : {})
      },
      orderBy: { name: "asc" }
    }),
    db.staffMember.findMany({
      where: {
        isActive: true,
        ...(campFilter ? { campId: campFilter } : {})
      },
      include: { camp: true },
      orderBy: [{ camp: { name: "asc" } }, { fullName: "asc" }]
    })
  ]);

  const today = new Date();

  return (
    <main>
      <div className="header">
        <div>
          <div className="brand-inline">
            <Link href="/" aria-label="Ir al inicio">
              <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
            </Link>
          </div>
          <h1>Turnos 14x14</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Sesion: {user.name} ({user.role})
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <form action={logoutAction}>
            <button className="danger" type="submit">
              Cerrar sesion
            </button>
          </form>
        </div>
      </div>

      <OpsNav active="turnos" showAdminSections={canSeeAdminSections} showLoadSection={!canSeeAdminSections} />

      {!canSeeAdminSections && !user.campId ? (
        <div className="alert error" style={{ marginBottom: 16 }}>
          Tu usuario supervisor no tiene campamento asignado. Pide al administrador que lo configure.
        </div>
      ) : null}

      {camps.length > 0 ? <StaffForm camps={camps.map((c) => ({ id: c.id, name: c.name }))} defaultDate={toInputDateValue(today)} /> : null}

      <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Estado actual del personal</h2>
        <table>
          <thead>
            <tr>
              <th>Campamento</th>
              <th>Nombre</th>
              <th>Cargo</th>
              <th>Inicio ciclo</th>
              <th>Estado hoy</th>
              <th>Dia del bloque</th>
              <th>Dias restantes</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => {
              const status = cycleStatus(member.shiftStartDate, today);
              return (
                <tr key={member.id}>
                  <td>{member.camp.name}</td>
                  <td>{member.fullName}</td>
                  <td>{member.role ?? "-"}</td>
                  <td>{toInputDateValue(member.shiftStartDate)}</td>
                  <td className={status.onShift ? "up" : "warn"}>{status.onShift ? "EN TURNO" : "DESCANSO"}</td>
                  <td>{status.dayInBlock}</td>
                  <td>{status.remaining}</td>
                </tr>
              );
            })}
            {staff.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: "var(--muted)" }}>
                  Aun no hay personal registrado en turnos.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}

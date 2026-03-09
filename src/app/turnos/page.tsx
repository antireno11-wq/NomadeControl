import Image from "next/image";
import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { logoutAction } from "@/app/dashboard/actions";
import { OpsNav } from "@/components/ops-nav";
import { StaffForm } from "./staff-form";
import { toggleShiftDayAction } from "./actions";

const ON_DAYS = 14;
const OFF_DAYS = 14;
const CYCLE_DAYS = ON_DAYS + OFF_DAYS;

function toUtcDateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(dateA: Date, dateB: Date) {
  const a = toUtcDateOnly(dateA);
  const b = toUtcDateOnly(dateB);
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function derivedStatus(startDate: Date, day: Date) {
  const diff = daysBetween(day, startDate);
  const mod = ((diff % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
  return mod < ON_DAYS ? "TRABAJA" : "DESCANSO";
}

function shortStatus(status: string) {
  if (status === "TRABAJA") return "T";
  if (status === "DESCANSO") return "D";
  if (status === "LICENCIA") return "L";
  return "-";
}

function statusClass(status: string) {
  if (status === "TRABAJA") return "up";
  if (status === "DESCANSO") return "warn";
  if (status === "LICENCIA") return "danger";
  return "";
}

export default async function TurnosPage() {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;

  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const daysInMonth = monthEnd.getUTCDate();
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), i + 1)));

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
      include: {
        camp: true,
        shiftDays: {
          where: {
            date: {
              gte: monthStart,
              lte: monthEnd
            }
          }
        }
      },
      orderBy: [{ camp: { name: "asc" } }, { fullName: "asc" }]
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
          <h1>Turnos</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Sesion: {user.name} ({user.role})
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/mi-perfil" className="menu-item">
            Mi perfil
          </Link>
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
        <h2 style={{ marginTop: 0 }}>Calendario mensual ({today.toLocaleDateString("es-CL", { month: "long", year: "numeric" })})</h2>
        <div style={{ color: "var(--muted)", marginBottom: 10 }}>
          Haz clic en cada día para rotar: <strong>T</strong> (trabaja), <strong>D</strong> (descanso), <strong>L</strong> (licencia),
          y volver a automático 14x14.
        </div>
        <table>
          <thead>
            <tr>
              <th>Campamento</th>
              <th>Trabajador</th>
              {monthDays.map((day) => (
                <th key={day.toISOString()} style={{ minWidth: 42, textAlign: "center" }}>
                  {day.getUTCDate()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => {
              const shiftMap = new Map(member.shiftDays.map((d) => [toInputDateValue(d.date), d.status]));
              return (
                <tr key={member.id}>
                  <td>{member.camp.name}</td>
                  <td>
                    <div>{member.fullName}</div>
                    <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{member.role ?? "-"}</div>
                  </td>
                  {monthDays.map((day) => {
                    const dateValue = toInputDateValue(day);
                    const explicitStatus = shiftMap.get(dateValue);
                    const status = explicitStatus ?? derivedStatus(member.shiftStartDate, day);
                    return (
                      <td key={`${member.id}-${dateValue}`} style={{ textAlign: "center" }}>
                        <form action={toggleShiftDayAction}>
                          <input type="hidden" name="staffMemberId" value={member.id} />
                          <input type="hidden" name="date" value={dateValue} />
                          <button
                            type="submit"
                            className={statusClass(status)}
                            style={{ minWidth: 34, padding: "4px 0", fontWeight: 700 }}
                            title={explicitStatus ? `${status} (manual)` : `${status} (auto 14x14)`}
                          >
                            {shortStatus(status)}
                          </button>
                        </form>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {staff.length === 0 ? (
              <tr>
                <td colSpan={2 + daysInMonth} style={{ color: "var(--muted)" }}>
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

import Image from "next/image";
import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { logoutAction } from "@/app/dashboard/actions";
import { OpsNav } from "@/components/ops-nav";
import { StaffForm } from "./staff-form";
import { toggleShiftDayAction } from "./actions";

function toUtcDateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(dateA: Date, dateB: Date) {
  const a = toUtcDateOnly(dateA);
  const b = toUtcDateOnly(dateB);
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function workBlockStartForToday(shiftStartDate: Date, workDays: number, offDays: number, today: Date) {
  const cycle = workDays + offDays;
  const diff = daysBetween(today, shiftStartDate);

  if (diff < 0) return toUtcDateOnly(shiftStartDate);

  const cycleIndex = Math.floor(diff / cycle);
  const dayInCycle = diff % cycle;

  if (dayInCycle < workDays) {
    return addDays(toUtcDateOnly(shiftStartDate), cycleIndex * cycle);
  }

  return addDays(toUtcDateOnly(shiftStartDate), (cycleIndex + 1) * cycle);
}

function statusClass(status: string) {
  return status === "TRABAJA" ? "up" : "warn";
}

function statusShort(status: string) {
  return status === "TRABAJA" ? "T" : "A";
}

export default async function TurnosPage() {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;

  const today = new Date();

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
        shiftDays: true
      },
      orderBy: [{ camp: { name: "asc" } }, { fullName: "asc" }]
    })
  ]);

  const maxWorkDays = Math.max(1, ...staff.map((m) => m.shiftWorkDays));

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
        <h2 style={{ marginTop: 0 }}>Calendario por bloque de trabajo</h2>
        <div style={{ color: "var(--muted)", marginBottom: 10 }}>
          Marca cada dia del bloque como <strong>Trabaja</strong> o <strong>Ausente</strong>.
        </div>
        <table>
          <thead>
            <tr>
              <th>Campamento</th>
              <th>Trabajador</th>
              <th>Turno</th>
              <th>Inicio bloque</th>
              {Array.from({ length: maxWorkDays }, (_, i) => (
                <th key={`day-${i + 1}`} style={{ minWidth: 46, textAlign: "center" }}>
                  {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => {
              const blockStart = workBlockStartForToday(member.shiftStartDate, member.shiftWorkDays, member.shiftOffDays, today);
              const shiftMap = new Map(member.shiftDays.map((d) => [toInputDateValue(d.date), d.status]));
              return (
                <tr key={member.id}>
                  <td>{member.camp.name}</td>
                  <td>
                    <div>{member.fullName}</div>
                    <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{member.role ?? "-"}</div>
                  </td>
                  <td>{member.shiftPattern}</td>
                  <td>{toInputDateValue(blockStart)}</td>
                  {Array.from({ length: maxWorkDays }, (_, dayIndex) => {
                    if (dayIndex >= member.shiftWorkDays) {
                      return (
                        <td key={`${member.id}-empty-${dayIndex}`} style={{ textAlign: "center", color: "var(--muted)" }}>
                          -
                        </td>
                      );
                    }

                    const date = addDays(blockStart, dayIndex);
                    const dateValue = toInputDateValue(date);
                    const rawStatus = shiftMap.get(dateValue);
                    const status = rawStatus === "AUSENTE" ? "AUSENTE" : "TRABAJA";

                    return (
                      <td key={`${member.id}-${dateValue}`} style={{ textAlign: "center" }}>
                        <form action={toggleShiftDayAction}>
                          <input type="hidden" name="staffMemberId" value={member.id} />
                          <input type="hidden" name="date" value={dateValue} />
                          <input type="hidden" name="currentStatus" value={status} />
                          <button
                            type="submit"
                            className={statusClass(status)}
                            style={{ minWidth: 34, padding: "4px 0", fontWeight: 700 }}
                            title={`${dateValue} · ${status}`}
                          >
                            {statusShort(status)}
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
                <td colSpan={4 + maxWorkDays} style={{ color: "var(--muted)" }}>
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

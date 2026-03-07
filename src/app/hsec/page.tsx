import Image from "next/image";
import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { logoutAction } from "@/app/dashboard/actions";
import { OpsNav } from "@/components/ops-nav";

export default async function HsecPage() {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;
  const recent = await db.dailyReport.findMany({
    where: campFilter ? { campId: campFilter } : undefined,
    take: 20,
    orderBy: [{ date: "desc" }],
    include: { camp: true }
  });

  const latestByCamp = new Map<string, (typeof recent)[number]>();
  for (const report of recent) {
    if (!latestByCamp.has(report.campId)) {
      latestByCamp.set(report.campId, report);
    }
  }

  return (
    <main>
      <div className="header">
        <div>
          <div className="brand-inline">
            <Link href="/" aria-label="Ir al inicio">
              <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
            </Link>
          </div>
          <h1>HSEC</h1>
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

      <OpsNav active="hsec" showAdminSections={canSeeAdminSections} showLoadSection={!canSeeAdminSections} />

      {!canSeeAdminSections && !user.campId ? (
        <div className="alert error" style={{ marginBottom: 16 }}>
          Tu usuario supervisor no tiene campamento asignado. Pide al administrador que lo configure.
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Monitoreo de agua y condiciones sanitarias</h2>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          Seguimiento diario de cloro, pH y nivel de llenado de basura por campamento.
        </p>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Campamento</th>
              <th>Fecha última medición</th>
              <th>Cloro</th>
              <th>pH</th>
              <th>Basura</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(latestByCamp.values()).map((report) => {
              const inRangeChlorine = report.chlorineLevel >= 0.2 && report.chlorineLevel <= 2;
              const inRangePh = report.phLevel >= 6.5 && report.phLevel <= 8.5;
              const wasteAlert = report.wasteFillPercent >= 80;
              const ok = inRangeChlorine && inRangePh && !wasteAlert;

              return (
                <tr key={report.id}>
                  <td>{report.camp.name}</td>
                  <td>{toInputDateValue(report.date)}</td>
                  <td>{report.chlorineLevel.toFixed(2)}</td>
                  <td>{report.phLevel.toFixed(2)}</td>
                  <td>{report.wasteFillPercent}%</td>
                  <td className={ok ? "up" : "down"}>{ok ? "Dentro de rango" : "Revisar"}</td>
                </tr>
              );
            })}
            {latestByCamp.size === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: "var(--muted)" }}>
                  Aún no hay registros para HSEC.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}

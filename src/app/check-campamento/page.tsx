import Image from "next/image";
import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { logoutAction } from "@/app/dashboard/actions";
import { OpsNav } from "@/components/ops-nav";

export default async function CheckCampamentoPage() {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;
  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const [camps, reportsToday, latestReports] = await Promise.all([
    db.camp.findMany({
      where: {
        isActive: true,
        ...(campFilter ? { id: campFilter } : {})
      },
      orderBy: { name: "asc" }
    }),
    db.dailyReport.findMany({
      where: {
        date: todayDate,
        ...(campFilter ? { campId: campFilter } : {})
      },
      include: { camp: true }
    }),
    db.dailyReport.findMany({
      where: campFilter ? { campId: campFilter } : undefined,
      take: 60,
      orderBy: [{ date: "desc" }],
      include: { camp: true }
    })
  ]);

  const latestByCamp = new Map<string, (typeof latestReports)[number]>();
  for (const report of latestReports) {
    if (!latestByCamp.has(report.campId)) {
      latestByCamp.set(report.campId, report);
    }
  }
  const reportedTodayCampIds = new Set(reportsToday.map((report) => report.campId));

  return (
    <main>
      <div className="header">
        <div>
          <div className="brand-inline">
            <Link href="/" aria-label="Ir al inicio">
              <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
            </Link>
          </div>
          <h1>Check Campamento</h1>
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

      <OpsNav active="check" showAdminSections={canSeeAdminSections} showLoadSection={!canSeeAdminSections} />

      {!canSeeAdminSections && !user.campId ? (
        <div className="alert error" style={{ marginBottom: 16 }}>
          Tu usuario supervisor no tiene campamento asignado. Pide al administrador que lo configure.
        </div>
      ) : null}

      <div className="grid two">
        {camps.map((camp) => {
          const latest = latestByCamp.get(camp.id);
          const hasToday = reportedTodayCampIds.has(camp.id);

          return (
            <div key={camp.id} className="card">
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>{camp.name}</h2>
              <div style={{ color: "var(--muted)", marginBottom: 12 }}>{camp.location ?? "Sin ubicación registrada"}</div>
              {hasToday ? <div className="alert success">Reporte diario cargado hoy</div> : <div className="alert error">Falta carga diaria</div>}
              <div style={{ marginTop: 12, fontSize: "0.9rem" }}>
                <strong>Último reporte:</strong> {latest ? toInputDateValue(latest.date) : "Sin reportes"}
              </div>
              <div style={{ marginTop: 8, fontSize: "0.9rem", color: "var(--muted)" }}>
                Checklist base: alimentación, agua, medidor, basura, cloro y pH.
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

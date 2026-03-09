import Image from "next/image";
import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { logoutAction } from "./actions";
import { OpsNav } from "@/components/ops-nav";
import { NotificationBell } from "@/components/notification-bell";

export default async function DashboardPage({ searchParams }: { searchParams?: { campId?: string | string[] } }) {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;

  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const last30Days = new Date(today);
  last30Days.setDate(last30Days.getDate() - 30);

  const [camps, reports30Days, reportsToday, recentReports] = await Promise.all([
    db.camp.findMany({
      where: { isActive: true, ...(campFilter ? { id: campFilter } : {}) },
      orderBy: { name: "asc" }
    }),
    db.dailyReport.findMany({
      where: {
        ...(campFilter ? { campId: campFilter } : {}),
        date: { gte: last30Days }
      },
      orderBy: [{ date: "asc" }, { camp: { name: "asc" } }],
      include: { camp: true, createdBy: true }
    }),
    db.dailyReport.findMany({
      where: {
        ...(campFilter ? { campId: campFilter } : {}),
        date: todayDate
      },
      include: { camp: true }
    }),
    db.dailyReport.findMany({
      where: campFilter ? { campId: campFilter } : undefined,
      take: 12,
      orderBy: [{ date: "desc" }, { camp: { name: "asc" } }],
      include: { camp: true, createdBy: true }
    })
  ]);

  const selectedCampIdRaw = searchParams?.campId;
  const selectedCampId = typeof selectedCampIdRaw === "string" && selectedCampIdRaw !== "general" ? selectedCampIdRaw : undefined;
  const scopedSelectedCampId = canSeeAdminSections ? selectedCampId : user.campId ?? selectedCampId;
  const scopeCamps = scopedSelectedCampId ? camps.filter((c) => c.id === scopedSelectedCampId) : camps;
  const scopeCampIds = new Set(scopeCamps.map((c) => c.id));

  const reportsScoped = reports30Days.filter((r) => scopeCampIds.has(r.campId));
  const reportsTodayScoped = reportsToday.filter((r) => scopeCampIds.has(r.campId));
  const recentReportsScoped = recentReports.filter((r) => scopeCampIds.has(r.campId));

  const byDay = new Map<string, { date: string; people: number; meals: number; water: number; fuel: number }>();
  for (const report of reportsScoped) {
    const d = toInputDateValue(report.date);
    const row = byDay.get(d) ?? { date: d, people: 0, meals: 0, water: 0, fuel: 0 };
    row.people += report.peopleCount;
    row.meals += report.breakfastCount + report.lunchCount + report.dinnerCount;
    row.water += report.waterLiters;
    row.fuel += report.fuelLiters;
    byDay.set(d, row);
  }

  const dailySeries = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  const chartDays = dailySeries.slice(-14);

  const totals = reportsScoped.reduce(
    (acc, r) => {
      acc.people += r.peopleCount;
      acc.meals += r.breakfastCount + r.lunchCount + r.dinnerCount;
      acc.water += r.waterLiters;
      acc.fuel += r.fuelLiters;
      return acc;
    },
    { people: 0, meals: 0, water: 0, fuel: 0 }
  );

  const maxPeople = Math.max(1, ...chartDays.map((d) => d.people));
  const maxRes = Math.max(1, ...chartDays.map((d) => Math.max(d.meals, d.water, d.fuel)));

  const reportedCampIdsToday = new Set(reportsTodayScoped.map((r) => r.campId));
  const missingCampsToday = scopeCamps.filter((c) => !reportedCampIdsToday.has(c.id));

  const notificationItems = missingCampsToday.map((camp) => ({
    text: `Falta informe diario hoy: ${camp.name}`,
    severity: "error" as const
  }));

  const defaultFromDate = toInputDateValue(last30Days);
  const defaultToDate = toInputDateValue(todayDate);

  return (
    <main>
      <div className="header">
        <div>
          <div className="brand-inline">
            <Link href="/" aria-label="Ir al inicio">
              <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
            </Link>
          </div>
          <h1>Dashboard</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Sesion: {user.name} ({user.role})
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/mi-perfil" className="menu-item">
            Mi perfil
          </Link>
          <NotificationBell items={notificationItems} />
          <form action={logoutAction}>
            <button className="danger" type="submit">
              Cerrar sesion
            </button>
          </form>
        </div>
      </div>

      <OpsNav active="dashboard" showAdminSections={canSeeAdminSections} showLoadSection={!canSeeAdminSections} />

      {canSeeAdminSections ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <form method="get" className="grid two" style={{ alignItems: "end" }}>
            <div>
              <label htmlFor="campId">Vista</label>
              <select id="campId" name="campId" defaultValue={scopedSelectedCampId ?? "general"}>
                <option value="general">General (todos)</option>
                {camps.map((camp) => (
                  <option key={camp.id} value={camp.id}>
                    {camp.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <button type="submit">Aplicar</button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Personas (14 días)</h2>
          <div className="chart-grid">
            {chartDays.map((day) => (
              <div key={`p-${day.date}`} className="chart-col">
                <div className="chart-value">{day.people}</div>
                <div className="chart-track">
                  <div className="chart-bar people" style={{ height: `${(day.people / maxPeople) * 100}%` }} />
                </div>
                <div className="chart-label">{day.date.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Consumos (14 días)</h2>
          <div className="chart-grid">
            {chartDays.map((day) => (
              <div key={`c-${day.date}`} className="chart-col">
                <div className="chart-stack">
                  <div className="chart-bar meals" style={{ height: `${(day.meals / maxRes) * 100}%` }} />
                  <div className="chart-bar water" style={{ height: `${(day.water / maxRes) * 100}%` }} />
                  <div className="chart-bar fuel" style={{ height: `${(day.fuel / maxRes) * 100}%` }} />
                </div>
                <div className="chart-label">{day.date.slice(5)}</div>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span><i className="dot meals" /> Comidas</span>
            <span><i className="dot water" /> Agua</span>
            <span><i className="dot fuel" /> Combustible</span>
          </div>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="metric">
          <div className="label">Personas acumuladas (30 días)</div>
          <div className="value">{totals.people}</div>
        </div>
        <div className="metric">
          <div className="label">Raciones acumuladas (30 días)</div>
          <div className="value">{totals.meals}</div>
        </div>
        <div className="metric">
          <div className="label">Agua acumulada (30 días)</div>
          <div className="value">{totals.water} L</div>
        </div>
        <div className="metric">
          <div className="label">Combustible acumulado (30 días)</div>
          <div className="value">{totals.fuel} L</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Control diario</h2>
        {missingCampsToday.length > 0 ? (
          <div className="alert error">Faltan informes hoy de: {missingCampsToday.map((camp) => camp.name).join(", ")}</div>
        ) : (
          <div className="alert success">Todos los campamentos cargaron su informe de hoy.</div>
        )}
      </div>

      {canSeeAdminSections ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Descargar información</h2>
          <form method="get" action="/api/reportes/export" className="grid two" style={{ alignItems: "end" }}>
            <div>
              <label htmlFor="from">Desde</label>
              <input id="from" name="from" type="date" defaultValue={defaultFromDate} />
            </div>
            <div>
              <label htmlFor="to">Hasta</label>
              <input id="to" name="to" type="date" defaultValue={defaultToDate} />
            </div>
            <div>
              <label htmlFor="exportCampId">Campamento</label>
              <select id="exportCampId" name="campId" defaultValue={scopedSelectedCampId ?? "general"}>
                <option value="general">Todos</option>
                {camps.map((camp) => (
                  <option key={camp.id} value={camp.id}>
                    {camp.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" name="format" value="csv">CSV</button>
              <button type="submit" name="format" value="xls" className="secondary">Excel</button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="card" style={{ overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Últimos reportes</h2>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Campamento</th>
              <th>Personas</th>
              <th>Comidas</th>
              <th>Agua</th>
              <th>Combustible</th>
              <th>Operador</th>
            </tr>
          </thead>
          <tbody>
            {recentReportsScoped.map((report) => (
              <tr key={report.id}>
                <td>{toInputDateValue(report.date)}</td>
                <td>{report.camp.name}</td>
                <td>{report.peopleCount}</td>
                <td>{report.breakfastCount + report.lunchCount + report.dinnerCount}</td>
                <td>{report.waterLiters} L</td>
                <td>{report.fuelLiters} L</td>
                <td>{report.createdBy.name}</td>
              </tr>
            ))}
            {recentReportsScoped.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: "var(--muted)" }}>Aún no hay reportes cargados.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}

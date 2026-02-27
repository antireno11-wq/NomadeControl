import Image from "next/image";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { logoutAction } from "./actions";

export default async function DashboardPage({
  searchParams
}: {
  searchParams?: { campId?: string | string[] };
}) {
  const user = await requireRole(["ADMIN", "OPERADOR"]);
  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const last30Days = new Date(today);
  last30Days.setDate(last30Days.getDate() - 30);

  const [camps, recentReports, reports30Days, reportsToday] = await Promise.all([
    db.camp.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.dailyReport.findMany({
      take: 20,
      orderBy: [{ date: "desc" }, { camp: { name: "asc" } }],
      include: { camp: true, createdBy: true }
    }),
    db.dailyReport.findMany({
      where: {
        date: {
          gte: last30Days
        }
      },
      orderBy: [{ date: "asc" }, { camp: { name: "asc" } }],
      include: { camp: true }
    }),
    db.dailyReport.findMany({
      where: {
        date: todayDate
      },
      include: {
        camp: true
      }
    })
  ]);

  const selectedCampIdRaw = searchParams?.campId;
  const selectedCampId = typeof selectedCampIdRaw === "string" ? selectedCampIdRaw : undefined;
  const selectedCamp = selectedCampId ? camps.find((camp) => camp.id === selectedCampId) : undefined;
  const scopeCamps = selectedCamp ? [selectedCamp] : camps;
  const scopeCampIds = new Set(scopeCamps.map((camp) => camp.id));
  const recentReportsFiltered = recentReports.filter((report) => scopeCampIds.has(report.campId));
  const reports30DaysFiltered = reports30Days.filter((report) => scopeCampIds.has(report.campId));
  const reportsTodayFiltered = reportsToday.filter((report) => scopeCampIds.has(report.campId));

  const totals = reports30DaysFiltered.reduce(
    (acc, row) => {
      acc.people += row.peopleCount;
      acc.breakfast += row.breakfastCount;
      acc.lunch += row.lunchCount;
      acc.dinner += row.dinnerCount;
      acc.snackSimple += row.snackSimpleCount;
      acc.snackReplacement += row.snackReplacementCount;
      acc.lodging += row.lodgingCount;
      acc.water += row.waterLiters;
      acc.fuel += row.fuelLiters;
      return acc;
    },
    {
      people: 0,
      breakfast: 0,
      lunch: 0,
      dinner: 0,
      snackSimple: 0,
      snackReplacement: 0,
      lodging: 0,
      water: 0,
      fuel: 0
    }
  );

  const byDay = new Map<
    string,
    {
      date: string;
      people: number;
      meals: number;
      snacks: number;
      lodgings: number;
      water: number;
      fuel: number;
    }
  >();

  for (const report of reports30DaysFiltered) {
    const date = toInputDateValue(report.date);
    const previous = byDay.get(date) ?? { date, people: 0, meals: 0, snacks: 0, lodgings: 0, water: 0, fuel: 0 };
    previous.people += report.peopleCount;
    previous.meals += report.breakfastCount + report.lunchCount + report.dinnerCount;
    previous.snacks += report.snackSimpleCount + report.snackReplacementCount;
    previous.lodgings += report.lodgingCount;
    previous.water += report.waterLiters;
    previous.fuel += report.fuelLiters;
    byDay.set(date, previous);
  }

  const dailySeries = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  const latestDay = dailySeries[dailySeries.length - 1];
  const previousDay = dailySeries[dailySeries.length - 2];
  const recent14Days = dailySeries.slice(-14).reverse();
  const chartDays = [...recent14Days].reverse();
  const maxPeopleChart = Math.max(1, ...chartDays.map((day) => day.people));
  const maxResourcesChart = Math.max(
    1,
    ...chartDays.map((day) => Math.max(day.meals, day.snacks, day.water, day.fuel))
  );

  const campRows = scopeCamps.map((camp) => {
    const campReports = reports30DaysFiltered.filter((report) => report.campId === camp.id);
    const ordered = [...campReports].sort((a, b) => a.date.getTime() - b.date.getTime());
    const last = ordered[ordered.length - 1];
    const prev = ordered[ordered.length - 2];
    const peopleTotal = campReports.reduce((sum, report) => sum + report.peopleCount, 0);
    const mealsTotal = campReports.reduce(
      (sum, report) => sum + report.breakfastCount + report.lunchCount + report.dinnerCount,
      0
    );
    const snacksTotal = campReports.reduce((sum, report) => sum + report.snackSimpleCount + report.snackReplacementCount, 0);
    const lodgingsTotal = campReports.reduce((sum, report) => sum + report.lodgingCount, 0);
    const waterTotal = campReports.reduce((sum, report) => sum + report.waterLiters, 0);
    const fuelTotal = campReports.reduce((sum, report) => sum + report.fuelLiters, 0);

    return {
      id: camp.id,
      name: camp.name,
      reportsCount: campReports.length,
      avgPeople: campReports.length > 0 ? Math.round(peopleTotal / campReports.length) : 0,
      mealsPerPerson: peopleTotal > 0 ? mealsTotal / peopleTotal : 0,
      snacksPerPerson: peopleTotal > 0 ? snacksTotal / peopleTotal : 0,
      lodgingCoverage: peopleTotal > 0 ? (lodgingsTotal / peopleTotal) * 100 : 0,
      waterPerPerson: peopleTotal > 0 ? waterTotal / peopleTotal : 0,
      fuelPerPerson: peopleTotal > 0 ? fuelTotal / peopleTotal : 0,
      mealCoverage: peopleTotal > 0 ? (mealsTotal / (peopleTotal * 3)) * 100 : 0,
      peopleDelta: last && prev ? last.peopleCount - prev.peopleCount : 0
    };
  });

  const reportedCampIdsToday = new Set(reportsTodayFiltered.map((report) => report.campId));
  const missingCampsToday = scopeCamps.filter((camp) => !reportedCampIdsToday.has(camp.id));
  const dailyCompliance = scopeCamps.length > 0 ? Math.round((reportsTodayFiltered.length / scopeCamps.length) * 100) : 0;

  return (
    <main>
      <nav className="top-menu">
        <Link href="/dashboard" className="menu-item active">
          Dashboard
        </Link>
        <Link href="/carga-diaria" className="menu-item">
          Cargar información
        </Link>
      </nav>

      <div className="header">
        <div>
          <div className="brand-inline">
            <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
          </div>
          <h1>Panel de Campamentos</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Sesión: {user.name} ({user.role}){selectedCamp ? ` · Vista: ${selectedCamp.name}` : " · Vista: General"}
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

      <div className="card" style={{ marginBottom: 16 }}>
        <form method="get" className="grid two" style={{ alignItems: "end" }}>
          <div>
            <label htmlFor="campId">Vista del dashboard</label>
            <select id="campId" name="campId" defaultValue={selectedCamp?.id ?? "general"}>
              <option value="general">General (todos los campamentos)</option>
              {camps.map((camp) => (
                <option key={camp.id} value={camp.id}>
                  {camp.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <button type="submit">Aplicar vista</button>
          </div>
        </form>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="metric">
          <div className="label">Personas acumuladas (30 días)</div>
          <div className="value">{totals.people}</div>
        </div>
        <div className="metric">
          <div className="label">Raciones acumuladas (30 días)</div>
          <div className="value">{totals.breakfast + totals.lunch + totals.dinner}</div>
        </div>
        <div className="metric">
          <div className="label">Colaciones acumuladas (30 días)</div>
          <div className="value">{totals.snackSimple + totals.snackReplacement}</div>
        </div>
        <div className="metric">
          <div className="label">Alojamientos acumulados (30 días)</div>
          <div className="value">{totals.lodging}</div>
        </div>
        <div className="metric">
          <div className="label">Agua total (30 días)</div>
          <div className="value">{totals.water} L</div>
        </div>
        <div className="metric">
          <div className="label">Combustible total (30 días)</div>
          <div className="value">{totals.fuel} L</div>
        </div>
        <div className="metric">
          <div className="label">Personas último día</div>
          <div className="value">{latestDay ? latestDay.people : 0}</div>
        </div>
        <div className="metric">
          <div className="label">Variación diaria personas</div>
          <div
            className={`value ${
              latestDay && previousDay
                ? latestDay.people - previousDay.people > 0
                  ? "up"
                  : latestDay.people - previousDay.people < 0
                    ? "down"
                    : ""
                : ""
            }`}
          >
            {latestDay && previousDay
              ? `${latestDay.people - previousDay.people > 0 ? "+" : ""}${latestDay.people - previousDay.people}`
              : "0"}
          </div>
        </div>
        <div className="metric">
          <div className="label">Cumplimiento diario (hoy)</div>
          <div className="value">{dailyCompliance}%</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Control Exigible Diario</h2>
        <div style={{ color: "var(--muted)", marginBottom: 8 }}>
          Campamentos con carga hoy: {reportsTodayFiltered.length} de {scopeCamps.length}
        </div>
        {missingCampsToday.length > 0 ? (
          <div className="alert error">
            Faltan reportes diarios de: {missingCampsToday.map((camp) => camp.name).join(", ")}
          </div>
        ) : (
          <div className="alert success">Todos los campamentos cargaron consumos diarios hoy.</div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Rendimiento por Campamento (últimos 30 días)</h2>
        <table>
          <thead>
            <tr>
              <th>Campamento</th>
              <th>Reportes</th>
              <th>Prom. personas</th>
              <th>Comidas/persona</th>
              <th>Colaciones/persona</th>
              <th>Cobertura alojamientos</th>
              <th>Agua/persona (L)</th>
              <th>Comb./persona (L)</th>
              <th>Cobertura comidas</th>
              <th>Tendencia personas</th>
            </tr>
          </thead>
          <tbody>
            {campRows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.reportsCount}</td>
                <td>{row.avgPeople}</td>
                <td>{row.mealsPerPerson.toFixed(2)}</td>
                <td>{row.snacksPerPerson.toFixed(2)}</td>
                <td>{row.lodgingCoverage.toFixed(0)}%</td>
                <td>{row.waterPerPerson.toFixed(2)}</td>
                <td>{row.fuelPerPerson.toFixed(2)}</td>
                <td>
                  <div className="progress-cell">
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${Math.min(row.mealCoverage, 100)}%` }} />
                    </div>
                    <span>{row.mealCoverage.toFixed(0)}%</span>
                  </div>
                </td>
                <td className={row.peopleDelta > 0 ? "up" : row.peopleDelta < 0 ? "down" : ""}>
                  {row.peopleDelta > 0 ? `+${row.peopleDelta}` : row.peopleDelta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Evolución Diaria (últimos 14 días)</h2>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Personas</th>
              <th>Comidas</th>
              <th>Colaciones</th>
              <th>Alojamientos</th>
              <th>Agua (L)</th>
              <th>Combustible (L)</th>
            </tr>
          </thead>
          <tbody>
            {recent14Days.map((day) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td>{day.people}</td>
                <td>{day.meals}</td>
                <td>{day.snacks}</td>
                <td>{day.lodgings}</td>
                <td>{day.water}</td>
                <td>{day.fuel}</td>
              </tr>
            ))}
            {recent14Days.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: "var(--muted)" }}>
                  Aún no hay datos suficientes para evolución diaria.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Gráfico: Tendencia de Personas (14 días)</h2>
          <div className="chart-grid">
            {chartDays.map((day) => (
              <div key={`people-${day.date}`} className="chart-col">
                <div className="chart-value">{day.people}</div>
                <div className="chart-track">
                  <div className="chart-bar people" style={{ height: `${(day.people / maxPeopleChart) * 100}%` }} />
                </div>
                <div className="chart-label">{day.date.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Gráfico: Consumos Diarios (14 días)</h2>
          <div className="chart-grid">
            {chartDays.map((day) => (
              <div key={`consumption-${day.date}`} className="chart-col">
                <div className="chart-stack">
                  <div className="chart-bar meals" style={{ height: `${(day.meals / maxResourcesChart) * 100}%` }} />
                  <div className="chart-bar snacks" style={{ height: `${(day.snacks / maxResourcesChart) * 100}%` }} />
                  <div className="chart-bar water" style={{ height: `${(day.water / maxResourcesChart) * 100}%` }} />
                  <div className="chart-bar fuel" style={{ height: `${(day.fuel / maxResourcesChart) * 100}%` }} />
                </div>
                <div className="chart-label">{day.date.slice(5)}</div>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span><i className="dot meals" /> Comidas</span>
            <span><i className="dot snacks" /> Colaciones</span>
            <span><i className="dot water" /> Agua</span>
            <span><i className="dot fuel" /> Combustible</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Últimos reportes</h2>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Campamento</th>
              <th>Personas</th>
              <th>Comidas</th>
              <th>Colaciones</th>
              <th>Alojamientos</th>
              <th>Agua</th>
              <th>Combustible</th>
              <th>Operador</th>
            </tr>
          </thead>
          <tbody>
            {recentReportsFiltered.map((report) => (
              <tr key={report.id}>
                <td>{toInputDateValue(report.date)}</td>
                <td>{report.camp.name}</td>
                <td>{report.peopleCount}</td>
                <td>{report.breakfastCount + report.lunchCount + report.dinnerCount}</td>
                <td>{report.snackSimpleCount + report.snackReplacementCount}</td>
                <td>{report.lodgingCount}</td>
                <td>{report.waterLiters} L</td>
                <td>{report.fuelLiters} L</td>
                <td>{report.createdBy.name}</td>
              </tr>
            ))}
            {recentReportsFiltered.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ color: "var(--muted)" }}>
                  Aún no hay reportes cargados.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}

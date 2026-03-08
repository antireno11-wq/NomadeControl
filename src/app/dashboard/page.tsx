import Image from "next/image";
import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { logoutAction } from "./actions";
import { OpsNav } from "@/components/ops-nav";
import { NotificationBell } from "@/components/notification-bell";

export default async function DashboardPage({
  searchParams
}: {
  searchParams?: { campId?: string | string[] };
}) {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;
  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const last30Days = new Date(today);
  last30Days.setDate(last30Days.getDate() - 30);

  const [camps, recentReports, reports30Days, reportsToday] = await Promise.all([
    db.camp.findMany({
      where: {
        isActive: true,
        ...(campFilter ? { id: campFilter } : {})
      },
      orderBy: { name: "asc" }
    }),
    db.dailyReport.findMany({
      where: campFilter ? { campId: campFilter } : undefined,
      take: 20,
      orderBy: [{ date: "desc" }, { camp: { name: "asc" } }],
      include: { camp: true, createdBy: true }
    }),
    db.dailyReport.findMany({
      where: {
        ...(campFilter ? { campId: campFilter } : {}),
        date: {
          gte: last30Days
        }
      },
      orderBy: [{ date: "asc" }, { camp: { name: "asc" } }],
      include: { camp: true }
    }),
    db.dailyReport.findMany({
      where: {
        ...(campFilter ? { campId: campFilter } : {}),
        date: todayDate
      },
      include: {
        camp: true
      }
    })
  ]);

  const selectedCampIdRaw = searchParams?.campId;
  const selectedCampId = typeof selectedCampIdRaw === "string" ? selectedCampIdRaw : undefined;
  const scopedSelectedCampId = canSeeAdminSections ? selectedCampId : user.campId ?? selectedCampId;
  const selectedCamp = selectedCampId ? camps.find((camp) => camp.id === selectedCampId) : undefined;
  const forcedSelectedCamp = scopedSelectedCampId ? camps.find((camp) => camp.id === scopedSelectedCampId) : undefined;
  const defaultFromDate = toInputDateValue(last30Days);
  const defaultToDate = toInputDateValue(todayDate);
  const scopeCamps = forcedSelectedCamp ? [forcedSelectedCamp] : selectedCamp ? [selectedCamp] : camps;
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
      acc.waterBottles += row.waterBottleCount;
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
      waterBottles: 0,
      lodging: 0,
      water: 0,
      fuel: 0
    }
  );

  const reportsByCamp = new Map<string, typeof reports30DaysFiltered>();
  for (const report of reports30DaysFiltered) {
    const list = reportsByCamp.get(report.campId) ?? [];
    list.push(report);
    reportsByCamp.set(report.campId, list);
  }

  const meterConsumptionByReportId = new Map<string, number>();
  for (const campReportList of reportsByCamp.values()) {
    const ordered = [...campReportList].sort((a, b) => a.date.getTime() - b.date.getTime());
    for (let i = 0; i < ordered.length; i += 1) {
      const current = ordered[i];
      if (i === 0) {
        meterConsumptionByReportId.set(current.id, 0);
        continue;
      }
      const previous = ordered[i - 1];
      const delta = Number((current.meterReading - previous.meterReading).toFixed(2));
      meterConsumptionByReportId.set(current.id, delta >= 0 ? delta : current.meterReading);
    }
  }

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
      meterUse: number;
    }
  >();

  for (const report of reports30DaysFiltered) {
    const date = toInputDateValue(report.date);
    const previous = byDay.get(date) ?? { date, people: 0, meals: 0, snacks: 0, lodgings: 0, water: 0, fuel: 0, meterUse: 0 };
    previous.people += report.peopleCount;
    previous.meals += report.breakfastCount + report.lunchCount + report.dinnerCount;
    previous.snacks += report.snackSimpleCount + report.snackReplacementCount;
    previous.lodgings += report.lodgingCount;
    previous.water += report.waterLiters;
    previous.fuel += report.fuelLiters;
    previous.meterUse += meterConsumptionByReportId.get(report.id) ?? 0;
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
    const waterBottlesTotal = campReports.reduce((sum, report) => sum + report.waterBottleCount, 0);
    const lodgingsTotal = campReports.reduce((sum, report) => sum + report.lodgingCount, 0);
    const waterTotal = campReports.reduce((sum, report) => sum + report.waterLiters, 0);
    const fuelTotal = campReports.reduce((sum, report) => sum + report.fuelLiters, 0);
    const wasteAvg = campReports.length > 0 ? campReports.reduce((sum, report) => sum + report.wasteFillPercent, 0) / campReports.length : 0;
    const chlorineAvg = campReports.length > 0 ? campReports.reduce((sum, report) => sum + report.chlorineLevel, 0) / campReports.length : 0;
    const phAvg = campReports.length > 0 ? campReports.reduce((sum, report) => sum + report.phLevel, 0) / campReports.length : 0;
    const first = ordered[0];
    const generator1UseMonth = first && last ? Math.max(0, last.generator1Hours - first.generator1Hours) : 0;
    const generator2UseMonth = first && last ? Math.max(0, last.generator2Hours - first.generator2Hours) : 0;
    const lastGeneratorDiff = Math.abs(generator1UseMonth - generator2UseMonth);
    const internetIssues = campReports.filter((report) => report.internetStatus !== "FUNCIONANDO").length;

    return {
      id: camp.id,
      name: camp.name,
      reportsCount: campReports.length,
      avgPeople: campReports.length > 0 ? Math.round(peopleTotal / campReports.length) : 0,
      mealsPerPerson: peopleTotal > 0 ? mealsTotal / peopleTotal : 0,
      snacksPerPerson: peopleTotal > 0 ? snacksTotal / peopleTotal : 0,
      bottlesPerPerson: peopleTotal > 0 ? waterBottlesTotal / peopleTotal : 0,
      lodgingCoverage: peopleTotal > 0 ? (lodgingsTotal / peopleTotal) * 100 : 0,
      waterPerPerson: peopleTotal > 0 ? waterTotal / peopleTotal : 0,
      fuelPerPerson: peopleTotal > 0 ? fuelTotal / peopleTotal : 0,
      mealCoverage: peopleTotal > 0 ? (mealsTotal / (peopleTotal * 3)) * 100 : 0,
      peopleDelta: last && prev ? last.peopleCount - prev.peopleCount : 0,
      wasteAvg,
      chlorineAvg,
      phAvg,
      lastGeneratorDiff,
      internetIssues,
      generator1UseMonth,
      generator2UseMonth
    };
  });

  const reportedCampIdsToday = new Set(reportsTodayFiltered.map((report) => report.campId));
  const missingCampsToday = scopeCamps.filter((camp) => !reportedCampIdsToday.has(camp.id));
  const dailyCompliance = scopeCamps.length > 0 ? Math.round((reportsTodayFiltered.length / scopeCamps.length) * 100) : 0;
  const generatorAlerts = campRows
    .filter((row) => row.lastGeneratorDiff > 30)
    .map((row) => `${row.name}: diferencia horómetros G1/G2 ${row.lastGeneratorDiff.toFixed(2)}h (>30h)`);
  const internetAlerts = campRows
    .filter((row) => row.internetIssues > 0)
    .map((row) => `${row.name}: ${row.internetIssues} reporte(s) con internet con interrupciones/no funciona`);
  const notificationItems = [
    ...missingCampsToday.map((camp) => ({ text: `Falta informe diario hoy: ${camp.name}`, severity: "error" as const })),
    ...generatorAlerts.map((text) => ({ text, severity: "warning" as const })),
    ...internetAlerts.map((text) => ({ text, severity: "warning" as const }))
  ];

  return (
    <main>
      <div className="header">
        <div>
          <div className="brand-inline">
            <Link href="/" aria-label="Ir al inicio">
              <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
            </Link>
          </div>
          <h1>Panel de Campamentos</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Sesión: {user.name} ({user.role}){forcedSelectedCamp ? ` · Vista: ${forcedSelectedCamp.name}` : selectedCamp ? ` · Vista: ${selectedCamp.name}` : " · Vista: General"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <NotificationBell items={notificationItems} />
          <form action={logoutAction}>
            <button className="danger" type="submit">
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>

      <OpsNav active="dashboard" showAdminSections={canSeeAdminSections} showLoadSection={!canSeeAdminSections} />

      {canSeeAdminSections ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <form method="get" className="grid two" style={{ alignItems: "end" }}>
            <div>
              <label htmlFor="campId">Vista del dashboard</label>
              <select id="campId" name="campId" defaultValue={forcedSelectedCamp?.id ?? selectedCamp?.id ?? "general"}>
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
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong>Vista supervisor:</strong> {forcedSelectedCamp?.name ?? "Campamento no asignado"}
        </div>
      )}

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
              <select id="exportCampId" name="campId" defaultValue={forcedSelectedCamp?.id ?? selectedCamp?.id ?? "general"}>
                <option value="general">Todos los campamentos</option>
                {camps.map((camp) => (
                  <option key={camp.id} value={camp.id}>
                    {camp.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" name="format" value="csv">
                Descargar CSV
              </button>
              <button type="submit" name="format" value="xls" className="secondary">
                Descargar Excel
              </button>
            </div>
          </form>
        </div>
      ) : null}

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
          <div className="label">Botellas de agua (30 días)</div>
          <div className="value">{totals.waterBottles}</div>
        </div>
        <div className="metric">
          <div className="label">Alojamientos acumulados (30 días)</div>
          <div className="value">{totals.lodging}</div>
        </div>
        <div className="metric">
          <div className="label">Agua gastada total (30 días)</div>
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
              <th>Botellas/persona</th>
              <th>Cobertura alojamientos</th>
              <th>Agua/persona (L)</th>
              <th>Comb./persona (L)</th>
              <th>Basura prom.</th>
              <th>Cloro prom.</th>
              <th>pH prom.</th>
              <th>Uso G1 mes (h)</th>
              <th>Uso G2 mes (h)</th>
              <th>Diferencia G1-G2</th>
              <th>Internet con incidentes</th>
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
                <td>{row.bottlesPerPerson.toFixed(2)}</td>
                <td>{row.lodgingCoverage.toFixed(0)}%</td>
                <td>{row.waterPerPerson.toFixed(2)}</td>
                <td>{row.fuelPerPerson.toFixed(2)}</td>
                <td>{row.wasteAvg.toFixed(0)}%</td>
                <td>{row.chlorineAvg.toFixed(2)}</td>
                <td>{row.phAvg.toFixed(2)}</td>
                <td>{row.generator1UseMonth.toFixed(2)}</td>
                <td>{row.generator2UseMonth.toFixed(2)}</td>
                <td className={row.lastGeneratorDiff > 30 ? "warn" : ""}>{row.lastGeneratorDiff.toFixed(2)}h</td>
                <td className={row.internetIssues > 0 ? "warn" : ""}>{row.internetIssues}</td>
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
              <th>Consumo medidor</th>
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
                <td>{day.meterUse.toFixed(2)}</td>
                <td>{day.water}</td>
                <td>{day.fuel}</td>
              </tr>
            ))}
            {recent14Days.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ color: "var(--muted)" }}>
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
              <th>Botellas</th>
              <th>Alojamientos</th>
              <th>Lectura medidor</th>
              <th>Consumo medidor</th>
              <th>Horómetro G1</th>
              <th>Horómetro G2</th>
              <th>Diferencia G1-G2</th>
              <th>Internet</th>
              <th>Agua gastada</th>
              <th>Combustible</th>
              <th>Basura</th>
              <th>Cloro</th>
              <th>pH</th>
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
                <td>{report.waterBottleCount}</td>
                <td>{report.lodgingCount}</td>
                <td>{report.meterReading.toFixed(2)}</td>
                <td>{(meterConsumptionByReportId.get(report.id) ?? 0).toFixed(2)}</td>
                <td>{report.generator1Hours.toFixed(2)}</td>
                <td>{report.generator2Hours.toFixed(2)}</td>
                <td className={Math.abs(report.generator1Hours - report.generator2Hours) > 30 ? "warn" : ""}>
                  {Math.abs(report.generator1Hours - report.generator2Hours).toFixed(2)}h
                </td>
                <td className={report.internetStatus === "FUNCIONANDO" ? "" : "warn"}>
                  {report.internetStatus.replaceAll("_", " ")}
                </td>
                <td>{report.waterLiters} L</td>
                <td>{report.fuelLiters} L</td>
                <td>{report.wasteFillPercent}%</td>
                <td>{report.chlorineLevel.toFixed(2)}</td>
                <td>{report.phLevel.toFixed(2)}</td>
                <td>{report.createdBy.name}</td>
              </tr>
            ))}
              {recentReportsFiltered.length === 0 ? (
                <tr>
                  <td colSpan={19} style={{ color: "var(--muted)" }}>
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

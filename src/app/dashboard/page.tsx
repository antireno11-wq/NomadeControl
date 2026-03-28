import Image from "next/image";
import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveWaterLiters, toInputDateValue } from "@/lib/report-utils";
import { getCampWeatherSummary } from "@/lib/weather";
import { logoutAction } from "./actions";
import { NotificationBell } from "@/components/notification-bell";

export default async function DashboardPage({ searchParams }: { searchParams?: { campId?: string | string[] } }) {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const selectedCampIdRaw = searchParams?.campId;
  const selectedCampId = typeof selectedCampIdRaw === "string" && selectedCampIdRaw !== "general" ? selectedCampIdRaw : undefined;
  const scopedSelectedCampId = canSeeAdminSections ? selectedCampId : user.campId ?? selectedCampId;
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;

  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dashboardDate = new Date(todayDate);
  dashboardDate.setUTCDate(dashboardDate.getUTCDate() - 1);
  const previousDashboardDate = new Date(dashboardDate);
  previousDashboardDate.setUTCDate(previousDashboardDate.getUTCDate() - 1);
  const last30Days = new Date(today);
  last30Days.setDate(last30Days.getDate() - 30);

  const [camps, reports30Days, reportsToday, recentReports, taskControlsToday, campShiftUsers] = await Promise.all([
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
        date: dashboardDate
      },
      include: { camp: true }
    }),
    db.dailyReport.findMany({
      where: campFilter ? { campId: campFilter } : undefined,
      take: 10,
      orderBy: [{ date: "desc" }, { camp: { name: "asc" } }],
      include: { camp: true, createdBy: true }
    }),
    db.dailyTaskControl.findMany({
      where: {
        ...(campFilter ? { campId: campFilter } : {}),
        date: dashboardDate
      },
      include: { camp: true, createdBy: true }
    }),
    db.user.findMany({
      where: {
        isActive: true,
        role: { in: ["SUPERVISOR", "OPERADOR"] },
        shiftStartDate: { not: null },
        ...(scopedSelectedCampId ? { campId: scopedSelectedCampId } : {})
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        campId: true,
        shiftPattern: true,
        shiftWorkDays: true,
        shiftOffDays: true,
        shiftStartDate: true
      }
    })
  ]);
  const scopeCamps = scopedSelectedCampId ? camps.filter((c) => c.id === scopedSelectedCampId) : camps;
  const scopeCampIds = new Set(scopeCamps.map((c) => c.id));

  const reportsScoped = reports30Days.filter((r) => scopeCampIds.has(r.campId));
  const reportsTodayScoped = reportsToday.filter((r) => scopeCampIds.has(r.campId));
  const recentReportsScoped = recentReports.filter((r) => scopeCampIds.has(r.campId));
  const taskControlsTodayScoped = taskControlsToday.filter((r) => scopeCampIds.has(r.campId));
  const weatherCamp =
    scopeCamps.length === 1
      ? {
          name: scopeCamps[0].name,
          location: scopeCamps[0].location,
          latitude: scopeCamps[0].latitude,
          longitude: scopeCamps[0].longitude
        }
      : null;
  const weatherSummary = weatherCamp
    ? await getCampWeatherSummary({
        latitude: weatherCamp.latitude,
        longitude: weatherCamp.longitude,
        location: weatherCamp.location,
        date: toInputDateValue(dashboardDate)
      })
    : null;

  const waterByReportId = new Map<string, number>();
  const previousReportByCamp = new Map<string, { meterReading: number; waterLiters: number }>();

  for (const report of reportsScoped.slice().sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const previousReport = previousReportByCamp.get(report.campId);
    const computedWaterLiters = resolveWaterLiters(report, previousReport);
    waterByReportId.set(report.id, computedWaterLiters);
    previousReportByCamp.set(report.campId, report);
  }

  const byDay = new Map<
    string,
    {
      date: string;
      people: number;
      meals: number;
      foodServices: number;
      water: number;
      fuel: number;
      potable: number;
      blackRemoved: number;
      blackTankLevelTotal: number;
      reportCount: number;
    }
  >();
  for (const report of reportsScoped) {
    const foodServices =
      report.breakfastCount +
      report.lunchCount +
      report.dinnerCount +
      report.snackSimpleCount +
      report.snackReplacementCount;
    const dateKey = toInputDateValue(report.date);
    const row = byDay.get(dateKey) ?? {
      date: dateKey,
      people: 0,
      meals: 0,
      foodServices: 0,
      water: 0,
      fuel: 0,
      potable: 0,
      blackRemoved: 0,
      blackTankLevelTotal: 0,
      reportCount: 0
    };
    const computedWaterLiters = waterByReportId.get(report.id) ?? report.waterLiters;
    row.people += report.peopleCount;
    row.meals += report.breakfastCount + report.lunchCount + report.dinnerCount;
    row.foodServices += foodServices;
    row.water += computedWaterLiters;
    row.fuel += report.fuelLiters;
    row.potable += report.potableWaterDeliveredM3;
    row.blackRemoved += report.blackWaterRemovedM3;
    row.blackTankLevelTotal += report.blackWaterTankLevelPercent;
    row.reportCount += 1;
    byDay.set(dateKey, row);
  }

  const defaultChartDays = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);

  const totals = reportsScoped.reduce(
    (acc, report) => {
      acc.people += report.peopleCount;
      acc.meals += report.breakfastCount + report.lunchCount + report.dinnerCount;
      acc.water += waterByReportId.get(report.id) ?? report.waterLiters;
      acc.fuel += report.fuelLiters;
      acc.waste += report.wasteFillPercent;
      if (report.internetStatus !== "FUNCIONANDO") acc.internetIssues += 1;
      return acc;
    },
    { people: 0, meals: 0, water: 0, fuel: 0, waste: 0, internetIssues: 0 }
  );

  const reportsCount = reportsScoped.length;
  const wasteAvg = reportsCount > 0 ? totals.waste / reportsCount : 0;

  const reportedCampIdsToday = new Set(reportsTodayScoped.map((r) => r.campId));
  const missingCampsToday = scopeCamps.filter((camp) => !reportedCampIdsToday.has(camp.id));
  const taskControlCampIdsToday = new Set(taskControlsTodayScoped.map((r) => r.campId));
  const missingTaskControlsToday = scopeCamps.filter((camp) => !taskControlCampIdsToday.has(camp.id));

  const generatorRows = scopeCamps.map((camp) => {
    const list = reportsScoped
      .filter((report) => report.campId === camp.id)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const first = list[0];
    const last = list[list.length - 1];
    const g1Use = first && last ? Math.max(0, last.generator1Hours - first.generator1Hours) : 0;
    const g2Use = first && last ? Math.max(0, last.generator2Hours - first.generator2Hours) : 0;
    return {
      id: camp.id,
      name: camp.name,
      g1Use,
      g2Use,
      diff: Math.abs(g1Use - g2Use)
    };
  });

  const shiftCampId = scopedSelectedCampId ?? (canSeeAdminSections && scopeCamps.length === 1 ? scopeCamps[0]?.id : null);
  const shiftOwner =
    !canSeeAdminSections && user.shiftStartDate
      ? {
          name: user.name,
          shiftPattern: user.shiftPattern ?? "14x14",
          shiftWorkDays: user.shiftWorkDays ?? 14,
          shiftOffDays: user.shiftOffDays ?? 14,
          shiftStartDate: user.shiftStartDate
        }
      : shiftCampId
        ? campShiftUsers.find((candidate) => candidate.campId === shiftCampId) ?? null
        : null;

  let chartDays = defaultChartDays;
  let peopleChartLabel = defaultChartDays.length > 0 ? `Últimos ${defaultChartDays.length} días` : "Sin turno";

  if (shiftOwner?.shiftStartDate && shiftOwner.shiftWorkDays && shiftOwner.shiftOffDays) {
    const millisPerDay = 24 * 60 * 60 * 1000;
    const shiftStart = new Date(
      Date.UTC(
        shiftOwner.shiftStartDate.getUTCFullYear(),
        shiftOwner.shiftStartDate.getUTCMonth(),
        shiftOwner.shiftStartDate.getUTCDate()
      )
    );
    const elapsedDays = Math.max(0, Math.floor((dashboardDate.getTime() - shiftStart.getTime()) / millisPerDay));
    const cycleLength = shiftOwner.shiftWorkDays + shiftOwner.shiftOffDays;
    const cycleIndex = cycleLength > 0 ? elapsedDays % cycleLength : 0;

    if (cycleIndex < shiftOwner.shiftWorkDays) {
      const cycleStart = new Date(shiftStart);
      cycleStart.setUTCDate(cycleStart.getUTCDate() + elapsedDays - cycleIndex);
      const cycleStartKey = toInputDateValue(cycleStart);
      chartDays = Array.from(byDay.values())
        .filter((day) => day.date >= cycleStartKey && day.date <= toInputDateValue(dashboardDate))
        .sort((a, b) => a.date.localeCompare(b.date));
      peopleChartLabel = `${shiftOwner.shiftPattern ?? "14x14"} · quedan ${shiftOwner.shiftWorkDays - (cycleIndex + 1)} días`;
    } else {
      peopleChartLabel = `${shiftOwner.shiftPattern ?? "14x14"} · descanso`;
    }
  }

  const maxPeople = Math.max(1, ...chartDays.map((day) => day.people));
  const maxFoodServices = Math.max(1, ...chartDays.map((day) => day.foodServices));
  const totalFoodServices = chartDays.reduce((sum, day) => sum + day.foodServices, 0);
  const chartDayInsights = chartDays.map((day) => ({
    date: day.date,
    waterPerPerson: day.people > 0 ? day.water / day.people : 0,
    fuelPerPerson: day.people > 0 ? day.fuel / day.people : 0
  }));
  const maxWaterPerPerson = Math.max(1, ...chartDayInsights.map((day) => day.waterPerPerson));
  const maxFuelPerPerson = Math.max(1, ...chartDayInsights.map((day) => day.fuelPerPerson));

  const totalG1Use = generatorRows.reduce((sum, row) => sum + row.g1Use, 0);
  const totalG2Use = generatorRows.reduce((sum, row) => sum + row.g2Use, 0);
  const totalGeneratorDiff = Math.abs(totalG1Use - totalG2Use);


  const peopleToday = reportsTodayScoped.reduce((sum, report) => sum + report.peopleCount, 0);
  const mealsToday = reportsTodayScoped.reduce(
    (sum, report) => sum + report.breakfastCount + report.lunchCount + report.dinnerCount,
    0
  );
  const waterToday = reportsTodayScoped.reduce((sum, report) => sum + (waterByReportId.get(report.id) ?? report.waterLiters), 0);
  const fuelToday = reportsTodayScoped.reduce((sum, report) => sum + report.fuelLiters, 0);
  const blackTankAvgToday =
    reportsTodayScoped.length > 0
      ? reportsTodayScoped.reduce((sum, report) => sum + report.blackWaterTankLevelPercent, 0) / reportsTodayScoped.length
      : 0;
  const waterPerPersonToday = peopleToday > 0 ? waterToday / peopleToday : 0;
  const fuelPerPersonToday = peopleToday > 0 ? fuelToday / peopleToday : 0;
  const previousDayKey = toInputDateValue(previousDashboardDate);
  const previousDaySeries = byDay.get(previousDayKey);
  const previousDayPeople = previousDaySeries?.people ?? 0;
  const previousDayWater = previousDaySeries?.water ?? 0;
  const peopleDiff = peopleToday - previousDayPeople;
  const waterDiff = waterToday - previousDayWater;
  const peopleDiffLabel = peopleDiff === 0 ? "Sin cambio" : `${peopleDiff > 0 ? "+" : ""}${peopleDiff}`;
  const waterDiffLabel = waterDiff === 0 ? "Sin cambio" : `${waterDiff > 0 ? "+" : ""}${waterDiff} L`;
  const reportSubmitted = scopeCamps.length > 0 && missingCampsToday.length === 0;
  const tasksSubmitted = scopeCamps.length > 0 && missingTaskControlsToday.length === 0;

  const notificationItems = [
    ...missingCampsToday.map((camp) => ({ text: `Falta informe diario ayer: ${camp.name}`, severity: "error" as const })),
    ...missingTaskControlsToday.map((camp) => ({ text: `Falta control de tareas ayer: ${camp.name}`, severity: "warning" as const })),
    ...reportsTodayScoped
      .filter((report) => report.peopleCount > 0 && (waterByReportId.get(report.id) ?? report.waterLiters) / report.peopleCount > 180)
      .map((report) => ({
        text: `${report.camp.name}: consumo de agua alto (${Math.round((waterByReportId.get(report.id) ?? report.waterLiters) / report.peopleCount)} L/persona)`,
        severity: "warning" as const
      })),
    ...reportsTodayScoped
      .filter((report) => report.peopleCount > 0 && report.fuelLiters / report.peopleCount > 20)
      .map((report) => ({
        text: `${report.camp.name}: combustible alto (${Math.round(report.fuelLiters / report.peopleCount)} L/persona)`,
        severity: "warning" as const
      })),
    ...reportsTodayScoped
      .filter((report) => report.blackWaterTankLevelPercent >= 80)
      .map((report) => ({
        text: `${report.camp.name}: estanque de aguas negras en ${report.blackWaterTankLevelPercent}%`,
        severity: report.blackWaterTankLevelPercent >= 90 ? ("error" as const) : ("warning" as const)
      })),
    ...(weatherSummary && weatherSummary.temperatureMax != null && weatherSummary.temperatureMax >= 30
      ? [{ text: `${weatherCamp?.name}: máxima de ${weatherSummary.temperatureMax.toFixed(1)}°C ayer`, severity: "warning" as const }]
      : []),
    ...(weatherSummary && weatherSummary.temperatureMin != null && weatherSummary.temperatureMin <= 0
      ? [{ text: `${weatherCamp?.name}: mínima de ${weatherSummary.temperatureMin.toFixed(1)}°C ayer`, severity: "warning" as const }]
      : []),
    ...generatorRows
      .filter((row) => row.diff > 30)
      .map((row) => ({ text: `${row.name}: diferencia horómetros ${row.diff.toFixed(1)}h`, severity: "warning" as const }))
  ];

  const dashboardNavItems = [
    { href: "/dashboard", label: "Dashboard", active: true },
    ...(!canSeeAdminSections
      ? [
          { href: "/carga-diaria", label: "Informe diario", active: false },
          { href: "/control-tareas-diarias", label: "Control tareas", active: false }
        ]
      : []),
    ...(canSeeAdminSections ? [{ href: "/administracion", label: "Administración", active: false }] : [])
  ];

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-sidebar-card">
          <Link href="/" aria-label="Ir al inicio" className="dashboard-brand">
            <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={112} height={112} priority />
            <div>
              <strong>Nomade Control</strong>
              <span>{scopedSelectedCampId ? scopeCamps[0]?.name ?? "Campamento" : "Vista general"}</span>
            </div>
          </Link>

          <nav className="dashboard-nav">
            {dashboardNavItems.map((item) => (
              <Link key={item.href} href={item.href} className={`dashboard-nav-link ${item.active ? "active" : ""}`}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="dashboard-sidebar-footer">
            <Link href="/mi-perfil" className="dashboard-mini-link">
              Mi perfil
            </Link>
            <form action={logoutAction}>
              <button className="danger" type="submit">
                Cerrar sesión
              </button>
            </form>
          </div>
        </div>
      </aside>

      <section className="dashboard-main">
        <div className="dashboard-topbar">
          <div>
            <h1>Dashboard</h1>
          </div>
          <div className="dashboard-topbar-actions">
            {canSeeAdminSections ? (
              <form method="get" className="dashboard-filter">
                <label htmlFor="campId" className="sr-only">
                  Campamento
                </label>
                <select id="campId" name="campId" defaultValue={scopedSelectedCampId ?? "general"}>
                  <option value="general">Todos</option>
                  {camps.map((camp) => (
                    <option key={camp.id} value={camp.id}>
                      {camp.name}
                    </option>
                  ))}
                </select>
                <button type="submit">Ver</button>
              </form>
            ) : null}
            <NotificationBell items={notificationItems} />
            <div className="dashboard-user">{user.name}</div>
          </div>
        </div>

        <div className="dashboard-kpi-grid">
          <div className="dashboard-kpi accent" title={`${reportsTodayScoped.length} informes cargados ayer · ${missingCampsToday.length} pendientes`}>
            <div className="dashboard-kpi-label">Informes ayer</div>
            <div className="dashboard-kpi-value">{reportsTodayScoped.length}</div>
            <div className="dashboard-kpi-meta">{missingCampsToday.length} pendientes</div>
          </div>
          <div className="dashboard-kpi teal" title={`${taskControlsTodayScoped.length} controles cargados ayer · ${missingTaskControlsToday.length} pendientes`}>
            <div className="dashboard-kpi-label">Tareas ayer</div>
            <div className="dashboard-kpi-value">{taskControlsTodayScoped.length}</div>
            <div className="dashboard-kpi-meta">{missingTaskControlsToday.length} pendientes</div>
          </div>
          <div className="dashboard-kpi" title={`${peopleToday} personas registradas ayer · ${mealsToday} raciones entregadas`}>
            <div className="dashboard-kpi-label">Personas ayer</div>
            <div className="dashboard-kpi-value">{peopleToday}</div>
            <div className="dashboard-kpi-meta">{mealsToday} raciones</div>
          </div>
          <div className="dashboard-kpi" title={`Diferencia total entre generadores: ${totalGeneratorDiff.toFixed(1)} horas`}>
            <div className="dashboard-kpi-label">Generadores ayer</div>
            <div className="dashboard-kpi-value">{totalGeneratorDiff.toFixed(1)}h</div>
            <div className="dashboard-kpi-meta">diferencia total</div>
          </div>
        </div>

        <div className="dashboard-core-grid">
          <section className="dashboard-panel dashboard-panel-large">
            <div className="dashboard-panel-header">
              <h2>Resumen diario</h2>
              <div className="dashboard-mini-stats">
                <span title={`Consumo de agua calculado desde la diferencia del medidor: ${waterToday} L`}>
                  {waterToday} L agua ayer
                </span>
                <span>{fuelToday} L combustible</span>
              </div>
            </div>

            <div className="dashboard-ring-grid">
              <div className="dashboard-status-card" title={`${reportsTodayScoped.length} de ${scopeCamps.length || 0} informes cargados ayer`}>
                <span className="dashboard-focus-label">Informe diario</span>
                <strong className={`dashboard-status-icon ${reportSubmitted ? "ok" : "warn"}`}>
                  {reportSubmitted ? "✓" : "!"}
                </strong>
                <small className="dashboard-focus-meta">
                  {reportsTodayScoped.length}/{scopeCamps.length || 0} cargados
                </small>
              </div>
              <div
                className="dashboard-focus-card"
                title={`Consumo de agua calculado desde el medidor: ${waterToday} L · Variación: ${waterDiffLabel}`}
              >
                <span className="dashboard-focus-label">Consumo agua ayer</span>
                <strong className="dashboard-focus-value">{waterToday} L</strong>
                <small className={`dashboard-focus-meta ${waterDiff === 0 ? "" : waterDiff > 0 ? "warn" : "up"}`}>
                  {waterDiffLabel} vs {previousDayKey}
                </small>
              </div>
              <div className="dashboard-focus-card" title={`Variación huéspedes: ${peopleDiffLabel} · Día anterior: ${previousDayPeople}`}>
                <span className="dashboard-focus-label">Huéspedes</span>
                <strong className="dashboard-focus-value">{peopleDiffLabel}</strong>
                <small className={`dashboard-focus-meta ${peopleDiff === 0 ? "" : peopleDiff > 0 ? "up" : "warn"}`}>
                  vs {previousDayPeople} el {previousDayKey}
                </small>
              </div>
              <div className="dashboard-mini-stack dashboard-mini-stack-compact">
                <div className="dashboard-mini-metric" title={`Uso generador 1: ${totalG1Use.toFixed(1)} horas`}>
                  <span>G1</span>
                  <strong>{totalG1Use.toFixed(1)}h</strong>
                </div>
                <div className="dashboard-mini-metric" title={`Uso generador 2: ${totalG2Use.toFixed(1)} horas`}>
                  <span>G2</span>
                  <strong>{totalG2Use.toFixed(1)}h</strong>
                </div>
                <div
                  className="dashboard-mini-metric"
                  title={`Consumo acumulado de agua calculado desde medidores en el período visible: ${totals.water} L`}
                >
                  <span>Agua acum.</span>
                  <strong>{totals.water} L</strong>
                </div>
                <div className="dashboard-mini-metric" title={tasksSubmitted ? "Control de tareas cargado" : "Control de tareas pendiente"}>
                  <span>Control tareas</span>
                  <strong className={tasksSubmitted ? "up" : "warn"}>{tasksSubmitted ? "✓" : "!"}</strong>
                </div>
                <div className="dashboard-mini-metric" title={`Promedio llenado basura: ${wasteAvg.toFixed(0)}%`}>
                  <span>Basura</span>
                  <strong>{wasteAvg.toFixed(0)}%</strong>
                </div>
              </div>
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <h2>Clima y alertas</h2>
              <span className="dashboard-chip small">{weatherCamp ? weatherCamp.name : "General"}</span>
            </div>
            <div className="dashboard-mini-stack">
              <div className="dashboard-mini-metric">
                <span>Temp. máxima</span>
                <strong>
                  {weatherSummary?.temperatureMax != null
                    ? `${weatherSummary.temperatureMax.toFixed(1)}°C`
                    : weatherCamp?.location
                      ? "Sin dato"
                      : weatherCamp
                        ? "Agrega ubicación"
                        : "Selecciona campamento"}
                </strong>
              </div>
              <div className="dashboard-mini-metric">
                <span>Temp. mínima</span>
                <strong>
                  {weatherSummary?.temperatureMin != null
                    ? `${weatherSummary.temperatureMin.toFixed(1)}°C`
                    : weatherCamp?.location
                      ? "Sin dato"
                      : weatherCamp
                        ? "Agrega ubicación"
                        : "Selecciona campamento"}
                </strong>
              </div>
              <div className="dashboard-mini-metric">
                <span>Estanque negras</span>
                <strong>{blackTankAvgToday.toFixed(0)}%</strong>
              </div>
            </div>
            {weatherCamp && !weatherCamp.location ? (
              <div className="section-caption" style={{ marginTop: 12 }}>
                Agrega la ubicación del campamento para obtener la temperatura automáticamente.
              </div>
            ) : null}
            <div className="dashboard-status-list" style={{ marginTop: 12 }}>
              {notificationItems.slice(0, 4).map((item) => (
                <div key={item.text} className="dashboard-status-row">
                  <span>{item.text}</span>
                  <span className={`status-pill ${item.severity === "error" ? "danger" : item.severity === "warning" ? "warn" : "ok"}`}>
                    {item.severity === "error" ? "Alta" : item.severity === "warning" ? "Media" : "Info"}
                  </span>
                </div>
              ))}
              {notificationItems.length === 0 ? <div className="section-caption">Sin alertas relevantes ayer.</div> : null}
            </div>
          </section>
        </div>

        <div className="dashboard-chart-grid">
          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <h2>Personas por turno</h2>
              <span className="dashboard-chip small">{peopleChartLabel}</span>
            </div>
            <div className="chart-grid compact">
              {chartDays.map((day) => (
                <div
                  key={`p-${day.date}`}
                  className="chart-col chart-tooltip-target"
                  data-tooltip={`${day.date}: ${day.people} personas`}
                >
                  <div className="chart-track tall">
                    <div className="chart-bar people" style={{ height: `${(day.people / maxPeople) * 100}%` }} />
                  </div>
                  <div className="chart-label">{day.date.slice(5)}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <h2>Servicios entregados</h2>
              <span className="dashboard-chip small">{totalFoodServices} total</span>
            </div>
            <div className="chart-grid compact">
              {chartDays.map((day) => (
                <div
                  key={`c-${day.date}`}
                  className="chart-col chart-tooltip-target"
                  data-tooltip={`${day.date}: ${day.foodServices} servicios entregados`}
                >
                  <div className="chart-track tall">
                    <div className="chart-bar meals" style={{ height: `${(day.foodServices / maxFoodServices) * 100}%` }} />
                  </div>
                  <div className="chart-label">{day.date.slice(5)}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="dashboard-metrics-grid">
          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <h2>Agua por huésped</h2>
              <span className="dashboard-chip small">{waterPerPersonToday.toFixed(1)} L/p</span>
            </div>
            <div className="chart-grid compact">
              {chartDayInsights.map((day) => (
                <div key={`wp-${day.date}`} className="chart-col chart-tooltip-target" data-tooltip={`${day.date}: ${day.waterPerPerson.toFixed(1)} L por persona`}>
                  <div className="chart-track tall">
                    <div className="chart-bar water" style={{ height: `${(day.waterPerPerson / maxWaterPerPerson) * 100}%` }} />
                  </div>
                  <div className="chart-label">{day.date.slice(5)}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <h2>Combustible por huésped</h2>
              <span className="dashboard-chip small">{fuelPerPersonToday.toFixed(1)} L/p</span>
            </div>
            <div className="chart-grid compact">
              {chartDayInsights.map((day) => (
                <div key={`fp-${day.date}`} className="chart-col chart-tooltip-target" data-tooltip={`${day.date}: ${day.fuelPerPerson.toFixed(1)} L por persona`}>
                  <div className="chart-track tall">
                    <div className="chart-bar fuel" style={{ height: `${(day.fuelPerPerson / maxFuelPerPerson) * 100}%` }} />
                  </div>
                  <div className="chart-label">{day.date.slice(5)}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="dashboard-bottom-grid">
          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <h2>Generadores</h2>
              <span className={`dashboard-chip small ${totalGeneratorDiff > 30 ? "warn" : ""}`}>{totalGeneratorDiff.toFixed(1)}h</span>
            </div>
            <div className="dashboard-generator-list">
              {generatorRows.map((row) => (
                <div
                  key={row.id}
                  className="dashboard-generator-row"
                  title={`${row.name}: G1 ${row.g1Use.toFixed(1)}h, G2 ${row.g2Use.toFixed(1)}h, diferencia ${row.diff.toFixed(1)}h`}
                >
                  <div>
                    <strong>{row.name}</strong>
                    <span>
                      G1 {row.g1Use.toFixed(1)}h / G2 {row.g2Use.toFixed(1)}h
                    </span>
                  </div>
                  <span className={`status-pill ${row.diff > 30 ? "warn" : "ok"}`}>{row.diff.toFixed(1)}h</span>
                </div>
              ))}
              {generatorRows.length === 0 ? <div className="section-caption">Sin datos.</div> : null}
            </div>
          </section>

          <section className="dashboard-panel dashboard-panel-wide">
            <div className="dashboard-panel-header">
              <h2>Últimos informes</h2>
              <Link href="/carga-diaria" className="dashboard-mini-link">
                Cargar
              </Link>
            </div>
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Campamento</th>
                    <th>Pers.</th>
                    <th>Com.</th>
                    <th>G1</th>
                    <th>G2</th>
                    <th>Operador</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {recentReportsScoped.map((report) => (
                    <tr key={report.id}>
                      <td>{toInputDateValue(report.date)}</td>
                      <td>{report.camp.name}</td>
                      <td>{report.peopleCount}</td>
                      <td>{report.breakfastCount + report.lunchCount + report.dinnerCount}</td>
                      <td>{report.generator1Hours.toFixed(1)}</td>
                      <td>{report.generator2Hours.toFixed(1)}</td>
                      <td>{report.createdBy.name}</td>
                      <td>
                        <Link href={`/informes/${report.id}`} className="dashboard-mini-link">
                          Ver
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {recentReportsScoped.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ color: "var(--muted)" }}>
                        Sin registros.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { formatDisplayDate, normalizeDateOnly, resolveWaterLiters, toInputDateValue } from "@/lib/report-utils";

type SearchParams = {
  campId?: string | string[];
  days?: string | string[];
  startDate?: string | string[];
  endDate?: string | string[];
};

function parseDaysParam(raw: string | string[] | undefined) {
  const value = typeof raw === "string" ? Number(raw) : NaN;
  return [7, 14, 30, 60, 90].includes(value) ? value : 30;
}

function parseDateParam(raw: string | string[] | undefined) {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }

  const date = normalizeDateOnly(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function countChecks(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { done: 0, total: 0 };
  }

  const entries = Object.values(value as Record<string, unknown>);
  return {
    total: entries.length,
    done: entries.filter((entry) => entry === true).length
  };
}

export default async function ResumenGeneralPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const selectedCampIdRaw = searchParams?.campId;
  const selectedCampId = typeof selectedCampIdRaw === "string" && selectedCampIdRaw !== "general" ? selectedCampIdRaw : undefined;
  const scopedSelectedCampId = canSeeAdminSections ? selectedCampId : user.campId ?? selectedCampId;
  const days = parseDaysParam(searchParams?.days);
  const customStartDate = parseDateParam(searchParams?.startDate);
  const customEndDate = parseDateParam(searchParams?.endDate);
  const hasCustomPeriod = Boolean(customStartDate || customEndDate);
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;

  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const defaultStartDate = new Date(todayDate);
  defaultStartDate.setUTCDate(defaultStartDate.getUTCDate() - days);
  const rawPeriodStart = customStartDate ?? defaultStartDate;
  const rawPeriodEnd = customEndDate ?? todayDate;
  const periodStart = rawPeriodStart <= rawPeriodEnd ? rawPeriodStart : rawPeriodEnd;
  const periodEnd = rawPeriodStart <= rawPeriodEnd ? rawPeriodEnd : rawPeriodStart;
  const periodStartInput = hasCustomPeriod ? toInputDateValue(periodStart) : "";
  const periodEndInput = hasCustomPeriod ? toInputDateValue(periodEnd) : "";

  const [camps, reports, taskControls] = await Promise.all([
    db.camp.findMany({
      where: { isActive: true, ...(campFilter ? { id: campFilter } : {}) },
      orderBy: { name: "asc" }
    }),
    db.dailyReport.findMany({
      where: {
        ...(campFilter ? { campId: campFilter } : {}),
        date: { gte: periodStart, lte: periodEnd }
      },
      orderBy: [{ date: "asc" }, { camp: { name: "asc" } }],
      include: { camp: true, createdBy: true }
    }),
    db.dailyTaskControl.findMany({
      where: {
        ...(campFilter ? { campId: campFilter } : {}),
        date: { gte: periodStart, lte: periodEnd }
      },
      orderBy: [{ date: "desc" }, { camp: { name: "asc" } }],
      include: { camp: true, createdBy: true }
    })
  ]);

  const scopeCamps = scopedSelectedCampId ? camps.filter((camp) => camp.id === scopedSelectedCampId) : camps;
  const scopeCampIds = new Set(scopeCamps.map((camp) => camp.id));
  const scopedReports = reports.filter((report) => scopeCampIds.has(report.campId));
  const scopedTaskControls = taskControls.filter((control) => scopeCampIds.has(control.campId));

  const waterByReportId = new Map<string, number>();
  const previousReportByCamp = new Map<string, { meterReading: number; waterLiters: number }>();

  for (const report of scopedReports) {
    const previousReport = previousReportByCamp.get(report.campId);
    const computedWaterLiters = resolveWaterLiters(report, previousReport);
    waterByReportId.set(report.id, computedWaterLiters);
    previousReportByCamp.set(report.campId, report);
  }

  const summary = scopedReports.reduce(
    (acc, report) => {
      acc.people += report.peopleCount;
      acc.meals += report.breakfastCount + report.lunchCount + report.dinnerCount;
      acc.snacks += report.snackSimpleCount + report.snackReplacementCount;
      acc.bottles += report.waterBottleCount;
      acc.lodgings += report.lodgingCount;
      acc.water += waterByReportId.get(report.id) ?? report.waterLiters;
      acc.fuel += report.fuelLiters;
      acc.fuelRemaining += report.fuelRemainingLiters;
      acc.potable += report.potableWaterDeliveredM3;
      acc.blackRemoved += report.blackWaterRemovedM3;
      acc.blackServices += report.blackWaterRemoved ? 1 : 0;
      acc.potableServices += report.potableWaterDelivered ? 1 : 0;
      acc.internetIssues += report.internetStatus === "FUNCIONANDO" ? 0 : 1;
      acc.waste += report.wasteFillPercent;
      acc.blackTank += report.blackWaterTankLevelPercent;
      acc.chlorine += report.chlorineLevel;
      acc.ph += report.phLevel;
      return acc;
    },
    {
      people: 0,
      meals: 0,
      snacks: 0,
      bottles: 0,
      lodgings: 0,
      water: 0,
      fuel: 0,
      fuelRemaining: 0,
      potable: 0,
      blackRemoved: 0,
      blackServices: 0,
      potableServices: 0,
      internetIssues: 0,
      waste: 0,
      blackTank: 0,
      chlorine: 0,
      ph: 0
    }
  );

  // ── Servicios por mes ─────────────────────────────────────────
  const monthMap = new Map<string, {
    label: string;
    blackCount: number;
    blackM3: number;
    potableCount: number;
    potableM3: number;
    campBreakdown: Map<string, { name: string; blackCount: number; blackM3: number; potableCount: number; potableM3: number }>;
  }>();

  const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  for (const report of scopedReports) {
    if (!report.blackWaterRemoved && !report.potableWaterDelivered) continue;
    const d = report.date;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = `${MONTHS_ES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    const row = monthMap.get(key) ?? { label, blackCount: 0, blackM3: 0, potableCount: 0, potableM3: 0, campBreakdown: new Map() };
    if (report.blackWaterRemoved) { row.blackCount++; row.blackM3 += report.blackWaterRemovedM3; }
    if (report.potableWaterDelivered) { row.potableCount++; row.potableM3 += report.potableWaterDeliveredM3; }

    const campRow = row.campBreakdown.get(report.campId) ?? { name: report.camp.name, blackCount: 0, blackM3: 0, potableCount: 0, potableM3: 0 };
    if (report.blackWaterRemoved) { campRow.blackCount++; campRow.blackM3 += report.blackWaterRemovedM3; }
    if (report.potableWaterDelivered) { campRow.potableCount++; campRow.potableM3 += report.potableWaterDeliveredM3; }
    row.campBreakdown.set(report.campId, campRow);
    monthMap.set(key, row);
  }

  const monthlyServices = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => ({ ...row, campBreakdown: Array.from(row.campBreakdown.values()) }));

  const showCampBreakdown = scopeCamps.length > 1 && !scopedSelectedCampId;

  const taskSummary = scopedTaskControls.reduce(
    (acc, control) => {
      const admin = countChecks(control.administrativeChecks);
      const op = countChecks(control.operationalChecks);
      acc.done += admin.done + op.done;
      acc.total += admin.total + op.total;
      return acc;
    },
    { done: 0, total: 0 }
  );

  const campTrendRows = scopeCamps.map((camp) => {
    const campReports = scopedReports.filter((report) => report.campId === camp.id);
    const campTaskControls = scopedTaskControls.filter((control) => control.campId === camp.id);
    const reportTotal = campReports.length;
    const peopleTotal = campReports.reduce((sum, report) => sum + report.peopleCount, 0);
    const mealsTotal = campReports.reduce((sum, report) => sum + report.breakfastCount + report.lunchCount + report.dinnerCount, 0);
    const waterTotal = campReports.reduce((sum, report) => sum + (waterByReportId.get(report.id) ?? report.waterLiters), 0);
    const fuelTotal = campReports.reduce((sum, report) => sum + report.fuelLiters, 0);
    const potableTotal = campReports.reduce((sum, report) => sum + report.potableWaterDeliveredM3, 0);
    const blackRemovedTotal = campReports.reduce((sum, report) => sum + report.blackWaterRemovedM3, 0);
    const internetIssues = campReports.filter((report) => report.internetStatus !== "FUNCIONANDO").length;
    const wasteAvg = reportTotal > 0 ? campReports.reduce((sum, report) => sum + report.wasteFillPercent, 0) / reportTotal : 0;
    const blackTankAvg = reportTotal > 0 ? campReports.reduce((sum, report) => sum + report.blackWaterTankLevelPercent, 0) / reportTotal : 0;

    const taskCompletion = campTaskControls.reduce(
      (acc, control) => {
        const admin = countChecks(control.administrativeChecks);
        const op = countChecks(control.operationalChecks);
        acc.done += admin.done + op.done;
        acc.total += admin.total + op.total;
        return acc;
      },
      { done: 0, total: 0 }
    );

    return {
      id: camp.id,
      name: camp.name,
      reportTotal,
      peopleAvg: reportTotal > 0 ? Math.round(peopleTotal / reportTotal) : 0,
      mealsTotal,
      waterTotal,
      fuelTotal,
      internetIssues,
      wasteAvg,
      taskCompletionPercent: taskCompletion.total > 0 ? Math.round((taskCompletion.done / taskCompletion.total) * 100) : 0
    };
  });

  const dayTrendMap = new Map<
    string,
    { date: string; people: number; meals: number; water: number; fuel: number; taskDone: number; taskTotal: number }
  >();

  for (const report of scopedReports) {
    const dateKey = toInputDateValue(report.date);
    const row = dayTrendMap.get(dateKey) ?? {
      date: dateKey,
      people: 0,
      meals: 0,
      water: 0,
      fuel: 0,
      taskDone: 0,
      taskTotal: 0
    };

    row.people += report.peopleCount;
    row.meals += report.breakfastCount + report.lunchCount + report.dinnerCount;
    row.water += waterByReportId.get(report.id) ?? report.waterLiters;
    row.fuel += report.fuelLiters;
    dayTrendMap.set(dateKey, row);
  }

  for (const control of scopedTaskControls) {
    const dateKey = toInputDateValue(control.date);
    const row = dayTrendMap.get(dateKey) ?? {
      date: dateKey,
      people: 0,
      meals: 0,
      water: 0,
      fuel: 0,
      taskDone: 0,
      taskTotal: 0
    };
    const admin = countChecks(control.administrativeChecks);
    const operational = countChecks(control.operationalChecks);
    row.taskDone += admin.done + operational.done;
    row.taskTotal += admin.total + operational.total;
    dayTrendMap.set(dateKey, row);
  }

  const trendDays = Array.from(dayTrendMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-Math.min(days, 14));

  const maxTrendPeople = Math.max(1, ...trendDays.map((day) => day.people));
  const maxTrendMeals = Math.max(1, ...trendDays.map((day) => day.meals));
  const maxTrendWater = Math.max(1, ...trendDays.map((day) => day.water));
  const maxTrendFuel = Math.max(1, ...trendDays.map((day) => day.fuel));
  const maxCampWater = Math.max(1, ...campTrendRows.map((row) => row.waterTotal));
  const maxCampFuel = Math.max(1, ...campTrendRows.map((row) => row.fuelTotal));
  const maxCampMeals = Math.max(1, ...campTrendRows.map((row) => row.mealsTotal));

  const summaryPeriodLabel = `${formatDisplayDate(periodStart)} al ${formatDisplayDate(periodEnd)}`;
  const avgWaste = scopedReports.length > 0 ? summary.waste / scopedReports.length : 0;
  const avgBlackTank = scopedReports.length > 0 ? summary.blackTank / scopedReports.length : 0;
  const avgChlorine = scopedReports.length > 0 ? summary.chlorine / scopedReports.length : 0;
  const avgPh = scopedReports.length > 0 ? summary.ph / scopedReports.length : 0;
  const taskCompletionPercent = taskSummary.total > 0 ? Math.round((taskSummary.done / taskSummary.total) * 100) : 0;

  return (
    <AppShell
      title="Resumen general"
      user={user}
      activeNav="resumen"
      showAdminSections={canSeeAdminSections}
      rightSlot={
        <form method="get" className="dashboard-filter">
          <select name="campId" defaultValue={scopedSelectedCampId ?? "general"}>
            <option value="general">Todos</option>
            {camps.map((camp) => (
              <option key={camp.id} value={camp.id}>
                {camp.name}
              </option>
            ))}
          </select>
          <select name="days" defaultValue={String(days)} title="Rango rápido si no usas fechas personalizadas">
            <option value="7">7 días</option>
            <option value="14">14 días</option>
            <option value="30">30 días</option>
            <option value="60">60 días</option>
            <option value="90">90 días</option>
          </select>
          <input name="startDate" type="date" defaultValue={periodStartInput} title="Desde" aria-label="Fecha desde" />
          <input name="endDate" type="date" defaultValue={periodEndInput} title="Hasta" aria-label="Fecha hasta" />
          <button type="submit">Ver</button>
        </form>
      }
    >
      <div className="page-stack">
        <div className="hero-panel">
          <div className="hero-kicker">Torre de control</div>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Resumen consolidado de campamentos</h2>
          <div className="section-caption">
            Vista general de consumos y operación en el período seleccionado. Usa fechas personalizadas para revisar agua, combustible y servicios en un rango específico.
          </div>
          <div className="dashboard-mini-stats" style={{ marginTop: 12 }}>
            <span>Período: {summaryPeriodLabel}</span>
            <span>{scopeCamps.length} campamento(s)</span>
            <span>{scopedReports.length} informe(s)</span>
            <span>{scopedTaskControls.length} control(es)</span>
          </div>
        </div>

        <div className="dashboard-kpi-grid insight-kpi-grid">
          <div className="dashboard-kpi teal">
            <div className="dashboard-kpi-label">Personas acumuladas</div>
            <div className="dashboard-kpi-value">{summary.people.toLocaleString("es-CL")}</div>
            <div className="dashboard-kpi-meta">promedio {scopedReports.length > 0 ? Math.round(summary.people / scopedReports.length) : 0} por informe</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Servicios de alimentación</div>
            <div className="dashboard-kpi-value">{summary.meals.toLocaleString("es-CL")}</div>
            <div className="dashboard-kpi-meta">{summary.snacks.toLocaleString("es-CL")} colaciones adicionales</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Agua calculada</div>
            <div className="dashboard-kpi-value">{summary.water.toLocaleString("es-CL")} L</div>
            <div className="dashboard-kpi-meta">{summary.potable.toFixed(0)} m3 ingresados</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Combustible</div>
            <div className="dashboard-kpi-value">{summary.fuel.toLocaleString("es-CL")} L</div>
            <div className="dashboard-kpi-meta">{summary.fuelRemaining.toLocaleString("es-CL")} L restantes informados</div>
          </div>
          <div className={`dashboard-kpi ${taskCompletionPercent < 80 ? "accent" : "teal"}`}>
            <div className="dashboard-kpi-label">Cumplimiento tareas</div>
            <div className="dashboard-kpi-value">{taskCompletionPercent}%</div>
            <div className="dashboard-kpi-meta">{scopedTaskControls.length} controles cargados</div>
          </div>
          <div className={`dashboard-kpi ${summary.internetIssues > 0 ? "accent" : ""}`}>
            <div className="dashboard-kpi-label">Incidentes internet</div>
            <div className="dashboard-kpi-value">{summary.internetIssues}</div>
            <div className="dashboard-kpi-meta">{summary.blackRemoved.toFixed(0)} m3 de aguas negras retiradas</div>
          </div>
        </div>

        <div className="dashboard-core-grid">
          <section className="dashboard-panel dashboard-panel-large">
            <div className="dashboard-panel-header">
              <h2>Tendencias del período</h2>
              <span className="dashboard-chip small">Últimos {trendDays.length || 0} días</span>
            </div>
            <div className="dashboard-chart-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <section className="dashboard-panel" style={{ padding: 0, background: "transparent", border: 0, boxShadow: "none" }}>
                <div className="dashboard-panel-header">
                  <h2>Personas</h2>
                  <span className="dashboard-chip small">{summary.people.toLocaleString("es-CL")} total</span>
                </div>
                <div className="chart-grid compact">
                  {trendDays.map((day) => (
                    <div
                      key={`people-${day.date}`}
                      className="chart-col chart-tooltip-target"
                      data-tooltip={`${formatDisplayDate(new Date(`${day.date}T00:00:00Z`))}: ${day.people} personas`}
                    >
                      <div className="chart-track tall">
                        <div className="chart-bar people" style={{ height: `${(day.people / maxTrendPeople) * 100}%` }} />
                      </div>
                      <div className="chart-label">{day.date.slice(8, 10)}/{day.date.slice(5, 7)}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="dashboard-panel" style={{ padding: 0, background: "transparent", border: 0, boxShadow: "none" }}>
                <div className="dashboard-panel-header">
                  <h2>Comidas</h2>
                  <span className="dashboard-chip small">{summary.meals.toLocaleString("es-CL")} total</span>
                </div>
                <div className="chart-grid compact">
                  {trendDays.map((day) => (
                    <div
                      key={`meals-${day.date}`}
                      className="chart-col chart-tooltip-target"
                      data-tooltip={`${formatDisplayDate(new Date(`${day.date}T00:00:00Z`))}: ${day.meals} comidas`}
                    >
                      <div className="chart-track tall">
                        <div className="chart-bar meals" style={{ height: `${(day.meals / maxTrendMeals) * 100}%` }} />
                      </div>
                      <div className="chart-label">{day.date.slice(8, 10)}/{day.date.slice(5, 7)}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="dashboard-panel" style={{ padding: 0, background: "transparent", border: 0, boxShadow: "none" }}>
                <div className="dashboard-panel-header">
                  <h2>Agua</h2>
                  <span className="dashboard-chip small">{summary.water.toLocaleString("es-CL")} L</span>
                </div>
                <div className="chart-grid compact">
                  {trendDays.map((day) => (
                    <div
                      key={`water-${day.date}`}
                      className="chart-col chart-tooltip-target"
                      data-tooltip={`${formatDisplayDate(new Date(`${day.date}T00:00:00Z`))}: ${day.water.toLocaleString("es-CL")} L`}
                    >
                      <div className="chart-track tall">
                        <div className="chart-bar water" style={{ height: `${(day.water / maxTrendWater) * 100}%` }} />
                      </div>
                      <div className="chart-label">{day.date.slice(8, 10)}/{day.date.slice(5, 7)}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="dashboard-panel" style={{ padding: 0, background: "transparent", border: 0, boxShadow: "none" }}>
                <div className="dashboard-panel-header">
                  <h2>Combustible</h2>
                  <span className="dashboard-chip small">{summary.fuel.toLocaleString("es-CL")} L</span>
                </div>
                <div className="chart-grid compact">
                  {trendDays.map((day) => (
                    <div
                      key={`fuel-${day.date}`}
                      className="chart-col chart-tooltip-target"
                      data-tooltip={`${formatDisplayDate(new Date(`${day.date}T00:00:00Z`))}: ${day.fuel.toLocaleString("es-CL")} L`}
                    >
                      <div className="chart-track tall">
                        <div className="chart-bar fuel" style={{ height: `${(day.fuel / maxTrendFuel) * 100}%` }} />
                      </div>
                      <div className="chart-label">{day.date.slice(8, 10)}/{day.date.slice(5, 7)}</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </div>

        <div className="dashboard-bottom-grid">
          <section className="dashboard-panel dashboard-panel-wide">
            <div className="dashboard-panel-header">
              <h2>Tendencia de cumplimiento diario</h2>
              <span className="dashboard-chip small">{taskCompletionPercent}% promedio</span>
            </div>
            <div className="chart-grid compact">
              {trendDays.map((day) => {
                const taskPercent = day.taskTotal > 0 ? Math.round((day.taskDone / day.taskTotal) * 100) : 0;
                return (
                  <div
                    key={`tasks-${day.date}`}
                    className="chart-col chart-tooltip-target"
                    data-tooltip={`${formatDisplayDate(new Date(`${day.date}T00:00:00Z`))}: ${taskPercent}% cumplimiento`}
                  >
                    <div className="chart-track tall">
                      <div className="chart-bar meals" style={{ height: `${taskPercent}%`, background: "linear-gradient(180deg, #20b36c, #0d8a3b)" }} />
                    </div>
                    <div className="chart-label">{day.date.slice(8, 10)}/{day.date.slice(5, 7)}</div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* ── Servicios de saneamiento por mes ── */}
        <div className="dashboard-bottom-grid">
          <section className="dashboard-panel dashboard-panel-wide">
            <div className="dashboard-panel-header">
              <h2>Servicios de saneamiento</h2>
              <span className="dashboard-chip small">
                {summary.blackServices} retiro(s) AN · {summary.potableServices} ingreso(s) AP
              </span>
            </div>
            {monthlyServices.length === 0 ? (
              <div className="section-caption">Sin servicios registrados en el período.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--border)" }}>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--muted)", fontWeight: 600 }}>Mes</th>
                      <th style={{ textAlign: "center", padding: "8px 12px", color: "var(--muted)", fontWeight: 600 }}>🚛 Retiros AN</th>
                      <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--muted)", fontWeight: 600 }}>m³ retirados</th>
                      <th style={{ textAlign: "center", padding: "8px 12px", color: "var(--muted)", fontWeight: 600 }}>💧 Ingresos AP</th>
                      <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--muted)", fontWeight: 600 }}>m³ ingresados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyServices.map((row, i) => (
                      <>
                        <tr key={`month-${i}`} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "rgba(0,168,184,0.04)" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 700, color: "var(--text)" }}>{row.label}</td>
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <span style={{ background: row.blackCount > 0 ? "rgba(255,100,80,0.12)" : "transparent", color: row.blackCount > 0 ? "#c0392b" : "var(--muted)", borderRadius: 6, padding: "2px 10px", fontWeight: 700 }}>
                              {row.blackCount}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: "var(--text)" }}>{row.blackM3 > 0 ? `${row.blackM3.toFixed(1)} m³` : "—"}</td>
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <span style={{ background: row.potableCount > 0 ? "rgba(0,168,184,0.12)" : "transparent", color: row.potableCount > 0 ? "var(--teal)" : "var(--muted)", borderRadius: 6, padding: "2px 10px", fontWeight: 700 }}>
                              {row.potableCount}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: "var(--text)" }}>{row.potableM3 > 0 ? `${row.potableM3.toFixed(1)} m³` : "—"}</td>
                        </tr>
                        {showCampBreakdown && row.campBreakdown.map((camp) => (
                          <tr key={`camp-${i}-${camp.name}`} style={{ borderBottom: "1px solid var(--border)", opacity: 0.75 }}>
                            <td style={{ padding: "6px 12px 6px 28px", color: "var(--muted)", fontSize: "0.82rem" }}>↳ {camp.name}</td>
                            <td style={{ padding: "6px 12px", textAlign: "center", color: "var(--muted)", fontSize: "0.82rem" }}>{camp.blackCount || "—"}</td>
                            <td style={{ padding: "6px 12px", textAlign: "right", color: "var(--muted)", fontSize: "0.82rem" }}>{camp.blackM3 > 0 ? `${camp.blackM3.toFixed(1)} m³` : "—"}</td>
                            <td style={{ padding: "6px 12px", textAlign: "center", color: "var(--muted)", fontSize: "0.82rem" }}>{camp.potableCount || "—"}</td>
                            <td style={{ padding: "6px 12px", textAlign: "right", color: "var(--muted)", fontSize: "0.82rem" }}>{camp.potableM3 > 0 ? `${camp.potableM3.toFixed(1)} m³` : "—"}</td>
                          </tr>
                        ))}
                      </>
                    ))}
                    <tr style={{ borderTop: "2px solid var(--border)", background: "rgba(0,168,184,0.06)" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: "var(--text)" }}>Total período</td>
                      <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, color: "#c0392b" }}>{summary.blackServices}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "var(--text)" }}>{summary.blackRemoved > 0 ? `${summary.blackRemoved.toFixed(1)} m³` : "—"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, color: "var(--teal)" }}>{summary.potableServices}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "var(--text)" }}>{summary.potable > 0 ? `${summary.potable.toFixed(1)} m³` : "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="dashboard-bottom-grid">
          <section className="dashboard-panel dashboard-panel-wide">
            <div className="dashboard-panel-header">
              <h2>Comparativo campamentos</h2>
              <span className="dashboard-chip small">Visual del período</span>
            </div>
            <div className="summary-list">
              {campTrendRows.map((row) => (
                <div key={row.id} className="summary-row" style={{ alignItems: "stretch", gap: 16 }}>
                  <div style={{ minWidth: 180 }}>
                    <strong>{row.name}</strong>
                    <div style={{ color: "var(--muted)" }}>
                      {row.reportTotal} informe(s) · {row.peopleAvg} personas prom.
                    </div>
                  </div>
                  <div style={{ flex: 1, display: "grid", gap: 8 }}>
                    <div className="progress-cell">
                      <span style={{ minWidth: 58 }}>Agua</span>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${(row.waterTotal / maxCampWater) * 100}%` }} />
                      </div>
                      <strong>{row.waterTotal.toLocaleString("es-CL")} L</strong>
                    </div>
                    <div className="progress-cell">
                      <span style={{ minWidth: 58 }}>Comb.</span>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${(row.fuelTotal / maxCampFuel) * 100}%`, background: "linear-gradient(90deg, #ff7b2f, #ff9f1c)" }}
                        />
                      </div>
                      <strong>{row.fuelTotal.toLocaleString("es-CL")} L</strong>
                    </div>
                    <div className="progress-cell">
                      <span style={{ minWidth: 58 }}>Comidas</span>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${(row.mealsTotal / maxCampMeals) * 100}%`, background: "linear-gradient(90deg, #006878, #00a6b6)" }}
                        />
                      </div>
                      <strong>{row.mealsTotal.toLocaleString("es-CL")}</strong>
                    </div>
                  </div>
                  <div style={{ minWidth: 120, textAlign: "right" }}>
                    <div className={`status-pill ${row.taskCompletionPercent >= 80 ? "ok" : row.taskCompletionPercent >= 60 ? "warn" : "danger"}`}>
                      {row.taskCompletionPercent}%
                    </div>
                    <div style={{ color: "var(--muted)", marginTop: 8, fontSize: "0.8rem" }}>
                      basura {row.wasteAvg.toFixed(0)}% · internet {row.internetIssues}
                    </div>
                  </div>
                </div>
              ))}
              {campTrendRows.length === 0 ? <div className="section-caption">Sin campamentos para comparar.</div> : null}
            </div>
          </section>
        </div>

      </div>
    </AppShell>
  );
}

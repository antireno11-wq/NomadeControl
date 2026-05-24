import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ADMIN_ROLES, isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDisplayDate, formatShortDisplayDate } from "@/lib/report-utils";
import { AppShell } from "@/components/app-shell";
import { BarChart, LineChart, StackedBarChart, ChartColors } from "@/components/charts";
import { cerrarCampamentoAction, reabrirCampamentoAction } from "@/app/administracion/actions";

export default async function ResumenCampamentoPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { status?: string };
}) {
  const user = await requireRole(OPERATION_ROLES);
  const canAdmin = isAdminRole(user.role);

  const camp = await db.camp.findUnique({
    where: { id: params.id },
    include: {
      _count: { select: { staffMembers: true, vehicles: true } },
      reports: { orderBy: { date: "asc" } },
      dailyTaskControls: { orderBy: { date: "asc" } },
    },
  });

  if (!camp) notFound();

  // Acceso: no-admin solo puede ver su propio campamento
  if (!canAdmin && user.campId !== camp.id) {
    redirect("/operaciones");
  }

  // ─── Agregaciones ───────────────────────────────────────────────────
  const reports = camp.reports;
  const totalReports = reports.length;
  const totalPeopleDays = reports.reduce((s, r) => s + r.peopleCount, 0);
  const totalLodgings = reports.reduce((s, r) => s + r.lodgingCount, 0);
  const totalBreakfasts = reports.reduce((s, r) => s + r.breakfastCount, 0);
  const totalLunches = reports.reduce((s, r) => s + r.lunchCount, 0);
  const totalDinners = reports.reduce((s, r) => s + r.dinnerCount, 0);
  const totalSnacks = reports.reduce((s, r) => s + r.snackSimpleCount + r.snackReplacementCount, 0);
  const totalMeals = totalBreakfasts + totalLunches + totalDinners + totalSnacks;
  const totalWater = reports.reduce((s, r) => s + r.waterLiters, 0);
  const totalFuel = reports.reduce((s, r) => s + r.fuelLiters, 0);
  const totalBlackWaterRemoved = reports.reduce((s, r) => s + (r.blackWaterRemovedM3 ?? 0), 0);
  const totalPotableDelivered = reports.reduce((s, r) => s + (r.potableWaterDeliveredM3 ?? 0), 0);
  const totalWaterBottles = reports.reduce((s, r) => s + (r.waterBottleCount ?? 0), 0);

  const firstReportDate = reports[0]?.date ?? camp.createdAt;
  const lastReportDate = reports[reports.length - 1]?.date ?? null;
  const operationStart = firstReportDate;
  const operationEnd = camp.closedAt ?? lastReportDate ?? new Date();
  const operationalDays = Math.max(
    1,
    Math.ceil((operationEnd.getTime() - operationStart.getTime()) / 86400000) + 1
  );

  const avgPeople = totalReports > 0 ? totalPeopleDays / totalReports : 0;
  const avgWater = totalReports > 0 ? totalWater / totalReports : 0;
  const avgFuel = totalReports > 0 ? totalFuel / totalReports : 0;

  // Series para gráficos
  const peopleSeries = reports.map((r) => ({ label: formatShortDisplayDate(r.date), value: r.peopleCount }));
  const waterSeries = reports.map((r) => ({ label: formatShortDisplayDate(r.date), value: r.waterLiters }));
  const fuelSeries = reports.map((r) => ({ label: formatShortDisplayDate(r.date), value: r.fuelLiters }));
  const generatorSeries = reports.map((r) => ({
    label: formatShortDisplayDate(r.date),
    value: Number(((r.generator1Hours ?? 0) + (r.generator2Hours ?? 0)).toFixed(1)),
  }));
  const mealsStacked = reports.map((r) => ({
    label: formatShortDisplayDate(r.date),
    segments: [
      { key: "Desayuno", value: r.breakfastCount, color: ChartColors.amber },
      { key: "Almuerzo", value: r.lunchCount, color: ChartColors.teal },
      { key: "Cena", value: r.dinnerCount, color: ChartColors.green },
      { key: "Snacks", value: r.snackSimpleCount + r.snackReplacementCount, color: ChartColors.slate },
    ],
  }));

  const isClosed = !camp.isActive;
  const statusMsg = searchParams?.status;

  return (
    <AppShell
      title={`Resumen · ${camp.name}`}
      user={user}
      activeNav="operaciones"
      showAdminSections={canAdmin}
      rightSlot={
        <Link href="/operaciones?vista=campamentos">
          <button type="button" className="secondary">← Campamentos</button>
        </Link>
      }
    >
      <div className="page-stack">
        {statusMsg === "closed" && (
          <div className="alert success">Campamento cerrado correctamente. Los trabajadores activos quedaron sin campamento asignado.</div>
        )}

        {/* ── Estado del campamento ── */}
        <div className="card" style={{ borderLeft: `4px solid ${isClosed ? "#9e2f23" : "#16a34a"}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>{camp.name}</h2>
                <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: "0.78rem", fontWeight: 700, background: isClosed ? "#fce9e8" : "#dcfce7", color: isClosed ? "#9e2f23" : "#166534" }}>
                  {isClosed ? "🔒 Cerrado" : "✅ Activo"}
                </span>
              </div>
              {camp.location && <div style={{ color: "var(--muted)", marginTop: 6, fontSize: "0.9rem" }}>📍 {camp.location}</div>}
              <div style={{ color: "var(--muted)", marginTop: 6, fontSize: "0.85rem" }}>
                {operationalDays} días de operación · {formatDisplayDate(operationStart)} → {camp.closedAt ? formatDisplayDate(camp.closedAt) : "hoy"}
              </div>
            </div>

            {/* Acciones de cierre */}
            {canAdmin && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {isClosed ? (
                  <form action={reabrirCampamentoAction}>
                    <input type="hidden" name="campId" value={camp.id} />
                    <button type="submit" className="secondary" style={{ fontSize: "0.85rem" }}>Reabrir campamento</button>
                  </form>
                ) : (
                  <form action={cerrarCampamentoAction}>
                    <input type="hidden" name="campId" value={camp.id} />
                    <button
                      type="submit"
                      style={{ background: "#9e2f23", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" }}
                    >
                      🏁 Finalizar campamento
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>

          {!isClosed && canAdmin && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "#fef9c3", border: "1px solid #fef08a", borderRadius: 8, fontSize: "0.85rem", color: "#854d0e" }}>
              ⚠️ Al finalizar el campamento se guardará toda la data y los {camp._count.staffMembers} trabajadores activos quedarán sin campamento asignado (siguen activos en el sistema).
            </div>
          )}
        </div>

        {/* ── KPIs ── */}
        <div className="dashboard-kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <div className="dashboard-kpi teal">
            <div className="dashboard-kpi-label">Días operativos</div>
            <div className="dashboard-kpi-value">{operationalDays}</div>
            <div className="dashboard-kpi-meta">{totalReports} informes diarios</div>
          </div>
          <div className="dashboard-kpi teal">
            <div className="dashboard-kpi-label">Personas-día</div>
            <div className="dashboard-kpi-value">{totalPeopleDays.toLocaleString("es-CL")}</div>
            <div className="dashboard-kpi-meta">prom. {avgPeople.toFixed(1)} pers/día</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Comidas servidas</div>
            <div className="dashboard-kpi-value">{totalMeals.toLocaleString("es-CL")}</div>
            <div className="dashboard-kpi-meta">{totalBreakfasts.toLocaleString("es-CL")} D · {totalLunches.toLocaleString("es-CL")} A · {totalDinners.toLocaleString("es-CL")} C</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Agua consumida</div>
            <div className="dashboard-kpi-value">{totalWater.toLocaleString("es-CL")} L</div>
            <div className="dashboard-kpi-meta">prom. {avgWater.toFixed(0)} L/día</div>
          </div>
          <div className="dashboard-kpi accent">
            <div className="dashboard-kpi-label">Combustible</div>
            <div className="dashboard-kpi-value">{totalFuel.toLocaleString("es-CL")} L</div>
            <div className="dashboard-kpi-meta">prom. {avgFuel.toFixed(0)} L/día</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Alojamientos</div>
            <div className="dashboard-kpi-value">{totalLodgings.toLocaleString("es-CL")}</div>
            <div className="dashboard-kpi-meta">noches-cama acumuladas</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Botellones</div>
            <div className="dashboard-kpi-value">{totalWaterBottles.toLocaleString("es-CL")}</div>
            <div className="dashboard-kpi-meta">unidades entregadas</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Aguas servidas</div>
            <div className="dashboard-kpi-value">{totalBlackWaterRemoved.toFixed(1)} m³</div>
            <div className="dashboard-kpi-meta">retiradas · {totalPotableDelivered.toFixed(1)} m³ entregados</div>
          </div>
        </div>

        {/* ── Gráficos ── */}
        {totalReports === 0 ? (
          <div className="card">
            <div className="alert error">No hay informes diarios cargados para este campamento. No se puede generar gráficos.</div>
          </div>
        ) : (
          <>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>👥 Personas por día</h3>
              <LineChart data={peopleSeries} color={ChartColors.teal} unit="pers" />
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>🍽️ Comidas servidas por día</h3>
              <StackedBarChart
                data={mealsStacked}
                legend={[
                  { key: "desayuno", label: "Desayuno", color: ChartColors.amber },
                  { key: "almuerzo", label: "Almuerzo", color: ChartColors.teal },
                  { key: "cena", label: "Cena", color: ChartColors.green },
                  { key: "snacks", label: "Snacks", color: ChartColors.slate },
                ]}
              />
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>💧 Consumo de agua (L)</h3>
              <BarChart data={waterSeries} color={ChartColors.teal} unit="L" />
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>⛽ Consumo de combustible (L)</h3>
              <BarChart data={fuelSeries} color={ChartColors.amber} unit="L" />
            </div>

            {generatorSeries.some((s) => s.value > 0) && (
              <div className="card">
                <h3 style={{ marginTop: 0 }}>⚡ Horas de generadores</h3>
                <LineChart data={generatorSeries} color={ChartColors.red} unit="hrs" />
              </div>
            )}
          </>
        )}

        {/* ── Recursos asociados ── */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>📋 Recursos asociados</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <div style={{ padding: 14, background: "rgba(0,0,0,0.03)", borderRadius: 10 }}>
              <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Trabajadores</div>
              <div style={{ fontWeight: 700, fontSize: "1.4rem", color: "var(--text)", marginTop: 4 }}>{camp._count.staffMembers}</div>
              <div style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: 2 }}>asociados al campamento</div>
            </div>
            <div style={{ padding: 14, background: "rgba(0,0,0,0.03)", borderRadius: 10 }}>
              <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Vehículos</div>
              <div style={{ fontWeight: 700, fontSize: "1.4rem", color: "var(--text)", marginTop: 4 }}>{camp._count.vehicles}</div>
              <div style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: 2 }}>asignados</div>
            </div>
            <div style={{ padding: 14, background: "rgba(0,0,0,0.03)", borderRadius: 10 }}>
              <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Controles diarios</div>
              <div style={{ fontWeight: 700, fontSize: "1.4rem", color: "var(--text)", marginTop: 4 }}>{camp.dailyTaskControls.length}</div>
              <div style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: 2 }}>tareas registradas</div>
            </div>
            <div style={{ padding: 14, background: "rgba(0,0,0,0.03)", borderRadius: 10 }}>
              <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Capacidad</div>
              <div style={{ fontWeight: 700, fontSize: "1.4rem", color: "var(--text)", marginTop: 4 }}>{camp.capacityPeople}</div>
              <div style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: 2 }}>personas</div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

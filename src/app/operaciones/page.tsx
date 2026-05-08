import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDisplayDate, formatShortDisplayDateValue, normalizeDateOnly, resolveWaterLiters, toInputDateValue } from "@/lib/report-utils";
import { getCampWeatherSummary } from "@/lib/weather";
import { AppShell } from "@/components/app-shell";

function parseDaysParam(raw: string | string[] | undefined) {
  const value = typeof raw === "string" ? Number(raw) : NaN;
  return [7, 14, 30, 60, 90].includes(value) ? value : 30;
}
function parseDateParam(raw: string | string[] | undefined) {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = normalizeDateOnly(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
function countChecks(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { done: 0, total: 0 };
  const entries = Object.values(value as Record<string, unknown>);
  return { total: entries.length, done: entries.filter((e) => e === true).length };
}

const TAB_STYLES = {
  base: { padding: "6px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.9rem", textDecoration: "none", display: "inline-block" } as React.CSSProperties,
  active: { background: "#1e3a5f", color: "#fff" } as React.CSSProperties,
  inactive: { background: "#f1f5f9", color: "#64748b" } as React.CSSProperties,
};

import React from "react";

function estimateUtcDate(baseDate: Date, daysFromBase: number) {
  const projected = new Date(baseDate);
  projected.setUTCDate(projected.getUTCDate() + Math.max(1, Math.ceil(daysFromBase)));
  return formatDisplayDate(projected);
}

export default async function OperacionesPage({ searchParams }: { searchParams?: { campId?: string | string[]; vista?: string; days?: string | string[]; startDate?: string | string[]; endDate?: string | string[] } }) {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const vista = searchParams?.vista ?? "hoy";

  // ── VISTA HISTÓRICA ─────────────────────────────────────────────────────────
  if (vista === "historico") {
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
    const defaultStartDate = new Date(todayDate); defaultStartDate.setUTCDate(defaultStartDate.getUTCDate() - days);
    const rawPeriodStart = customStartDate ?? defaultStartDate;
    const rawPeriodEnd = customEndDate ?? todayDate;
    const periodStart = rawPeriodStart <= rawPeriodEnd ? rawPeriodStart : rawPeriodEnd;
    const periodEnd = rawPeriodStart <= rawPeriodEnd ? rawPeriodEnd : rawPeriodStart;
    const periodStartInput = hasCustomPeriod ? toInputDateValue(periodStart) : "";
    const periodEndInput = hasCustomPeriod ? toInputDateValue(periodEnd) : "";
    const [camps, reports, taskControls] = await Promise.all([
      db.camp.findMany({ where: { isActive: true, ...(campFilter ? { id: campFilter } : {}) }, orderBy: { name: "asc" } }),
      db.dailyReport.findMany({ where: { ...(campFilter ? { campId: campFilter } : {}), date: { gte: periodStart, lte: periodEnd } }, orderBy: [{ date: "asc" }, { camp: { name: "asc" } }], include: { camp: true, createdBy: true } }),
      db.dailyTaskControl.findMany({ where: { ...(campFilter ? { campId: campFilter } : {}), date: { gte: periodStart, lte: periodEnd } }, orderBy: [{ date: "desc" }, { camp: { name: "asc" } }], include: { camp: true, createdBy: true } }),
    ]);
    const scopeCamps = scopedSelectedCampId ? camps.filter((c) => c.id === scopedSelectedCampId) : camps;
    const scopeCampIds = new Set(scopeCamps.map((c) => c.id));
    const scopedReports = reports.filter((r) => scopeCampIds.has(r.campId));
    const scopedTaskControls = taskControls.filter((c) => scopeCampIds.has(c.campId));
    const waterByReportId = new Map<string, number>();
    const previousReportByCamp = new Map<string, { meterReading: number; waterLiters: number }>();
    for (const report of scopedReports) {
      const prev = previousReportByCamp.get(report.campId);
      const w = resolveWaterLiters(report, prev);
      waterByReportId.set(report.id, w);
      previousReportByCamp.set(report.campId, report);
    }
    const summary = scopedReports.reduce((acc, r) => {
      acc.people += r.peopleCount; acc.meals += r.breakfastCount + r.lunchCount + r.dinnerCount;
      acc.snacks += r.snackSimpleCount + r.snackReplacementCount; acc.bottles += r.waterBottleCount;
      acc.water += waterByReportId.get(r.id) ?? r.waterLiters; acc.fuel += r.fuelLiters;
      acc.fuelRemaining += r.fuelRemainingLiters; acc.potable += r.potableWaterDeliveredM3;
      acc.blackRemoved += r.blackWaterRemovedM3; acc.blackServices += r.blackWaterRemoved ? 1 : 0;
      acc.potableServices += r.potableWaterDelivered ? 1 : 0;
      acc.internetIssues += r.internetStatus === "FUNCIONANDO" ? 0 : 1;
      return acc;
    }, { people: 0, meals: 0, snacks: 0, bottles: 0, water: 0, fuel: 0, fuelRemaining: 0, potable: 0, blackRemoved: 0, blackServices: 0, potableServices: 0, internetIssues: 0 });
    const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const monthMap = new Map<string, { label: string; blackCount: number; blackM3: number; potableCount: number; potableM3: number; campBreakdown: Map<string, { name: string; blackCount: number; blackM3: number; potableCount: number; potableM3: number }> }>();
    for (const r of scopedReports) {
      if (!r.blackWaterRemoved && !r.potableWaterDelivered) continue;
      const d = r.date; const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
      const label = `${MONTHS_ES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      const row = monthMap.get(key) ?? { label, blackCount:0, blackM3:0, potableCount:0, potableM3:0, campBreakdown: new Map() };
      if (r.blackWaterRemoved) { row.blackCount++; row.blackM3 += r.blackWaterRemovedM3; }
      if (r.potableWaterDelivered) { row.potableCount++; row.potableM3 += r.potableWaterDeliveredM3; }
      const cr = row.campBreakdown.get(r.campId) ?? { name: r.camp.name, blackCount:0, blackM3:0, potableCount:0, potableM3:0 };
      if (r.blackWaterRemoved) { cr.blackCount++; cr.blackM3 += r.blackWaterRemovedM3; }
      if (r.potableWaterDelivered) { cr.potableCount++; cr.potableM3 += r.potableWaterDeliveredM3; }
      row.campBreakdown.set(r.campId, cr); monthMap.set(key, row);
    }
    const monthlyServices = Array.from(monthMap.entries()).sort(([a],[b]) => a.localeCompare(b)).map(([,row]) => ({ ...row, campBreakdown: Array.from(row.campBreakdown.values()) }));
    const showCampBreakdown = scopeCamps.length > 1 && !scopedSelectedCampId;
    const taskSummary = scopedTaskControls.reduce((acc, c) => { const a=countChecks(c.administrativeChecks); const o=countChecks(c.operationalChecks); acc.done+=a.done+o.done; acc.total+=a.total+o.total; return acc; }, { done:0, total:0 });
    const campTrendRows = scopeCamps.map((camp) => {
      const cr = scopedReports.filter((r) => r.campId === camp.id);
      const ct = scopedTaskControls.filter((c) => c.campId === camp.id);
      const rt = cr.length; const tc = ct.reduce((a,c) => { const ad=countChecks(c.administrativeChecks); const op=countChecks(c.operationalChecks); a.done+=ad.done+op.done; a.total+=ad.total+op.total; return a; }, {done:0,total:0});
      return { id: camp.id, name: camp.name, reportTotal: rt, peopleAvg: rt>0?Math.round(cr.reduce((s,r)=>s+r.peopleCount,0)/rt):0, mealsTotal: cr.reduce((s,r)=>s+r.breakfastCount+r.lunchCount+r.dinnerCount,0), waterTotal: cr.reduce((s,r)=>s+(waterByReportId.get(r.id)??r.waterLiters),0), fuelTotal: cr.reduce((s,r)=>s+r.fuelLiters,0), internetIssues: cr.filter((r)=>r.internetStatus!=="FUNCIONANDO").length, taskCompletionPercent: tc.total>0?Math.round((tc.done/tc.total)*100):0 };
    });
    const dayTrendMap = new Map<string,{date:string;people:number;meals:number;water:number;fuel:number;taskDone:number;taskTotal:number}>();
    for (const r of scopedReports) { const k=toInputDateValue(r.date); const row=dayTrendMap.get(k)??{date:k,people:0,meals:0,water:0,fuel:0,taskDone:0,taskTotal:0}; row.people+=r.peopleCount; row.meals+=r.breakfastCount+r.lunchCount+r.dinnerCount; row.water+=waterByReportId.get(r.id)??r.waterLiters; row.fuel+=r.fuelLiters; dayTrendMap.set(k,row); }
    for (const c of scopedTaskControls) { const k=toInputDateValue(c.date); const row=dayTrendMap.get(k)??{date:k,people:0,meals:0,water:0,fuel:0,taskDone:0,taskTotal:0}; const a=countChecks(c.administrativeChecks); const o=countChecks(c.operationalChecks); row.taskDone+=a.done+o.done; row.taskTotal+=a.total+o.total; dayTrendMap.set(k,row); }
    const trendDays = Array.from(dayTrendMap.values()).sort((a,b)=>a.date.localeCompare(b.date)).slice(-Math.min(days,14));
    const maxTP=Math.max(1,...trendDays.map(d=>d.people)), maxTM=Math.max(1,...trendDays.map(d=>d.meals)), maxTW=Math.max(1,...trendDays.map(d=>d.water)), maxTF=Math.max(1,...trendDays.map(d=>d.fuel));
    const maxCW=Math.max(1,...campTrendRows.map(r=>r.waterTotal)), maxCF=Math.max(1,...campTrendRows.map(r=>r.fuelTotal)), maxCM=Math.max(1,...campTrendRows.map(r=>r.mealsTotal));
    const summaryPeriodLabel=`${formatDisplayDate(periodStart)} al ${formatDisplayDate(periodEnd)}`;
    const taskCompletionPercent=taskSummary.total>0?Math.round((taskSummary.done/taskSummary.total)*100):0;

    return (
      <AppShell title="Operaciones" user={user} activeNav="operaciones" showAdminSections={canSeeAdminSections}
        rightSlot={
          <form method="get" className="dashboard-filter">
            <input type="hidden" name="vista" value="historico" />
            <select name="campId" defaultValue={scopedSelectedCampId ?? "general"}>
              <option value="general">Todos</option>
              {camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select name="days" defaultValue={String(days)}>
              {[7,14,30,60,90].map(d=><option key={d} value={d}>{d} días</option>)}
            </select>
            <input name="startDate" type="date" defaultValue={periodStartInput} aria-label="Desde" />
            <input name="endDate" type="date" defaultValue={periodEndInput} aria-label="Hasta" />
            <button type="submit">Ver</button>
          </form>
        }
      >
        <div className="page-stack">
          {/* Pestañas */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Link href="/operaciones" style={{ ...TAB_STYLES.base, ...TAB_STYLES.inactive }}>Estado hoy</Link>
            <span style={{ ...TAB_STYLES.base, ...TAB_STYLES.active }}>Histórico</span>
          </div>

          <div className="hero-panel">
            <div className="hero-kicker">Torre de control</div>
            <h2 style={{ marginTop:0, marginBottom:8 }}>Resumen consolidado de campamentos</h2>
            <div className="dashboard-mini-stats" style={{ marginTop:12 }}>
              <span>Período: {summaryPeriodLabel}</span>
              <span>{scopeCamps.length} campamento(s)</span>
              <span>{scopedReports.length} informe(s)</span>
            </div>
          </div>

          <div className="dashboard-kpi-grid insight-kpi-grid">
            <div className="dashboard-kpi teal"><div className="dashboard-kpi-label">Personas acumuladas</div><div className="dashboard-kpi-value">{summary.people.toLocaleString("es-CL")}</div><div className="dashboard-kpi-meta">prom. {scopedReports.length>0?Math.round(summary.people/scopedReports.length):0} por informe</div></div>
            <div className="dashboard-kpi"><div className="dashboard-kpi-label">Servicios de alimentación</div><div className="dashboard-kpi-value">{summary.meals.toLocaleString("es-CL")}</div><div className="dashboard-kpi-meta">{summary.snacks.toLocaleString("es-CL")} colaciones</div></div>
            <div className="dashboard-kpi"><div className="dashboard-kpi-label">Agua calculada</div><div className="dashboard-kpi-value">{summary.water.toLocaleString("es-CL")} L</div><div className="dashboard-kpi-meta">{summary.potable.toFixed(0)} m³ ingresados</div></div>
            <div className="dashboard-kpi"><div className="dashboard-kpi-label">Combustible</div><div className="dashboard-kpi-value">{summary.fuel.toLocaleString("es-CL")} L</div><div className="dashboard-kpi-meta">{summary.fuelRemaining.toLocaleString("es-CL")} L restantes</div></div>
            <div className={`dashboard-kpi ${taskCompletionPercent<80?"accent":"teal"}`}><div className="dashboard-kpi-label">Cumplimiento tareas</div><div className="dashboard-kpi-value">{taskCompletionPercent}%</div><div className="dashboard-kpi-meta">{scopedTaskControls.length} controles</div></div>
            <div className={`dashboard-kpi ${summary.internetIssues>0?"accent":""}`}><div className="dashboard-kpi-label">Incidentes internet</div><div className="dashboard-kpi-value">{summary.internetIssues}</div><div className="dashboard-kpi-meta">{summary.blackRemoved.toFixed(0)} m³ AN retiradas</div></div>
          </div>

          <div className="dashboard-core-grid">
            <section className="dashboard-panel dashboard-panel-large">
              <div className="dashboard-panel-header"><h2>Tendencias del período</h2><span className="dashboard-chip small">Últimos {trendDays.length} días</span></div>
              <div className="dashboard-chart-grid" style={{ gridTemplateColumns:"repeat(2,minmax(0,1fr))" }}>
                {([["Personas","people",maxTP,"people"],["Comidas","meals",maxTM,"meals"],["Agua","water",maxTW,"water"],["Combustible","fuel",maxTF,"fuel"]] as [string,keyof typeof trendDays[0],number,string][]).map(([label,key,max,barClass]) => (
                  <section key={label} className="dashboard-panel" style={{padding:0,background:"transparent",border:0,boxShadow:"none"}}>
                    <div className="dashboard-panel-header"><h2>{label}</h2></div>
                    <div className="chart-grid compact">
                      {trendDays.map((day) => (
                        <div key={`${label}-${day.date}`} className="chart-col chart-tooltip-target" data-tooltip={`${day.date.slice(8,10)}/${day.date.slice(5,7)}: ${(day[key] as number).toLocaleString("es-CL")}`}>
                          <div className="chart-track tall"><div className={`chart-bar ${barClass}`} style={{height:`${((day[key] as number)/max)*100}%`}} /></div>
                          <div className="chart-label">{day.date.slice(8,10)}/{day.date.slice(5,7)}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          </div>

          <div className="dashboard-bottom-grid">
            <section className="dashboard-panel dashboard-panel-wide">
              <div className="dashboard-panel-header"><h2>Tendencia cumplimiento diario</h2><span className="dashboard-chip small">{taskCompletionPercent}% promedio</span></div>
              <div className="chart-grid compact">
                {trendDays.map((day) => { const pct=day.taskTotal>0?Math.round((day.taskDone/day.taskTotal)*100):0; return (
                  <div key={`tasks-${day.date}`} className="chart-col chart-tooltip-target" data-tooltip={`${day.date.slice(8,10)}/${day.date.slice(5,7)}: ${pct}%`}>
                    <div className="chart-track tall"><div className="chart-bar meals" style={{height:`${pct}%`,background:"linear-gradient(180deg,#20b36c,#0d8a3b)"}} /></div>
                    <div className="chart-label">{day.date.slice(8,10)}/{day.date.slice(5,7)}</div>
                  </div>
                ); })}
              </div>
            </section>
          </div>

          <div className="dashboard-bottom-grid">
            <section className="dashboard-panel dashboard-panel-wide">
              <div className="dashboard-panel-header"><h2>Servicios de saneamiento</h2><span className="dashboard-chip small">{summary.blackServices} retiro(s) AN · {summary.potableServices} ingreso(s) AP</span></div>
              {monthlyServices.length === 0 ? <div className="section-caption">Sin servicios en el período.</div> : (
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.9rem"}}>
                    <thead><tr style={{borderBottom:"2px solid var(--border)"}}>
                      <th style={{textAlign:"left",padding:"8px 12px",color:"var(--muted)",fontWeight:600}}>Mes</th>
                      <th style={{textAlign:"center",padding:"8px 12px",color:"var(--muted)",fontWeight:600}}>🚛 Retiros AN</th>
                      <th style={{textAlign:"right",padding:"8px 12px",color:"var(--muted)",fontWeight:600}}>m³</th>
                      <th style={{textAlign:"center",padding:"8px 12px",color:"var(--muted)",fontWeight:600}}>💧 Ingresos AP</th>
                      <th style={{textAlign:"right",padding:"8px 12px",color:"var(--muted)",fontWeight:600}}>m³</th>
                    </tr></thead>
                    <tbody>
                      {monthlyServices.map((row,i) => (<React.Fragment key={i}>
                        <tr style={{borderBottom:"1px solid var(--border)",background:i%2===0?"transparent":"rgba(0,168,184,0.04)"}}>
                          <td style={{padding:"10px 12px",fontWeight:700}}>{row.label}</td>
                          <td style={{padding:"10px 12px",textAlign:"center"}}><span style={{background:row.blackCount>0?"rgba(255,100,80,0.12)":"transparent",color:row.blackCount>0?"#c0392b":"var(--muted)",borderRadius:6,padding:"2px 10px",fontWeight:700}}>{row.blackCount}</span></td>
                          <td style={{padding:"10px 12px",textAlign:"right",fontWeight:600}}>{row.blackM3>0?`${row.blackM3.toFixed(1)} m³`:"—"}</td>
                          <td style={{padding:"10px 12px",textAlign:"center"}}><span style={{background:row.potableCount>0?"rgba(0,168,184,0.12)":"transparent",color:row.potableCount>0?"var(--teal)":"var(--muted)",borderRadius:6,padding:"2px 10px",fontWeight:700}}>{row.potableCount}</span></td>
                          <td style={{padding:"10px 12px",textAlign:"right",fontWeight:600}}>{row.potableM3>0?`${row.potableM3.toFixed(1)} m³`:"—"}</td>
                        </tr>
                        {showCampBreakdown && row.campBreakdown.map((c) => (
                          <tr key={`${i}-${c.name}`} style={{borderBottom:"1px solid var(--border)",opacity:0.75}}>
                            <td style={{padding:"6px 12px 6px 28px",color:"var(--muted)",fontSize:"0.82rem"}}>↳ {c.name}</td>
                            <td style={{padding:"6px 12px",textAlign:"center",color:"var(--muted)",fontSize:"0.82rem"}}>{c.blackCount||"—"}</td>
                            <td style={{padding:"6px 12px",textAlign:"right",color:"var(--muted)",fontSize:"0.82rem"}}>{c.blackM3>0?`${c.blackM3.toFixed(1)} m³`:"—"}</td>
                            <td style={{padding:"6px 12px",textAlign:"center",color:"var(--muted)",fontSize:"0.82rem"}}>{c.potableCount||"—"}</td>
                            <td style={{padding:"6px 12px",textAlign:"right",color:"var(--muted)",fontSize:"0.82rem"}}>{c.potableM3>0?`${c.potableM3.toFixed(1)} m³`:"—"}</td>
                          </tr>
                        ))}
                      </React.Fragment>))}
                      <tr style={{borderTop:"2px solid var(--border)",background:"rgba(0,168,184,0.06)"}}>
                        <td style={{padding:"10px 12px",fontWeight:700}}>Total período</td>
                        <td style={{padding:"10px 12px",textAlign:"center",fontWeight:700,color:"#c0392b"}}>{summary.blackServices}</td>
                        <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700}}>{summary.blackRemoved>0?`${summary.blackRemoved.toFixed(1)} m³`:"—"}</td>
                        <td style={{padding:"10px 12px",textAlign:"center",fontWeight:700,color:"var(--teal)"}}>{summary.potableServices}</td>
                        <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700}}>{summary.potable>0?`${summary.potable.toFixed(1)} m³`:"—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="dashboard-bottom-grid">
            <section className="dashboard-panel dashboard-panel-wide">
              <div className="dashboard-panel-header"><h2>Comparativo campamentos</h2></div>
              <div className="summary-list">
                {campTrendRows.map((row) => (
                  <div key={row.id} className="summary-row" style={{alignItems:"stretch",gap:16}}>
                    <div style={{minWidth:180}}><strong>{row.name}</strong><div style={{color:"var(--muted)"}}>{row.reportTotal} informe(s) · {row.peopleAvg} personas prom.</div></div>
                    <div style={{flex:1,display:"grid",gap:8}}>
                      <div className="progress-cell"><span style={{minWidth:58}}>Agua</span><div className="progress-track"><div className="progress-fill" style={{width:`${(row.waterTotal/maxCW)*100}%`}} /></div><strong>{row.waterTotal.toLocaleString("es-CL")} L</strong></div>
                      <div className="progress-cell"><span style={{minWidth:58}}>Comb.</span><div className="progress-track"><div className="progress-fill" style={{width:`${(row.fuelTotal/maxCF)*100}%`,background:"linear-gradient(90deg,#ff7b2f,#ff9f1c)"}} /></div><strong>{row.fuelTotal.toLocaleString("es-CL")} L</strong></div>
                      <div className="progress-cell"><span style={{minWidth:58}}>Comidas</span><div className="progress-track"><div className="progress-fill" style={{width:`${(row.mealsTotal/maxCM)*100}%`,background:"linear-gradient(90deg,#006878,#00a6b6)"}} /></div><strong>{row.mealsTotal.toLocaleString("es-CL")}</strong></div>
                    </div>
                    <div style={{minWidth:120,textAlign:"right"}}><div className={`status-pill ${row.taskCompletionPercent>=80?"ok":row.taskCompletionPercent>=60?"warn":"danger"}`}>{row.taskCompletionPercent}%</div><div style={{color:"var(--muted)",marginTop:8,fontSize:"0.8rem"}}>internet {row.internetIssues}</div></div>
                  </div>
                ))}
                {campTrendRows.length === 0 && <div className="section-caption">Sin campamentos para comparar.</div>}
              </div>
            </section>
          </div>
        </div>
      </AppShell>
    );
  }

  // ── VISTA HOY ────────────────────────────────────────────────────────────────
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
          id: scopeCamps[0].id,
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
  const weatherCampHasSource = Boolean(
    weatherCamp && ((weatherCamp.latitude != null && weatherCamp.longitude != null) || weatherCamp.location?.trim())
  );

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
        ? (() => {
            const selectedCamp = scopeCamps.find((camp) => camp.id === shiftCampId);
            if (
              selectedCamp?.currentShiftSupervisorId &&
              selectedCamp.currentShiftStartDate &&
              selectedCamp.currentShiftWorkDays &&
              selectedCamp.currentShiftOffDays
            ) {
              return {
                name: selectedCamp.currentShiftSupervisorName ?? "Turno actual",
                shiftPattern: selectedCamp.currentShiftPattern ?? "14x14",
                shiftWorkDays: selectedCamp.currentShiftWorkDays,
                shiftOffDays: selectedCamp.currentShiftOffDays,
                shiftStartDate: selectedCamp.currentShiftStartDate
              };
            }

            return campShiftUsers.find((candidate) => candidate.campId === shiftCampId) ?? null;
          })()
        : null;

  let chartDays = defaultChartDays;

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
    }
  }

  const horizontalChartDays = defaultChartDays;
  const horizontalChartLabel = horizontalChartDays.length > 0 ? `Últimos ${horizontalChartDays.length} días` : "Sin datos";
  const maxPeople = Math.max(1, ...horizontalChartDays.map((day) => day.people));
  const maxFoodServices = Math.max(1, ...horizontalChartDays.map((day) => day.foodServices));
  const totalFoodServices = horizontalChartDays.reduce((sum, day) => sum + day.foodServices, 0);
  const visibleWaterTotal = chartDays.reduce((sum, day) => sum + day.water, 0);
  const chartDayInsights = horizontalChartDays.map((day) => ({
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
  const latestReportByCamp = new Map(reportsTodayScoped.map((report) => [report.campId, report]));
  const avgVisibleWaterPerDay = chartDays.length > 0 ? visibleWaterTotal / chartDays.length : 0;
  const visibleFuelTotal = chartDays.reduce((sum, day) => sum + day.fuel, 0);
  const avgVisibleFuelPerDay = chartDays.length > 0 ? visibleFuelTotal / chartDays.length : 0;
  const waterRemainingLiters = scopeCamps.reduce((sum, camp) => {
    const latestReport = latestReportByCamp.get(camp.id);
    const capacityLiters = (camp.potableWaterTankCapacityM3 ?? 0) * 1000;
    if (!latestReport || capacityLiters <= 0) return sum;
    return sum + Math.round((latestReport.potableWaterTankLevelPercent / 100) * capacityLiters);
  }, 0);
  const blackRemainingLiters = scopeCamps.reduce((sum, camp) => {
    const latestReport = latestReportByCamp.get(camp.id);
    const capacityLiters = (camp.blackWaterTankCapacityM3 ?? 0) * 1000;
    if (!latestReport || capacityLiters <= 0) return sum;
    return sum + Math.round(((100 - latestReport.blackWaterTankLevelPercent) / 100) * capacityLiters);
  }, 0);
  const fuelRemainingLiters = reportsTodayScoped.reduce((sum, report) => sum + report.fuelRemainingLiters, 0);
  const waterAutonomyDays = avgVisibleWaterPerDay > 0 ? waterRemainingLiters / avgVisibleWaterPerDay : null;
  const fuelAutonomyDays = avgVisibleFuelPerDay > 0 ? fuelRemainingLiters / avgVisibleFuelPerDay : null;
  const internetCriticalCount = reportsTodayScoped.filter((report) => report.internetStatus !== "FUNCIONANDO").length;
  const sanitaryCriticalCount = reportsTodayScoped.filter((report) => report.chlorineLevel < 0.2 || report.chlorineLevel > 1.5 || report.phLevel < 6.5 || report.phLevel > 8.5).length;
  const criticalStatusCount = internetCriticalCount + sanitaryCriticalCount;

  const waterProjectionCandidates = scopeCamps
    .map((camp) => {
      const campReports = reportsScoped
        .filter((report) => report.campId === camp.id)
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      const latestReport = latestReportByCamp.get(camp.id);
      const capacityLiters = (camp.potableWaterTankCapacityM3 ?? 0) * 1000;
      if (!latestReport || capacityLiters <= 0 || campReports.length === 0) return null;

      const waterTotal = campReports.reduce((sum, report) => sum + (waterByReportId.get(report.id) ?? report.waterLiters), 0);
      const avgWaterPerDay = waterTotal / campReports.length;
      const remainingLiters = Math.round((latestReport.potableWaterTankLevelPercent / 100) * capacityLiters);
      if (avgWaterPerDay <= 0 || remainingLiters <= 0) return null;

      const daysRemaining = remainingLiters / avgWaterPerDay;
      return {
        campName: camp.name,
        daysRemaining,
        dateLabel: estimateUtcDate(dashboardDate, daysRemaining),
        meta: `${remainingLiters.toLocaleString("es-CL")} L · ${avgWaterPerDay.toFixed(0)} L/día`
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  const blackProjectionCandidates = scopeCamps
    .map((camp) => {
      const campReports = reportsScoped
        .filter((report) => report.campId === camp.id)
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      const latestReport = latestReportByCamp.get(camp.id);
      const capacityLiters = (camp.blackWaterTankCapacityM3 ?? 0) * 1000;
      if (!latestReport || capacityLiters <= 0 || campReports.length < 2) return null;

      const generationSamples: number[] = [];
      for (let index = 1; index < campReports.length; index += 1) {
        const previous = campReports[index - 1];
        const current = campReports[index];
        const previousOccupied = (previous.blackWaterTankLevelPercent / 100) * capacityLiters;
        const currentOccupied = (current.blackWaterTankLevelPercent / 100) * capacityLiters;
        const generatedLiters = Math.max(0, currentOccupied - previousOccupied + current.blackWaterRemovedM3 * 1000);
        if (generatedLiters > 0) generationSamples.push(generatedLiters);
      }

      const avgGeneratedPerDay =
        generationSamples.length > 0 ? generationSamples.reduce((sum, value) => sum + value, 0) / generationSamples.length : 0;
      const freeLiters = Math.round(((100 - latestReport.blackWaterTankLevelPercent) / 100) * capacityLiters);
      if (avgGeneratedPerDay <= 0 || freeLiters <= 0) return null;

      const daysRemaining = freeLiters / avgGeneratedPerDay;
      return {
        campName: camp.name,
        daysRemaining,
        dateLabel: estimateUtcDate(dashboardDate, daysRemaining),
        meta: `${freeLiters.toLocaleString("es-CL")} L libres · ${avgGeneratedPerDay.toFixed(0)} L/día`
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  const wasteProjectionCandidates = scopeCamps
    .map((camp) => {
      const campReports = reportsScoped
        .filter((report) => report.campId === camp.id)
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      const latestReport = latestReportByCamp.get(camp.id);
      if (!latestReport || campReports.length < 2) return null;

      const fillSamples: number[] = [];
      for (let index = 1; index < campReports.length; index += 1) {
        const previous = campReports[index - 1];
        const current = campReports[index];
        const delta = current.wasteFillPercent - previous.wasteFillPercent;
        if (delta > 0) {
          fillSamples.push(delta);
        } else if (delta < 0 && current.wasteFillPercent > 0) {
          fillSamples.push(current.wasteFillPercent);
        }
      }

      const avgFillPerDay = fillSamples.length > 0 ? fillSamples.reduce((sum, value) => sum + value, 0) / fillSamples.length : 0;
      const remainingPercent = Math.max(0, 100 - latestReport.wasteFillPercent);
      if (avgFillPerDay <= 0 || remainingPercent <= 0) return null;

      const daysRemaining = remainingPercent / avgFillPerDay;
      return {
        campName: camp.name,
        daysRemaining,
        dateLabel: estimateUtcDate(dashboardDate, daysRemaining),
        meta: `${remainingPercent.toFixed(0)}% libre · ${avgFillPerDay.toFixed(1)}%/día`
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  const nextWaterProjection = waterProjectionCandidates[0] ?? null;
  const nextBlackProjection = blackProjectionCandidates[0] ?? null;
  const nextWasteProjection = wasteProjectionCandidates[0] ?? null;

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
    ...generatorRows
      .filter((row) => row.diff > 30)
      .map((row) => ({ text: `${row.name}: diferencia horómetros ${row.diff.toFixed(1)}h`, severity: "warning" as const }))
  ];

  return (
    <AppShell
      title="Operaciones"
      user={user}
      activeNav="operaciones"
      showAdminSections={canSeeAdminSections}
      notifications={notificationItems}
      rightSlot={
        canSeeAdminSections ? (
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
        ) : undefined
      }
    >

        {/* Pestañas */}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <span style={{ ...TAB_STYLES.base, ...TAB_STYLES.active }}>Estado hoy</span>
          <Link href="/operaciones?vista=historico" style={{ ...TAB_STYLES.base, ...TAB_STYLES.inactive }}>Histórico</Link>
        </div>

        <div className="dashboard-kpi-grid">
          <div
            className={`dashboard-kpi ${waterAutonomyDays != null && waterAutonomyDays < 2 ? "accent" : "teal"}`}
            title={`Agua restante en estanque: ${waterRemainingLiters} L · Promedio visible ${avgVisibleWaterPerDay.toFixed(0)} L/día`}
          >
            <div className="dashboard-kpi-label">Agua en estanque</div>
            <div className="dashboard-kpi-value">{waterRemainingLiters.toLocaleString("es-CL")} L</div>
            <div className="dashboard-kpi-meta">
              {waterAutonomyDays != null ? `${waterAutonomyDays.toFixed(1)} días aprox.` : "Falta capacidad o nivel"}
            </div>
          </div>
          <div
            className={`dashboard-kpi ${blackRemainingLiters < 5000 && blackRemainingLiters > 0 ? "accent" : ""}`}
            title={`Capacidad libre en estanques de aguas negras: ${blackRemainingLiters} L`}
          >
            <div className="dashboard-kpi-label">Aguas negras libres</div>
            <div className="dashboard-kpi-value">{blackRemainingLiters.toLocaleString("es-CL")} L</div>
            <div className="dashboard-kpi-meta">espacio disponible</div>
          </div>
          <div
            className={`dashboard-kpi ${fuelAutonomyDays != null && fuelAutonomyDays < 2 ? "accent" : ""}`}
            title={`Combustible restante estimado: ${fuelRemainingLiters} L · Promedio visible ${avgVisibleFuelPerDay.toFixed(0)} L/día`}
          >
            <div className="dashboard-kpi-label">Combustible restante</div>
            <div className="dashboard-kpi-value">{fuelRemainingLiters.toLocaleString("es-CL")} L</div>
            <div className="dashboard-kpi-meta">
              {fuelAutonomyDays != null ? `${fuelAutonomyDays.toFixed(1)} días aprox.` : "Falta consumo visible"}
            </div>
          </div>
          <div className={`dashboard-kpi ${reportSubmitted ? "teal" : "accent"}`} title={`${reportsTodayScoped.length} informes cargados ayer · ${missingCampsToday.length} pendientes`}>
            <div className="dashboard-kpi-label">Informe diario</div>
            <div className="dashboard-kpi-value">{reportSubmitted ? "OK" : "Falta"}</div>
            <div className="dashboard-kpi-meta">{missingCampsToday.length} pendientes</div>
          </div>
          <div className={`dashboard-kpi ${tasksSubmitted ? "teal" : "accent"}`} title={`${taskControlsTodayScoped.length} controles cargados ayer · ${missingTaskControlsToday.length} pendientes`}>
            <div className="dashboard-kpi-label">Control tareas</div>
            <div className="dashboard-kpi-value">{tasksSubmitted ? "OK" : "Falta"}</div>
            <div className="dashboard-kpi-meta">{missingTaskControlsToday.length} pendientes</div>
          </div>
          <div className={`dashboard-kpi ${criticalStatusCount > 0 ? "accent" : ""}`} title={`${internetCriticalCount} problema(s) internet · ${sanitaryCriticalCount} alerta(s) cloro/pH`}>
            <div className="dashboard-kpi-label">Estado crítico</div>
            <div className="dashboard-kpi-value">{criticalStatusCount}</div>
            <div className="dashboard-kpi-meta">
              {criticalStatusCount > 0 ? `${internetCriticalCount} internet · ${sanitaryCriticalCount} sanitario` : "Sin alertas críticas"}
            </div>
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
              <div className="dashboard-mini-stack dashboard-summary-metrics">
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
                  title={`Consumo acumulado de agua calculado desde medidores en el período visible: ${visibleWaterTotal} L`}
                >
                  <span>Agua acum.</span>
                  <strong>{visibleWaterTotal} L</strong>
                </div>
                <div className="dashboard-mini-metric" title={tasksSubmitted ? "Control de tareas cargado" : "Control de tareas pendiente"}>
                  <span>Control tareas</span>
                  <strong className={tasksSubmitted ? "up" : "warn"}>{tasksSubmitted ? "✓" : "!"}</strong>
                </div>
                <div className="dashboard-mini-metric" title={`Uso promedio del estanque de aguas negras: ${blackTankAvgToday.toFixed(0)}%`}>
                  <span>Aguas negras</span>
                  <strong>{blackTankAvgToday.toFixed(0)}%</strong>
                </div>
                <div className="dashboard-mini-metric" title={`Promedio llenado basura: ${wasteAvg.toFixed(0)}%`}>
                  <span>Basura</span>
                  <strong>{wasteAvg.toFixed(0)}%</strong>
                </div>
              </div>
            </div>
          </section>

          <Link
            className="dashboard-panel-link"
            href={weatherCamp ? `/clima?campId=${weatherCamp.id}` : "/clima"}
            style={{ color: "inherit", textDecoration: "none" }}
          >
            <section className="dashboard-panel">
              <div className="dashboard-panel-header">
                <h2>Clima</h2>
              </div>
              <div className="section-caption" style={{ marginBottom: 12 }}>
                {weatherCamp ? weatherCamp.name : "Selecciona un campamento"}
              </div>
              <div className="dashboard-climate-grid">
                <div className="dashboard-climate-metric">
                  <span>Temp. máxima ayer</span>
                  <strong className="up">
                    {weatherSummary?.temperatureMax != null
                      ? `${weatherSummary.temperatureMax.toFixed(1)}°C`
                      : weatherCampHasSource
                        ? "Sin dato"
                        : weatherCamp
                          ? "Agrega ubicación o coordenadas"
                          : "Selecciona campamento"}
                  </strong>
                </div>
                <div className="dashboard-climate-metric">
                  <span>Temp. mínima ayer</span>
                  <strong className="down">
                    {weatherSummary?.temperatureMin != null
                      ? `${weatherSummary.temperatureMin.toFixed(1)}°C`
                      : weatherCampHasSource
                        ? "Sin dato"
                        : weatherCamp
                          ? "Agrega ubicación o coordenadas"
                          : "Selecciona campamento"}
                  </strong>
                </div>
              </div>
              {weatherCamp && !weatherCampHasSource ? (
                <div className="section-caption" style={{ marginTop: 12 }}>
                  Agrega ubicación o coordenadas del campamento para obtener la temperatura automáticamente.
                </div>
              ) : null}
            </section>
          </Link>
        </div>

        <div className="dashboard-bottom-grid">
          <section className="dashboard-panel dashboard-panel-wide">
            <div className="dashboard-panel-header">
              <h2>Próximas gestiones</h2>
              <span className="dashboard-chip small">Proyección operativa</span>
            </div>
            <div className="dashboard-kpi-grid insight-kpi-grid">
              <div
                className={`dashboard-kpi ${nextWaterProjection && nextWaterProjection.daysRemaining <= 2 ? "accent" : "teal"}`}
                title={
                  nextWaterProjection
                    ? `${nextWaterProjection.campName} · ${nextWaterProjection.meta}`
                    : "Falta capacidad del estanque o historial suficiente"
                }
              >
                <div className="dashboard-kpi-label">Próx. agua potable</div>
                <div className="dashboard-kpi-value">{nextWaterProjection ? nextWaterProjection.dateLabel : "Sin dato"}</div>
                <div className="dashboard-kpi-meta">
                  {nextWaterProjection ? `${nextWaterProjection.campName} · ${nextWaterProjection.daysRemaining.toFixed(1)} días` : "Completa capacidad y nivel"}
                </div>
              </div>
              <div
                className={`dashboard-kpi ${nextBlackProjection && nextBlackProjection.daysRemaining <= 2 ? "accent" : ""}`}
                title={
                  nextBlackProjection
                    ? `${nextBlackProjection.campName} · ${nextBlackProjection.meta}`
                    : "Falta capacidad del estanque o historial suficiente"
                }
              >
                <div className="dashboard-kpi-label">Próx. retiro negras</div>
                <div className="dashboard-kpi-value">{nextBlackProjection ? nextBlackProjection.dateLabel : "Sin dato"}</div>
                <div className="dashboard-kpi-meta">
                  {nextBlackProjection ? `${nextBlackProjection.campName} · ${nextBlackProjection.daysRemaining.toFixed(1)} días` : "Completa capacidad e historial"}
                </div>
              </div>
              <div
                className={`dashboard-kpi ${nextWasteProjection && nextWasteProjection.daysRemaining <= 2 ? "accent" : ""}`}
                title={
                  nextWasteProjection
                    ? `${nextWasteProjection.campName} · ${nextWasteProjection.meta}`
                    : "Falta historial suficiente de llenado"
                }
              >
                <div className="dashboard-kpi-label">Próx. cambio basura</div>
                <div className="dashboard-kpi-value">{nextWasteProjection ? nextWasteProjection.dateLabel : "Sin dato"}</div>
                <div className="dashboard-kpi-meta">
                  {nextWasteProjection ? `${nextWasteProjection.campName} · ${nextWasteProjection.daysRemaining.toFixed(1)} días` : "Necesita más datos diarios"}
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="dashboard-chart-grid dashboard-horizontal-charts">
          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <h2>Personas por turno</h2>
              <span className="dashboard-chip small">{horizontalChartLabel}</span>
            </div>
            <div className="chart-scroll-wrap">
              <div className="chart-grid compact horizontal-days">
                {horizontalChartDays.map((day) => (
                  <div
                    key={`p-${day.date}`}
                    className="chart-col chart-tooltip-target"
                    data-tooltip={`${formatDisplayDate(new Date(`${day.date}T00:00:00Z`))}: ${day.people} personas`}
                  >
                    <div className="chart-track tall">
                      <div className="chart-bar people" style={{ height: `${(day.people / maxPeople) * 100}%` }} />
                    </div>
                    <div className="chart-label">{formatShortDisplayDateValue(day.date)}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <h2>Servicios entregados</h2>
              <span className="dashboard-chip small">{totalFoodServices} total</span>
            </div>
            <div className="chart-scroll-wrap">
              <div className="chart-grid compact horizontal-days">
                {horizontalChartDays.map((day) => (
                  <div
                    key={`c-${day.date}`}
                    className="chart-col chart-tooltip-target"
                    data-tooltip={`${formatDisplayDate(new Date(`${day.date}T00:00:00Z`))}: ${day.foodServices} servicios entregados`}
                  >
                    <div className="chart-track tall">
                      <div className="chart-bar meals" style={{ height: `${(day.foodServices / maxFoodServices) * 100}%` }} />
                    </div>
                    <div className="chart-label">{formatShortDisplayDateValue(day.date)}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <h2>Agua por huésped</h2>
              <span className="dashboard-chip small">{waterPerPersonToday.toFixed(1)} L/p</span>
            </div>
            <div className="chart-scroll-wrap">
              <div className="chart-grid compact horizontal-days">
                {chartDayInsights.map((day) => (
                  <div key={`wp-${day.date}`} className="chart-col chart-tooltip-target" data-tooltip={`${formatDisplayDate(new Date(`${day.date}T00:00:00Z`))}: ${day.waterPerPerson.toFixed(1)} L por persona`}>
                    <div className="chart-track tall">
                      <div className="chart-bar water" style={{ height: `${(day.waterPerPerson / maxWaterPerPerson) * 100}%` }} />
                    </div>
                    <div className="chart-label">{formatShortDisplayDateValue(day.date)}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <h2>Combustible por huésped</h2>
              <span className="dashboard-chip small">{fuelPerPersonToday.toFixed(1)} L/p</span>
            </div>
            <div className="chart-scroll-wrap">
              <div className="chart-grid compact horizontal-days">
                {chartDayInsights.map((day) => (
                  <div key={`fp-${day.date}`} className="chart-col chart-tooltip-target" data-tooltip={`${formatDisplayDate(new Date(`${day.date}T00:00:00Z`))}: ${day.fuelPerPerson.toFixed(1)} L por persona`}>
                    <div className="chart-track tall">
                      <div className="chart-bar fuel" style={{ height: `${(day.fuelPerPerson / maxFuelPerPerson) * 100}%` }} />
                    </div>
                    <div className="chart-label">{formatShortDisplayDateValue(day.date)}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="dashboard-bottom-grid">
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
                    <th>Lectura agua</th>
                    <th>G1</th>
                    <th>G2</th>
                    <th>Operador</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {recentReportsScoped.map((report) => (
                    <tr key={report.id}>
                      <td>{formatDisplayDate(report.date)}</td>
                      <td>{report.camp.name}</td>
                      <td>{report.peopleCount}</td>
                      <td>{report.breakfastCount + report.lunchCount + report.dinnerCount}</td>
                      <td>{report.meterReading.toLocaleString("es-CL")}</td>
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
                      <td colSpan={9} style={{ color: "var(--muted)" }}>
                        Sin registros.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
    </AppShell>
  );
}

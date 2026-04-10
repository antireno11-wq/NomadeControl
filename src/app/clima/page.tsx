import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { formatDisplayDateValue, formatShortDisplayDateValue, toInputDateValue } from "@/lib/report-utils";
import { getCampWeatherHistory } from "@/lib/weather";

type SearchParams = {
  campId?: string | string[];
};

export default async function ClimaPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const selectedCampIdRaw = searchParams?.campId;
  const selectedCampId = typeof selectedCampIdRaw === "string" && selectedCampIdRaw !== "general" ? selectedCampIdRaw : undefined;
  const scopedSelectedCampId = canSeeAdminSections ? selectedCampId : user.campId ?? selectedCampId;
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;

  const camps = await db.camp.findMany({
    where: { isActive: true, ...(campFilter ? { id: campFilter } : {}) },
    orderBy: { name: "asc" }
  });

  const activeCamp = scopedSelectedCampId
    ? camps.find((camp) => camp.id === scopedSelectedCampId) ?? null
    : camps.length === 1
      ? camps[0]
      : null;

  const endDate = new Date();
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 6);

  const history = activeCamp
    ? await getCampWeatherHistory({
        latitude: activeCamp.latitude,
        longitude: activeCamp.longitude,
        location: activeCamp.location,
        startDate: toInputDateValue(startDate),
        endDate: toInputDateValue(endDate)
      })
    : [];

  const maxTemp = Math.max(1, ...history.map((point) => point.temperatureMax ?? 0));
  const minTempAbs = Math.max(1, ...history.map((point) => Math.abs(point.temperatureMin ?? 0)));

  return (
    <AppShell
      title="Clima"
      user={user}
      activeNav={null}
      showAdminSections={canSeeAdminSections}
      rightSlot={
        <div style={{ display: "flex", gap: 10 }}>
          {canSeeAdminSections ? (
            <form method="get" className="dashboard-filter">
              <select name="campId" defaultValue={activeCamp?.id ?? "general"}>
                <option value="general">Selecciona campamento</option>
                {camps.map((camp) => (
                  <option key={camp.id} value={camp.id}>
                    {camp.name}
                  </option>
                ))}
              </select>
              <button type="submit">Ver</button>
            </form>
          ) : null}
          <Link href={activeCamp ? `/dashboard?campId=${activeCamp.id}` : "/dashboard"}>
            <button type="button" className="secondary">Volver</button>
          </Link>
        </div>
      }
    >
      <div className="page-stack">
        <div className="hero-panel">
          <div className="hero-kicker">Histórico</div>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Comportamiento del clima última semana</h2>
          <div className="section-caption">
            {activeCamp
              ? `${activeCamp.name} · del ${formatDisplayDateValue(toInputDateValue(startDate))} al ${formatDisplayDateValue(toInputDateValue(endDate))}`
              : "Selecciona un campamento para ver la evolución de temperatura."}
          </div>
        </div>

        {activeCamp ? (
          <>
            <div className="dashboard-kpi-grid insight-kpi-grid">
              <div className="dashboard-kpi teal">
                <div className="dashboard-kpi-label">Máxima semanal</div>
                <div className="dashboard-kpi-value">{history.length > 0 ? `${Math.max(...history.map((point) => point.temperatureMax ?? -999)).toFixed(1)}°C` : "Sin dato"}</div>
                <div className="dashboard-kpi-meta">temperatura más alta registrada</div>
              </div>
              <div className="dashboard-kpi">
                <div className="dashboard-kpi-label">Mínima semanal</div>
                <div className="dashboard-kpi-value">{history.length > 0 ? `${Math.min(...history.map((point) => point.temperatureMin ?? 999)).toFixed(1)}°C` : "Sin dato"}</div>
                <div className="dashboard-kpi-meta">temperatura más baja registrada</div>
              </div>
            </div>

            <div className="dashboard-chart-grid">
              <section className="dashboard-panel">
                <div className="dashboard-panel-header">
                  <h2>Temperatura máxima</h2>
                  <span className="dashboard-chip small">Últimos 7 días</span>
                </div>
                <div className="chart-grid compact">
                  {history.map((point) => (
                    <div
                      key={`max-${point.date}`}
                      className="chart-col chart-tooltip-target"
                      data-tooltip={`${formatDisplayDateValue(point.date)}: ${point.temperatureMax != null ? `${point.temperatureMax.toFixed(1)}°C` : "Sin dato"}`}
                    >
                      <div className="chart-track tall">
                        <div className="chart-bar meals" style={{ height: `${((point.temperatureMax ?? 0) / maxTemp) * 100}%`, background: "linear-gradient(180deg, #ff7b2f, #ffb067)" }} />
                      </div>
                      <div className="chart-label">{formatShortDisplayDateValue(point.date)}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="dashboard-panel">
                <div className="dashboard-panel-header">
                  <h2>Temperatura mínima</h2>
                  <span className="dashboard-chip small">Últimos 7 días</span>
                </div>
                <div className="chart-grid compact">
                  {history.map((point) => (
                    <div
                      key={`min-${point.date}`}
                      className="chart-col chart-tooltip-target"
                      data-tooltip={`${formatDisplayDateValue(point.date)}: ${point.temperatureMin != null ? `${point.temperatureMin.toFixed(1)}°C` : "Sin dato"}`}
                    >
                      <div className="chart-track tall">
                        <div className="chart-bar water" style={{ height: `${(Math.abs(point.temperatureMin ?? 0) / minTempAbs) * 100}%`, background: "linear-gradient(180deg, #006878, #55d2dd)" }} />
                      </div>
                      <div className="chart-label">{formatShortDisplayDateValue(point.date)}</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="card">
            <div className="section-caption">Selecciona un campamento para ver el gráfico climático de la última semana.</div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

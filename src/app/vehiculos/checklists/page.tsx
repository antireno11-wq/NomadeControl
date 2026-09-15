import Link from "next/link";
import { db } from "@/lib/db";
import { VEHICLE_ROLES, isAdminRole, requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { formatDisplayDate } from "@/lib/report-utils";
import { RESULTADO_LABEL, type ResultadoChecklist } from "@/lib/checklist-vehiculos";

/**
 * Dónde quedan los checklists: qué vehículos lo hicieron hoy, cuáles no, y
 * con qué resultado. Hasta ahora solo se veían de a uno, dentro de cada
 * ficha; para saber si la flota salió inspeccionada había que abrir cada
 * vehículo.
 */
export default async function ChecklistsPage({
  searchParams,
}: {
  searchParams?: { dia?: string };
}) {
  const user = await requireRole(VEHICLE_ROLES);

  // El "día" es en hora de Chile: un checklist de las 07:00 en faena es de
  // hoy aunque en UTC ya sea otra fecha.
  const hoyChile = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
  const diaParam = searchParams?.dia && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.dia) ? searchParams.dia : null;
  const dia = diaParam ? new Date(`${diaParam}T00:00:00`) : new Date(hoyChile.getFullYear(), hoyChile.getMonth(), hoyChile.getDate());
  const diaFin = new Date(dia.getTime() + 86_400_000);
  const esHoy = dia.toDateString() === new Date(hoyChile.getFullYear(), hoyChile.getMonth(), hoyChile.getDate()).toDateString();

  const [vehiculos, delDia, recientes] = await Promise.all([
    db.vehicle.findMany({
      where: { status: { not: "FUERA_DE_SERVICIO" } },
      orderBy: { plate: "asc" },
      select: {
        id: true, plate: true, type: true, model: true, company: true, status: true,
        checklists: {
          take: 1, orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          select: { id: true, date: true, resultado: true, resultadoMotivo: true, origen: true, conductorNombre: true, driver: { select: { name: true } } },
        },
      },
    }),
    db.vehicleChecklist.findMany({
      where: { date: { gte: dia, lt: diaFin } },
      select: { vehicleId: true },
    }),
    db.vehicleChecklist.findMany({
      take: 40,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: {
        id: true, date: true, createdAt: true, resultado: true, resultadoMotivo: true, origen: true,
        odometerKm: true, conductorNombre: true,
        driver: { select: { name: true } },
        vehicle: { select: { id: true, plate: true, type: true } },
        _count: { select: { fotos: true } },
      },
    }),
  ]);

  const hechosDelDia = new Set(delDia.map(c => c.vehicleId));
  const conChecklist = vehiculos.filter(v => hechosDelDia.has(v.id));
  const sinChecklist = vehiculos.filter(v => !hechosDelDia.has(v.id));
  const noAptos = vehiculos.filter(v => v.checklists[0]?.resultado === "no_apto");

  const quien = (c: { driver?: { name: string } | null; conductorNombre?: string | null; origen?: string }) =>
    c.driver?.name ?? c.conductorNombre ?? (c.origen === "google_forms" ? "Formulario" : "—");
  const colorDe = (r: string | null | undefined) => {
    const t = RESULTADO_LABEL[(r as ResultadoChecklist) ?? "apto"]?.tone;
    return t === "danger" ? "#dc2626" : t === "warn" ? "#9a6300" : "#16a34a";
  };
  const kpi = (label: string, valor: number, color?: string, sub?: string) => (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: "1.9rem", fontWeight: 800, lineHeight: 1.15, color: color ?? "var(--text)" }}>{valor}</div>
      {sub && <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{sub}</div>}
    </div>
  );
  const th: React.CSSProperties = { textAlign: "left", padding: "8px 12px", fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" };
  const td: React.CSSProperties = { padding: "8px 12px", fontSize: "0.86rem", borderTop: "1px solid var(--border)" };

  return (
    <AppShell
      title="Checklists de salida"
      user={user}
      activeNav="vehiculos"
      showAdminSections={isAdminRole(user.role)}
      rightSlot={<Link href="/vehiculos"><button type="button" className="secondary">← Vehículos</button></Link>}
    >
      <div className="page-stack">
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <strong>{esHoy ? "Hoy" : formatDisplayDate(dia)} · {vehiculos.length} vehículos en servicio</strong>
          <form method="GET" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" name="dia" defaultValue={dia.toISOString().slice(0, 10)} style={{ width: "auto" }} />
            <button type="submit" className="secondary" style={{ width: "auto" }}>Ver día</button>
          </form>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          {kpi("Con checklist", conChecklist.length, "#16a34a", esHoy ? "hoy" : "ese día")}
          {kpi("Sin checklist", sinChecklist.length, sinChecklist.length > 0 ? "#dc2626" : undefined, "no deberían salir")}
          {kpi("No aptos", noAptos.length, noAptos.length > 0 ? "#dc2626" : undefined, "según su último checklist")}
        </div>

        {/* ── Sin checklist: la lista que importa a las 7 de la mañana ──── */}
        {sinChecklist.length > 0 && (
          <div className="card" style={{ borderLeft: "4px solid #dc2626" }}>
            <h3 style={{ margin: "0 0 8px" }}>Sin checklist {esHoy ? "hoy" : "ese día"}</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {sinChecklist.map(v => (
                <Link key={v.id} href={`/vehiculos/${v.id}`} style={{ textDecoration: "none" }}>
                  <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 20, background: "#fce9e8", color: "#9e2f23", fontSize: "0.82rem", fontWeight: 700 }}>
                    {v.plate}
                    <span style={{ fontWeight: 400, opacity: 0.8 }}> · {v.type}{v.company === "Arrendado / externo" ? " · arrendado" : ""}</span>
                    {v.checklists[0] && (
                      <span style={{ fontWeight: 400, opacity: 0.8 }}> · último {formatDisplayDate(v.checklists[0].date)}</span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Estado por vehículo ───────────────────────────────────────── */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px 4px" }}><h3 style={{ margin: 0 }}>Estado por vehículo</h3></div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>Vehículo</th><th style={th}>{esHoy ? "Hoy" : "Ese día"}</th>
                <th style={th}>Último checklist</th><th style={th}>Resultado</th><th style={th}>Quién</th>
              </tr></thead>
              <tbody>
                {vehiculos.map(v => {
                  const u = v.checklists[0];
                  const hecho = hechosDelDia.has(v.id);
                  return (
                    <tr key={v.id}>
                      <td style={td}>
                        <Link href={`/vehiculos/${v.id}`} style={{ fontWeight: 700, color: "var(--teal)", textDecoration: "none" }}>{v.plate}</Link>
                        <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}> · {v.type} · {v.model}</span>
                        {v.company === "Arrendado / externo" && <span style={{ marginLeft: 6, fontSize: "0.7rem", color: "#9a6300", fontWeight: 700 }}>arrendado</span>}
                      </td>
                      <td style={td}>
                        <span style={{ fontWeight: 700, color: hecho ? "#16a34a" : "#dc2626" }}>{hecho ? "✓ Hecho" : "✗ Falta"}</span>
                      </td>
                      <td style={td}>{u ? formatDisplayDate(u.date) : <span style={{ color: "var(--muted)" }}>nunca</span>}</td>
                      <td style={td}>
                        {u ? (
                          <span style={{ fontWeight: 700, color: colorDe(u.resultado) }} title={u.resultadoMotivo ?? undefined}>
                            {RESULTADO_LABEL[(u.resultado as ResultadoChecklist) ?? "apto"].label}
                          </span>
                        ) : "—"}
                      </td>
                      <td style={td}>{u ? quien(u) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Últimos checklists ────────────────────────────────────────── */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px 4px" }}><h3 style={{ margin: 0 }}>Últimos {recientes.length} checklists</h3></div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>Fecha</th><th style={th}>Vehículo</th><th style={th}>Quién</th>
                <th style={th}>Km</th><th style={th}>Resultado</th><th style={th}>Origen</th>
              </tr></thead>
              <tbody>
                {recientes.map(c => (
                  <tr key={c.id}>
                    <td style={td}>{formatDisplayDate(c.date)}</td>
                    <td style={td}><Link href={`/vehiculos/${c.vehicle.id}`} style={{ color: "var(--teal)", fontWeight: 700, textDecoration: "none" }}>{c.vehicle.plate}</Link></td>
                    <td style={td}>{quien(c)}</td>
                    <td style={td}>{c.odometerKm.toLocaleString("es-CL")}</td>
                    <td style={td}>
                      <span style={{ fontWeight: 700, color: colorDe(c.resultado) }}>{RESULTADO_LABEL[(c.resultado as ResultadoChecklist) ?? "apto"].label}</span>
                      {c.resultadoMotivo && <div style={{ fontSize: "0.76rem", color: "var(--muted)" }}>{c.resultadoMotivo}</div>}
                    </td>
                    <td style={{ ...td, fontSize: "0.78rem", color: "var(--muted)" }}>
                      {c.origen === "google_forms" ? "Formulario" : "App"}{c._count.fotos > 0 ? ` · ${c._count.fotos} foto${c._count.fotos === 1 ? "" : "s"}` : ""}
                    </td>
                  </tr>
                ))}
                {recientes.length === 0 && <tr><td colSpan={6} style={{ ...td, color: "var(--muted)" }}>Todavía no hay checklists.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

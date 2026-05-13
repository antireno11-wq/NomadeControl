import Link from "next/link";
import { requireRole, TRABAJADORES_ROLES, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

type SearchParams = { q?: string; tipo?: string; estado?: string };

const TIPOS_CAPACITACION: Record<string, string> = {
  induccion:             "Inducción de seguridad",
  capacitacion:          "Certificado de capacitación",
  odi_firmada:           "ODI firmada",
  examen_preocupacional: "Examen preocupacional",
  examen_periodico:      "Examen periódico",
  altura_fisica:         "Certificado altura física",
  altura_trabajos:       "Trabajo en altura",
  espacios_confinados:   "Espacios confinados",
};

function calcDias(fecha: Date): number {
  const hoy = new Date();
  const base = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const tgt  = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  return Math.ceil((tgt - base) / 86400000);
}

type EstadoVenc = "vencido" | "critico" | "proximo" | "vigente" | "sin_fecha";

function estadoVenc(fechaVencimiento: Date | null): EstadoVenc {
  if (!fechaVencimiento) return "sin_fecha";
  const d = calcDias(fechaVencimiento);
  if (d < 0)   return "vencido";
  if (d <= 7)  return "critico";
  if (d <= 60) return "proximo";
  return "vigente";
}

const ESTADO_BADGE: Record<EstadoVenc, { bg: string; color: string; label: string; icon: string }> = {
  vencido:   { bg: "#fee2e2", color: "#991b1b", label: "Vencido",          icon: "⛔" },
  critico:   { bg: "#ffedd5", color: "#9a3412", label: "Vence en ≤7d",     icon: "🔴" },
  proximo:   { bg: "#fef9c3", color: "#854d0e", label: "Vence en ≤60d",    icon: "🟡" },
  vigente:   { bg: "#dcfce7", color: "#166534", label: "Vigente",          icon: "🟢" },
  sin_fecha: { bg: "#f1f5f9", color: "#64748b", label: "Sin vencimiento",  icon: "⚪" },
};

export default async function CapacitacionesPage({ searchParams }: { searchParams?: SearchParams }) {
  const user    = await requireRole(TRABAJADORES_ROLES);
  const isAdmin = isAdminRole(user.role);
  const campFilter = !isAdmin && user.campId ? { campId: user.campId } : {};

  const q      = searchParams?.q?.trim() ?? "";
  const tipo   = searchParams?.tipo ?? "";
  const estado = searchParams?.estado ?? "";

  const documentos = await db.documentoTrabajador.findMany({
    where: {
      tipo: tipo ? tipo : { in: Object.keys(TIPOS_CAPACITACION) },
      staffMember: { isActive: true, ...campFilter },
      ...(q ? {
        OR: [
          { nombre:      { contains: q, mode: "insensitive" } },
          { staffMember: { fullName: { contains: q, mode: "insensitive" } } },
        ],
      } : {}),
    },
    select: {
      id: true, tipo: true, nombre: true,
      fechaEmision: true, fechaVencimiento: true,
      staffMember: {
        select: { id: true, fullName: true, camp: { select: { name: true } } },
      },
    },
    orderBy: [{ fechaVencimiento: "asc" }, { staffMember: { fullName: "asc" } }],
  });

  // Filtrar por estado de vencimiento (depende de Date.now())
  const filtrados = estado
    ? documentos.filter(d => estadoVenc(d.fechaVencimiento) === estado)
    : documentos;

  // Stats sobre todos (sin filtro de estado)
  const counts = { vencido: 0, critico: 0, proximo: 0, vigente: 0, sin_fecha: 0 };
  for (const d of documentos) counts[estadoVenc(d.fechaVencimiento)]++;

  return (
    <AppShell title="Capacitaciones e Inducciones" user={user} activeNav="trabajadores">
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1100 }}>

        {/* Stats */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(["vencido", "critico", "proximo", "vigente", "sin_fecha"] as EstadoVenc[]).map(ev => {
            const b = ESTADO_BADGE[ev];
            return (
              <div key={ev} className="card" style={{ flex: "0 0 auto", padding: "10px 18px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "1.3rem" }}>{b.icon}</span>
                <span style={{ fontSize: "1.3rem", fontWeight: 900, color: b.color }}>{counts[ev]}</span>
                <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{b.label}</span>
              </div>
            );
          })}
        </div>

        {/* Filtros */}
        <form method="GET" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar trabajador o documento…"
            style={{ flex: "1 1 180px", minWidth: 160, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.88rem" }}
          />
          <select name="tipo" defaultValue={tipo} style={{ width: "auto", padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.88rem" }}>
            <option value="">Todos los tipos</option>
            {Object.entries(TIPOS_CAPACITACION).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select name="estado" defaultValue={estado} style={{ width: "auto", padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.88rem" }}>
            <option value="">Todos los estados</option>
            <option value="vencido">Vencido</option>
            <option value="critico">Vence en ≤7d</option>
            <option value="proximo">Vence en ≤60d</option>
            <option value="vigente">Vigente</option>
            <option value="sin_fecha">Sin vencimiento</option>
          </select>
          <button type="submit" style={{ width: "auto", padding: "7px 16px", borderRadius: 8 }}>Buscar</button>
          {(q || tipo || estado) && (
            <a href="/trabajadores/inducciones" style={{
              padding: "7px 12px", borderRadius: 8, background: "#f1f5f9",
              color: "var(--muted)", fontWeight: 600, fontSize: "0.85rem",
              textDecoration: "none", border: "1px solid var(--border)",
            }}>✕ Limpiar</a>
          )}
        </form>

        {/* Tabla */}
        {filtrados.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>🎓</div>
            <div style={{ fontWeight: 600 }}>
              {q || tipo || estado ? "Sin resultados con esos filtros" : "No hay registros de capacitaciones aún"}
            </div>
            <div style={{ fontSize: "0.85rem", marginTop: 8 }}>
              Subí los certificados desde el perfil de cada trabajador →{" "}
              <Link href="/trabajadores" style={{ color: "var(--teal)", fontWeight: 600 }}>Ver trabajadores</Link>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "2px solid var(--border)" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--muted)", fontSize: "0.78rem" }}>Trabajador</th>
                    {isAdmin && <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--muted)", fontSize: "0.78rem" }}>Camp.</th>}
                    <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--muted)", fontSize: "0.78rem" }}>Tipo</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--muted)", fontSize: "0.78rem" }}>Descripción</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--muted)", fontSize: "0.78rem" }}>Realización</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--muted)", fontSize: "0.78rem" }}>Vencimiento</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--muted)", fontSize: "0.78rem" }}>Estado</th>
                    <th style={{ padding: "10px 14px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map(doc => {
                    const ev    = estadoVenc(doc.fechaVencimiento);
                    const badge = ESTADO_BADGE[ev];
                    const dias  = doc.fechaVencimiento ? calcDias(doc.fechaVencimiento) : null;
                    return (
                      <tr key={doc.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>
                          <Link href={`/trabajadores/${doc.staffMember.id}`} style={{ color: "var(--teal)", textDecoration: "none" }}>
                            {doc.staffMember.fullName}
                          </Link>
                        </td>
                        {isAdmin && (
                          <td style={{ padding: "10px 14px", color: "var(--muted)", fontSize: "0.82rem" }}>
                            {doc.staffMember.camp?.name ?? "—"}
                          </td>
                        )}
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{
                            fontSize: "0.73rem", padding: "2px 8px", borderRadius: 999,
                            background: "var(--teal)18", color: "var(--teal)", fontWeight: 700, whiteSpace: "nowrap",
                          }}>
                            {TIPOS_CAPACITACION[doc.tipo] ?? doc.tipo}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", fontWeight: 500 }}>{doc.nombre}</td>
                        <td style={{ padding: "10px 14px", color: "var(--muted)", fontSize: "0.82rem" }}>
                          {doc.fechaEmision ? doc.fechaEmision.toLocaleDateString("es-CL") : "—"}
                        </td>
                        <td style={{ padding: "10px 14px", fontSize: "0.82rem" }}>
                          {doc.fechaVencimiento ? (
                            <div>
                              <div>{doc.fechaVencimiento.toLocaleDateString("es-CL")}</div>
                              {dias !== null && (
                                <div style={{ fontSize: "0.72rem", color: badge.color, fontWeight: 600, marginTop: 1 }}>
                                  {dias < 0 ? `Hace ${Math.abs(dias)}d` : dias === 0 ? "Hoy" : `En ${dias}d`}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>Sin fecha</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{
                            fontSize: "0.73rem", padding: "2px 9px", borderRadius: 999,
                            background: badge.bg, color: badge.color, fontWeight: 700,
                          }}>
                            {badge.label}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <Link
                            href={`/trabajadores/${doc.staffMember.id}/documentos`}
                            style={{ fontSize: "0.78rem", color: "var(--accent)", fontWeight: 700, textDecoration: "none" }}
                          >
                            Ver →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "10px 14px", fontSize: "0.78rem", color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
              {filtrados.length} registro{filtrados.length !== 1 ? "s" : ""}
              {(q || tipo || estado) && ` · Filtrando de ${documentos.length} total`}
            </div>
          </div>
        )}

        <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: 0 }}>
          💡 Para registrar una capacitación, andá al perfil del trabajador → Documentos → cargá el certificado con el tipo correspondiente.
        </p>
      </div>
    </AppShell>
  );
}

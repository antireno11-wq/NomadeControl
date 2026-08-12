import Link from "next/link";
import { db } from "@/lib/db";
import { TRABAJADORES_ROLES, isAdminRole, requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { formatDisplayDate } from "@/lib/report-utils";
import { etiquetaTipoReunion } from "@/lib/ddd";

export default async function ReunionesPage() {
  const user = await requireRole(TRABAJADORES_ROLES);
  const reuniones = await db.reunion.findMany({
    where: { NOT: { referencia: "Alta manual" } },
    orderBy: [{ fecha: "desc" }],
    take: 60,
    select: {
      id: true, tipo: true, fecha: true, semanaIso: true, referencia: true,
      estado: true, resumen: true, publicadaPorNombre: true,
      _count: { select: { compromisosOrigen: true, amenazasOrigen: true } },
    },
  });

  return (
    <AppShell
      title="Reuniones"
      user={user}
      activeNav="reuniones"
      showAdminSections={isAdminRole(user.role)}
      rightSlot={<Link href="/reuniones/nueva"><button type="button">+ Nueva reunión</button></Link>}
    >
      <div className="page-stack">
        {reuniones.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: 40 }}>
            <p style={{ color: "var(--muted)", margin: "0 0 16px" }}>
              Todavía no hay reuniones cargadas. Pega la transcripción de un daily y el sistema
              propone los compromisos.
            </p>
            <Link href="/reuniones/nueva"><button type="button">Cargar la primera</button></Link>
          </div>
        ) : reuniones.map(r => (
          <Link key={r.id} href={r.estado === "publicada" ? `/reuniones/${r.id}/minuta` : `/reuniones/${r.id}`}
                style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card" style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong>{etiquetaTipoReunion(r.tipo)}</strong>
                <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                  {formatDisplayDate(r.fecha)} · semana {r.semanaIso}
                </span>
                <span style={{
                  background: r.estado === "publicada" ? "#e8f7ef" : "#fff4dc",
                  color: r.estado === "publicada" ? "#146c3d" : "#9a6300",
                  borderRadius: 6, padding: "2px 9px", fontSize: "0.72rem", fontWeight: 700,
                }}>
                  {r.estado === "publicada" ? "Publicada" : "Borrador"}
                </span>
                <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "0.8rem" }}>
                  {r._count.compromisosOrigen} compromisos · {r._count.amenazasOrigen} amenazas
                </span>
              </div>
              {r.resumen && (
                <div style={{ color: "var(--muted)", fontSize: "0.84rem", marginTop: 6 }}>
                  {r.resumen.slice(0, 200)}{r.resumen.length > 200 ? "…" : ""}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

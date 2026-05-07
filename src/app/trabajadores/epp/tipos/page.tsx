import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { crearTipoEPPAction, toggleTipoEPPAction } from "./actions";
import Link from "next/link";

export default async function TiposEPPPage({ searchParams }: { searchParams?: { status?: string } }) {
  const user = await requireRole(ADMIN_ROLES);

  const tipos = await db.tipoEPP.findMany({ orderBy: { nombre: "asc" }, include: { _count: { select: { entregas: true } } } });

  const msg = searchParams?.status === "created" ? "Tipo de EPP creado." :
              searchParams?.status === "updated" ? "Tipo actualizado." : null;

  return (
    <AppShell title="Tipos de EPP" user={user} activeNav="trabajadores">
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: 900 }}>
        {msg && <div className="alert success">{msg}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Link href="/trabajadores/epp" style={{ fontSize: "0.875rem", color: "var(--muted)" }}>← Volver a EPP</Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", alignItems: "start" }}>

          {/* Formulario nuevo tipo */}
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Agregar tipo de EPP</h3>
            <form action={crearTipoEPPAction} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div>
                <label className="label">Nombre *</label>
                <input name="nombre" required className="input" placeholder="Ej: Casco de seguridad" />
              </div>
              <div>
                <label className="label">Descripción</label>
                <input name="descripcion" className="input" placeholder="Opcional" />
              </div>
              <div>
                <label className="label">Vigencia (días)</label>
                <input name="vigenciaDias" type="number" min="1" defaultValue="365" required className="input" />
              </div>
              <button type="submit" className="btn primary">Agregar</button>
            </form>
          </div>

          {/* Lista de tipos */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e2e8f0" }}>
              <h3 style={{ margin: 0 }}>Tipos registrados ({tipos.length})</h3>
            </div>
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              {tipos.length === 0 && (
                <p style={{ padding: "1.5rem", color: "var(--muted)", textAlign: "center", margin: 0 }}>No hay tipos aún.</p>
              )}
              {tipos.map((t) => (
                <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1.25rem", borderBottom: "1px solid #f1f5f9" }}>
                  <div>
                    <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
                      {t.nombre}
                      <span style={{ fontSize: "0.75rem", padding: "1px 6px", borderRadius: 4, background: t.isActive ? "#dcfce7" : "#fee2e2", color: t.isActive ? "#166534" : "#991b1b" }}>
                        {t.isActive ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                      {t.vigenciaDias} días vigencia · {t._count.entregas} entregas
                      {t.descripcion ? ` · ${t.descripcion}` : ""}
                    </div>
                  </div>
                  <form action={toggleTipoEPPAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="isActive" value={String(!t.isActive)} />
                    <button type="submit" className="btn secondary" style={{ fontSize: "0.78rem", padding: "3px 10px" }}>
                      {t.isActive ? "Desactivar" : "Activar"}
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

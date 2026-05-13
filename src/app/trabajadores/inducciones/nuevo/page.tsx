import Link from "next/link";
import { isAdminRole, TRABAJADORES_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { asignarInduccionAction } from "./actions";

export default async function NuevaInduccionPage() {
  const user = await requireRole(TRABAJADORES_ROLES);
  const isAdmin = isAdminRole(user.role);

  const campFilter = isAdmin ? { isActive: true } : { isActive: true, campId: user.campId ?? undefined };

  const [trabajadores, cursos] = await Promise.all([
    db.staffMember.findMany({ where: campFilter, select: { id: true, fullName: true, camp: { select: { name: true } } }, orderBy: { fullName: "asc" } }),
    db.curso.findMany({ where: { activo: true }, select: { id: true, titulo: true, tiempoEstimadoMin: true }, orderBy: { titulo: "asc" } }),
  ]);

  return (
    <AppShell title="Asignar Inducción" user={user} activeNav="trabajadores">
      <div className="card" style={{ maxWidth: 600 }}>
        {cursos.length === 0 && (
          <div className="alert" style={{ marginBottom: "1rem", background: "#fef3c7", color: "#92400e", padding: "0.75rem 1rem", borderRadius: 8 }}>
            No hay cursos activos. <Link href="/trabajadores/cursos/nuevo">Crea uno primero →</Link>
          </div>
        )}
        <form action={asignarInduccionAction} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label className="label">Trabajador *</label>
            <select name="staffMemberId" required className="input">
              <option value="">Seleccionar trabajador...</option>
              {trabajadores.map((t) => (
                <option key={t.id} value={t.id}>{t.fullName} — {t.camp?.name ?? "Sin asignar"}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Curso *</label>
            <select name="cursoId" required className="input">
              <option value="">Seleccionar curso...</option>
              {cursos.map((c) => (
                <option key={c.id} value={c.id}>{c.titulo} ({c.tiempoEstimadoMin} min)</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <a href="/trabajadores/inducciones" className="btn secondary">Cancelar</a>
            <button type="submit" className="btn primary">Asignar inducción</button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

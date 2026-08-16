import Link from "next/link";
import { db } from "@/lib/db";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getCalificaciones } from "@/lib/requisitos-db";
import {
  crearCalificacionAction, actualizarCalificacionAction, alternarCalificacionAction,
} from "./actions";

export default async function CalificacionesPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const user = await requireRole(ADMIN_ROLES);
  const calificaciones = await getCalificaciones(false);

  // Cuántas personas tiene cada una: desactivar la que nadie usa es distinto
  // de desactivar una que sostiene los requisitos de media dotación.
  const conteos = await db.calificacion.findMany({
    select: { id: true, _count: { select: { trabajadores: true, requisitos: true } } },
  });
  const uso = new Map(conteos.map(c => [c.id, c._count]));

  const alerta = {
    creada: { type: "success", text: "Calificación creada. Ya se puede marcar en la ficha de un trabajador." },
    guardada: { type: "success", text: "Cambios guardados." },
    reactivada: { type: "success", text: "Esa calificación ya existía desactivada. Se reactivó." },
    repetida: { type: "error", text: "Ya existe una calificación con ese nombre." },
    "nombre-corto": { type: "error", text: "El nombre necesita al menos 3 caracteres." },
    invalida: { type: "error", text: "No se encontró la calificación." },
  }[searchParams?.status ?? ""] ?? null;

  const etiqueta: React.CSSProperties = {
    fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.03em",
  };

  return (
    <AppShell
      title="Calificaciones"
      user={user}
      activeNav="administracion"
      showAdminSections
      rightSlot={<Link href="/administracion"><button type="button" className="secondary">← Administración</button></Link>}
    >
      <div className="page-stack">
        {alerta && <div className={`alert ${alerta.type}`}>{alerta.text}</div>}

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Qué es una calificación</h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem", maxWidth: "70ch" }}>
            Una habilitación que la persona tiene <strong>además</strong> de su cargo. Emanuel es
            montajista (cargo) y además rigger (calificación). No es un cargo aparte: si lo fuera,
            habría que duplicar toda la matriz de montajista y crear un cargo más cada vez que
            alguien saca un carnet.
          </p>
          <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: "0.9rem", maxWidth: "70ch" }}>
            Sirven para exigir documentos solo a quien corresponde. Un requisito atado a una
            calificación no se le pide a nadie más, ni le aparece como faltante.
          </p>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Agregar una calificación</h2>
          <form action={crearCalificacionAction} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 2fr auto", gap: 12, alignItems: "end" }}>
            <div>
              <label htmlFor="c-nombre" style={etiqueta}>Nombre</label>
              <input id="c-nombre" name="nombre" required minLength={3} placeholder="Rigger, Operador de grúa…" />
            </div>
            <div>
              <label htmlFor="c-desc" style={etiqueta}>Para qué habilita</label>
              <input id="c-desc" name="descripcion" placeholder="Opcional, pero ayuda a quien la marque después" />
            </div>
            <button type="submit">Agregar</button>
          </form>
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "10px 14px", minWidth: 170 }}>Nombre</th>
                  <th style={{ textAlign: "left", padding: "10px 14px", minWidth: 240 }}>Para qué habilita</th>
                  <th style={{ textAlign: "left", padding: "10px 14px" }}>Uso</th>
                  <th style={{ textAlign: "right", padding: "10px 14px" }} />
                </tr>
              </thead>
              <tbody>
                {calificaciones.map(c => {
                  const u = uso.get(c.id);
                  return (
                    <tr key={c.id} style={{ borderBottom: "1px solid var(--border)", opacity: c.activo ? 1 : 0.55 }}>
                      <td style={{ padding: "8px 14px" }}>
                        <form action={actualizarCalificacionAction} id={`f-${c.id}`} style={{ display: "contents" }}>
                          <input type="hidden" name="id" value={c.id} />
                          <input name="nombre" defaultValue={c.nombre} required minLength={3}
                                 style={{ fontSize: "0.86rem", padding: "5px 8px" }} />
                        </form>
                      </td>
                      <td style={{ padding: "8px 14px" }}>
                        <input form={`f-${c.id}`} name="descripcion" defaultValue={c.descripcion ?? ""}
                               placeholder="—" style={{ fontSize: "0.86rem", padding: "5px 8px" }} />
                      </td>
                      <td style={{ padding: "8px 14px", color: "var(--muted)", fontSize: "0.82rem", whiteSpace: "nowrap" }}>
                        {u?.trabajadores ?? 0} {u?.trabajadores === 1 ? "persona" : "personas"}
                        {" · "}
                        {u?.requisitos ?? 0} {u?.requisitos === 1 ? "requisito" : "requisitos"}
                        {!c.activo && <span style={{ display: "block", color: "#9a6300" }}>desactivada</span>}
                      </td>
                      <td style={{ padding: "8px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <button form={`f-${c.id}`} type="submit"
                                style={{ width: "auto", padding: "5px 12px", fontSize: "0.8rem" }}>
                          Guardar
                        </button>
                        <form action={alternarCalificacionAction} style={{ display: "inline" }}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="plano"
                                  style={{ width: "auto", padding: "5px 12px", fontSize: "0.8rem", marginLeft: 6, border: "1px solid var(--border)", borderRadius: 8 }}>
                            {c.activo ? "Desactivar" : "Reactivar"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
                {calificaciones.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 20, color: "var(--muted)" }}>
                    Todavía no hay calificaciones.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ background: "var(--bg)" }}>
          <strong style={{ fontSize: "0.9rem" }}>Falta un paso para que exijan documentos</strong>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: "0.88rem", maxWidth: "70ch" }}>
            Crear la calificación y marcarla en la ficha de alguien no le pide nada todavía. Para
            que exija papeles hay que atarle requisitos en la matriz. Los del rigger —curso y
            carnet— ya vienen atados; para el resto, dime cuáles y los dejo sembrados.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

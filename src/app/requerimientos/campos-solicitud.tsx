import { aInputDate } from "@/lib/ddd";
import { PRIORIDADES, TURNOS } from "@/lib/requerimientos";
import type { CargoRow, ProyectoRow } from "@/lib/requisitos-db";

/**
 * Campos de la solicitud, iguales al crear y al editar. Si fueran dos
 * formularios, tarde o temprano uno pediría algo que el otro no.
 */
export function CamposSolicitud({
  cargos, proyectos, valores, prefijo = "s",
}: {
  cargos: CargoRow[];
  proyectos: ProyectoRow[];
  valores?: {
    cargoId: string; proyectoId: string; vacantes: number; fechaRequerida: Date;
    turno: string; prioridad: string; requisitos: string | null; observaciones: string | null;
  };
  /** Prefijo de los id, para que dos formularios en la misma página no choquen. */
  prefijo?: string;
}) {
  const turnoConocido = valores ? (TURNOS as readonly string[]).includes(valores.turno) : true;
  const hoy = aInputDate(new Date());

  return (
    <>
      <div>
        <label htmlFor={`${prefijo}-cargo`}>Cargo</label>
        <select id={`${prefijo}-cargo`} name="cargoId" required defaultValue={valores?.cargoId ?? ""}>
          <option value="" disabled>Elige un cargo</option>
          {cargos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>
          ¿Falta un cargo? Lo agrega un administrador en Administración.
        </span>
      </div>
      <div>
        <label htmlFor={`${prefijo}-vacantes`}>Vacantes</label>
        <input id={`${prefijo}-vacantes`} name="vacantes" type="number" min={1} max={100} required defaultValue={valores?.vacantes ?? 1} />
      </div>
      <div>
        <label htmlFor={`${prefijo}-proyecto`}>Proyecto / centro de costo</label>
        <select id={`${prefijo}-proyecto`} name="proyectoId" required defaultValue={valores?.proyectoId ?? ""}>
          <option value="" disabled>Elige un proyecto</option>
          {proyectos.map(p => <option key={p.id} value={p.id}>{p.mandanteNombre} — {p.nombre}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${prefijo}-fecha`}>Fecha requerida de ingreso</label>
        <input id={`${prefijo}-fecha`} name="fechaRequerida" type="date" required
               min={valores ? undefined : hoy}
               defaultValue={valores ? aInputDate(valores.fechaRequerida) : ""} />
      </div>
      <div>
        <label htmlFor={`${prefijo}-turno`}>Turno</label>
        <select id={`${prefijo}-turno`} name="turno" required defaultValue={valores ? (turnoConocido ? valores.turno : "otro") : "14x14"}>
          {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
          <option value="otro">Otro</option>
        </select>
      </div>
      <div>
        <label htmlFor={`${prefijo}-turno-otro`}>Si elegiste «Otro», ¿cuál?</label>
        <input id={`${prefijo}-turno-otro`} name="turnoOtro" maxLength={40} placeholder="Ej.: 8x6"
               defaultValue={valores && !turnoConocido ? valores.turno : ""} />
      </div>
      <div>
        <label htmlFor={`${prefijo}-prioridad`}>Prioridad</label>
        <select id={`${prefijo}-prioridad`} name="prioridad" required defaultValue={valores?.prioridad ?? "media"}>
          {PRIORIDADES.map(p => <option key={p.valor} value={p.valor}>{p.label}</option>)}
        </select>
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label htmlFor={`${prefijo}-requisitos`}>Requisitos específicos</label>
        <textarea id={`${prefijo}-requisitos`} name="requisitos" rows={3}
                  placeholder="Acreditaciones, licencias, experiencia, exámenes"
                  defaultValue={valores?.requisitos ?? ""} style={{ fontFamily: "inherit" }} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label htmlFor={`${prefijo}-obs`}>Observaciones</label>
        <input id={`${prefijo}-obs`} name="observaciones" defaultValue={valores?.observaciones ?? ""} />
      </div>
    </>
  );
}

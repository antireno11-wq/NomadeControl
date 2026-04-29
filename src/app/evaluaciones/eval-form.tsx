"use client";

import { useState } from "react";

type Competencia = {
  key: string;
  label: string;
  descripcion: string;
  verificacion: string;
  comentKey: string;
};

const COMPETENCIAS_TRANSVERSALES: Competencia[] = [
  {
    key: "planificacion",
    label: "Planificación",
    descripcion: "Capacidad para organizar y distribuir sus actividades de manera autónoma, sugiriendo alternativas para optimizar tiempos y recursos.",
    verificacion: "Observar si el colaborador/a es capaz de planificar su jornada, distribuir sus tareas de forma ordenada, establecer prioridades y cumplir con los tiempos asignados.",
    comentKey: "comentPlanificacion",
  },
  {
    key: "iniciativa",
    label: "Iniciativa",
    descripcion: "Disposición para actuar de manera autónoma y proactiva frente a situaciones imprevistas, tomando decisiones que permitan mantener el flujo de trabajo.",
    verificacion: "Identificar oportunidades de mejora o reacción ante contratiempos sin esperar instrucciones, adaptando sus acciones para evitar retrasos o tiempos muertos.",
    comentKey: "comentIniciativa",
  },
  {
    key: "cooperacion",
    label: "Cooperación",
    descripcion: "Participa activamente en el equipo, mostrando disposición para apoyar en tareas distintas a las propias, contribuyendo al logro de los objetivos comunes.",
    verificacion: "Observar si el trabajador/a está disponible para asumir funciones fuera de su rol cuando es necesario, especialmente ante ausencias o sobrecargas del equipo.",
    comentKey: "comentCooperacion",
  },
  {
    key: "responsabilidad",
    label: "Responsabilidad",
    descripcion: "Cumple con sus tareas en los plazos establecidos, mostrando compromiso con los resultados. Informa oportunamente cualquier dificultad que pueda afectar el cumplimiento.",
    verificacion: "Evaluar si cumple con sus horarios y tareas según lo planificado, si respeta los tiempos de entrega y si comunica a tiempo cualquier problema.",
    comentKey: "comentResponsabilidad",
  },
  {
    key: "convivenciaLaboral",
    label: "Convivencia Laboral",
    descripcion: "Demuestra una actitud respetuosa, colaborativa y comprometida con la buena convivencia dentro del equipo de trabajo.",
    verificacion: "Analizar si mantiene una comunicación adecuada con sus compañeros/as, si colabora en la resolución de conflictos de manera constructiva.",
    comentKey: "comentConvivencia",
  },
];

const COMPETENCIAS_SEGURIDAD: Competencia[] = [
  {
    key: "comunicacionSeg",
    label: "Comunicación (Seguridad)",
    descripcion: "Participa activamente en charlas de seguridad al inicio del turno, promoviendo el intercambio de información útil para el equipo.",
    verificacion: "Verificar si sugiere temas relevantes de seguridad, pone atención y motiva la participación de otros compañeros/as.",
    comentKey: "comentComunicacion",
  },
  {
    key: "indumentaria",
    label: "Uso y Cuidado de Indumentaria",
    descripcion: "Utiliza correctamente el uniforme y los elementos de protección personal (EPP), responsabilizándose de su uso adecuado, limpieza y mantenimiento.",
    verificacion: "Validar el cumplimiento de las normas de seguridad respecto al uso de uniforme y EPP, y observar el estado de limpieza y conservación del equipamiento.",
    comentKey: "comentIndumentaria",
  },
  {
    key: "elaboracionDocs",
    label: "Elaboración de Documentos",
    descripcion: "Elabora o supervisa documentos de seguridad asociados al análisis seguro del trabajo (AST/ART) e inspecciones, de forma autónoma y alineada a las tareas a ejecutar.",
    verificacion: "Revisar si completa o valida los formularios correspondientes según la planificación del día (AST individual o del equipo).",
    comentKey: "comentElaboracion",
  },
  {
    key: "reportabilidad",
    label: "Reportabilidad",
    descripcion: "Identifica y reporta condiciones inseguras o subestándar que puedan poner en riesgo su integridad o la del equipo.",
    verificacion: "Verificar si notifica oportunamente situaciones que requieran mejora para prevenir incidentes (herramientas defectuosas, materiales fuera de lugar, etc.).",
    comentKey: "comentReportabilidad",
  },
  {
    key: "gestionAmbiente",
    label: "Gestión del Ambiente",
    descripcion: "Sugiere o reporta condiciones ambientales que puedan generar impactos positivos o negativos en el entorno o en la comunidad.",
    verificacion: "Revisar si contribuye con información relevante sobre el entorno ambiental (derrames, residuos mal gestionados, avistamientos de fauna, etc.).",
    comentKey: "comentGestion",
  },
];

const ESCALA = [
  { val: 1, label: "1 – No cumple" },
  { val: 2, label: "2 – Cumple parcialmente" },
  { val: 3, label: "3 – Cumple lo esperado" },
  { val: 4, label: "4 – Excede" },
  { val: 5, label: "5 – Sobre excede" },
];

type EvalData = {
  id: string;
  evaluadoNombre: string;
  evaluadoCargo: string | null;
  periodo: string;
  proyecto: string | null;
  evaluadorNombre: string;
  planificacion: number | null;
  iniciativa: number | null;
  cooperacion: number | null;
  responsabilidad: number | null;
  convivenciaLaboral: number | null;
  comunicacionSeg: number | null;
  indumentaria: number | null;
  elaboracionDocs: number | null;
  reportabilidad: number | null;
  gestionAmbiente: number | null;
  comentPlanificacion: string | null;
  comentIniciativa: string | null;
  comentCooperacion: string | null;
  comentResponsabilidad: string | null;
  comentConvivencia: string | null;
  comentComunicacion: string | null;
  comentIndumentaria: string | null;
  comentElaboracion: string | null;
  comentReportabilidad: string | null;
  comentGestion: string | null;
  puntajeTotal: number | null;
  oportunidadesMejora: string | null;
  mantenerCargo: string | null;
  reubicar: string | null;
  promocion: string | null;
  reconocimiento: string | null;
  requiereCapacitacion: string | null;
  observacionesFinales: string | null;
  estado: string;
} | null;

type Trabajador = { nombre: string; cargo: string };

function ScoreSelector({ name, defaultValue }: { name: string; defaultValue?: number | null }) {
  const [selected, setSelected] = useState<number | null>(defaultValue ?? null);
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <input type="hidden" name={name} value={selected ?? ""} />
      {ESCALA.map(({ val, label }) => (
        <button
          key={val}
          type="button"
          onClick={() => setSelected(val === selected ? null : val)}
          title={label}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            border: selected === val ? "2px solid var(--teal)" : "1px solid var(--border)",
            background: selected === val ? "var(--teal)" : "var(--surface)",
            color: selected === val ? "white" : "var(--text)",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: "0.9rem",
            transition: "all 0.15s",
          }}
        >
          {val}
        </button>
      ))}
      {selected !== null && (
        <span style={{ alignSelf: "center", fontSize: "0.8rem", color: "var(--muted)", marginLeft: 4 }}>
          {ESCALA.find(e => e.val === selected)?.label.split("–")[1]?.trim()}
        </span>
      )}
    </div>
  );
}

function CompetenciaRow({ comp, evalData }: { comp: Competencia; evalData: EvalData }) {
  const score = evalData ? (evalData as any)[comp.key] as number | null : null;
  const coment = evalData ? (evalData as any)[comp.comentKey] as string | null : null;
  const [open, setOpen] = useState(false);

  return (
    <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{comp.label}</div>
          <div style={{ fontSize: "0.83rem", color: "var(--muted)", lineHeight: 1.5, marginBottom: 8 }}>{comp.descripcion}</div>
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            style={{
              fontSize: "0.78rem",
              color: "var(--teal)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            {open ? "▲ Ocultar forma de verificación" : "▼ Ver forma de verificación"}
          </button>
          {open && (
            <div style={{ fontSize: "0.82rem", color: "var(--muted)", background: "rgba(0,168,191,0.07)", borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
              {comp.verificacion}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 240 }}>
          <ScoreSelector name={comp.key} defaultValue={score} />
          <textarea
            name={comp.comentKey}
            defaultValue={coment ?? ""}
            placeholder="Comentario del evaluador (opcional)…"
            rows={2}
            style={{
              width: "100%",
              borderRadius: 8,
              border: "1px solid var(--border)",
              padding: "8px 10px",
              fontSize: "0.83rem",
              background: "var(--surface)",
              color: "var(--text)",
              resize: "vertical",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function EvaluacionForm({
  action,
  evaluacion,
  trabajadores,
  evaluadorNombre,
}: {
  action: (fd: FormData) => Promise<void>;
  evaluacion: EvalData;
  trabajadores: Trabajador[];
  evaluadorNombre: string;
}) {
  const [selectedTrabajador, setSelectedTrabajador] = useState(evaluacion?.evaluadoNombre ?? "");
  const [selectedCargo, setSelectedCargo] = useState(evaluacion?.evaluadoCargo ?? "");

  function handleTrabajadorChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    setSelectedTrabajador(val);
    const found = trabajadores.find(t => t.nombre === val);
    if (found) setSelectedCargo(found.cargo);
    else setSelectedCargo("");
  }

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {evaluacion && <input type="hidden" name="evalId" value={evaluacion.id} />}

      {/* I. Identificación */}
      <div className="card">
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--teal)", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          I. Identificación del Colaborador/a
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <div>
            <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>Trabajador evaluado *</label>
            <select
              name="evaluadoNombre"
              value={selectedTrabajador}
              onChange={handleTrabajadorChange}
              required
              style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: "9px 12px", background: "var(--surface)", color: "var(--text)", fontSize: "0.9rem" }}
            >
              <option value="">— Seleccionar trabajador —</option>
              {trabajadores.map(t => (
                <option key={t.nombre} value={t.nombre}>{t.nombre}</option>
              ))}
              <option value="__manual__">✏️ Ingresar manualmente…</option>
            </select>
            {(selectedTrabajador === "__manual__" || !trabajadores.some(t => t.nombre === selectedTrabajador) && selectedTrabajador !== "") && (
              <input
                name="evaluadoNombre"
                defaultValue={selectedTrabajador === "__manual__" ? "" : selectedTrabajador}
                placeholder="Nombre completo"
                required
                style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: "9px 12px", background: "var(--surface)", color: "var(--text)", fontSize: "0.9rem", marginTop: 8 }}
              />
            )}
          </div>
          <div>
            <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>Cargo</label>
            <input
              name="evaluadoCargo"
              value={selectedCargo}
              onChange={e => setSelectedCargo(e.target.value)}
              placeholder="Cargo del trabajador"
              style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: "9px 12px", background: "var(--surface)", color: "var(--text)", fontSize: "0.9rem" }}
            />
          </div>
          <div>
            <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>Período evaluado *</label>
            <input
              name="periodo"
              defaultValue={evaluacion?.periodo ?? ""}
              placeholder="ej: Enero–Junio 2025"
              required
              style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: "9px 12px", background: "var(--surface)", color: "var(--text)", fontSize: "0.9rem" }}
            />
          </div>
          <div>
            <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>Proyecto</label>
            <input
              name="proyecto"
              defaultValue={evaluacion?.proyecto ?? ""}
              placeholder="Nombre del proyecto (opcional)"
              style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: "9px 12px", background: "var(--surface)", color: "var(--text)", fontSize: "0.9rem" }}
            />
          </div>
          <div>
            <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>Evaluador/a</label>
            <input
              value={evaluadorNombre}
              readOnly
              style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: "9px 12px", background: "rgba(0,0,0,0.04)", color: "var(--muted)", fontSize: "0.9rem" }}
            />
          </div>
        </div>

        {/* Escala de referencia */}
        <div style={{ marginTop: 20, padding: "14px 16px", borderRadius: 10, background: "rgba(0,168,191,0.07)", border: "1px solid rgba(0,168,191,0.2)" }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--teal)", marginBottom: 8 }}>Escala de medición</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px" }}>
            {ESCALA.map(e => (
              <span key={e.val} style={{ fontSize: "0.8rem", color: "var(--text)" }}>
                <strong style={{ color: "var(--teal)" }}>{e.val}</strong> = {e.label.split("–")[1]?.trim()}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* II. Competencias Transversales */}
      <div className="card">
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--teal)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          II. Competencias Transversales
        </div>
        <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 20 }}>
          Selecciona el puntaje (1–5) para cada competencia. Puedes agregar un comentario opcional.
        </div>
        {COMPETENCIAS_TRANSVERSALES.map(comp => (
          <CompetenciaRow key={comp.key} comp={comp} evalData={evaluacion} />
        ))}
      </div>

      {/* III. Seguridad y Medio Ambiente */}
      <div className="card">
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--teal)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          III. Desempeño de Seguridad y Medio Ambiente
        </div>
        <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 20 }}>
          Evalúa el desempeño en seguridad y cuidado del medio ambiente.
        </div>
        {COMPETENCIAS_SEGURIDAD.map(comp => (
          <CompetenciaRow key={comp.key} comp={comp} evalData={evaluacion} />
        ))}
      </div>

      {/* IV. Retroalimentación */}
      <div className="card">
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--teal)", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          IV. Sesión de Retroalimentación
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>Oportunidades de mejora recomendadas</label>
            <textarea
              name="oportunidadesMejora"
              defaultValue={evaluacion?.oportunidadesMejora ?? ""}
              placeholder="Describe las áreas de mejora identificadas…"
              rows={3}
              style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: "10px 12px", background: "var(--surface)", color: "var(--text)", fontSize: "0.9rem", resize: "vertical" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            <div>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>1. ¿Mantener en el cargo?</label>
              <select
                name="mantenerCargo"
                defaultValue={evaluacion?.mantenerCargo ?? ""}
                style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: "9px 12px", background: "var(--surface)", color: "var(--text)", fontSize: "0.9rem" }}
              >
                <option value="">— Sin definir —</option>
                <option value="Sí">Sí</option>
                <option value="No">No</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>2. ¿Reubicar? ¿Dónde?</label>
              <input
                name="reubicar"
                defaultValue={evaluacion?.reubicar ?? ""}
                placeholder="Indicar destino o 'No'"
                style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: "9px 12px", background: "var(--surface)", color: "var(--text)", fontSize: "0.9rem" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>3. Promoción ¿A qué puesto?</label>
              <input
                name="promocion"
                defaultValue={evaluacion?.promocion ?? ""}
                placeholder="Indicar propuesta o 'No aplica'"
                style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: "9px 12px", background: "var(--surface)", color: "var(--text)", fontSize: "0.9rem" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>4. Reconocimiento</label>
              <input
                name="reconocimiento"
                defaultValue={evaluacion?.reconocimiento ?? ""}
                placeholder="Tipo de reconocimiento propuesto"
                style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: "9px 12px", background: "var(--surface)", color: "var(--text)", fontSize: "0.9rem" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>5. ¿Requiere capacitación? ¿En qué?</label>
              <input
                name="requiereCapacitacion"
                defaultValue={evaluacion?.requiereCapacitacion ?? ""}
                placeholder="Área o tipo de capacitación requerida"
                style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: "9px 12px", background: "var(--surface)", color: "var(--text)", fontSize: "0.9rem" }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>Observaciones Finales</label>
            <textarea
              name="observacionesFinales"
              defaultValue={evaluacion?.observacionesFinales ?? ""}
              placeholder="Conclusiones generales de la evaluación…"
              rows={3}
              style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: "10px 12px", background: "var(--surface)", color: "var(--text)", fontSize: "0.9rem", resize: "vertical" }}
            />
          </div>
        </div>
      </div>

      {/* Acciones */}
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap", paddingBottom: 40 }}>
        <button
          type="submit"
          name="accion"
          value="borrador"
          style={{ borderRadius: 10, padding: "12px 24px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontWeight: 600, cursor: "pointer", fontSize: "0.95rem" }}
        >
          💾 Guardar borrador
        </button>
        <button
          type="submit"
          name="accion"
          value="completar"
          style={{ borderRadius: 10, padding: "12px 28px", background: "var(--teal)", color: "white", border: "none", fontWeight: 700, cursor: "pointer", fontSize: "0.95rem" }}
        >
          ✅ Completar evaluación
        </button>
      </div>
    </form>
  );
}

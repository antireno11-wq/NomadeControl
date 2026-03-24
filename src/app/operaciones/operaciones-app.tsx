"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./operaciones.module.css";

type Semaforo = "rojo" | "amarillo" | "verde";

type Obligacion = {
  id: string;
  proyecto: string;
  area: string;
  obligacion: string;
  criticidad: "Critica" | "Alta" | "Media" | "Baja";
  responsable: string;
  supervisor: string;
  frecuencia: "Diaria" | "Semanal" | "Quincenal" | "Mensual" | "Trimestral";
  tipoEvidencia: string;
  fechaProximaRevision: string;
  estado: "Pendiente" | "En curso" | "Al dia" | "Incumplida" | "Cerrada";
};

type Hallazgo = {
  id: string;
  proyecto: string;
  fechaDeteccion: string;
  area: string;
  descripcion: string;
  prioridad: "Critica" | "Alta" | "Media" | "Baja";
  accionInmediata: string;
  accionDefinitiva: string;
  responsable: string;
  fechaCompromiso: string;
  estado: "Abierto" | "En seguimiento" | "Escalado" | "Cerrado";
  evidencia: string;
  fechaCierre: string;
};

type Dotacion = {
  id: string;
  proyecto: string;
  ocupacionActual: number;
  dotacionMinimaRequerida: number;
  dotacionReal: number;
  brecha: number;
  comentario: string;
};

type Filtros = {
  proyecto: string;
  prioridad: string;
  estado: string;
};

const STORAGE_KEYS = {
  obligaciones: "nomade-operaciones-obligaciones",
  hallazgos: "nomade-operaciones-hallazgos",
  dotacion: "nomade-operaciones-dotacion"
} as const;

const PRIORIDADES = ["Critica", "Alta", "Media", "Baja"] as const;
const ESTADOS_OBLIGACIONES = ["Pendiente", "En curso", "Al dia", "Incumplida", "Cerrada"] as const;
const ESTADOS_HALLAZGOS = ["Abierto", "En seguimiento", "Escalado", "Cerrado"] as const;
const ESTADOS_DOTACION = ["Con brecha", "Sin brecha"] as const;
const FRECUENCIAS = ["Diaria", "Semanal", "Quincenal", "Mensual", "Trimestral"] as const;

const DEMO_OBLIGACIONES: Obligacion[] = [
  {
    id: "obl-1",
    proyecto: "Quebrada Blanca",
    area: "HSEC",
    obligacion: "Control diario de agua potable",
    criticidad: "Critica",
    responsable: "Valentina Diaz",
    supervisor: "Ramon Vega",
    frecuencia: "Diaria",
    tipoEvidencia: "Checklist firmado",
    fechaProximaRevision: shiftDate(1),
    estado: "En curso"
  },
  {
    id: "obl-2",
    proyecto: "Sierra Norte",
    area: "Operaciones",
    obligacion: "Prueba de grupo electrogeno",
    criticidad: "Alta",
    responsable: "Felipe Araya",
    supervisor: "Daniela Pizarro",
    frecuencia: "Semanal",
    tipoEvidencia: "Registro fotografico",
    fechaProximaRevision: shiftDate(-2),
    estado: "Pendiente"
  },
  {
    id: "obl-3",
    proyecto: "Atacama Sur",
    area: "Mantencion",
    obligacion: "Inspeccion de extintores",
    criticidad: "Media",
    responsable: "Ignacio Mella",
    supervisor: "Paola Cortes",
    frecuencia: "Mensual",
    tipoEvidencia: "Acta inspeccion",
    fechaProximaRevision: shiftDate(9),
    estado: "Al dia"
  }
];

const DEMO_HALLAZGOS: Hallazgo[] = [
  {
    id: "hal-1",
    proyecto: "Quebrada Blanca",
    fechaDeteccion: shiftDate(-4),
    area: "Casino",
    descripcion: "Temperatura de camara fria fuera de rango",
    prioridad: "Critica",
    accionInmediata: "Aislar productos sensibles",
    accionDefinitiva: "Mantencion correctiva del equipo",
    responsable: "Nicolas Torres",
    fechaCompromiso: shiftDate(-1),
    estado: "En seguimiento",
    evidencia: "Foto + OT 443",
    fechaCierre: ""
  },
  {
    id: "hal-2",
    proyecto: "Sierra Norte",
    fechaDeteccion: shiftDate(-2),
    area: "Habitabilidad",
    descripcion: "Fuga menor en ducha modulo B",
    prioridad: "Media",
    accionInmediata: "Cerrar llave sectorizada",
    accionDefinitiva: "Cambio de flexible",
    responsable: "Cristobal Salas",
    fechaCompromiso: shiftDate(2),
    estado: "Abierto",
    evidencia: "Ticket mantenimiento #918",
    fechaCierre: ""
  },
  {
    id: "hal-3",
    proyecto: "Atacama Sur",
    fechaDeteccion: shiftDate(-9),
    area: "Seguridad",
    descripcion: "Senaletica de evacuacion repuesta",
    prioridad: "Alta",
    accionInmediata: "Demarcacion provisoria",
    accionDefinitiva: "Instalacion senaletica definitiva",
    responsable: "Karen Olguin",
    fechaCompromiso: shiftDate(-3),
    estado: "Cerrado",
    evidencia: "Acta cierre + fotos",
    fechaCierre: shiftDate(-2)
  }
];

const DEMO_DOTACION: Dotacion[] = [
  {
    id: "dot-1",
    proyecto: "Quebrada Blanca",
    ocupacionActual: 218,
    dotacionMinimaRequerida: 22,
    dotacionReal: 19,
    brecha: 3,
    comentario: "Faltan 2 auxiliares y 1 tecnico de mantencion"
  },
  {
    id: "dot-2",
    proyecto: "Sierra Norte",
    ocupacionActual: 155,
    dotacionMinimaRequerida: 16,
    dotacionReal: 16,
    brecha: 0,
    comentario: "Cobertura segun plan semanal"
  },
  {
    id: "dot-3",
    proyecto: "Atacama Sur",
    ocupacionActual: 96,
    dotacionMinimaRequerida: 11,
    dotacionReal: 12,
    brecha: -1,
    comentario: "Turno con refuerzo eventual"
  }
].map((item) => normalizeDotacion(item));

const DEFAULT_FILTROS: Filtros = {
  proyecto: "",
  prioridad: "",
  estado: ""
};

export function OperacionesApp() {
  const [filtros, setFiltros] = useState<Filtros>(DEFAULT_FILTROS);
  const [obligaciones, setObligaciones] = useState<Obligacion[]>(DEMO_OBLIGACIONES);
  const [hallazgos, setHallazgos] = useState<Hallazgo[]>(DEMO_HALLAZGOS);
  const [dotacion, setDotacion] = useState<Dotacion[]>(DEMO_DOTACION);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const obligacionesStored = readStorage<Obligacion[]>(STORAGE_KEYS.obligaciones, DEMO_OBLIGACIONES);
    const hallazgosStored = readStorage<Hallazgo[]>(STORAGE_KEYS.hallazgos, DEMO_HALLAZGOS);
    const dotacionStored = readStorage<Dotacion[]>(STORAGE_KEYS.dotacion, DEMO_DOTACION).map((item) =>
      normalizeDotacion(item)
    );

    setObligaciones(obligacionesStored);
    setHallazgos(hallazgosStored);
    setDotacion(dotacionStored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEYS.obligaciones, JSON.stringify(obligaciones));
  }, [obligaciones, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEYS.hallazgos, JSON.stringify(hallazgos));
  }, [hallazgos, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEYS.dotacion, JSON.stringify(dotacion));
  }, [dotacion, hydrated]);

  const proyectos = useMemo(
    () =>
      uniqueValues([
        ...obligaciones.map((item) => item.proyecto),
        ...hallazgos.map((item) => item.proyecto),
        ...dotacion.map((item) => item.proyecto)
      ]),
    [obligaciones, hallazgos, dotacion]
  );

  const estados = useMemo(
    () => uniqueValues([...obligaciones.map((item) => item.estado), ...hallazgos.map((item) => item.estado), ...ESTADOS_DOTACION]),
    [obligaciones, hallazgos]
  );

  const obligacionesFiltradas = useMemo(
    () =>
      obligaciones.filter((item) => {
        if (filtros.proyecto && item.proyecto !== filtros.proyecto) return false;
        if (filtros.prioridad && item.criticidad !== filtros.prioridad) return false;
        if (filtros.estado && item.estado !== filtros.estado) return false;
        return true;
      }),
    [obligaciones, filtros]
  );

  const hallazgosFiltrados = useMemo(
    () =>
      hallazgos.filter((item) => {
        if (filtros.proyecto && item.proyecto !== filtros.proyecto) return false;
        if (filtros.prioridad && item.prioridad !== filtros.prioridad) return false;
        if (filtros.estado && item.estado !== filtros.estado) return false;
        return true;
      }),
    [hallazgos, filtros]
  );

  const dotacionFiltrada = useMemo(
    () =>
      dotacion.filter((item) => {
        if (filtros.proyecto && item.proyecto !== filtros.proyecto) return false;
        if (filtros.estado) {
          const estadoDotacion = item.brecha > 0 ? "Con brecha" : "Sin brecha";
          if (estadoDotacion !== filtros.estado) return false;
        }
        return true;
      }),
    [dotacion, filtros]
  );

  const pendientesCriticosAbiertos = hallazgosFiltrados.filter(
    (item) => item.prioridad === "Critica" && item.estado !== "Cerrado"
  ).length;

  const pendientesVencidos = hallazgosFiltrados.filter(
    (item) => item.estado !== "Cerrado" && dateDiffFromToday(item.fechaCompromiso) < 0
  ).length;

  const obligacionesSinRevisionVigente = obligacionesFiltradas.filter(
    (item) => item.estado !== "Cerrada" && dateDiffFromToday(item.fechaProximaRevision) < 0
  ).length;

  const brechasPorProyecto = useMemo(() => {
    const grouped = new Map<string, number>();

    for (const item of dotacionFiltrada) {
      const brechaPositiva = Math.max(item.brecha, 0);
      grouped.set(item.proyecto, (grouped.get(item.proyecto) ?? 0) + brechaPositiva);
    }

    return Array.from(grouped.entries())
      .map(([proyecto, brecha]) => ({ proyecto, brecha }))
      .sort((a, b) => b.brecha - a.brecha);
  }, [dotacionFiltrada]);

  function handleFiltroChange<K extends keyof Filtros>(key: K, value: Filtros[K]) {
    setFiltros((prev) => ({ ...prev, [key]: value }));
  }

  function handleResetFiltros() {
    setFiltros(DEFAULT_FILTROS);
  }

  function updateObligacion<K extends keyof Obligacion>(id: string, key: K, value: Obligacion[K]) {
    setObligaciones((prev) => prev.map((item) => (item.id === id ? { ...item, [key]: value } : item)));
  }

  function addObligacion() {
    setObligaciones((prev) => [
      {
        id: uid(),
        proyecto: "",
        area: "",
        obligacion: "",
        criticidad: "Media",
        responsable: "",
        supervisor: "",
        frecuencia: "Semanal",
        tipoEvidencia: "",
        fechaProximaRevision: todayIso(),
        estado: "Pendiente"
      },
      ...prev
    ]);
  }

  function deleteObligacion(id: string) {
    setObligaciones((prev) => prev.filter((item) => item.id !== id));
  }

  function updateHallazgo<K extends keyof Hallazgo>(id: string, key: K, value: Hallazgo[K]) {
    setHallazgos((prev) => prev.map((item) => (item.id === id ? { ...item, [key]: value } : item)));
  }

  function addHallazgo() {
    setHallazgos((prev) => [
      {
        id: uid(),
        proyecto: "",
        fechaDeteccion: todayIso(),
        area: "",
        descripcion: "",
        prioridad: "Media",
        accionInmediata: "",
        accionDefinitiva: "",
        responsable: "",
        fechaCompromiso: todayIso(),
        estado: "Abierto",
        evidencia: "",
        fechaCierre: ""
      },
      ...prev
    ]);
  }

  function deleteHallazgo(id: string) {
    setHallazgos((prev) => prev.filter((item) => item.id !== id));
  }

  function updateDotacion<K extends keyof Dotacion>(id: string, key: K, value: Dotacion[K]) {
    setDotacion((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [key]: value };
        return normalizeDotacion(updated);
      })
    );
  }

  function addDotacion() {
    setDotacion((prev) => [
      {
        id: uid(),
        proyecto: "",
        ocupacionActual: 0,
        dotacionMinimaRequerida: 0,
        dotacionReal: 0,
        brecha: 0,
        comentario: ""
      },
      ...prev
    ]);
  }

  function deleteDotacion(id: string) {
    setDotacion((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <main className={styles.main}>
      <section className={`${styles.card} ${styles.headerCard}`}>
        <div>
          <h1 className={styles.title}>Control operacional de campamentos</h1>
          <p className={styles.subtitle}>
            Nómade Chile | Base operativa para obligaciones criticas, hallazgos y dotacion minima.
          </p>
        </div>
      </section>

      <section className={`${styles.card} ${styles.filtersCard}`}>
        <div className={styles.filtersGrid}>
          <label className={styles.field}>
            <span>Proyecto</span>
            <select value={filtros.proyecto} onChange={(event) => handleFiltroChange("proyecto", event.target.value)}>
              <option value="">Todos</option>
              {proyectos.map((proyecto) => (
                <option key={proyecto} value={proyecto}>
                  {proyecto}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Prioridad</span>
            <select value={filtros.prioridad} onChange={(event) => handleFiltroChange("prioridad", event.target.value)}>
              <option value="">Todas</option>
              {PRIORIDADES.map((prioridad) => (
                <option key={prioridad} value={prioridad}>
                  {prioridad}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Estado</span>
            <select value={filtros.estado} onChange={(event) => handleFiltroChange("estado", event.target.value)}>
              <option value="">Todos</option>
              {estados.map((estado) => (
                <option key={estado} value={estado}>
                  {estado}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className={styles.secondaryButton} onClick={handleResetFiltros}>
            Limpiar filtros
          </button>
        </div>
      </section>

      <section className={styles.contentStack}>
          <div className={styles.metricsGrid}>
            <MetricCard title="Pendientes criticos abiertos" value={pendientesCriticosAbiertos} tone="rojo" />
            <MetricCard title="Pendientes vencidos" value={pendientesVencidos} tone="amarillo" />
            <MetricCard title="Obligaciones sin revision vigente" value={obligacionesSinRevisionVigente} tone="rojo" />
            <MetricCard
              title="Brecha total de dotacion"
              value={dotacionFiltrada.reduce((acc, item) => acc + Math.max(item.brecha, 0), 0)}
              tone="verde"
            />
          </div>

          <div className={styles.card}>
            <div className={styles.sectionTitleRow}>
              <h2>Brechas de dotacion por proyecto</h2>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Proyecto</th>
                    <th>Brecha total</th>
                    <th>Semaforo</th>
                  </tr>
                </thead>
                <tbody>
                  {brechasPorProyecto.length === 0 ? (
                    <tr>
                      <td colSpan={3} className={styles.emptyRow}>
                        Sin brechas activas para los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    brechasPorProyecto.map((item) => {
                      const estado = item.brecha > 0 ? "Con brecha" : "Sin brecha";
                      const semaforo = item.brecha > 0 ? "rojo" : "verde";
                      return (
                        <tr key={item.proyecto}>
                          <td>{item.proyecto}</td>
                          <td>{item.brecha}</td>
                          <td>
                            <SemaforoTag color={semaforo} label={estado} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
      </section>

      <section className={styles.card}>
          <div className={styles.sectionTitleRow}>
            <h2>Obligaciones criticas</h2>
            <button type="button" className={styles.primaryButton} onClick={addObligacion}>
              Agregar obligacion
            </button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Proyecto</th>
                  <th>Area</th>
                  <th>Obligacion</th>
                  <th>Criticidad</th>
                  <th>Responsable</th>
                  <th>Supervisor</th>
                  <th>Frecuencia</th>
                  <th>Tipo evidencia</th>
                  <th>Proxima revision</th>
                  <th>Estado</th>
                  <th>Semaforo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {obligacionesFiltradas.length === 0 ? (
                  <tr>
                    <td colSpan={12} className={styles.emptyRow}>
                      No hay obligaciones para este filtro.
                    </td>
                  </tr>
                ) : (
                  obligacionesFiltradas.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input value={item.proyecto} onChange={(event) => updateObligacion(item.id, "proyecto", event.target.value)} />
                      </td>
                      <td>
                        <input value={item.area} onChange={(event) => updateObligacion(item.id, "area", event.target.value)} />
                      </td>
                      <td>
                        <input
                          value={item.obligacion}
                          onChange={(event) => updateObligacion(item.id, "obligacion", event.target.value)}
                        />
                      </td>
                      <td>
                        <select
                          value={item.criticidad}
                          onChange={(event) => updateObligacion(item.id, "criticidad", event.target.value as Obligacion["criticidad"])}
                        >
                          {PRIORIDADES.map((prioridad) => (
                            <option key={prioridad} value={prioridad}>
                              {prioridad}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          value={item.responsable}
                          onChange={(event) => updateObligacion(item.id, "responsable", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          value={item.supervisor}
                          onChange={(event) => updateObligacion(item.id, "supervisor", event.target.value)}
                        />
                      </td>
                      <td>
                        <select
                          value={item.frecuencia}
                          onChange={(event) => updateObligacion(item.id, "frecuencia", event.target.value as Obligacion["frecuencia"])}
                        >
                          {FRECUENCIAS.map((frecuencia) => (
                            <option key={frecuencia} value={frecuencia}>
                              {frecuencia}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          value={item.tipoEvidencia}
                          onChange={(event) => updateObligacion(item.id, "tipoEvidencia", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          value={item.fechaProximaRevision}
                          onChange={(event) =>
                            updateObligacion(item.id, "fechaProximaRevision", normalizeDateInput(event.target.value))
                          }
                        />
                      </td>
                      <td>
                        <select
                          value={item.estado}
                          onChange={(event) => updateObligacion(item.id, "estado", event.target.value as Obligacion["estado"])}
                        >
                          {ESTADOS_OBLIGACIONES.map((estado) => (
                            <option key={estado} value={estado}>
                              {estado}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <SemaforoTag color={semaforoObligacion(item)} label={labelSemaforo(semaforoObligacion(item))} />
                      </td>
                      <td>
                        <button type="button" className={styles.deleteButton} onClick={() => deleteObligacion(item.id)}>
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
      </section>

      <section className={styles.card}>
          <div className={styles.sectionTitleRow}>
            <h2>Hallazgos y pendientes</h2>
            <button type="button" className={styles.primaryButton} onClick={addHallazgo}>
              Agregar hallazgo
            </button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Proyecto</th>
                  <th>Fecha deteccion</th>
                  <th>Area</th>
                  <th>Descripcion</th>
                  <th>Prioridad</th>
                  <th>Accion inmediata</th>
                  <th>Accion definitiva</th>
                  <th>Responsable</th>
                  <th>Fecha compromiso</th>
                  <th>Estado</th>
                  <th>Evidencia</th>
                  <th>Fecha cierre</th>
                  <th>Semaforo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {hallazgosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={14} className={styles.emptyRow}>
                      No hay hallazgos para este filtro.
                    </td>
                  </tr>
                ) : (
                  hallazgosFiltrados.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input value={item.proyecto} onChange={(event) => updateHallazgo(item.id, "proyecto", event.target.value)} />
                      </td>
                      <td>
                        <input
                          type="date"
                          value={item.fechaDeteccion}
                          onChange={(event) => updateHallazgo(item.id, "fechaDeteccion", normalizeDateInput(event.target.value))}
                        />
                      </td>
                      <td>
                        <input value={item.area} onChange={(event) => updateHallazgo(item.id, "area", event.target.value)} />
                      </td>
                      <td>
                        <input
                          value={item.descripcion}
                          onChange={(event) => updateHallazgo(item.id, "descripcion", event.target.value)}
                        />
                      </td>
                      <td>
                        <select
                          value={item.prioridad}
                          onChange={(event) => updateHallazgo(item.id, "prioridad", event.target.value as Hallazgo["prioridad"])}
                        >
                          {PRIORIDADES.map((prioridad) => (
                            <option key={prioridad} value={prioridad}>
                              {prioridad}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          value={item.accionInmediata}
                          onChange={(event) => updateHallazgo(item.id, "accionInmediata", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          value={item.accionDefinitiva}
                          onChange={(event) => updateHallazgo(item.id, "accionDefinitiva", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          value={item.responsable}
                          onChange={(event) => updateHallazgo(item.id, "responsable", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          value={item.fechaCompromiso}
                          onChange={(event) => updateHallazgo(item.id, "fechaCompromiso", normalizeDateInput(event.target.value))}
                        />
                      </td>
                      <td>
                        <select
                          value={item.estado}
                          onChange={(event) => updateHallazgo(item.id, "estado", event.target.value as Hallazgo["estado"])}
                        >
                          {ESTADOS_HALLAZGOS.map((estado) => (
                            <option key={estado} value={estado}>
                              {estado}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          value={item.evidencia}
                          onChange={(event) => updateHallazgo(item.id, "evidencia", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          value={item.fechaCierre}
                          onChange={(event) => updateHallazgo(item.id, "fechaCierre", normalizeDateInput(event.target.value))}
                        />
                      </td>
                      <td>
                        <SemaforoTag color={semaforoHallazgo(item)} label={labelSemaforo(semaforoHallazgo(item))} />
                      </td>
                      <td>
                        <button type="button" className={styles.deleteButton} onClick={() => deleteHallazgo(item.id)}>
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
      </section>

      <section className={styles.card}>
          <div className={styles.sectionTitleRow}>
            <h2>Dotacion minima</h2>
            <button type="button" className={styles.primaryButton} onClick={addDotacion}>
              Agregar fila
            </button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Proyecto</th>
                  <th>Ocupacion actual</th>
                  <th>Dotacion minima requerida</th>
                  <th>Dotacion real</th>
                  <th>Brecha</th>
                  <th>Comentario</th>
                  <th>Semaforo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dotacionFiltrada.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.emptyRow}>
                      No hay dotacion para este filtro.
                    </td>
                  </tr>
                ) : (
                  dotacionFiltrada.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input value={item.proyecto} onChange={(event) => updateDotacion(item.id, "proyecto", event.target.value)} />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={item.ocupacionActual}
                          onChange={(event) =>
                            updateDotacion(item.id, "ocupacionActual", toNumberInput(event.target.value))
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={item.dotacionMinimaRequerida}
                          onChange={(event) =>
                            updateDotacion(item.id, "dotacionMinimaRequerida", toNumberInput(event.target.value))
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={item.dotacionReal}
                          onChange={(event) => updateDotacion(item.id, "dotacionReal", toNumberInput(event.target.value))}
                        />
                      </td>
                      <td>
                        <span className={styles.readonlyCell}>{item.brecha}</span>
                      </td>
                      <td>
                        <input
                          value={item.comentario}
                          onChange={(event) => updateDotacion(item.id, "comentario", event.target.value)}
                        />
                      </td>
                      <td>
                        <SemaforoTag color={semaforoDotacion(item)} label={labelSemaforo(semaforoDotacion(item))} />
                      </td>
                      <td>
                        <button type="button" className={styles.deleteButton} onClick={() => deleteDotacion(item.id)}>
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
      </section>
    </main>
  );
}

function MetricCard({ title, value, tone }: { title: string; value: number; tone: Semaforo }) {
  return (
    <article className={styles.metricCard}>
      <p>{title}</p>
      <div className={styles.metricValueRow}>
        <strong>{value}</strong>
        <SemaforoTag color={tone} label={labelSemaforo(tone)} />
      </div>
    </article>
  );
}

function SemaforoTag({ color, label }: { color: Semaforo; label: string }) {
  return (
    <span className={`${styles.semaforo} ${styles[color]}`}>
      <span className={styles.dot} />
      {label}
    </span>
  );
}

function semaforoObligacion(item: Obligacion): Semaforo {
  if (item.estado === "Cerrada" || item.estado === "Al dia") return "verde";
  if (item.estado === "Incumplida") return "rojo";

  const diff = dateDiffFromToday(item.fechaProximaRevision);
  if (diff < 0) return "rojo";
  if (diff <= 7) return "amarillo";
  return "verde";
}

function semaforoHallazgo(item: Hallazgo): Semaforo {
  if (item.estado === "Cerrado") return "verde";

  const diff = dateDiffFromToday(item.fechaCompromiso);
  if (diff < 0 || item.prioridad === "Critica") return "rojo";
  if (diff <= 3 || item.prioridad === "Alta") return "amarillo";
  return "verde";
}

function semaforoDotacion(item: Dotacion): Semaforo {
  if (item.brecha > 0) return "rojo";
  if (item.brecha === 0) return "verde";
  return "amarillo";
}

function labelSemaforo(color: Semaforo) {
  if (color === "rojo") return "Alto";
  if (color === "amarillo") return "Medio";
  return "Controlado";
}

function normalizeDotacion(item: Dotacion): Dotacion {
  const minima = finiteNumber(item.dotacionMinimaRequerida);
  const real = finiteNumber(item.dotacionReal);

  return {
    ...item,
    ocupacionActual: finiteNumber(item.ocupacionActual),
    dotacionMinimaRequerida: minima,
    dotacionReal: real,
    brecha: minima - real,
    comentario: item.comentario ?? ""
  };
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNumberInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDateInput(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function shiftDate(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function todayIso() {
  return toIsoDate(new Date());
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateDiffFromToday(dateValue: string): number {
  if (!dateValue) return 999;
  const parsed = parseDate(dateValue);
  if (!parsed) return 999;

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const diffMs = parsed.getTime() - now.getTime();
  return Math.floor(diffMs / 86400000);
}

function parseDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null;
  }

  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function uniqueValues(items: string[]) {
  return Array.from(new Set(items.filter((item) => item.trim() !== ""))).sort((a, b) => a.localeCompare(b, "es"));
}

function uid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

"use client";

import { useRef, useState, useTransition } from "react";
import type { DragEvent } from "react";
import { extractDocumentsAction, applyExtractionsAction } from "./actions";
import { agruparPorPersona, formatearNombre, nombreMasProbable } from "@/lib/acreditacion";

type Worker = { id: string; fullName: string; nationalId: string | null };
type DocType = { id: string; codigo: string; nombre: string; noVence: boolean; esFoto: boolean; vigenciaDias: number | null };

/** Info del archivo subido, compartida por todas las filas que produjo. */
type ArchivoInfo = {
  clientFileId: string;
  fileName: string;
  fileUrl: string;   // blob URL para el preview
  mimeType: string;
  base64: string;    // se reenvía al confirmar, para guardar el original
  esPdf: boolean;
};

/** Una fila editable = un documento detectado dentro de un archivo. */
type EditableRow = {
  rowId: string;
  clientFileId: string;
  procesando: boolean;
  detectedTipoId: string | null;
  detectedDocTypeLabel: string;
  expiryDate: string | null;
  issueDate: string | null;
  paginaInicio: number | null;
  workerName: string | null;
  workerRut: string | null;
  workerId: string | null;   // id existente, o CREAR_NUEVO
  nuevoNombre: string;
  nuevoRut: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  error?: string;
  applied?: boolean;
  /** Filas del mismo (persona, tipo): las dos caras de la cédula, las hojas
   *  sueltas de una ficha, o una carga repetida. */
  grupoId?: string | null;
  /** El vencimiento se dedujo de la vigencia del tipo, no venía impreso. */
  expiryCalculada?: boolean;
  /** El titular se heredó del resto del lote. */
  titularHeredado?: boolean;
  /** Cantidad de firmantes si el documento es colectivo. */
  firmantes?: number | null;
  /** Colectivo que no incluye a la persona dueña del resto de la carga. */
  ajenoAlLote?: boolean;
  empleadorNombre?: string | null;
  empleadorRut?: string | null;
  cargoContrato?: string | null;
  /** RUT de la cédula de esta carga, cuando el de esta fila no calza. */
  rutDeCedula?: string | null;
  /** Se guarda sin fecha de vencimiento, por decisión explícita del usuario.
   *  Perder el documento porque no se le pudo leer una fecha es peor que
   *  registrarlo sin ella y que alguien la complete después. */
  sinVencimiento?: boolean;
};

/** Qué hacer con un grupo de filas que apuntan al mismo documento. */
type AccionGrupo = "combinar" | "separar";

/**
 * Selector de tipo de documento con filtro mientras se escribe.
 *
 * El catálogo pasó de 9 tipos a más de 50 y una lista desplegable de ese
 * largo obliga a recorrerla entera para encontrar "Curso de extintores".
 * Se escribe una parte del nombre y quedan las coincidencias.
 */
function SelectorTipo({
  tipos,
  valor,
  onElegir,
  disabled,
}: {
  tipos: DocType[];
  valor: string | null;
  onElegir: (tipoId: string | null) => void;
  disabled?: boolean;
}) {
  const elegido = valor ? tipos.find(t => t.id === valor) ?? null : null;
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);

  const normalizar = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Se buscan todas las palabras escritas, en cualquier orden: "curso epp"
  // encuentra "Curso de uso y mantención de EPP".
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
  const coincidencias = palabras.length === 0
    ? tipos
    : tipos.filter(t => {
        const n = normalizar(t.nombre);
        return palabras.every(p => n.includes(p));
      });

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => { if (!disabled) { setTexto(""); setAbierto(true); } }}
        disabled={disabled}
        style={{
          padding: "5px 8px", fontSize: "0.82rem", width: "100%", maxWidth: 190,
          textAlign: "left", background: "white", cursor: disabled ? "default" : "pointer",
          border: elegido ? "1px solid var(--border)" : "1.5px solid #f59e0b",
          borderRadius: 6, color: elegido ? "var(--text)" : "#92400e",
        }}
      >
        {elegido?.nombre ?? "— Elegir —"}
      </button>
    );
  }

  return (
    <div style={{ position: "relative", maxWidth: 190 }}>
      <input
        autoFocus
        value={texto}
        onChange={e => setTexto(e.target.value)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        placeholder="Escribe para buscar…"
        style={{ padding: "5px 8px", fontSize: "0.82rem", width: "100%", boxSizing: "border-box" }}
      />
      <div style={{
        position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0,
        maxHeight: 220, overflowY: "auto", background: "white",
        border: "1px solid var(--border)", borderRadius: 8, marginTop: 2,
        boxShadow: "0 6px 18px rgba(15,23,42,0.12)",
      }}>
        {coincidencias.length === 0 ? (
          <div style={{ padding: "8px 10px", fontSize: "0.78rem", color: "var(--muted)" }}>
            Ningún tipo coincide con «{texto}»
          </div>
        ) : coincidencias.slice(0, 40).map(t => (
          <button
            key={t.id}
            type="button"
            className={t.id === valor ? "opcion-lista activa" : "opcion-lista"}
            onMouseDown={() => { onElegir(t.id); setAbierto(false); }}
          >
            {t.nombre}
          </button>
        ))}
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const MIME_PDF = "application/pdf";
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", MIME_PDF, MIME_DOCX];
const ACCEPTED_EXT = /\.(pdf|docx|jpe?g|png|webp|gif)$/i;

/**
 * Algunos archivos llegan con `type` vacío — es lo que hace el navegador
 * cuando el sistema no reconoce la extensión, y pasa seguido con los .docx
 * bajados de Drive. Rechazarlos por eso sería perder el documento por un
 * detalle del sistema operativo, así que caemos a la extensión.
 */
function mimeDeArchivo(f: File): string {
  if (f.type) return f.type;
  if (/\.pdf$/i.test(f.name)) return MIME_PDF;
  if (/\.docx$/i.test(f.name)) return MIME_DOCX;
  if (/\.jpe?g$/i.test(f.name)) return "image/jpeg";
  if (/\.png$/i.test(f.name)) return "image/png";
  if (/\.webp$/i.test(f.name)) return "image/webp";
  return "";
}

function formatoAceptado(f: File): boolean {
  return ACCEPTED_TYPES.includes(mimeDeArchivo(f)) || ACCEPTED_EXT.test(f.name);
}
const MAX_FILE_MB = 18;

/** Valor especial del select: crear un trabajador con los datos detectados. */
const CREAR_NUEVO = "__crear__";
/** Prefijo de las opciones "persona que se crea con esta misma carga". */
const NUEVO_PREFIX = "__nuevo__:";

const CONFIDENCE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  high:   { bg: "#dcfce7", color: "#166534", label: "✓ Alta" },
  medium: { bg: "#fef3c7", color: "#854d0e", label: "~ Media" },
  low:    { bg: "#fee2e2", color: "#991b1b", label: "! Baja" },
};

export function ExtractClient({
  workers,
  docTypes,
  apiKeyMissing,
  fixedWorker,
  proyectos = [],
  cargos = [],
}: {
  workers: Worker[];
  docTypes: DocType[];
  apiKeyMissing: boolean;
  /** Cargando desde la ficha de una persona: todo lo que se suba es de ella.
   *  Se saca el selector de trabajador, que ahí no tiene nada que decidir. */
  fixedWorker?: { id: string; fullName: string };
  /** Proyecto y cargo disponibles para los trabajadores que se creen acá. */
  proyectos?: { id: string; nombre: string; mandanteNombre: string; ambito: string }[];
  cargos?: { id: string; nombre: string }[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [archivos, setArchivos] = useState<ArchivoInfo[]>([]);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ applied: number; creados: number; errors: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  // Por defecto se combinan: dos caras de una cédula son un documento, no dos.
  const [accionGrupo, setAccionGrupo] = useState<Record<string, AccionGrupo>>({});
  // A qué proyecto y cargo entran los trabajadores que cree esta carga.
  const proyectosMandante = proyectos.filter(p => p.ambito !== "interno");
  const [proyectoNuevo, setProyectoNuevo] = useState(proyectosMandante[0]?.id ?? "");
  const [cargoNuevo, setCargoNuevo] = useState("");

  const infoDe = (clientFileId: string) => archivos.find(a => a.clientFileId === clientFileId);
  const tipoDe = (tipoId: string | null) => (tipoId ? docTypes.find(t => t.id === tipoId) ?? null : null);
  /** Las constancias y la foto se guardan sin fecha de vencimiento. */
  const necesitaFecha = (tipoId: string | null) => {
    const t = tipoDe(tipoId);
    return t ? !t.noVence && !t.esFoto : true;
  };

  async function handleFiles(fileList: FileList | File[]) {
    setGlobalError(null);
    setApplyResult(null);

    const files = Array.from(fileList);
    if (files.length === 0) return;

    const legacyDoc = files.filter(f => /\.doc$/i.test(f.name));
    if (legacyDoc.length > 0) {
      setGlobalError(
        `${legacyDoc.map(f => f.name).join(", ")} está en el formato .doc antiguo, que no se puede ` +
        `leer. Ábrelo en Word y guárdalo como .docx o como PDF.`,
      );
      return;
    }

    const invalidos = files.filter(f => !formatoAceptado(f));
    if (invalidos.length > 0) {
      setGlobalError(`Formato no soportado: ${invalidos.map(f => f.name).join(", ")}. Aceptados: PDF, Word (.docx), JPG, PNG, WEBP.`);
      return;
    }

    const pesados = files.filter(f => f.size > MAX_FILE_MB * 1024 * 1024);
    if (pesados.length > 0) {
      setGlobalError(`Estos archivos superan ${MAX_FILE_MB} MB: ${pesados.map(f => f.name).join(", ")}. Comprímelos o divide el PDF.`);
      return;
    }

    const base64s = await Promise.all(files.map(fileToBase64));
    const nuevosArchivos: ArchivoInfo[] = files.map((f, i) => ({
      clientFileId: `${Date.now()}-${i}`,
      fileName: f.name,
      fileUrl: URL.createObjectURL(f),
      mimeType: mimeDeArchivo(f),
      base64: base64s[i],
      esPdf: mimeDeArchivo(f) === MIME_PDF,
    }));
    setArchivos(prev => [...prev, ...nuevosArchivos]);

    // Una fila "procesando" por archivo, hasta que sepamos cuántos documentos trae
    setRows(prev => [
      ...prev,
      ...nuevosArchivos.map((a): EditableRow => ({
        rowId: `${a.clientFileId}#loading`,
        clientFileId: a.clientFileId,
        procesando: true,
        detectedTipoId: null,
        detectedDocTypeLabel: a.esPdf ? "Leyendo PDF…" : "Procesando…",
        expiryDate: null, issueDate: null, paginaInicio: null,
        workerName: null, workerRut: null, workerId: fixedWorker?.id ?? null,
        nuevoNombre: "", nuevoRut: "",
        confidence: "low", reasoning: "",
      })),
    ]);

    startTransition(async () => {
      try {
        const results = await extractDocumentsAction(
          nuevosArchivos.map(a => ({
            clientFileId: a.clientFileId,
            fileName: a.fileName,
            mimeType: a.mimeType,
            base64: a.base64,
          }))
        );
        const idsProcesados = new Set(nuevosArchivos.map(a => a.clientFileId));

        setRows(prev => [
          // Sacamos los placeholders de estos archivos
          ...prev.filter(r => !(idsProcesados.has(r.clientFileId) && r.procesando)),
          // Y agregamos una fila por documento detectado
          ...results.map((res): EditableRow => {
            const bestMatch = res.matches[0] ?? null;
            const proponerCrear = !bestMatch && Boolean(res.workerName?.trim());
            return {
              rowId: res.rowId,
              clientFileId: res.clientFileId,
              procesando: false,
              detectedTipoId: res.detectedTipoId,
              detectedDocTypeLabel: res.detectedDocTypeLabel,
              expiryDate: res.expiryDate,
              issueDate: res.issueDate,
              paginaInicio: res.paginaInicio,
              workerName: res.workerName,
              workerRut: res.workerRut,
              // Los firmantes de un documento colectivo también se proponen
              // para crear: muchas veces esa declaración es la primera vez que
              // la persona aparece. El resguardo no es bloquearlo sino que se
              // vea — el panel previo al guardado marca a quién se crearía y
              // desde qué archivo.
              workerId: fixedWorker?.id
                ?? bestMatch?.workerId
                // Un firmante ajeno a la carpeta no se propone para crear:
                // el archivo está mal archivado y eso lo decide una persona.
                ?? (proponerCrear && !res.ajenoAlLote ? CREAR_NUEVO : null),
              nuevoNombre: res.workerName ? formatearNombre(res.workerName) : "",
              nuevoRut: res.workerRut ?? "",
              confidence: res.confidence,
              reasoning: res.reasoning,
              error: res.error,
              grupoId: res.grupoId ?? null,
              firmantes: res.firmantes ?? null,
              ajenoAlLote: res.ajenoAlLote,
              empleadorNombre: res.empleadorNombre,
              empleadorRut: res.empleadorRut,
              cargoContrato: res.cargoContrato,
              rutDeCedula: res.rutDeCedula,
              // El documento dice que no vence: no hay fecha que pedir.
              sinVencimiento: res.sinVencimiento,
              expiryCalculada: res.expiryCalculada,
              titularHeredado: res.titularHeredado,
            };
          }),
        ]);
      } catch (e) {
        setGlobalError(`Error al procesar: ${(e as Error).message}`);
        setRows(prev => prev.filter(r => !r.procesando));
      }
    });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }

  /**
   * Traduce lo elegido en el select. Las opciones `__nuevo__:Nombre` son
   * personas que todavía no existen en la base pero que este lote va a
   * crear: se resuelven a CREAR_NUEVO con ese nombre, así todos sus
   * documentos terminan en una sola ficha.
   */
  function elegirTrabajador(rowId: string, valor: string) {
    if (valor.startsWith(NUEVO_PREFIX)) {
      const nombre = valor.slice(NUEVO_PREFIX.length);
      const persona = personasNuevas.find(p => p.nombre === nombre);
      updateRow(rowId, {
        workerId: CREAR_NUEVO,
        nuevoNombre: nombre,
        nuevoRut: persona?.rut ?? "",
      });
      return;
    }
    updateRow(rowId, { workerId: valor || null });
  }

  function updateRow(rowId: string, changes: Partial<EditableRow>) {
    setRows(prev => prev.map(r => r.rowId === rowId ? { ...r, ...changes } : r));
  }

  function removeRow(rowId: string) {
    setRows(prev => prev.filter(r => r.rowId !== rowId));
  }

  function resetAll() {
    archivos.forEach(a => URL.revokeObjectURL(a.fileUrl));
    setArchivos([]);
    setRows([]);
    setApplyResult(null);
    setGlobalError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Grupos: filas que apuntan al mismo documento ──────────────────
  const activas = rows.filter(r => !r.procesando && !r.applied);
  const accionDe = (grupoId: string): AccionGrupo => accionGrupo[grupoId] ?? "combinar";
  /** La primera fila del grupo es la que se guarda; el resto son sus hojas. */
  const esPrincipal = (r: EditableRow) =>
    !r.grupoId || activas.find(x => x.grupoId === r.grupoId)?.rowId === r.rowId;
  const esHoja = (r: EditableRow) =>
    Boolean(r.grupoId) && accionDe(r.grupoId!) === "combinar" && !esPrincipal(r);

  const gruposDuplicados = [...new Set(activas.map(r => r.grupoId).filter((g): g is string => Boolean(g)))]
    .map(grupoId => ({
      grupoId,
      filas: activas.filter(r => r.grupoId === grupoId),
      accion: accionDe(grupoId),
    }));

  /**
   * Personas que este lote va a crear. Se ofrecen en el select de cada fila
   * para poder mandarle un documento a alguien que todavía no existe en la
   * base — antes había que crearlo primero y volver a subir.
   */
  const { lista: personasNuevas, porFila: nombreCanonicoDeFila } = (() => {
    const candidatas = activas.filter(r => r.workerId === CREAR_NUEVO && r.nuevoNombre.trim());
    // Se agrupa con el MISMO criterio que usa el guardado. Antes esta lista
    // deduplicaba por texto exacto, así que mostraba "Walter Garrido",
    // "Walter Garrido Morales" y "Walter Antonio Garrido Morales" como tres
    // personas cuando el guardado iba a crear una sola. La lista tiene que
    // decir la verdad sobre lo que va a pasar.
    const grupos = agruparPorPersona(
      candidatas.map(r => ({ nombre: r.nuevoNombre.trim(), rut: r.nuevoRut.trim() || null })),
    ).map(g => ({
      nombre: g.variantes.length > 0 ? formatearNombre(nombreMasProbable(g.variantes)) : g.nombre,
      rut: g.rut ?? "",
      variantes: g.variantes.length > 0 ? g.variantes : [g.nombre],
    }));

    // Cada fila tiene que saber con qué nombre quedó su grupo. El select
    // ofrece el canónico —"Marco Antonio Flores Araya"— y la fila guarda el
    // suyo —"Marco Flores"—: si busca el propio no encuentra la opción, y el
    // navegador cae en la primera, que dice "Sin asignar". La fila se iba a
    // crear igual, pero la pantalla decía lo contrario.
    const porFila = new Map<string, string>();
    for (const r of candidatas) {
      const suyo = r.nuevoNombre.trim();
      const grupo = grupos.find(g => g.variantes.includes(suyo) || g.nombre === suyo)
        ?? grupos.find(g => g.rut && g.rut === r.nuevoRut.trim());
      if (grupo) porFila.set(r.rowId, grupo.nombre);
    }

    return { lista: grupos.map(({ nombre, rut }) => ({ nombre, rut })), porFila };
  })();

  /** Por qué una fila no entra en el guardado. */
  const motivoBloqueo = (r: EditableRow): string | null => {
    if (r.procesando || r.applied || r.error) return null;
    if (!r.detectedTipoId) return "Falta elegir el tipo de documento";
    if (necesitaFecha(r.detectedTipoId) && !r.expiryDate && !r.sinVencimiento) {
      return "Falta la fecha de vencimiento";
    }
    if (r.workerId === CREAR_NUEVO && !r.nuevoNombre.trim()) return "Falta el nombre del trabajador nuevo";
    if (r.workerId !== CREAR_NUEVO && !r.workerId) return "Falta asignarlo a un trabajador";
    return null;
  };

  const readyRows = rows.filter(r =>
    !r.procesando && !r.applied && !r.error &&
    r.detectedTipoId &&
    (necesitaFecha(r.detectedTipoId) ? Boolean(r.expiryDate) || Boolean(r.sinVencimiento) : true) &&
    (r.workerId === CREAR_NUEVO ? Boolean(r.nuevoNombre.trim()) : Boolean(r.workerId)) &&
    // Las hojas de un grupo combinado no se guardan aparte: viajan como
    // archivos adicionales de su fila principal.
    !esHoja(r)
  );

  const bloqueadas = rows
    .filter(r => !esHoja(r))
    .map(row => ({ row, motivo: motivoBloqueo(row) }))
    .filter((x): x is { row: EditableRow; motivo: string } => x.motivo !== null);

  /** Se resuelve con un clic: el documento existe, solo no trae fecha. */
  const sinFecha = bloqueadas.filter(x => x.motivo.startsWith("Falta la fecha")).map(x => x.row);
  /** Necesita que alguien complete un dato antes de poder guardarse. */
  const faltaDato = bloqueadas.filter(x => !x.motivo.startsWith("Falta la fecha"));

  const filasNuevas = readyRows.filter(r => r.workerId === CREAR_NUEVO);
  const grupos = agruparPorPersona(
    filasNuevas.map(r => ({ nombre: r.nuevoNombre.trim(), rut: r.nuevoRut.trim() || null })),
  );
  const aCrear = grupos.length;

  /**
   * Unifica todas las filas nuevas bajo una misma persona.
   * Escape para cuando los documentos traen el nombre tan distinto que
   * el agrupamiento automático no los junta.
   */
  function unificarPersona() {
    const candidatas = rows.filter(r => !r.procesando && !r.applied && r.workerId === CREAR_NUEVO);
    if (candidatas.length === 0) return;
    // El nombre más largo suele ser el completo; el RUT, el primero que aparezca
    const nombre = candidatas.reduce((mejor, r) =>
      r.nuevoNombre.trim().length > mejor.length ? r.nuevoNombre.trim() : mejor, "");
    const rut = candidatas.find(r => r.nuevoRut.trim())?.nuevoRut.trim() ?? "";
    setRows(prev => prev.map(r =>
      (!r.procesando && !r.applied && r.workerId === CREAR_NUEVO)
        ? { ...r, nuevoNombre: nombre, nuevoRut: rut }
        : r
    ));
  }

  /** Asigna todas las filas nuevas a un trabajador que ya existe. */
  function asignarTodasA(workerId: string) {
    if (!workerId) return;
    setRows(prev => prev.map(r =>
      (!r.procesando && !r.applied) ? { ...r, workerId } : r
    ));
  }

  function handleApply() {
    if (readyRows.length === 0) return;
    startTransition(async () => {
      const result = await applyExtractionsAction(
        readyRows.map(r => ({
          workerId: r.workerId === CREAR_NUEVO ? null : r.workerId,
          nuevoTrabajador: r.workerId === CREAR_NUEVO
            ? { nombre: r.nuevoNombre.trim(), rut: r.nuevoRut.trim() || null }
            : null,
          tipoDocumentoId: r.detectedTipoId!,
          confidence: r.confidence,
          expiryDate: necesitaFecha(r.detectedTipoId) && !r.sinVencimiento ? r.expiryDate : null,
          sinVencimiento: Boolean(r.sinVencimiento),
          issueDate: r.issueDate,
          vencimientoCalculado: Boolean(r.expiryCalculada),
          empleadorNombre: r.empleadorNombre ?? null,
          empleadorRut: r.empleadorRut ?? null,
          cargoContrato: r.cargoContrato ?? null,
          archivo: (() => {
            const a = infoDe(r.clientFileId);
            return a ? { clientFileId: a.clientFileId, fileName: a.fileName, mimeType: a.mimeType, base64: a.base64 } : null;
          })(),
          archivosExtra: r.grupoId && accionDe(r.grupoId) === "combinar"
            ? activas
                .filter(x => x.grupoId === r.grupoId && x.rowId !== r.rowId)
                .map(x => infoDe(x.clientFileId))
                .filter((a): a is ArchivoInfo => Boolean(a))
                .map(a => ({ clientFileId: a.clientFileId, fileName: a.fileName, mimeType: a.mimeType, base64: a.base64 }))
            : [],
        })),
        { proyectoId: proyectoNuevo || null, cargoId: cargoNuevo || null },
      );
      const appliedIds = new Set(readyRows.map(r => r.rowId));
      setRows(prev => prev.map(r => appliedIds.has(r.rowId) ? { ...r, applied: true } : r));
      setApplyResult({ applied: result.applied, creados: result.creados.length, errors: result.errors.length });
    });
  }

  const totalDocs = rows.filter(r => !r.procesando).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,image/*"
        style={{ display: "none" }}
        onChange={e => e.target.files && handleFiles(e.target.files)}
      />
      <div
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragEnter={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onClick={() => !apiKeyMissing && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--teal)" : "#cbd5e1"}`,
          borderRadius: 16,
          padding: "40px 24px",
          textAlign: "center",
          cursor: apiKeyMissing ? "not-allowed" : "pointer",
          background: apiKeyMissing ? "#f8fafc" : dragging ? "#f0fdf4" : "#fafbfc",
          opacity: apiKeyMissing ? 0.6 : 1,
          transition: "all 0.15s",
        }}
      >
        <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>📄</div>
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "#475569" }}>
          {apiKeyMissing
            ? "OPENAI_API_KEY no configurada"
            : dragging ? "Suelta aquí" : "Arrastra PDFs o fotos, o haz clic para elegir"}
        </div>
        <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginTop: 6 }}>
          PDF, Word, JPG, PNG, WEBP — varios a la vez · hasta {MAX_FILE_MB} MB cada uno
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 4 }}>
          Un PDF con la carpeta completa se separa en sus documentos automáticamente
        </div>
      </div>

      {globalError && <div className="alert error">{globalError}</div>}

      {applyResult && (
        <div className="alert success">
          ✅ Se guardaron <strong>{applyResult.applied}</strong> documento{applyResult.applied !== 1 ? "s" : ""}
          {applyResult.creados > 0 && <> · se crearon <strong>{applyResult.creados}</strong> trabajador{applyResult.creados !== 1 ? "es" : ""}</>}
          {applyResult.errors > 0 && <> · {applyResult.errors} error(es)</>}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ fontWeight: 700 }}>
              {archivos.length} archivo{archivos.length !== 1 ? "s" : ""} ·{" "}
              {totalDocs} documento{totalDocs !== 1 ? "s" : ""} detectado{totalDocs !== 1 ? "s" : ""} ·{" "}
              <span style={{ color: "#166534" }}>{readyRows.length} listo{readyRows.length !== 1 ? "s" : ""}</span>
            </div>
            <button
              type="button"
              onClick={resetAll}
              className="plano"
              style={{ border: "1px solid var(--border)", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem" }}
            >
              🗑 Limpiar todo
            </button>
          </div>

          {/* Variantes de nombre leídas: delatan un OCR dudoso */}
          {grupos.some(g => new Set(g.variantes.map(v => v.toLowerCase())).size > 1) && (
            <div style={{ padding: "10px 14px", borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe", fontSize: "0.82rem", color: "#1e40af" }}>
              📖 Los documentos escriben el nombre de formas distintas. Se eligió el que más se repite,
              pero conviene revisarlo:
              <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                {grupos
                  .filter(g => new Set(g.variantes.map(v => v.toLowerCase())).size > 1)
                  .map((g, i) => (
                    <li key={i}>
                      <strong>{g.nombre}</strong>
                      <span style={{ opacity: 0.8 }}> — se leyó también como: {
                        Array.from(new Set(g.variantes))
                          .filter(v => v.toLowerCase() !== g.nombre.toLowerCase())
                          .join(" · ")
                      }</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {/* Control de agrupación por persona */}
          {aCrear > 0 && !fixedWorker && (cargos.length > 0 || proyectosMandante.length > 0) && (
            <div style={{ border: "1px solid #93c5fd", background: "#eff6ff", borderRadius: 12, padding: "14px 18px" }}>
              <strong style={{ color: "#1e40af", fontSize: "0.9rem" }}>
                ¿Dónde entran {aCrear === 1 ? "el trabajador nuevo" : `los ${aCrear} trabajadores nuevos`}?
              </strong>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
                <div style={{ minWidth: 240 }}>
                  <label style={{ fontSize: "0.78rem", color: "#1e40af" }}>Proyecto de acreditación</label>
                  <select
                    value={proyectoNuevo}
                    onChange={e => setProyectoNuevo(e.target.value)}
                    style={{ padding: "6px 10px", fontSize: "0.84rem", width: "100%" }}
                  >
                    <option value="">Sin proyecto</option>
                    {proyectosMandante.map(p => (
                      <option key={p.id} value={p.id}>{p.mandanteNombre} — {p.nombre}</option>
                    ))}
                  </select>
                </div>
                <div style={{ minWidth: 220 }}>
                  <label style={{ fontSize: "0.78rem", color: "#1e40af" }}>Grupo de dotación</label>
                  <select
                    value={cargoNuevo}
                    onChange={e => setCargoNuevo(e.target.value)}
                    style={{
                      padding: "6px 10px", fontSize: "0.84rem", width: "100%",
                      border: cargoNuevo ? "1px solid var(--border)" : "1.5px solid #f59e0b",
                    }}
                  >
                    <option value="">Elegir cargo…</option>
                    {cargos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ fontSize: "0.78rem", color: "#1e40af", marginTop: 8 }}>
                Los requisitos de contratación de NOMADE se aplican siempre, sin importar el
                proyecto. Sin cargo no se puede calcular qué documentos le corresponden, así que
                la persona queda «sin matriz» hasta que se lo asignes en su ficha.
              </div>
            </div>
          )}

          {aCrear > 0 && (
            <div style={{
              padding: "12px 14px", borderRadius: 10,
              background: aCrear > 1 ? "#fef3c7" : "#f0fdf4",
              border: `1px solid ${aCrear > 1 ? "#fde68a" : "#86efac"}`,
              display: "flex", justifyContent: "space-between", alignItems: "center",
              gap: 12, flexWrap: "wrap",
            }}>
              <div style={{ fontSize: "0.85rem", color: aCrear > 1 ? "#854d0e" : "#166534" }}>
                {aCrear === 1 ? (
                  <>✓ Se va a crear <strong>1 trabajador</strong>: {grupos[0]?.nombre}</>
                ) : (
                  <>
                    ⚠️ Se van a crear <strong>{aCrear} trabajadores distintos</strong>
                    {/* El nombre solo no alcanza para decidir: hay que ver de qué
                        archivo salió cada persona. Una carpeta suele traer
                        plantillas en blanco o certificados de otro trabajador, y
                        esos crean fichas que nadie pidió. */}
                    <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
                      {grupos.map(g => {
                        const archivos = [...new Set(
                          g.indices
                            .map(i => filasNuevas[i])
                            .filter(Boolean)
                            .map(r => infoDe(r.clientFileId)?.fileName ?? "archivo"),
                        )];
                        return (
                          <div key={g.clave} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                            <strong style={{ fontSize: "0.85rem" }}>{g.nombre || "(sin nombre)"}</strong>
                            {g.rut && <span style={{ fontSize: "0.75rem" }}>{g.rut}</span>}
                            <span style={{ fontSize: "0.75rem", opacity: 0.85 }}>
                              ← {archivos.slice(0, 3).join(", ")}
                              {archivos.length > 3 && ` y ${archivos.length - 3} más`}
                            </span>
                            {/* Alguien que solo firma un documento colectivo puede
                                ser de otra cuadrilla: la firma prueba que estuvo,
                                no que se le esté armando la carpeta. */}
                            {g.indices.every(i => filasNuevas[i]?.firmantes) && (
                              <span style={{ background: "#dbeafe", color: "#1e40af", borderRadius: 4, padding: "1px 6px", fontSize: "0.68rem", fontWeight: 700 }}>
                                solo firma un documento colectivo
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: "0.78rem", marginTop: 6, opacity: 0.9 }}>
                      Revisa de qué archivo salió cada una. Si son la misma persona escrita
                      distinto, unifícalas; si un archivo es de otro trabajador o una plantilla
                      en blanco, descarta esa fila con la ✕.
                    </div>
                  </>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {aCrear > 1 && (
                  <button
                    type="button"
                    onClick={unificarPersona}
                    style={{ background: "#854d0e", color: "#fff", border: "none", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: "0.82rem", fontWeight: 700 }}
                  >
                    👤 Es la misma persona
                  </button>
                )}
                {workers.length > 0 && (
                  <select
                    defaultValue=""
                    onChange={e => { asignarTodasA(e.target.value); e.currentTarget.value = ""; }}
                    style={{ padding: "6px 10px", fontSize: "0.82rem", maxWidth: 220 }}
                  >
                    <option value="">Asignar todo a un existente…</option>
                    {workers.map(w => (
                      <option key={w.id} value={w.id}>
                        {w.fullName}{w.nationalId ? ` · ${w.nationalId}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          {gruposDuplicados.length > 0 && (
            <div style={{ border: "1px solid #93c5fd", background: "#eff6ff", borderRadius: 12, padding: "14px 18px", display: "grid", gap: 12 }}>
              <div>
                <strong style={{ color: "#1e40af" }}>
                  {gruposDuplicados.length} documento{gruposDuplicados.length === 1 ? "" : "s"} aparece{gruposDuplicados.length === 1 ? "" : "n"} más de una vez
                </strong>
                <div style={{ color: "#1e40af", fontSize: "0.82rem", marginTop: 2 }}>
                  Suele pasar cuando la cédula se sube por sus dos caras o la ficha de ingreso hoja
                  por hoja. Por defecto se combinan en un solo documento y se guardan todas las
                  imágenes; si de verdad son documentos distintos, sepáralos.
                </div>
              </div>
              {gruposDuplicados.map(g => {
                const principal = g.filas[0];
                return (
                  <div key={g.grupoId} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid #bfdbfe", paddingTop: 10 }}>
                    <strong style={{ fontSize: "0.85rem", color: "#1e3a8a" }}>
                      {principal.detectedDocTypeLabel}
                    </strong>
                    <span style={{ color: "#1e40af", fontSize: "0.78rem" }}>
                      {principal.nuevoNombre.trim() || principal.workerName || "sin titular"} ·{" "}
                      {g.filas.map(f => infoDe(f.clientFileId)?.fileName ?? "archivo").join(" + ")}
                    </span>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      {([["combinar", "Combinar en uno"], ["separar", "Mantener separados"]] as const).map(([valor, etiqueta]) => (
                        <button
                          key={valor}
                          type="button"
                          onClick={() => setAccionGrupo(prev => ({ ...prev, [g.grupoId]: valor }))}
                          style={{
                            padding: "4px 12px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700,
                            cursor: "pointer",
                            border: g.accion === valor ? "1px solid #2563eb" : "1px solid #cbd5e1",
                            background: g.accion === valor ? "#2563eb" : "white",
                            color: g.accion === valor ? "white" : "#475569",
                          }}
                        >
                          {etiqueta}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "2px solid var(--border)" }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", width: 56 }}></th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", minWidth: 170 }}>Origen</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>Confianza</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", minWidth: 210 }}>Trabajador</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", minWidth: 170 }}>Tipo de documento</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>Emisión</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>Vencimiento</th>
                    <th style={{ padding: "10px 12px", width: 34 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const info = infoDe(row.clientFileId);
                    const conf = CONFIDENCE_STYLE[row.confidence];
                    const tipo = tipoDe(row.detectedTipoId);
                    const pideFecha = necesitaFecha(row.detectedTipoId);
                    // Un vencimiento en el pasado suele significar que la IA
                    // tomó la fecha de emisión por la de caducidad.
                    const yaVencido = Boolean(
                      row.expiryDate && new Date(row.expiryDate + "T12:00:00") < new Date()
                    );
                    const diasVigencia = tipo?.vigenciaDias ?? null;
                    const listo = !row.procesando && !row.applied && !row.error
                      && row.detectedTipoId
                      && (pideFecha ? row.expiryDate : true)
                      && (row.workerId === CREAR_NUEVO ? row.nuevoNombre.trim() : row.workerId);

                    return (
                      <tr key={row.rowId} style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: row.applied ? "#f0fdf4" : row.error ? "#fef2f2" : esHoja(row) ? "#f8fafc" : undefined,
                        // Las hojas de un documento combinado se ven atenuadas:
                        // están, se guardan, pero no son una fila propia.
                        opacity: esHoja(row) ? 0.6 : 1,
                        borderLeft: row.grupoId ? "3px solid #60a5fa" : undefined,
                      }}>
                        <td style={{ padding: "8px 12px" }}>
                          {info && (
                            <a href={info.fileUrl} target="_blank" rel="noreferrer" title="Ver el archivo original">
                              {info.esPdf ? (
                                <div style={{ width: 40, height: 40, borderRadius: 6, background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem", cursor: "pointer" }}>
                                  📕
                                </div>
                              ) : info.mimeType === MIME_DOCX ? (
                                // Word no se previsualiza en el navegador: el enlace lo descarga.
                                <div style={{ width: 40, height: 40, borderRadius: 6, background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem", cursor: "pointer" }}>
                                  📘
                                </div>
                              ) : (
                                <img src={info.fileUrl} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer" }} />
                              )}
                            </a>
                          )}
                        </td>

                        <td style={{ padding: "8px 12px" }}>
                          <div style={{ fontWeight: 600, fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 190 }}>
                            {info?.fileName}
                          </div>
                          {row.paginaInicio && (
                            <div style={{ color: "var(--muted)", fontSize: "0.72rem" }}>página {row.paginaInicio}</div>
                          )}
                          {row.applied && <div style={{ color: "#166534", fontSize: "0.72rem", fontWeight: 700 }}>✓ Guardado</div>}
                          {row.error && <div style={{ color: "#991b1b", fontSize: "0.72rem" }}>❌ {row.error}</div>}
                          {row.reasoning && !row.error && (
                            <div style={{ color: "var(--muted)", fontSize: "0.7rem", marginTop: 2 }} title={row.reasoning}>
                              {row.reasoning.slice(0, 60)}{row.reasoning.length > 60 ? "…" : ""}
                            </div>
                          )}
                        </td>

                        <td style={{ padding: "8px 12px" }}>
                          {row.procesando ? (
                            <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>⏳</span>
                          ) : (
                            <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: conf.bg, color: conf.color }}>
                              {conf.label}
                            </span>
                          )}
                        </td>

                        <td style={{ padding: "8px 12px" }}>
                          {fixedWorker ? (
                            <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>{fixedWorker.fullName}</span>
                          ) : row.procesando ? (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          ) : (
                            <>
                              <select
                                value={
                                  row.workerId === CREAR_NUEVO && row.nuevoNombre.trim()
                                    ? `${NUEVO_PREFIX}${nombreCanonicoDeFila.get(row.rowId) ?? row.nuevoNombre.trim()}`
                                    : row.workerId ?? ""
                                }
                                onChange={e => elegirTrabajador(row.rowId, e.target.value)}
                                disabled={row.applied}
                                style={{ padding: "5px 8px", fontSize: "0.82rem", width: "100%", maxWidth: 250 }}
                              >
                                <option value="">— Sin asignar —</option>
                                <option value={CREAR_NUEVO}>➕ Crear trabajador nuevo</option>
                                {/* Los trabajadores que este mismo lote va a crear:
                                    sin esto había que guardarlos y volver a subir. */}
                                {personasNuevas.length > 0 && (
                                  <optgroup label="Se crean con esta carga">
                                    {personasNuevas.map(p => (
                                      <option key={`nuevo-${p.nombre}`} value={`${NUEVO_PREFIX}${p.nombre}`}>
                                        {p.nombre}{p.rut ? ` · ${p.rut}` : ""} (nuevo)
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <optgroup label="Trabajadores existentes">
                                  {workers.map(w => (
                                    <option key={w.id} value={w.id}>
                                      {w.fullName}{w.nationalId ? ` · ${w.nationalId}` : ""}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>

                              {row.workerId === CREAR_NUEVO && !row.applied && (
                                <div style={{ display: "grid", gap: 4, marginTop: 6, padding: 8, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8 }}>
                                  <input
                                    value={row.nuevoNombre}
                                    onChange={e => updateRow(row.rowId, { nuevoNombre: e.target.value })}
                                    placeholder="Nombre completo"
                                    style={{ padding: "5px 8px", fontSize: "0.8rem", width: "100%", boxSizing: "border-box" }}
                                  />
                                  <input
                                    value={row.nuevoRut}
                                    onChange={e => updateRow(row.rowId, { nuevoRut: e.target.value })}
                                    placeholder="RUT (opcional)"
                                    style={{ padding: "5px 8px", fontSize: "0.8rem", width: "100%", boxSizing: "border-box" }}
                                  />
                                  <div style={{ fontSize: "0.68rem", color: "#166534" }}>
                                    Los documentos con el mismo RUT se agrupan en un solo trabajador.
                                  </div>
                                </div>
                              )}

                              {row.workerName && row.workerId !== CREAR_NUEVO && (
                                <div style={{ color: "var(--muted)", fontSize: "0.72rem", marginTop: 2 }}>
                                  Detectado: {row.workerName}{row.workerRut && ` (${row.workerRut})`}
                                </div>
                              )}
                              {row.firmantes && (
                                <div style={{ color: "#0369a1", fontSize: "0.7rem", marginTop: 2, fontWeight: 600 }}>
                                  Documento colectivo: lo firman {row.firmantes} personas. El mismo
                                  archivo queda en la ficha de cada una.
                                </div>
                              )}
                              {row.rutDeCedula && (
                                <div style={{ color: "#991b1b", fontSize: "0.7rem", marginTop: 2, fontWeight: 700, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 5, padding: "3px 6px" }}>
                                  El RUT no calza con el de la cédula de esta carga ({row.rutDeCedula}).
                                  O está mal leído, o el archivo es de otra persona.
                                </div>
                              )}
                              {row.ajenoAlLote && (
                                <div style={{ color: "#92400e", fontSize: "0.7rem", marginTop: 2, fontWeight: 700, background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 5, padding: "3px 6px" }}>
                                  Ninguno de los firmantes es la persona del resto de la carpeta.
                                  Revisa si el archivo está guardado donde no corresponde.
                                </div>
                              )}
                              {row.titularHeredado && (
                                <div style={{ color: "#9a6300", fontSize: "0.7rem", marginTop: 2 }}>
                                  El archivo no traía titular: se tomó del resto del lote. Verifícalo.
                                </div>
                              )}
                              {esHoja(row) && (
                                <div style={{ color: "#1e40af", fontSize: "0.7rem", marginTop: 2, fontWeight: 600 }}>
                                  Se guarda como hoja adicional del mismo documento.
                                </div>
                              )}
                            </>
                          )}
                        </td>

                        <td style={{ padding: "8px 12px" }}>
                          {row.procesando ? (
                            <span style={{ color: "var(--muted)" }}>{row.detectedDocTypeLabel}</span>
                          ) : (
                            <SelectorTipo
                              tipos={docTypes}
                              valor={row.detectedTipoId}
                              disabled={row.applied}
                              onElegir={tipoId => updateRow(row.rowId, { detectedTipoId: tipoId })}
                            />
                          )}
                        </td>

                        <td style={{ padding: "8px 12px" }}>
                          {row.procesando ? (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          ) : tipo?.esFoto ? (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          ) : (
                            <input
                              type="date"
                              value={row.issueDate ?? ""}
                              onChange={e => updateRow(row.rowId, { issueDate: e.target.value || null })}
                              disabled={row.applied}
                              title="Fecha en que se emitió o realizó el documento"
                              style={{ padding: "4px 8px", fontSize: "0.82rem", width: 135 }}
                            />
                          )}
                        </td>

                        <td style={{ padding: "8px 12px" }}>
                          {row.procesando ? (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          ) : tipo?.esFoto ? (
                            <span style={{ fontSize: "0.78rem", color: "#0369a1", fontWeight: 600 }}>
                              Se guarda como foto
                            </span>
                          ) : !pideFecha || row.sinVencimiento ? (
                            <span style={{ fontSize: "0.78rem", color: "#0369a1", fontWeight: 600 }}>
                              ∞ No vence
                            </span>
                          ) : (
                            <>
                              <input
                                type="date"
                                value={row.expiryDate ?? ""}
                                onChange={e => updateRow(row.rowId, { expiryDate: e.target.value || null })}
                                disabled={row.applied}
                                style={{
                                  padding: "4px 8px", fontSize: "0.82rem", width: 135,
                                  border: yaVencido
                                    ? "1.5px solid #dc2626"
                                    : row.expiryDate ? "1px solid var(--border)" : "1.5px solid #f59e0b",
                                }}
                              />
                              {/* Dos avisos distintos, y confundirlos desorienta: si la
                                  fecha la leímos del papel y ya pasó, lo probable es que
                                  sea la de emisión mal clasificada. Si la calculamos
                                  nosotros, no hay nada que revisar en el documento — el
                                  certificado simplemente está viejo y hay que pedirlo
                                  de nuevo. */}
                              {yaVencido && !row.expiryCalculada && (
                                <div style={{ fontSize: "0.68rem", color: "#dc2626", marginTop: 3, maxWidth: 150, lineHeight: 1.3 }}>
                                  ⚠️ Fecha pasada. ¿Es de emisión y no de vencimiento?
                                </div>
                              )}
                              {row.expiryCalculada && (
                                <div style={{
                                  fontSize: "0.68rem", marginTop: 3, maxWidth: 150, lineHeight: 1.3,
                                  color: yaVencido ? "#dc2626" : "#0369a1",
                                }}>
                                  {yaVencido
                                    ? `Vencido. Esta fecha no está en el documento: son ${diasVigencia ?? "los"} días de vigencia desde la emisión, así que hay que pedir uno nuevo.`
                                    : `Calculado: ${diasVigencia ?? "los"} días desde la emisión. No venía impreso.`}
                                </div>
                              )}
                            </>
                          )}
                        </td>

                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
                          {!row.applied && !row.procesando && (
                            <button
                              type="button"
                              onClick={() => removeRow(row.rowId)}
                              title="Descartar esta fila"
                              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}
                            >
                              ✕
                            </button>
                          )}
                          {listo && <div style={{ color: "#16a34a", fontSize: "0.7rem", fontWeight: 700 }}>listo</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sin esto, una fila que no cumple los requisitos simplemente no entra
              en el contador y desaparece sin decir por qué: el usuario cree que
              subió el documento y en la ficha aparece como no cargado. */}
          {/* Dos avisos separados, porque piden cosas distintas: uno se
              resuelve aceptando, el otro exige completar un dato. Mezclarlos
              en una sola lista obligaba a leerla entera para saber qué hacer. */}
          {sinFecha.length > 0 && (
            <div style={{ border: "1px solid #f59e0b", background: "#fffbeb", borderRadius: 12, padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <strong style={{ color: "#92400e", flex: 1, minWidth: 260 }}>
                  {sinFecha.length} documento{sinFecha.length === 1 ? "" : "s"} sin fecha de vencimiento
                </strong>
                <button
                  type="button"
                  onClick={() => setRows(prev => prev.map(r =>
                    sinFecha.some(x => x.rowId === r.rowId) ? { ...r, sinVencimiento: true } : r))}
                  style={{ background: "#92400e", color: "white", border: "none", borderRadius: 8, padding: "6px 16px", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}
                >
                  Aceptar {sinFecha.length === 1 ? "" : "todos"}
                </button>
              </div>
              <div style={{ fontSize: "0.8rem", color: "#92400e", marginBottom: 10 }}>
                No la traen impresa y su tipo no tiene vigencia definida. Revísalos y acepta para
                guardarlos igual: queda anotado que la fecha está pendiente.
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {sinFecha.map(row => (
                  <div key={row.rowId} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: "0.82rem" }}>
                    <strong style={{ color: "#92400e" }}>{row.detectedDocTypeLabel}</strong>
                    <span style={{ color: "var(--muted)", flex: 1, minWidth: 120 }}>
                      {infoDe(row.clientFileId)?.fileName}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateRow(row.rowId, { sinVencimiento: true })}
                      style={{ flexShrink: 0, background: "white", color: "#92400e", border: "1px solid #f59e0b", borderRadius: 6, padding: "3px 12px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}
                    >
                      Aceptar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {faltaDato.length > 0 && (
            <div style={{ border: "1px solid #cbd5e1", background: "var(--surface, #f8fafc)", borderRadius: 12, padding: "14px 18px" }}>
              <strong style={{ color: "var(--text)" }}>
                {faltaDato.length} documento{faltaDato.length === 1 ? "" : "s"} sin guardar por datos incompletos
              </strong>
              <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
                {faltaDato.map(({ row, motivo }) => (
                  <div key={row.rowId} style={{ fontSize: "0.82rem", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <strong>{row.detectedDocTypeLabel}</strong>
                    <span style={{ color: "var(--muted)" }}>{infoDe(row.clientFileId)?.fileName}</span>
                    <span>— {motivo}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {readyRows.length > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={handleApply}
                disabled={isPending}
                style={{
                  padding: "10px 24px", borderRadius: 10,
                  background: isPending ? "#94a3b8" : "var(--teal)",
                  color: "#fff", fontWeight: 700, fontSize: "0.92rem",
                  border: "none", cursor: isPending ? "not-allowed" : "pointer",
                }}
              >
                {isPending
                  ? "Guardando…"
                  : `💾 Guardar ${readyRows.length} documento${readyRows.length !== 1 ? "s" : ""}` +
                    (aCrear > 0 ? ` · crear ${aCrear} trabajador${aCrear !== 1 ? "es" : ""}` : "")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

"use client";

import { useFormState, useFormStatus } from "react-dom";
import { toInputDateValue } from "@/lib/report-utils";
import { saveVehicleChecklistAction, type ActionState } from "./actions";
import {
  ESTADOS_NEUMATICO, ITEMS_COMUNES, plantillaPara,
} from "@/lib/checklist-vehiculos";

const initialState: ActionState = { error: "", success: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : "Registrar checklist"}</button>;
}

/**
 * Checklist de salida.
 *
 * Nada viene marcado. La versión anterior traía todo conforme por defecto y
 * decía "desmarca solo lo que esté con observación": un conductor apurado lo
 * enviaba sin mirar y quedaba registrado que las ruedas estaban bien. El
 * mandante encontró neumáticos desgastados en un vehículo con checklist
 * impecable, y ese es el problema que esta pantalla existe para evitar.
 */
export function VehicleChecklistForm({
  vehicleId, odometerKm, tipoVehiculo,
}: {
  vehicleId: string; odometerKm: number; tipoVehiculo: string;
}) {
  const [state, formAction] = useFormState(saveVehicleChecklistAction, initialState);
  const plantilla = plantillaPara(tipoVehiculo);

  const etiqueta: React.CSSProperties = {
    fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.03em", display: "block", marginBottom: 3,
  };

  return (
    <form action={formAction} className="grid two vehicle-form-grid">
      <input type="hidden" name="vehicleId" value={vehicleId} />

      <div>
        <label htmlFor="check-date">Fecha</label>
        <input id="check-date" name="date" type="date" defaultValue={toInputDateValue(new Date())} required />
      </div>
      <div>
        <label htmlFor="check-odometer">Kilometraje de salida</label>
        <input id="check-odometer" name="odometerKm" type="number" min={0} defaultValue={odometerKm} required />
      </div>
      <div>
        <label htmlFor="check-fuel">Combustible (%)</label>
        <input id="check-fuel" name="fuelPercent" type="number" min={0} max={100} required />
      </div>
      <div className="vehicle-inline-option">
        <label>
          <input type="checkbox" name="incidentReported" />
          Reporta incidente o novedad
        </label>
      </div>

      {/* ── Neumáticos ─────────────────────────────────────────────── */}
      <div style={{ gridColumn: "1 / -1" }}>
        <h3 style={{ margin: "6px 0 2px", fontSize: "1rem" }}>Neumáticos — medir con calibre de dibujo</h3>
        <div className="section-caption" style={{ marginBottom: 10 }}>
          Mínimo <strong>{plantilla.mmMinimo} mm</strong> en cada posición; bajo eso el vehículo{" "}
          <strong>no sale</strong>. Entre {plantilla.mmMinimo} y {plantilla.mmAviso} mm sale con
          observación. Sin medir no hay checklist válido.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
          {plantilla.posiciones.map((pos, i) => (
            <div key={pos} style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)" }}>
              <strong style={{ fontSize: "0.86rem", display: "block", marginBottom: 6 }}>{pos}</strong>
              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 8, alignItems: "end" }}>
                <div>
                  <label htmlFor={`neum-${i}-mm`} style={etiqueta}>mm</label>
                  <input id={`neum-${i}-mm`} name={`neum_${i}_mm`} type="number" step="0.5" min={0} max={30}
                         inputMode="decimal" required placeholder="0.0" style={{ padding: "6px 8px" }} />
                </div>
                <div>
                  <label htmlFor={`neum-${i}-estado`} style={etiqueta}>Estado</label>
                  <select id={`neum-${i}-estado`} name={`neum_${i}_estado`} required defaultValue="" style={{ padding: "6px 8px", fontSize: "0.85rem" }}>
                    <option value="" disabled>— elegir —</option>
                    {ESTADOS_NEUMATICO.map(e => <option key={e.valor} value={e.valor}>{e.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Ítems comunes ──────────────────────────────────────────── */}
      <div style={{ gridColumn: "1 / -1" }}>
        <h3 style={{ margin: "6px 0 2px", fontSize: "1rem" }}>Revisión general</h3>
        <div className="section-caption" style={{ marginBottom: 10 }}>
          Marca <strong>solo lo que revisaste y está conforme</strong>. Lo que quede sin marcar se
          registra como observación; los ítems críticos sin marcar dejan el vehículo no apto.
        </div>
        <div className="checklist-grid">
          {ITEMS_COMUNES.map(item => (
            <label key={item.clave} className="checklist-item" title={item.critico ? "Crítico: sin esto no sale" : undefined}>
              <input type="checkbox" name={item.clave} />
              <span>{item.label}{item.critico && <span style={{ color: "#dc2626", marginLeft: 4 }}>*</span>}</span>
            </label>
          ))}
        </div>
      </div>

      {/* ── Ítems del tipo ─────────────────────────────────────────── */}
      {plantilla.extras.length > 0 && (
        <div style={{ gridColumn: "1 / -1" }}>
          <h3 style={{ margin: "6px 0 8px", fontSize: "1rem" }}>Propios de {tipoVehiculo.toLowerCase()}</h3>
          <div className="checklist-grid">
            {plantilla.extras.map(item => (
              <label key={item.clave} className="checklist-item" title={item.critico ? "Crítico: sin esto no sale" : undefined}>
                <input type="checkbox" name={`extra_${item.clave}`} />
                <span>{item.label}{item.critico && <span style={{ color: "#dc2626", marginLeft: 4 }}>*</span>}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── Fotos ──────────────────────────────────────────────────── */}
      <div style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="check-fotos">Fotos del levantamiento</label>
        {/* capture="environment" abre la cámara trasera en el celular, que es
            donde se hace el checklist. En escritorio es un selector normal. */}
        <input id="check-fotos" name="fotos" type="file" accept="image/*" capture="environment" multiple
               style={{ padding: "8px" }} />
        <div className="section-caption" style={{ marginTop: 4 }}>
          Fotografía cualquier cosa que reportes: el neumático, el daño, el extintor vencido.
          Una descripción se discute; una foto no. Hasta 8 fotos de 8 MB.
        </div>
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="check-observations">Observaciones</label>
        <textarea id="check-observations" name="observations" placeholder="Daños, faltantes, ruidos, algo que el próximo conductor deba saber..." />
      </div>

      {state.error ? <div className="alert error" style={{ gridColumn: "1 / -1" }}>{state.error}</div> : null}
      {state.success ? <div className="alert success" style={{ gridColumn: "1 / -1" }}>{state.success}</div> : null}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gridColumn: "1 / -1", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
          <span style={{ color: "#dc2626" }}>*</span> crítico. El resultado lo calcula el sistema al guardar.
        </span>
        <SubmitButton />
      </div>
    </form>
  );
}

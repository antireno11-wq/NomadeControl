"use client";

import { useFormState, useFormStatus } from "react-dom";
import { toInputDateValue } from "@/lib/report-utils";
import { saveVehicleChecklistAction, type ActionState } from "./actions";

const initialState: ActionState = { error: "", success: "" };

const checklistItems = [
  { name: "frontLightsOk", label: "Luces delanteras" },
  { name: "rearLightsOk", label: "Luces traseras" },
  { name: "tiresOk", label: "Neumáticos" },
  { name: "brakesOk", label: "Frenos" },
  { name: "mirrorsOk", label: "Espejos" },
  { name: "hornOk", label: "Bocina" },
  { name: "fluidsOk", label: "Fluidos" },
  { name: "jackOk", label: "Gata" },
  { name: "spareTireOk", label: "Rueda de repuesto" },
  { name: "extinguisherOk", label: "Extintor" },
  { name: "documentsOk", label: "Documentos a bordo" },
  { name: "bodyworkOk", label: "Carrocería" },
  { name: "cleanlinessOk", label: "Limpieza" }
] as const;

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : "Registrar checklist"}</button>;
}

export function VehicleChecklistForm({ vehicleId, odometerKm }: { vehicleId: string; odometerKm: number }) {
  const [state, formAction] = useFormState(saveVehicleChecklistAction, initialState);

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
        <input id="check-fuel" name="fuelPercent" type="number" min={0} max={100} defaultValue={100} required />
      </div>
      <div className="vehicle-inline-option">
        <label>
          <input type="checkbox" name="incidentReported" />
          Reporta incidente o novedad
        </label>
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <div className="section-caption" style={{ marginBottom: 10 }}>
          Desmarca solo lo que esté con observación. Lo marcado se considera conforme.
        </div>
        <div className="checklist-grid">
          {checklistItems.map((item) => (
            <label key={item.name} className="checklist-item">
              <input type="checkbox" name={item.name} defaultChecked />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="check-observations">Observaciones</label>
        <textarea id="check-observations" name="observations" placeholder="Daños, faltantes, mantenciones, documentos próximos a vencer..." />
      </div>

      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.success ? <div className="alert success">{state.success}</div> : null}

      <div style={{ display: "flex", justifyContent: "flex-end", gridColumn: "1 / -1" }}>
        <SubmitButton />
      </div>
    </form>
  );
}

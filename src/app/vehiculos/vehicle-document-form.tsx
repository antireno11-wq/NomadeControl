"use client";

import { useFormState, useFormStatus } from "react-dom";
import { addVehicleDocumentAction, type ActionState } from "./actions";

const initialState: ActionState = { error: "", success: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : "Agregar documento"}</button>;
}

export function VehicleDocumentForm({ vehicleId }: { vehicleId: string }) {
  const [state, formAction] = useFormState(addVehicleDocumentAction, initialState);

  return (
    <form action={formAction} className="grid two vehicle-form-grid">
      <input type="hidden" name="vehicleId" value={vehicleId} />

      <div>
        <label htmlFor="document-type">Tipo documental</label>
        <select id="document-type" name="documentType" defaultValue="DECRETO_80">
          <option value="DECRETO_80">Decreto 80</option>
          <option value="BARRA_INTERIOR">Barra interior</option>
          <option value="BARRA_EXTERIOR">Barra exterior</option>
          <option value="REVISION_TECNICA">Revisión técnica adicional</option>
          <option value="SOAP">SOAP adicional</option>
          <option value="PERMISO_CIRCULACION">Permiso circulación adicional</option>
          <option value="OTRO">Otro</option>
        </select>
      </div>
      <div>
        <label htmlFor="document-name">Documento</label>
        <input id="document-name" name="name" placeholder="Póliza especial, revisión GPS..." required />
      </div>
      <div>
        <label htmlFor="document-number">Número</label>
        <input id="document-number" name="number" />
      </div>
      <div>
        <label htmlFor="document-issuer">Emisor</label>
        <input id="document-issuer" name="issuer" />
      </div>
      <div>
        <label htmlFor="document-alert">Avisar antes (días)</label>
        <input id="document-alert" name="alertDays" type="number" min={1} max={365} defaultValue={30} required />
      </div>
      <div>
        <label htmlFor="document-issued">Emitido el</label>
        <input id="document-issued" name="issuedAt" type="date" />
      </div>
      <div>
        <label htmlFor="document-expires">Vence el</label>
        <input id="document-expires" name="expiresAt" type="date" required />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="document-notes">Observaciones</label>
        <textarea id="document-notes" name="notes" placeholder="Proveedor, cobertura, recordatorios..." />
      </div>

      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.success ? <div className="alert success">{state.success}</div> : null}

      <div style={{ display: "flex", justifyContent: "flex-end", gridColumn: "1 / -1" }}>
        <SubmitButton />
      </div>
    </form>
  );
}

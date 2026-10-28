"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { addVehicleDocumentAction, type ActionState } from "./actions";

const initialState: ActionState = { error: "", success: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : "Agregar documento"}</button>;
}

export function VehicleDocumentForm({ vehicleId }: { vehicleId: string }) {
  const [state, formAction] = useFormState(addVehicleDocumentAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Se limpia al guardar: con el archivo todavía seleccionado, un segundo
  // clic subía el mismo documento dos veces.
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="grid two vehicle-form-grid">
      <input type="hidden" name="vehicleId" value={vehicleId} />

      <div>
        <label htmlFor="document-type">Tipo documental</label>
        <select id="document-type" name="documentType" defaultValue="REVISION_TECNICA">
          <option value="REVISION_TECNICA">Revisión técnica</option>
          <option value="SOAP">SOAP</option>
          <option value="PERMISO_CIRCULACION">Permiso de circulación</option>
          <option value="SEGURO">Seguro</option>
          <option value="EXTINTOR">Extintor</option>
          <option value="DECRETO_80">Decreto 80</option>
          <option value="BARRA_INTERIOR">Barra interior</option>
          <option value="BARRA_EXTERIOR">Barra exterior</option>
          <option value="OTRO">Otro</option>
        </select>
      </div>
      <div>
        <label htmlFor="document-name">Nombre (solo si es «Otro»)</label>
        <input id="document-name" name="name" placeholder="Póliza especial, revisión GPS..." />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="document-file">Archivo (PDF o foto)</label>
        <input id="document-file" name="archivo" type="file" accept="application/pdf,image/*" />
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

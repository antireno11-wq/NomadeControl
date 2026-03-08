"use client";

import { useFormState, useFormStatus } from "react-dom";
import { saveStockMovementAction, type StockFormState } from "./actions";

type CampOption = { id: string; name: string };

const initialState: StockFormState = { error: "", success: "" };

function SaveButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : "Guardar movimiento"}</button>;
}

export function MovementForm({ camps, defaultDate }: { camps: CampOption[]; defaultDate: string }) {
  const [state, formAction] = useFormState(saveStockMovementAction, initialState);

  return (
    <form action={formAction} className="card grid">
      <h2 style={{ margin: 0 }}>Movimiento de bodega</h2>
      <div className="grid two">
        <div>
          <label htmlFor="date">Fecha</label>
          <input id="date" name="date" type="date" defaultValue={defaultDate} required />
        </div>
        <div>
          <label htmlFor="campId">Campamento</label>
          <select id="campId" name="campId" required>
            {camps.map((camp) => (
              <option key={camp.id} value={camp.id}>
                {camp.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="movementType">Tipo</label>
          <select id="movementType" name="movementType" defaultValue="SALIDA">
            <option value="SALIDA">SALIDA</option>
            <option value="INGRESO">INGRESO</option>
          </select>
        </div>
        <div>
          <label htmlFor="itemName">Ítem</label>
          <input id="itemName" name="itemName" placeholder="Ej: Arroz, Aceite, Gas..." required />
        </div>
        <div>
          <label htmlFor="quantity">Cantidad</label>
          <input id="quantity" name="quantity" type="number" min={0.01} step="0.01" required />
        </div>
        <div>
          <label htmlFor="unit">Unidad</label>
          <input id="unit" name="unit" defaultValue="unidad" required />
        </div>
      </div>
      <div>
        <label htmlFor="notes">Observaciones</label>
        <textarea id="notes" name="notes" placeholder="Detalle opcional..." />
      </div>

      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.success ? <div className="alert success">{state.success}</div> : null}
      <SaveButton />
    </form>
  );
}

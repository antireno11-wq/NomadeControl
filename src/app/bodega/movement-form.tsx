"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { saveStockMovementAction, type StockFormState } from "./actions";

type CampOption = { id: string; name: string };
type InventoryItemOption = { id: string; name: string; unit: string; category: string };

const initialState: StockFormState = { error: "", success: "" };

function SaveButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : "Guardar movimiento"}</button>;
}

export function MovementForm({
  camps,
  inventoryItems,
  defaultDate
}: {
  camps: CampOption[];
  inventoryItems: InventoryItemOption[];
  defaultDate: string;
}) {
  const [state, formAction] = useFormState(saveStockMovementAction, initialState);
  const groupedItems = inventoryItems.reduce<Record<string, InventoryItemOption[]>>((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {});
  const categories = Object.keys(groupedItems).sort((a, b) => a.localeCompare(b, "es"));

  return (
    <form action={formAction} className="card grid">
      <h2 style={{ margin: 0 }}>Movimiento de bodega</h2>
      <div style={{ marginTop: -6 }}>
        <Link href="/bodega/items/nuevo">+ Agregar item si no aparece en la lista</Link>
      </div>
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
          <label htmlFor="inventoryItemId">Item</label>
          <select id="inventoryItemId" name="inventoryItemId" required defaultValue="">
            <option value="" disabled>
              Selecciona un item del catalogo...
            </option>
            {categories.map((category) => (
              <optgroup key={category} label={category}>
                {groupedItems[category].map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.unit})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="quantity">Cantidad</label>
          <input id="quantity" name="quantity" type="number" min={0.01} step="0.01" required />
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

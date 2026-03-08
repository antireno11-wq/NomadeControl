"use client";

import { useFormState, useFormStatus } from "react-dom";
import { saveInventoryItemAction, type InventoryItemFormState } from "@/app/bodega/actions";

type CampOption = { id: string; name: string };

const initialState: InventoryItemFormState = { error: "", success: "" };

function SaveButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : "Crear item"}</button>;
}

export function NewItemForm({
  camps,
  categories,
  defaultCampId,
  allowGlobal
}: {
  camps: CampOption[];
  categories: string[];
  defaultCampId: string;
  allowGlobal: boolean;
}) {
  const [state, formAction] = useFormState(saveInventoryItemAction, initialState);

  return (
    <form action={formAction} className="card grid" style={{ maxWidth: 760 }}>
      <h2 style={{ margin: 0 }}>Nuevo item de bodega</h2>
      <div className="grid two">
        <div>
          <label htmlFor="campId">Campamento</label>
          <select id="campId" name="campId" defaultValue={defaultCampId} required>
            {allowGlobal ? <option value="">Catalogo general (todos los campamentos)</option> : null}
            {camps.map((camp) => (
              <option key={camp.id} value={camp.id}>
                {camp.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="unit">Unidad</label>
          <input id="unit" name="unit" placeholder="unidad, caja, kilogramo, litro..." required />
        </div>
        <div>
          <label htmlFor="name">Nombre del item</label>
          <input id="name" name="name" placeholder="Ej: Arroz, Aceite vegetal..." required />
        </div>
        <div>
          <label htmlFor="category">Categoria</label>
          <select id="category" name="category" defaultValue="">
            <option value="">Seleccionar...</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="newCategory">Nueva categoria (opcional)</label>
        <input id="newCategory" name="newCategory" placeholder="Si no existe, escribe una nueva" />
      </div>

      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.success ? <div className="alert success">{state.success}</div> : null}
      <SaveButton />
    </form>
  );
}

"use client";

import { useFormState, useFormStatus } from "react-dom";
import { saveStaffMemberAction, type StaffFormState } from "./actions";

type CampOption = { id: string; name: string };

const initialState: StaffFormState = { error: "", success: "" };

function SaveButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : "Agregar personal"}</button>;
}

export function StaffForm({ camps, defaultDate }: { camps: CampOption[]; defaultDate: string }) {
  const [state, formAction] = useFormState(saveStaffMemberAction, initialState);

  return (
    <form action={formAction} className="card grid">
      <h2 style={{ margin: 0 }}>Configuración de turnos</h2>
      <div className="grid two">
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
          <label htmlFor="shiftPattern">Tipo de turno</label>
          <select id="shiftPattern" name="shiftPattern" defaultValue="14x14" required>
            <option value="14x14">14x14</option>
            <option value="10x10">10x10</option>
            <option value="7x7">7x7</option>
            <option value="4x3">4x3</option>
          </select>
        </div>
        <div>
          <label htmlFor="shiftStartDate">Inicio del ciclo</label>
          <input id="shiftStartDate" name="shiftStartDate" type="date" defaultValue={defaultDate} required />
        </div>
        <div>
          <label htmlFor="fullName">Nombre del trabajador</label>
          <input id="fullName" name="fullName" required />
        </div>
        <div>
          <label htmlFor="role">Cargo</label>
          <input id="role" name="role" placeholder="Cocinero, Mantencion, Aseo..." />
        </div>
      </div>

      <div>
        <label htmlFor="notes">Notas</label>
        <textarea id="notes" name="notes" placeholder="Observaciones del turno..." />
      </div>

      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.success ? <div className="alert success">{state.success}</div> : null}
      <SaveButton />
    </form>
  );
}

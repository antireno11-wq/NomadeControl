"use client";

import { useFormState, useFormStatus } from "react-dom";
import { saveReportAction } from "./actions";

type CampOption = {
  id: string;
  name: string;
};

const initialState = { error: "", success: "" };

function SaveButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : "Guardar reporte"}</button>;
}

export function ReportForm({ camps, defaultDate }: { camps: CampOption[]; defaultDate: string }) {
  const [state, formAction] = useFormState(saveReportAction, initialState);

  return (
    <form action={formAction} className="card grid">
      <h2 style={{ margin: 0 }}>Carga diaria</h2>

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
      </div>

      <div className="grid two">
        <div>
          <label htmlFor="peopleCount">Personas en campamento</label>
          <input id="peopleCount" name="peopleCount" type="number" min={0} defaultValue={0} required />
        </div>
        <div>
          <label htmlFor="breakfastCount">Desayunos entregados</label>
          <input id="breakfastCount" name="breakfastCount" type="number" min={0} defaultValue={0} required />
        </div>
      </div>

      <div className="grid two">
        <div>
          <label htmlFor="lunchCount">Almuerzos entregados</label>
          <input id="lunchCount" name="lunchCount" type="number" min={0} defaultValue={0} required />
        </div>
        <div>
          <label htmlFor="dinnerCount">Cenas entregadas</label>
          <input id="dinnerCount" name="dinnerCount" type="number" min={0} defaultValue={0} required />
        </div>
      </div>

      <div className="grid two">
        <div>
          <label htmlFor="waterLiters">Agua (litros)</label>
          <input id="waterLiters" name="waterLiters" type="number" min={0} defaultValue={0} required />
        </div>
        <div>
          <label htmlFor="fuelLiters">Combustible (litros)</label>
          <input id="fuelLiters" name="fuelLiters" type="number" min={0} defaultValue={0} required />
        </div>
      </div>

      <div>
        <label htmlFor="notes">Observaciones</label>
        <textarea id="notes" name="notes" placeholder="Novedades del día..." />
      </div>

      {state?.error ? <div className="alert error">{state.error}</div> : null}
      {state?.success ? <div className="alert success">{state.success}</div> : null}

      <SaveButton />
    </form>
  );
}

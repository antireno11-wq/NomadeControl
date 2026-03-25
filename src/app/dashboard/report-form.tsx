"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { saveReportAction } from "./actions";
import type { ReportFormState } from "./actions";

type CampOption = {
  id: string;
  name: string;
};

const initialState: ReportFormState = { error: "", success: "" };

function SaveButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : "Guardar reporte"}</button>;
}

export function ReportForm({ camps, defaultDate }: { camps: CampOption[]; defaultDate: string }) {
  const [state, formAction] = useFormState(saveReportAction, initialState);
  const [wasteFillPercent, setWasteFillPercent] = useState(0);

  return (
    <form action={formAction} className="card grid">
      <h2 style={{ margin: 0 }}>Informe diario</h2>

      <section className="report-section">
        <h3 className="section-title">Contexto Diario</h3>
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
            <label htmlFor="peopleCount">Personas en campamento</label>
            <input id="peopleCount" name="peopleCount" type="number" min={0} defaultValue={0} required />
          </div>
        </div>
      </section>

      <section className="report-section">
        <h3 className="section-title">Alimentación</h3>
        <div className="grid two">
          <div>
            <label htmlFor="breakfastCount">Desayunos entregados</label>
            <input id="breakfastCount" name="breakfastCount" type="number" min={0} defaultValue={0} required />
          </div>
          <div>
            <label htmlFor="lunchCount">Almuerzos entregados</label>
            <input id="lunchCount" name="lunchCount" type="number" min={0} defaultValue={0} required />
          </div>
          <div>
            <label htmlFor="dinnerCount">Cenas entregadas</label>
            <input id="dinnerCount" name="dinnerCount" type="number" min={0} defaultValue={0} required />
          </div>
          <div>
            <label htmlFor="snackSimpleCount">Colaciones simples</label>
            <input id="snackSimpleCount" name="snackSimpleCount" type="number" min={0} defaultValue={0} required />
          </div>
          <div>
            <label htmlFor="snackReplacementCount">Colaciones de reemplazo</label>
            <input
              id="snackReplacementCount"
              name="snackReplacementCount"
              type="number"
              min={0}
              defaultValue={0}
              required
            />
          </div>
          <div>
            <label htmlFor="waterBottleCount">Botellas de agua</label>
            <input id="waterBottleCount" name="waterBottleCount" type="number" min={0} defaultValue={0} required />
          </div>
        </div>
      </section>

      <section className="report-section">
        <h3 className="section-title">Alojamiento</h3>
        <div className="grid two">
          <div>
            <label htmlFor="lodgingCount">Alojamientos</label>
            <input id="lodgingCount" name="lodgingCount" type="number" min={0} defaultValue={0} required />
          </div>
        </div>
      </section>

      <section className="report-section">
        <h3 className="section-title">Recursos Operativos</h3>
        <div className="grid two">
          <div>
            <label htmlFor="meterReading">Lectura del medidor</label>
            <input id="meterReading" name="meterReading" type="number" min={0} step="0.01" defaultValue={0} required />
          </div>
          <div>
            <label htmlFor="waterLiters">Agua gastada (litros)</label>
            <input id="waterLiters" name="waterLiters" type="number" min={0} defaultValue={0} required />
          </div>
          <div>
            <label htmlFor="fuelLiters">Combustible (litros)</label>
            <input id="fuelLiters" name="fuelLiters" type="number" min={0} defaultValue={0} required />
          </div>
          <div>
            <label htmlFor="generator1Hours">Horómetro generador 1</label>
            <input id="generator1Hours" name="generator1Hours" type="number" min={0} step="0.01" defaultValue={0} required />
          </div>
          <div>
            <label htmlFor="generator2Hours">Horómetro generador 2</label>
            <input id="generator2Hours" name="generator2Hours" type="number" min={0} step="0.01" defaultValue={0} required />
          </div>
          <div>
            <label htmlFor="internetStatus">Status internet</label>
            <select id="internetStatus" name="internetStatus" defaultValue="FUNCIONANDO">
              <option value="FUNCIONANDO">Funcionando</option>
              <option value="CON_INTERRUPCIONES">Con interrupciones</option>
              <option value="NO_FUNCIONA">No funciona</option>
            </select>
          </div>
          <div>
            <label htmlFor="blackWaterRemoved">Retiro aguas negras realizado</label>
            <select id="blackWaterRemoved" name="blackWaterRemoved" defaultValue="NO">
              <option value="NO">No</option>
              <option value="SI">Si</option>
            </select>
          </div>
          <div>
            <label htmlFor="blackWaterRemovedM3">Aguas negras retiradas (m3)</label>
            <input id="blackWaterRemovedM3" name="blackWaterRemovedM3" type="number" min={0} step="0.01" defaultValue={0} required />
          </div>
          <div>
            <label htmlFor="potableWaterDelivered">Ingreso agua potable realizado</label>
            <select id="potableWaterDelivered" name="potableWaterDelivered" defaultValue="NO">
              <option value="NO">No</option>
              <option value="SI">Si</option>
            </select>
          </div>
          <div>
            <label htmlFor="potableWaterDeliveredM3">Agua potable ingresada (m3)</label>
            <input id="potableWaterDeliveredM3" name="potableWaterDeliveredM3" type="number" min={0} step="0.01" defaultValue={0} required />
          </div>
          <div>
            <label htmlFor="wasteFillPercent">Llenado contenedor basura ({wasteFillPercent}%)</label>
            <input
              id="wasteFillPercent"
              name="wasteFillPercent"
              type="range"
              min={0}
              max={100}
              value={wasteFillPercent}
              onChange={(event) => setWasteFillPercent(Number(event.target.value))}
              required
            />
          </div>
          <div>
            <label htmlFor="chlorineLevel">Medición de cloro</label>
            <input id="chlorineLevel" name="chlorineLevel" type="number" min={0} step="0.01" defaultValue={0} required />
          </div>
          <div>
            <label htmlFor="phLevel">Medición de pH</label>
            <input id="phLevel" name="phLevel" type="number" min={0} step="0.01" defaultValue={7} required />
          </div>
        </div>
      </section>

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

"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { saveReportAction } from "./actions";
import type { ReportFormState } from "./actions";

type CampOption = {
  id: string;
  name: string;
  /** Capacidades en m³, para mostrarlas junto al nivel y validar. */
  potableCapM3?: number | null;
  blackCapM3?: number | null;
};

type ReportFormDefaults = {
  reportId?: string;
  date: string;
  campId: string;
  peopleCount: number;
  breakfastCount: number;
  lunchCount: number;
  dinnerCount: number;
  snackSimpleCount: number;
  snackReplacementCount: number;
  waterBottleCount: number;
  lodgingCount: number;
  equipoCompleto?: boolean;
  cargoFaltante?: string | null;
  congelamiento?: boolean;
  congelamientoDetalle?: string | null;
  meterReading: number;
  fuelLiters: number;
  fuelRemainingLiters: number;
  generator1Hours: number;
  generator2Hours: number;
  internetStatus: "FUNCIONANDO" | "CON_INTERRUPCIONES" | "NO_FUNCIONA";
  blackWaterRemoved: "SI" | "NO";
  blackWaterRemovedM3: number;
  potableWaterTankLevelPercent: number;
  blackWaterTankLevelPercent: number;
  potableWaterTankLevelM3?: number | null;
  blackWaterTankLevelM3?: number | null;
  potableWaterDelivered: "SI" | "NO";
  potableWaterDeliveredM3: number;
  wasteFillPercent: number;
  chlorineLevel: number;
  phLevel: number;
  notes: string;
};

const initialState: ReportFormState = { error: "", success: "" };

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : label}</button>;
}

export function ReportForm({
  camps,
  defaultDate,
  defaultCampId,
  title = "Informe diario",
  submitLabel = "Guardar reporte",
  defaults
}: {
  camps: CampOption[];
  defaultDate: string;
  defaultCampId?: string;
  title?: string;
  submitLabel?: string;
  defaults?: Partial<ReportFormDefaults>;
}) {
  const [state, formAction] = useFormState(saveReportAction, initialState);
  const [wasteFillPercent, setWasteFillPercent] = useState(defaults?.wasteFillPercent ?? 0);
  const [campIdSel, setCampIdSel] = useState<string>(defaults?.campId ?? defaultCampId ?? camps[0]?.id ?? "");
  const campSel = camps.find(c => c.id === campIdSel) ?? null;
  const [blackWaterRemoved, setBlackWaterRemoved] = useState(defaults?.blackWaterRemoved ?? "NO");
  const [potableWaterDelivered, setPotableWaterDelivered] = useState(defaults?.potableWaterDelivered ?? "NO");
  const cubicMeterOptions = Array.from({ length: 40 }, (_, index) => index + 1);

  return (
    <form action={formAction} className="card grid">
      {defaults?.reportId ? <input type="hidden" name="reportId" value={defaults.reportId} /> : null}
      <h2 style={{ margin: 0 }}>{title}</h2>
      {state?.error ? <div className="alert error report-save-feedback">{state.error}</div> : null}
      {state?.success ? <div className="alert success report-save-feedback">{state.success}</div> : null}

      <section className="report-section">
        <h3 className="section-title">Contexto Diario</h3>
        <div className="grid two">
          <div>
            <label htmlFor="date">Fecha</label>
            <input id="date" name="date" type="date" defaultValue={defaults?.date ?? defaultDate} required />
          </div>

          <div>
            <label htmlFor="campId">Campamento</label>
            <select id="campId" name="campId" value={campIdSel} onChange={e => setCampIdSel(e.target.value)} required>
              {camps.map((camp) => (
                <option key={camp.id} value={camp.id}>
                  {camp.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="peopleCount">Personas en campamento</label>
            <input id="peopleCount" name="peopleCount" type="number" min={0} defaultValue={defaults?.peopleCount ?? 0} required />
          </div>
        </div>
      </section>

      <section className="report-section">
        <h3 className="section-title">Alimentación</h3>
        <div className="grid two">
          <div>
            <label htmlFor="breakfastCount">Desayunos entregados</label>
            <input id="breakfastCount" name="breakfastCount" type="number" min={0} defaultValue={defaults?.breakfastCount ?? 0} required />
          </div>
          <div>
            <label htmlFor="lunchCount">Almuerzos entregados</label>
            <input id="lunchCount" name="lunchCount" type="number" min={0} defaultValue={defaults?.lunchCount ?? 0} required />
          </div>
          <div>
            <label htmlFor="dinnerCount">Cenas entregadas</label>
            <input id="dinnerCount" name="dinnerCount" type="number" min={0} defaultValue={defaults?.dinnerCount ?? 0} required />
          </div>
          <div>
            <label htmlFor="snackSimpleCount">Colaciones simples</label>
            <input id="snackSimpleCount" name="snackSimpleCount" type="number" min={0} defaultValue={defaults?.snackSimpleCount ?? 0} required />
          </div>
          <div>
            <label htmlFor="snackReplacementCount">Colaciones de reemplazo</label>
            <input
              id="snackReplacementCount"
              name="snackReplacementCount"
              type="number"
              min={0}
              defaultValue={defaults?.snackReplacementCount ?? 0}
              required
            />
          </div>
          <div>
            <label htmlFor="waterBottleCount">Botellas de agua</label>
            <input id="waterBottleCount" name="waterBottleCount" type="number" min={0} defaultValue={defaults?.waterBottleCount ?? 0} required />
          </div>
        </div>
      </section>

      {/* "Alojamientos" era el mismo número que "Personas en campamento",
          preguntado dos veces. Se dejó uno solo. */}
      <section className="report-section">
        <h3 className="section-title">Equipo de servicio</h3>
        <div className="grid two">
          <div>
            <label htmlFor="equipoCompleto">¿El equipo está completo dando el servicio?</label>
            <select id="equipoCompleto" name="equipoCompleto" defaultValue={defaults?.equipoCompleto === false ? "no" : "si"}>
              <option value="si">Sí, equipo completo</option>
              <option value="no">No, falta un cargo</option>
            </select>
          </div>
          <div>
            <label htmlFor="cargoFaltante">Qué cargo falta y por qué</label>
            <input id="cargoFaltante" name="cargoFaltante" defaultValue={defaults?.cargoFaltante ?? ""}
                   placeholder="Ej: cocinero, licencia médica hasta el viernes" />
          </div>
        </div>
      </section>

      <section className="report-section">
        <h3 className="section-title">Recursos Operativos</h3>

        <div className="grid two" style={{ marginBottom: 14 }}>
          <div>
            <label htmlFor="meterReading">Lectura del medidor</label>
            <input id="meterReading" name="meterReading" type="number" min={0} step="0.01" defaultValue={defaults?.meterReading ?? 0} required />
            <div className="section-caption" style={{ marginTop: 6 }}>
              El consumo de agua se calcula automáticamente con la diferencia contra la lectura anterior.
            </div>
          </div>
          <div>
            <label htmlFor="internetStatus">Status internet</label>
            <select id="internetStatus" name="internetStatus" defaultValue={defaults?.internetStatus ?? "FUNCIONANDO"}>
              <option value="FUNCIONANDO">Funcionando</option>
              <option value="CON_INTERRUPCIONES">Con interrupciones</option>
              <option value="NO_FUNCIONA">No funciona</option>
            </select>
          </div>
        </div>

        <div className="grid two" style={{ marginBottom: 14 }}>
          <div className="report-section">
            <h4 className="section-title" style={{ fontSize: "0.95rem" }}>Consumos</h4>
            <div className="grid">
              <div>
                <label htmlFor="fuelLiters">Combustible (litros)</label>
                <input id="fuelLiters" name="fuelLiters" type="number" min={0} defaultValue={defaults?.fuelLiters ?? 0} required />
              </div>
              <div>
                <label htmlFor="fuelRemainingLiters">Combustible restante (litros)</label>
                <input id="fuelRemainingLiters" name="fuelRemainingLiters" type="number" min={0} defaultValue={defaults?.fuelRemainingLiters ?? 0} required />
              </div>
            </div>
          </div>

          <div className="report-section">
            <h4 className="section-title" style={{ fontSize: "0.95rem" }}>Generadores</h4>
            <div className="grid">
              <div>
                <label htmlFor="generator1Hours">Horómetro generador 1</label>
                <input id="generator1Hours" name="generator1Hours" type="number" min={0} step="0.01" defaultValue={defaults?.generator1Hours ?? 0} required />
              </div>
              <div>
                <label htmlFor="generator2Hours">Horómetro generador 2</label>
                <input id="generator2Hours" name="generator2Hours" type="number" min={0} step="0.01" defaultValue={defaults?.generator2Hours ?? 0} required />
              </div>
            </div>
          </div>
        </div>

        <div className="grid two">
          <div className="report-section">
            <h4 className="section-title" style={{ fontSize: "0.95rem" }}>Agua y saneamiento</h4>
            <div className="grid">
              {/* En m³, que es lo que marca el medidor. El porcentaje lo
                  calcula el sistema con la capacidad del campamento. */}
              <div>
                <label htmlFor="potableWaterTankLevelM3">
                  Nivel estanque agua potable (m³)
                  {campSel?.potableCapM3 ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · capacidad {campSel.potableCapM3} m³</span> : null}
                </label>
                <input
                  id="potableWaterTankLevelM3"
                  name="potableWaterTankLevelM3"
                  type="number"
                  min={0}
                  step="0.1"
                  inputMode="decimal"
                  max={campSel?.potableCapM3 ?? undefined}
                  defaultValue={defaults?.potableWaterTankLevelM3 ?? ""}
                  required
                />
                {campSel && !campSel.potableCapM3 && (
                  <span style={{ fontSize: "0.74rem", color: "#9a6300" }}>
                    Este campamento no tiene capacidad de estanque configurada: se guarda el m³ pero no se puede calcular el porcentaje.
                  </span>
                )}
              </div>
              <div>
                <label htmlFor="blackWaterTankLevelM3">
                  Nivel estanque aguas negras (m³)
                  {campSel?.blackCapM3 ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · capacidad {campSel.blackCapM3} m³</span> : null}
                </label>
                <input
                  id="blackWaterTankLevelM3"
                  name="blackWaterTankLevelM3"
                  type="number"
                  min={0}
                  step="0.1"
                  inputMode="decimal"
                  max={campSel?.blackCapM3 ?? undefined}
                  defaultValue={defaults?.blackWaterTankLevelM3 ?? ""}
                  required
                />
              </div>
              <div>
            <label htmlFor="blackWaterRemoved">Retiro aguas negras realizado</label>
            <select
              id="blackWaterRemoved"
              name="blackWaterRemoved"
              value={blackWaterRemoved}
              onChange={(event) => setBlackWaterRemoved(event.target.value as "SI" | "NO")}
            >
              <option value="NO">No</option>
              <option value="SI">Si</option>
            </select>
          </div>
              {blackWaterRemoved === "SI" ? (
                <div>
                  <label htmlFor="blackWaterRemovedM3">Aguas negras retiradas (m3)</label>
                  <select id="blackWaterRemovedM3" name="blackWaterRemovedM3" defaultValue={String(defaults?.blackWaterRemovedM3 ?? 1)} required>
                    {cubicMeterOptions.map((value) => (
                      <option key={`black-${value}`} value={value}>
                        {value} m3
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input type="hidden" name="blackWaterRemovedM3" value="0" />
              )}

              <div>
            <label htmlFor="potableWaterDelivered">Ingreso agua potable realizado</label>
            <select
              id="potableWaterDelivered"
              name="potableWaterDelivered"
              value={potableWaterDelivered}
              onChange={(event) => setPotableWaterDelivered(event.target.value as "SI" | "NO")}
            >
              <option value="NO">No</option>
              <option value="SI">Si</option>
            </select>
          </div>
              {potableWaterDelivered === "SI" ? (
                <div>
                  <label htmlFor="potableWaterDeliveredM3">Agua potable ingresada (m3)</label>
                  <select id="potableWaterDeliveredM3" name="potableWaterDeliveredM3" defaultValue={String(defaults?.potableWaterDeliveredM3 ?? 1)} required>
                    {cubicMeterOptions.map((value) => (
                      <option key={`potable-${value}`} value={value}>
                        {value} m3
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input type="hidden" name="potableWaterDeliveredM3" value="0" />
              )}
            </div>
          </div>

          <div className="report-section">
            <h4 className="section-title" style={{ fontSize: "0.95rem" }}>Control sanitario</h4>
            <div className="grid">
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
                <input id="chlorineLevel" name="chlorineLevel" type="number" min={0} step="0.01" defaultValue={defaults?.chlorineLevel ?? 0} required />
              </div>
              <div>
                <label htmlFor="phLevel">Medición de pH</label>
                <input id="phLevel" name="phLevel" type="number" min={0} step="0.01" defaultValue={defaults?.phLevel ?? 7} required />
              </div>
              <div>
                <label htmlFor="congelamiento">¿Hubo congelamiento?</label>
                <select id="congelamiento" name="congelamiento" defaultValue={defaults?.congelamiento ? "si" : "no"}>
                  <option value="no">No</option>
                  <option value="si">Sí</option>
                </select>
              </div>
              <div>
                <label htmlFor="congelamientoDetalle">Qué se congeló y qué se hizo</label>
                <input id="congelamientoDetalle" name="congelamientoDetalle" defaultValue={defaults?.congelamientoDetalle ?? ""}
                       placeholder="Ej: cañería de duchas, se descongeló a las 09:00" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div>
        <label htmlFor="notes">Observaciones</label>
        <textarea id="notes" name="notes" defaultValue={defaults?.notes ?? ""} placeholder="Novedades del día..." />
      </div>

      <SaveButton label={submitLabel} />
    </form>
  );
}

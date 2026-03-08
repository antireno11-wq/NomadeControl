"use client";

import { useFormState, useFormStatus } from "react-dom";
import { saveDailyTasksAction, type DailyTasksFormState } from "./actions";
import { ADMIN_DAILY_TASKS, OPERATIONAL_DAILY_TASKS, taskKeyFromLabel } from "@/lib/daily-task-checklists";

type CampOption = { id: string; name: string };

const initialState: DailyTasksFormState = { error: "", success: "" };

function SaveButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : "Guardar control diario"}</button>;
}

export function TasksForm({ camps, defaultDate }: { camps: CampOption[]; defaultDate: string }) {
  const [state, formAction] = useFormState(saveDailyTasksAction, initialState);

  return (
    <form action={formAction} className="card grid">
      <h2 style={{ margin: 0 }}>Control de tareas diarias</h2>

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

      <section className="report-section">
        <h3 className="section-title">Checklist diario administrativo</h3>
        <div className="grid">
          {ADMIN_DAILY_TASKS.map((task) => (
            <label key={task} style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
              <input type="checkbox" name={taskKeyFromLabel(task)} style={{ width: "auto", padding: 0 }} />
              {task}
            </label>
          ))}
        </div>
      </section>

      <section className="report-section">
        <h3 className="section-title">Checklist diario operacional</h3>
        <div className="grid">
          {OPERATIONAL_DAILY_TASKS.map((task) => (
            <label key={task} style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
              <input type="checkbox" name={taskKeyFromLabel(task)} style={{ width: "auto", padding: 0 }} />
              {task}
            </label>
          ))}
        </div>
      </section>

      <div>
        <label htmlFor="notes">Observaciones</label>
        <textarea id="notes" name="notes" placeholder="Detalle del día..." />
      </div>

      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.success ? <div className="alert success">{state.success}</div> : null}

      <SaveButton />
    </form>
  );
}

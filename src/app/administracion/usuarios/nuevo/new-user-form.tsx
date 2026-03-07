"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createUserAction, type CreateUserFormState } from "@/app/administracion/actions";

type CampOption = { id: string; name: string };

const initialState: CreateUserFormState = { error: "", success: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Creando..." : "Crear usuario"}</button>;
}

export function NewUserForm({ camps }: { camps: CampOption[] }) {
  const [state, formAction] = useFormState(createUserAction, initialState);

  return (
    <form action={formAction} className="grid two">
      <div>
        <label htmlFor="new-name">Nombre</label>
        <input id="new-name" name="name" required />
      </div>
      <div>
        <label htmlFor="new-email">Correo</label>
        <input id="new-email" name="email" type="email" required />
      </div>
      <div>
        <label htmlFor="new-role">Rol</label>
        <select id="new-role" name="role" defaultValue="SUPERVISOR">
          <option value="SUPERVISOR">SUPERVISOR</option>
          <option value="ADMINISTRADOR">ADMINISTRADOR</option>
        </select>
      </div>
      <div>
        <label htmlFor="new-camp">Campamento (solo supervisor)</label>
        <select id="new-camp" name="campId" defaultValue="none">
          <option value="none">Sin asignar</option>
          {camps.map((camp) => (
            <option key={camp.id} value={camp.id}>
              {camp.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="new-password">Contraseña inicial</label>
        <input id="new-password" name="password" type="password" minLength={8} required />
      </div>
      <div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 28 }}>
          <input type="checkbox" name="sendWelcomeEmail" defaultChecked style={{ width: "auto", padding: 0 }} />
          Enviar credenciales por correo
        </label>
      </div>

      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.success ? <div className="alert success">{state.success}</div> : null}

      <div style={{ display: "flex", alignItems: "end" }}>
        <SubmitButton />
      </div>
    </form>
  );
}

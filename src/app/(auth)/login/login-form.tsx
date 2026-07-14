"use client";

import { useFormState, useFormStatus } from "react-dom";
import { loginAction } from "./actions";

const initialState = { error: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Ingresando..." : "Ingresar"}</button>;
}

export function LoginForm() {
  const [state, formAction] = useFormState(loginAction, initialState);

  return (
    <>
      <form action={formAction} className="grid">
        <div>
          <label htmlFor="accessRole">Tipo de acceso</label>
          <select id="accessRole" name="accessRole" defaultValue="OPERATIVO" required>
            <option value="ADMINISTRADOR">Administrador</option>
            <option value="OPERATIVO">Operativo</option>
            <option value="CONSULTA">Consulta</option>
          </select>
        </div>

        <div>
          <label htmlFor="email">Correo</label>
          <input id="email" name="email" type="email" placeholder="admin@campamentos.local" required />
        </div>

        <div>
          <label htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" required />
        </div>

        {state?.error ? <div className="alert error">{state.error}</div> : null}

        <SubmitButton />
      </form>
    </>
  );
}

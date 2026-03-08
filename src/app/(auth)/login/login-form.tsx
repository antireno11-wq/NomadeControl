"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { loginAction } from "./actions";

const initialState = { error: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Ingresando..." : "Ingresar"}</button>;
}

export function LoginForm({ oauthErrorText }: { oauthErrorText?: string }) {
  const [state, formAction] = useFormState(loginAction, initialState);

  return (
    <>
      <Link href="/api/auth/google/start" style={{ textDecoration: "none" }}>
        <button type="button" className="secondary">
          Continuar con Google
        </button>
      </Link>

      <form action={formAction} className="grid" style={{ marginTop: 16 }}>
        <div>
          <label htmlFor="accessRole">Tipo de acceso</label>
          <select id="accessRole" name="accessRole" defaultValue="SUPERVISOR" required>
            <option value="SUPERVISOR">Supervisor</option>
            <option value="ADMINISTRADOR">Administrador</option>
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
        {oauthErrorText ? <div className="alert error">{oauthErrorText}</div> : null}

        <SubmitButton />
      </form>
    </>
  );
}

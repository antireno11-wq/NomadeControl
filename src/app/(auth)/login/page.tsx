"use client";

import Image from "next/image";
import { useFormState, useFormStatus } from "react-dom";
import { loginAction } from "./actions";

const initialState = { error: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Ingresando..." : "Ingresar"}</button>;
}

export default function LoginPage() {
  const [state, formAction] = useFormState(loginAction, initialState);

  return (
    <main style={{ maxWidth: 460, paddingTop: 80 }}>
      <div className="card">
        <div className="brand-logo">
          <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={220} height={220} priority />
        </div>
        <h1 style={{ marginTop: 0 }}>Control de Campamentos</h1>
        <p style={{ color: "var(--muted)" }}>
          Inicia sesión para registrar y revisar reportes diarios.
        </p>

        <form action={formAction} className="grid" style={{ marginTop: 16 }}>
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

        <div style={{ marginTop: 16, color: "var(--muted)", fontSize: "0.88rem" }}>
          Usuario inicial: <strong>admin@campamentos.local</strong> / <strong>Admin1234</strong>
        </div>
      </div>
    </main>
  );
}

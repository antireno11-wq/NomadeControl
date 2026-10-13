"use client";

import { useFormState, useFormStatus } from "react-dom";
import { cambiarClaveAction, type EstadoCambio } from "../actions";

const inicial: EstadoCambio = { error: "" };

function Guardar() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "Guardando..." : "Guardar contraseña"}</button>;
}

export function CambiarForm({ token, largoMinimo }: { token: string; largoMinimo: number }) {
  const [estado, accion] = useFormState(cambiarClaveAction, inicial);
  return (
    <form action={accion} className="grid">
      <input type="hidden" name="token" value={token} />
      <div>
        <label htmlFor="clave">Contraseña nueva</label>
        <input id="clave" name="clave" type="password" autoComplete="new-password" minLength={largoMinimo} required />
      </div>
      <div>
        <label htmlFor="repetida">Repítela</label>
        <input id="repetida" name="repetida" type="password" autoComplete="new-password" minLength={largoMinimo} required />
      </div>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
        Al menos {largoMinimo} caracteres. Al guardarla se cierran las sesiones que tengas abiertas en otros equipos.
      </p>
      {estado.error ? <div className="alert error">{estado.error}</div> : null}
      <Guardar />
    </form>
  );
}

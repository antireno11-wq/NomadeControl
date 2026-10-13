"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { pedirRecuperacionAction, type EstadoPedido } from "./actions";

const inicial: EstadoPedido = { enviado: false, error: "" };

function Enviar() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "Enviando..." : "Enviarme el enlace"}</button>;
}

export function PedirForm() {
  const [estado, accion] = useFormState(pedirRecuperacionAction, inicial);

  if (estado.enviado) {
    return (
      <div className="grid">
        <div className="alert success">
          Si ese correo tiene una cuenta, te llegó un enlace para elegir una contraseña nueva.
          Revisa también la carpeta de spam. El enlace vence en una hora.
        </div>
        <Link href="/login">← Volver al inicio de sesión</Link>
      </div>
    );
  }

  return (
    <form action={accion} className="grid">
      <div>
        <label htmlFor="email">Tu correo</label>
        <input id="email" name="email" type="email" autoComplete="email" required placeholder="nombre@nomadechile.cl" />
      </div>
      {estado.error ? <div className="alert error">{estado.error}</div> : null}
      <Enviar />
      <Link href="/login">← Volver al inicio de sesión</Link>
    </form>
  );
}

import Image from "next/image";
import { PedirForm } from "./pedir-form";

export default function RecuperarPage() {
  return (
    <main style={{ maxWidth: 460, paddingTop: 80 }}>
      <div className="card">
        <div className="brand-logo">
          <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={220} height={220} priority />
        </div>
        <h1 style={{ marginTop: 0 }}>Recuperar contraseña</h1>
        <p style={{ color: "var(--muted)" }}>
          Escribe el correo con el que entras y te mandamos un enlace para elegir una contraseña nueva.
        </p>
        <PedirForm />
      </div>
    </main>
  );
}

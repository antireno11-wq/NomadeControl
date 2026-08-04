import Image from "next/image";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main style={{ maxWidth: 460, paddingTop: 80 }}>
      <div className="card">
        <div className="brand-logo">
          <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={220} height={220} priority />
        </div>
        <h1 style={{ marginTop: 0 }}>NomadeControl</h1>
        <p style={{ color: "var(--muted)" }}>
          Selecciona tu tipo de acceso e iniciá sesión.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}

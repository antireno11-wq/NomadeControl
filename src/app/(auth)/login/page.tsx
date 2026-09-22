import Image from "next/image";
import { LoginForm } from "./login-form";

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { destino?: string | string[] };
}) {
  const destino = typeof searchParams?.destino === "string" ? searchParams.destino : "";
  return (
    <main style={{ maxWidth: 460, paddingTop: 80 }}>
      <div className="card">
        <div className="brand-logo">
          <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={220} height={220} priority />
        </div>
        <h1 style={{ marginTop: 0 }}>NomadeControl</h1>
        <p style={{ color: "var(--muted)" }}>
          Selecciona tu tipo de acceso e inicia sesión.
        </p>
        <LoginForm destino={destino} />
      </div>
    </main>
  );
}

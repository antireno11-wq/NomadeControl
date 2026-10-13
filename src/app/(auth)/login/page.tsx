import Image from "next/image";
import Link from "next/link";
import { destinoSeguro } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { destino?: string | string[]; status?: string | string[] };
}) {
  const claveCambiada = searchParams?.status === "clave-cambiada";
  // Se filtra acá además de en la acción. La acción es la que decide, pero
  // una URL ajena no tiene por qué llegar siquiera a dibujarse en la página.
  const destino = destinoSeguro(typeof searchParams?.destino === "string" ? searchParams.destino : "") ?? "";
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
        {claveCambiada && (
          <div className="alert success" style={{ marginBottom: 12 }}>
            Contraseña cambiada. Entra con la nueva.
          </div>
        )}
        <LoginForm destino={destino} />
        <p style={{ marginTop: 16, marginBottom: 0, textAlign: "center", fontSize: "0.9rem" }}>
          <Link href="/recuperar">¿Olvidaste tu contraseña?</Link>
        </p>
      </div>
    </main>
  );
}

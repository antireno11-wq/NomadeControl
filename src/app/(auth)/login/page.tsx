import Image from "next/image";
import { LoginForm } from "./login-form";

export default function LoginPage({ searchParams }: { searchParams?: { error?: string } }) {
  const oauthError = searchParams?.error;
  const oauthErrorText =
    oauthError === "google_user_not_authorized"
      ? "Tu cuenta Google no está autorizada en la plataforma."
      : oauthError
        ? "No se pudo iniciar sesión con Google. Inténtalo nuevamente."
        : "";

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
        <LoginForm oauthErrorText={oauthErrorText} />

      </div>
    </main>
  );
}

import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { LARGO_MINIMO_CLAVE, recuperacionVigente } from "@/lib/recuperacion-clave";
import { CambiarForm } from "./cambiar-form";

// El token va en la dirección: que no viaje a ningún otro sitio en la
// cabecera Referer si la página llegara a cargar algo externo.
export const metadata: Metadata = { referrer: "no-referrer" };

/**
 * Abrir el enlace NO lo gasta: solo lo gasta guardar la contraseña. Los
 * filtros de correo abren los enlaces para revisarlos, y si con eso bastara
 * para usarlo, a la persona le llegaría un enlace ya vencido.
 */
export default async function CambiarClavePage({ params }: { params: { token: string } }) {
  const pedido = await recuperacionVigente(params.token);

  return (
    <main style={{ maxWidth: 460, paddingTop: 80 }}>
      <div className="card">
        <div className="brand-logo">
          <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={220} height={220} priority />
        </div>
        <h1 style={{ marginTop: 0 }}>Contraseña nueva</h1>
        {pedido ? (
          <>
            <p style={{ color: "var(--muted)" }}>Elige la contraseña nueva para {pedido.user.email}.</p>
            <CambiarForm token={params.token} largoMinimo={LARGO_MINIMO_CLAVE} />
          </>
        ) : (
          <div className="grid">
            <div className="alert error">
              Este enlace ya no sirve: venció o ya se usó. Los enlaces duran una hora y sirven una sola vez.
            </div>
            <Link href="/recuperar">Pedir un enlace nuevo</Link>
          </div>
        )}
      </div>
    </main>
  );
}

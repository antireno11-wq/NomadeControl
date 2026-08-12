"use client";

import { useState } from "react";

/**
 * Descarga en PDF y copia como texto.
 *
 * El PDF sale por el diálogo de impresión del navegador en vez de generarse
 * en el servidor: no agrega dependencias, respeta los estilos que ya se ven
 * en pantalla y deja al usuario elegir el tamaño de papel. Lo que se imprime
 * es la minuta sola — los botones y la transcripción se ocultan.
 */
export function BotonesMinuta() {
  const [copiado, setCopiado] = useState(false);

  function copiar() {
    const nodo = document.getElementById("minuta");
    if (!nodo) return;
    navigator.clipboard.writeText(nodo.innerText).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    });
  }

  return (
    <>
      <style>{`
        @media print {
          .no-imprimir, nav, aside, header button { display: none !important; }
          #minuta { border: none !important; box-shadow: none !important; padding: 0 !important; }
          body { background: white !important; }
        }
      `}</style>
      <div className="no-imprimir card" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => window.print()}>Descargar PDF</button>
        <button type="button" className="secondary" onClick={copiar}>
          {copiado ? "Copiado" : "Copiar como texto"}
        </button>
        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
          En el diálogo de impresión, elige «Guardar como PDF». El texto copiado sirve para pegarlo
          en un correo o en WhatsApp.
        </span>
      </div>
    </>
  );
}

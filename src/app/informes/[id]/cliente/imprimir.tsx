"use client";

export function BotonImprimir() {
  return (
    <button type="button" onClick={() => window.print()}>
      Descargar PDF
    </button>
  );
}

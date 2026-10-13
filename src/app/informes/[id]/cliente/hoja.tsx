import React from "react";

export type DatosHojaCliente = {
  campamento: string;
  mandante: string;
  fecha: string;
  supervisor: string;
  filas: Array<[string, string]>;
  desglose: Array<{ empresa: string; habitaciones: number }>;
  servicios: string[];
};

/**
 * La hoja del informe REG-OP-OPE-001, solo con datos. Va aparte de la página
 * para poder dibujarla sin sesión y compararla con el formato del cliente.
 */
export function HojaCliente({ campamento, mandante, fecha, supervisor, filas, desglose, servicios }: DatosHojaCliente) {
  const azul = "#1f4e5f", naranjo = "#ff5a00", cabecera = "#8496b0", gris = "#e7e6e6";
  const celda: React.CSSProperties = { border: "1px solid #c9c9c9", padding: "2px 6px", fontSize: 10.5 };
  const totalDesglose = desglose.reduce((s, f) => s + f.habitaciones, 0);

  return (
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ width: 470 }}>
          <div style={{ textAlign: "center", fontWeight: 700, color: azul, fontSize: 15 }}>INFORME DIARIO DE CAMPAMENTO</div>
          <div style={{ height: 12, background: naranjo, margin: "6px 0 6px" }} />
          <div style={{ display: "flex", gap: 48, color: azul, fontWeight: 700, fontSize: 10 }}>
            <span>Código: REG-OP-OPE-001</span><span>Rev.: 1</span>
          </div>
        </div>

        <table style={{ marginTop: 18, width: 470 }}>
          <tbody>
            <tr>
              <td style={{ fontWeight: 700, fontSize: 10.5, width: 130, whiteSpace: "nowrap" }}>Campamento / Proyecto:</td>
              <td style={{ ...celda, width: 130 }}>{campamento}</td>
              <td style={{ fontWeight: 700, fontSize: 10.5, paddingLeft: 10, width: 70, whiteSpace: "nowrap" }}>Mandante:</td>
              <td style={celda}>{mandante}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700, fontSize: 10.5 }}>Fecha:</td>
              <td style={{ ...celda, textAlign: "center" }}>{fecha}</td>
              <td style={{ fontWeight: 700, fontSize: 10.5, paddingLeft: 10, whiteSpace: "nowrap" }}>Supervisor:</td>
              <td style={celda}>{supervisor}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: "flex", gap: 30, alignItems: "flex-start", marginTop: 18 }}>
          <table style={{ width: 470 }}>
            <thead>
              <tr><th colSpan={2} style={{ background: cabecera, color: "#fff", textAlign: "left", fontSize: 10.5, padding: "2px 6px" }}>CONTROL DE CAMPAMENTO</th></tr>
            </thead>
            <tbody>
              {filas.map(([etiqueta, valor]) => {
                const texto = valor === "Sí" || valor === "No" || valor === "Con interrupciones";
                return (
                  <tr key={etiqueta}>
                    <td style={{ fontWeight: 700, fontSize: 10.5, padding: "2px 6px 2px 48px", width: 300 }}>{etiqueta}</td>
                    <td style={{ ...celda, background: gris, fontWeight: 700, textAlign: texto ? "left" : "right" }}>{valor}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <table style={{ width: 175 }}>
            <thead>
              <tr><th colSpan={2} style={{ background: cabecera, color: "#fff", textAlign: "left", fontSize: 10, padding: "2px 6px", whiteSpace: "nowrap" }}>DESGLOSE DE OCUPACION</th></tr>
              <tr><td style={{ ...celda, background: gris }} /><td style={{ ...celda, background: gris, fontWeight: 700, textAlign: "center" }}>Habitaciones</td></tr>
            </thead>
            <tbody>
              {desglose.length === 0 ? (
                <tr><td colSpan={2} style={{ ...celda, background: gris, textAlign: "center" }}>—</td></tr>
              ) : desglose.map(f => (
                <tr key={f.empresa}>
                  <td style={{ ...celda, background: gris, fontWeight: 700, whiteSpace: "nowrap" }}>{f.empresa}</td>
                  <td style={{ ...celda, background: gris, fontWeight: 700, textAlign: "right" }}>{f.habitaciones}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...celda, background: gris, fontWeight: 700 }}>Total</td>
                <td style={{ ...celda, background: gris, fontWeight: 700, textAlign: "right" }}>{desglose.length ? totalDesglose : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 20, paddingLeft: 48, fontSize: 10.5, fontWeight: 700 }}>
          <div style={{ marginBottom: 4 }}>Los servicios planificados para el dia de hoy son:</div>
          {servicios.length === 0 ? <div>—</div> : servicios.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
  );
}

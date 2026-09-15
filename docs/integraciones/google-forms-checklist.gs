/**
 * Nomade Control — envío del checklist SGI-F-GE-024 desde Google Forms.
 *
 * Se instala en el formulario (Extensiones → Apps Script) y corre con cada
 * envío. Manda la respuesta completa a Nomade Control, que la registra como
 * checklist del vehículo y calcula el veredicto.
 *
 * Configurar en Proyecto → Configuración → Propiedades del script:
 *   NOMADE_URL     https://<tu-app>/api/integraciones/google-forms
 *   NOMADE_SECRET  el mismo valor que GOOGLE_FORMS_WEBHOOK_SECRET en Railway
 *   AVISO_EMAIL    correo al que avisar si algo falla (opcional)
 */

function alEnviar(e) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("NOMADE_URL");
  var secret = props.getProperty("NOMADE_SECRET");
  var aviso = props.getProperty("AVISO_EMAIL");
  if (!url || !secret) throw new Error("Faltan NOMADE_URL o NOMADE_SECRET en las propiedades del script");

  var respuesta = e.response;
  var respuestas = {};
  var archivos = {};

  respuesta.getItemResponses().forEach(function (ir) {
    var titulo = ir.getItem().getTitle();
    var valor = ir.getResponse();
    // Las preguntas de subir archivo devuelven ids de Drive: se convierten en
    // enlaces, que es lo que Nomade Control guarda.
    if (ir.getItem().getType() === FormApp.ItemType.FILE_UPLOAD) {
      var ids = Array.isArray(valor) ? valor : [valor];
      archivos[titulo] = ids.filter(String).map(function (id) {
        return "https://drive.google.com/file/d/" + id + "/view";
      });
      return;
    }
    respuestas[titulo] = valor;
  });

  var payload = {
    responseId: respuesta.getId(),
    timestamp: respuesta.getTimestamp().toISOString(),
    email: respuesta.getRespondentEmail() || "",
    respuestas: respuestas,
    archivos: archivos
  };

  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { "x-webhook-secret": secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code >= 200 && code < 300) return;

  // Un checklist que no se pudo registrar no puede perderse en silencio:
  // queda en el registro del script y, si hay correo, se avisa con el motivo.
  var detalle = "Código " + code + ": " + res.getContentText();
  console.error("Nomade Control rechazó la respuesta " + respuesta.getId() + " — " + detalle);
  if (aviso) {
    MailApp.sendEmail(
      aviso,
      "Checklist no registrado en Nomade Control",
      "Un checklist del formulario SGI-F-GE-024 no se pudo registrar.\n\n" +
      "Conductor: " + (respuestas["Nombre del conductor"] || "?") + "\n" +
      "Patente: " + (respuestas["Patente"] || "?") + "\n" +
      "Motivo: " + detalle + "\n\n" +
      "La respuesta sigue guardada en el formulario; cuando se corrija la causa, se puede reenviar."
    );
  }
}

/** Ejecutar UNA vez a mano para crear el disparador de envío. */
function instalarDisparador() {
  var form = FormApp.getActiveForm();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "alEnviar") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("alEnviar").forForm(form).onFormSubmit().create();
}

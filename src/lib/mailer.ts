type SendWelcomeEmailInput = {
  to: string;
  name: string;
  role: string;
  password: string;
  campName?: string | null;
};

type MissingCampInput = {
  campName: string;
  missingReport: boolean;
  missingTasks: boolean;
};

type SendMissingDailyInputsAlertEmailInput = {
  to: string[];
  targetDateLabel: string;
  missingCamps: MissingCampInput[];
};

function appUrl() {
  return process.env.APP_URL ?? "https://nomadecontrol-production.up.railway.app";
}

export async function sendWelcomeEmail(input: SendWelcomeEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error("Falta configuración de correo: RESEND_API_KEY y/o RESEND_FROM_EMAIL.");
  }

  const url = appUrl();
  const campText = input.campName ? `<p><strong>Campamento asignado:</strong> ${input.campName}</p>` : "";
  const html = `
    <div style="font-family: Arial, sans-serif; color: #10212b; line-height:1.5">
      <h2>Bienvenido/a a NomadeControl</h2>
      <p>Hola ${input.name}, tu cuenta fue creada correctamente.</p>
      <p><strong>Rol:</strong> ${input.role}</p>
      ${campText}
      <p><strong>Correo:</strong> ${input.to}</p>
      <p><strong>Contraseña inicial:</strong> ${input.password}</p>
      <p>Ingresa aquí: <a href="${url}">${url}</a></p>
      <p>Por seguridad, cambia tu contraseña al primer ingreso.</p>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: "Acceso a NomadeControl",
      html
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Error enviando correo: ${detail}`);
  }
}

export async function sendMissingDailyInputsAlertEmail(input: SendMissingDailyInputsAlertEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error("Falta configuración de correo: RESEND_API_KEY y/o RESEND_FROM_EMAIL.");
  }

  if (input.to.length === 0) {
    throw new Error("No hay destinatarios configurados para la alerta.");
  }

  const rows = input.missingCamps
    .map((camp) => {
      const missingParts = [
        camp.missingReport ? "Informe diario" : null,
        camp.missingTasks ? "Control de tareas" : null
      ].filter(Boolean);

      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${camp.campName}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${missingParts.join(" + ")}</td>
      </tr>`;
    })
    .join("");

  const url = appUrl();
  const html = `
    <div style="font-family: Arial, sans-serif; color: #10212b; line-height:1.5">
      <h2>Faltan cargas diarias en NomadeControl</h2>
      <p>Se detectaron campamentos sin carga completa para el día <strong>${input.targetDateLabel}</strong>.</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <thead>
          <tr>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #cbd5e1;">Campamento</th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #cbd5e1;">Falta</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p>Revisa la plataforma aquí: <a href="${url}">${url}</a></p>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: `Alerta NomadeControl: faltan informes del ${input.targetDateLabel}`,
      html
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Error enviando correo: ${detail}`);
  }
}

type SendTareaAsignadaEmailInput = {
  to: string;       // recipient email
  toName: string;   // recipient name
  descripcion: string;
  asignadoPor: string;
  prioridad: string;
  fechaCierre?: string | null;
  appUrl?: string;
};

export async function sendTareaAsignadaEmail(input: SendTareaAsignadaEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return; // silently skip if not configured

  const url = input.appUrl ?? appUrl();
  const prioridadColor = input.prioridad === "alta" ? "#dc2626" : input.prioridad === "media" ? "#f97316" : "#16a34a";
  const fechaTexto = input.fechaCierre ? `<p><strong>Fecha de cierre:</strong> ${input.fechaCierre}</p>` : "";

  const html = `
    <div style="font-family: Arial, sans-serif; color: #10212b; line-height:1.6; max-width:520px">
      <h2 style="color:#006878">Nueva tarea asignada</h2>
      <p>Hola ${input.toName}, se te asignó una nueva tarea en NomadeControl.</p>
      <div style="border-left:4px solid ${prioridadColor};padding:12px 16px;background:#f8fafc;border-radius:0 8px 8px 0;margin:16px 0">
        <p style="margin:0;font-weight:700;font-size:1rem">${input.descripcion}</p>
        <p style="margin:4px 0 0;font-size:0.85rem;color:#64748b">Prioridad: <strong style="color:${prioridadColor}">${input.prioridad.toUpperCase()}</strong></p>
      </div>
      ${fechaTexto}
      <p><strong>Asignada por:</strong> ${input.asignadoPor}</p>
      <a href="${url}/gestion-tareas" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#006878;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">
        Ver mis tareas
      </a>
    </div>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: `Tarea asignada: ${input.descripcion.slice(0, 60)}`,
      html,
    }),
  }).catch(() => {}); // don't break the action if email fails
}

type TareaVencidaItem = {
  descripcion: string;
  responsable: string | null;
  diasAtraso: number;
  prioridad: string;
};

type SendTareasVencidasEmailInput = {
  to: string[];
  tareas: TareaVencidaItem[];
};

export async function sendTareasVencidasEmail(input: SendTareasVencidasEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || input.to.length === 0) return;

  const url = appUrl();

  const rows = input.tareas.map(t => {
    const color = t.prioridad === "alta" ? "#dc2626" : t.prioridad === "media" ? "#f97316" : "#16a34a";
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:600">${t.descripcion}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${t.responsable ?? "Sin asignar"}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:${color};font-weight:700">${t.prioridad.toUpperCase()}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#dc2626;font-weight:700">${t.diasAtraso}d</td>
    </tr>`;
  }).join("");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#10212b;line-height:1.6;max-width:600px">
      <h2 style="color:#dc2626">⚠️ Tareas vencidas en NomadeControl</h2>
      <p>Las siguientes tareas han superado su fecha de cierre y requieren atención:</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <thead>
          <tr style="background:#f1f5f9">
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #cbd5e1">Tarea</th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #cbd5e1">Responsable</th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #cbd5e1">Prioridad</th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #cbd5e1">Atraso</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <a href="${url}/gestion-tareas?v=todas" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#dc2626;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">
        Ver todas las tareas
      </a>
    </div>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: `⚠️ ${input.tareas.length} tarea${input.tareas.length > 1 ? "s" : ""} vencida${input.tareas.length > 1 ? "s" : ""} en NomadeControl`,
      html,
    }),
  }).catch(() => {});
}

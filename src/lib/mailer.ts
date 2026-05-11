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

// ─── Alerta diaria de documentos por vencer ───────────────────────────────────

type AlertaDocItem = {
  severidad: "vencido" | "critico" | "medio" | "preventivo";
  categoria: string;
  nombre: string;
  entidad: string;
  diasRestantes: number;
  fechaVencimiento: Date;
  href: string;
};

type SendAlertasVencimientoEmailInput = {
  to: string[];
  fechaLabel: string;
  alertas: AlertaDocItem[];
};

export async function sendAlertasVencimientoEmail(input: SendAlertasVencimientoEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || input.to.length === 0) return;

  const url = appUrl();

  const SEV_CONFIG: Record<AlertaDocItem["severidad"], { icon: string; color: string; label: string }> = {
    vencido:    { icon: "⛔", color: "#991b1b", label: "VENCIDO" },
    critico:    { icon: "🔴", color: "#9a3412", label: "Vence en ≤ 7 días" },
    medio:      { icon: "🟠", color: "#854d0e", label: "Vence en ≤ 30 días" },
    preventivo: { icon: "🟡", color: "#1d4ed8", label: "Vence en ≤ 60 días" },
  };

  const CATEGORIA_LABEL: Record<string, string> = {
    trabajador: "Trabajador",
    hsec: "HSEC Campamento",
    vehiculo: "Vehículo",
    epp: "EPP",
  };

  const counts = {
    vencido: input.alertas.filter(a => a.severidad === "vencido").length,
    critico: input.alertas.filter(a => a.severidad === "critico").length,
    medio:   input.alertas.filter(a => a.severidad === "medio").length,
    preventivo: input.alertas.filter(a => a.severidad === "preventivo").length,
  };

  const summaryItems = (Object.entries(counts) as [AlertaDocItem["severidad"], number][])
    .filter(([, n]) => n > 0)
    .map(([sev, n]) => {
      const cfg = SEV_CONFIG[sev];
      return `<td style="padding:10px 16px;text-align:center;background:#f8fafc;border-radius:8px;margin:0 4px">
        <div style="font-size:1.4rem">${cfg.icon}</div>
        <div style="font-size:1.5rem;font-weight:800;color:${cfg.color}">${n}</div>
        <div style="font-size:0.75rem;color:#64748b">${cfg.label}</div>
      </td>`;
    })
    .join('<td style="width:8px"></td>');

  const rows = input.alertas.slice(0, 50).map(a => {
    const cfg = SEV_CONFIG[a.severidad];
    const diasText = a.diasRestantes < 0
      ? `Vencido hace ${Math.abs(a.diasRestantes)} días`
      : a.diasRestantes === 0
        ? "Vence hoy"
        : `Vence en ${a.diasRestantes} día${a.diasRestantes > 1 ? "s" : ""}`;
    const fechaStr = a.fechaVencimiento.toLocaleDateString("es-CL");
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${cfg.icon}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:0.8rem;color:#64748b">${CATEGORIA_LABEL[a.categoria] ?? a.categoria}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:600">${a.nombre}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${a.entidad}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:0.85rem">${fechaStr}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:${cfg.color};font-weight:700;font-size:0.8rem">${diasText}</td>
    </tr>`;
  }).join("");

  const overflowNote = input.alertas.length > 50
    ? `<p style="color:#64748b;font-size:0.85rem;margin-top:8px">Y ${input.alertas.length - 50} documentos más. <a href="${url}/dashboard">Ver todo en el dashboard →</a></p>`
    : "";

  const html = `
    <div style="font-family:Arial,sans-serif;color:#10212b;line-height:1.6;max-width:700px">
      <h2 style="color:#006878">📋 Resumen diario de documentos — ${input.fechaLabel}</h2>
      <p>Los siguientes documentos requieren atención en <strong>NomadeControl</strong>:</p>

      <table style="border-collapse:separate;border-spacing:8px 0;margin:16px 0">
        <tr>${summaryItems}</tr>
      </table>

      <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:0.9rem">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="padding:8px 10px;border-bottom:2px solid #cbd5e1;width:28px"></th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #cbd5e1">Tipo</th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #cbd5e1">Documento</th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #cbd5e1">Entidad</th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #cbd5e1">Vencimiento</th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #cbd5e1">Estado</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      ${overflowNote}

      <a href="${url}/dashboard" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#006878;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">
        Ver dashboard completo
      </a>

      <p style="color:#94a3b8;font-size:0.75rem;margin-top:24px">
        Este correo se envía automáticamente cada día a las 8:00 AM.<br>
        NomadeControl — control.nomadechile.cl
      </p>
    </div>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: `📋 Alertas NomadeControl ${input.fechaLabel}: ${counts.vencido} vencido${counts.vencido !== 1 ? "s" : ""}, ${counts.critico} crítico${counts.critico !== 1 ? "s" : ""}`,
      html,
    }),
  }).catch(() => {});
}

type SendWelcomeEmailInput = {
  to: string;
  name: string;
  role: string;
  password: string;
  campName?: string | null;
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

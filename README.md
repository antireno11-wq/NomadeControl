# NomadeControl

App web para registrar reportes diarios por campamento y supervisar desde una oficina central.

## Funcionalidades iniciales
- Usuarios con roles `ADMINISTRADOR` y `SUPERVISOR`.
- Registro diario por campamento:
  - Personas en campamento
  - Desayunos, almuerzos y cenas entregadas
  - Agua (litros)
  - Combustible (litros)
  - Observaciones
- Dashboard con últimos reportes y totales rápidos.
- Endpoint de exportación JSON para admin: `GET /api/reportes`.

## Stack
- Next.js 14 (App Router)
- Prisma ORM
- PostgreSQL (Railway / producción)
- Railway para despliegue

## 1. Configuración local
```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run prisma:seed
npm run dev
```

Abrir: [http://localhost:3000](http://localhost:3000)

### Usuarios semilla
- `administrador@campamentos.local` / `Admin1234`
- `supervisor@campamentos.local` / `Supervisor1234`

## 2. Crear repositorio nuevo en GitHub
Desde la carpeta `campamentos-control`:
```bash
git init
git add .
git commit -m "init campamentos-control"
git branch -M main
git remote add origin <TU_REPO_GITHUB_URL>
git push -u origin main
```

## 3. Desplegar en Railway
1. Crear proyecto en Railway desde tu repo de GitHub.
2. Variables de entorno mínimas:
   - `DATABASE_URL`
   - `SESSION_COOKIE_NAME=camp_session`
   - `SEED_ADMIN_EMAIL`
   - `SEED_ADMIN_PASSWORD`
   - `APP_URL`
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL`
3. En producción usa Postgres de Railway y actualiza `DATABASE_URL`.
4. Ejecutar migraciones con `npx prisma migrate deploy` en el proceso de despliegue.

## Envío de correo al crear usuario
En Administración, al crear usuario puedes activar `Enviar credenciales por correo`.
Para que funcione, configura en Railway:
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `APP_URL` (URL pública de tu app)

## Login con Google (OAuth)
La plataforma permite `Continuar con Google` en login para usuarios ya registrados.
Variables requeridas:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `APP_URL`

En Google Cloud Console:
1. Crea credenciales OAuth 2.0 (Web application).
2. Authorized redirect URI:
   - Local: `http://localhost:3000/api/auth/google/callback`
   - Producción: `https://nomadecontrol-production.up.railway.app/api/auth/google/callback`
3. Copia Client ID/Secret en Railway Variables.

## 4. Siguientes mejoras sugeridas
- Catálogo dinámico de "otros consumos" (no solo agua/combustible).
- Histórico con filtros por rango de fechas y por campamento.
- Exportación a Excel/PDF.
- Auditoría de cambios por usuario.

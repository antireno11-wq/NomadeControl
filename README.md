# NomadeControl

App web para registrar reportes diarios por campamento y supervisar desde una oficina central.

## Funcionalidades iniciales
- Usuarios con roles `ADMIN` y `OPERADOR`.
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
- `admin@campamentos.local` / `Admin1234`
- `operador@campamentos.local` / `Operador1234`

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
3. En producción usa Postgres de Railway y actualiza `DATABASE_URL`.
4. Ejecutar migraciones con `npx prisma migrate deploy` en el proceso de despliegue.

## 4. Siguientes mejoras sugeridas
- Catálogo dinámico de "otros consumos" (no solo agua/combustible).
- Histórico con filtros por rango de fechas y por campamento.
- Exportación a Excel/PDF.
- Auditoría de cambios por usuario.

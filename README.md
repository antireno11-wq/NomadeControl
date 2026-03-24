# Nómade Chile | Control Operacional (base simple)

Aplicacion web interna para control operacional de campamentos.

Objetivo: evitar que compromisos criticos queden sin responsable, seguimiento o cierre, y detectar riesgos antes de que escalen.

## Stack propuesto (simple y mantenible)
- Next.js 14 + React 18 + TypeScript
- CSS Modules (sin librerias UI)
- Persistencia local con `localStorage` (sin backend para esta base)

Por que este stack para la base:
- Ya esta instalado en este repo.
- Corre local con `npm run dev`.
- Facil de evolucionar luego a API + BD sin reescribir UI.

## Modulos incluidos
1. Obligaciones criticas
2. Hallazgos / pendientes
3. Dotacion minima
4. Dashboard

## Funcionalidades incluidas
- Tablas editables inline (inputs/select/fecha)
- Agregar y eliminar filas
- Filtros globales por proyecto, prioridad y estado
- Vista inline de los 4 modulos (sin cambiar de pestaña)
- Semaforo rojo/amarillo/verde en tablas y dashboard
- Dashboard con:
  - pendientes criticos abiertos
  - pendientes vencidos
  - obligaciones sin revision vigente
  - brechas de dotacion por proyecto
- Datos demo iniciales
- Guardado automatico en navegador (`localStorage`)

## Ejecutar local
Desde `campamentos-control`:

```bash
npm install
npm run dev
```

Abrir en navegador:
- `http://localhost:3000/operaciones`
- `http://localhost:3000/` redirige automaticamente a `operaciones`

## Archivos clave
- `src/app/operaciones/page.tsx`
- `src/app/operaciones/operaciones-app.tsx`
- `src/app/operaciones/operaciones.module.css`
- `src/app/page.tsx`

## Nota de esta version base
Esta version prioriza simplicidad operacional local.
Siguiente paso recomendado cuando valides el flujo: mover persistencia a API + base de datos y agregar autenticacion por roles.

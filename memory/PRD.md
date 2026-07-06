# Preservia — PRD

## Problem Statement
Herramienta móvil profesional para embalsamadores/tanatopraxia que combina cálculos técnicos (volúmenes, masa magra, concentraciones) con gestión de casos privados, notas con fotos, generación de reportes PDF y respaldo en la nube. Stack: Expo React Native + FastAPI + MongoDB.

## User Personas
- Embalsamador independiente que documenta casos en campo.
- Funeraria / profesional de tanatopraxia que necesita cálculos rápidos + registro respaldado.

## Architecture
- **Frontend:** Expo Router (file-based). Auth gate en `index.tsx`, tabs (Casos, Perfil), hub de caso con control segmentado (Cálculos/Notas/Reporte), modales de nuevo caso y calculadora. Tema oscuro slate sobrio, fuentes Geist/Geist Mono.
- **Backend:** FastAPI, rutas `/api`. JWT (bcrypt) + Google (flujo Emergent session-data, unificado a un solo modelo JWT). Cálculos con fórmulas estándar. PDF con reportlab (retornado como base64).
- **DB:** MongoDB — colecciones `users`, `cases` (cálculos embebidos), `notes` (texto + fotos base64). Respaldo en la nube vía persistencia server-side.

## Core Requirements (static)
- Login/registro email/contraseña + Google. Casos privados por usuario.
- Calculadoras: Volumen de solución, Masa magra (Boer), Concentración/Dilución.
- Notas con texto, fecha y fotos adjuntas. Reporte PDF por caso.

## Implemented (2026-07-06)
- Auth JWT + Google (Emergent), `/auth/me`, aislamiento por usuario.
- CRUD de casos, cálculos guardados por caso, notas con fotos base64.
- Endpoint `/api/calculate` y generación de PDF profesional (`/api/cases/{id}/report`).
- UI completa: login/registro, lista de casos con búsqueda/estado vacío/FAB, hub de caso, calculadoras con resultado en vivo, composer de notas con cámara/galería, pantalla de reporte, perfil/logout.
- Verificado: 25/25 pruebas backend + flujo frontend end-to-end.

## Backlog / Next
- P1: Migrar `expo-file-system/legacy` → API v19; reemplazar `shadow*` por `boxShadow` en web.
- P1: Editar caso desde la UI (endpoint PUT ya existe).
- P2: Compartir reporte por email; historial/estadísticas de casos.
- P2: Firmas/consentimientos digitales; modo offline con sync.
- P2: Suscripción/planes (Stripe/Razorpay).

## Notes / Mocks
- Ningún API mockeado. Fotos y PDFs viven en MongoDB (base64) — respaldo en la nube funcional vía BD, no object storage externo.

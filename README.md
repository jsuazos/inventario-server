# Inventario Musical API

Backend Express para el inventario musical. Persiste usuarios, inventario, wishlist y suscripciones push en Supabase; además actúa como proxy para Artistas, Fanart.tv y Discogs.

## Requisitos

- Node.js 22 o posterior.
- Un proyecto Supabase con el esquema de [supabase-schema.sql](./supabase-schema.sql).
- Una copia local de `.env` creada desde `.env.example`.

No se deben versionar valores reales de `.env`.

## Inicio local

```bash
npm install
npm start
```

El servidor escucha en `http://localhost:3000` por defecto. Para calidad local:

```bash
npm test
npm run lint
```

## Configuración

| Variable | Uso |
| --- | --- |
| `PORT` | Puerto HTTP; por defecto `3000`. |
| `SUPABASE_URL` | URL del proyecto Supabase. |
| `SUPABASE_SERVICE_KEY` | Service role key usada únicamente por el servidor. |
| `JWT_SECRET` | Secreto para firmar y verificar sesiones. |
| `JWT_EXPIRES_IN` | Duración de nuevos JWT; por defecto `30d`. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Credenciales de Web Push. |
| `ADMIN_USERS` | Usuarios administradores separados por coma; habilita diagnóstico y broadcast push. |
| `ALLOWED_PUBLIC_ORIGINS` | Orígenes CORS separados por coma. |
| `SECRET_TOKEN_INVENTARIO` | Identificador del Apps Script para el catálogo de artistas. |
| `DISCOGS_TOKEN`, `FANART_API_KEY` | Credenciales de proveedores externos. |
| `POLL_INTERVAL_MS` | Frecuencia del chequeo de cambios para push. |

## Autenticación

Las rutas protegidas requieren:

```http
Authorization: Bearer <token>
```

`POST /api/login` y `POST /api/register` responden con `{ token, usuario }`. Los nuevos registros requieren un usuario de 3 a 32 caracteres y contraseña de 10 a 128 caracteres. Login y registro tienen límites de intentos en memoria.

## Endpoints

| Método | Ruta | Auth | Descripción |
| --- | --- | :---: | --- |
| `GET` | `/api/health` | No | Estado del servicio. |
| `POST` | `/api/login` | No | Inicia sesión con `usuario` y `contrasena`. |
| `POST` | `/api/login/verify` | Sí | Verifica una sesión. |
| `POST` | `/api/register` | No | Registra una cuenta. |
| `GET` | `/api/inventario` | Sí | Devuelve los discos visibles del usuario. |
| `GET` | `/api/inventario/ocultos` | Sí | Devuelve los discos ocultos del usuario. |
| `POST` | `/api/inventario` | Sí | Crea un disco; requiere `Artista` y `Disco`. |
| `PUT` | `/api/inventario` | Sí | Edita `{ originalItem, item }`. |
| `PATCH` | `/api/inventario/recibido` | Sí | Marca `{ originalItem }` como recibido. |
| `DELETE` | `/api/inventario` | Sí | Oculta `{ originalItem }`. |
| `PATCH` | `/api/inventario/restaurar` | Sí | Restaura `{ originalItem }` al inventario visible. |
| `GET` | `/api/wishlist/me` | Sí | Devuelve la wishlist del usuario. |
| `POST` | `/api/wishlist` | Sí | Añade un item de wishlist. |
| `PUT` | `/api/wishlist/:rowId` | Sí | Edita un item de wishlist. |
| `DELETE` | `/api/wishlist/:rowId` | Sí | Elimina un item de wishlist. |
| `GET` | `/api/artistas` | No | Proxy del catálogo de artistas. |
| `GET` | `/api/fanart?mbid=...` | No | Proxy de Fanart.tv. |
| `GET` | `/api/discogs?q=...` | No | Busca lanzamientos en Discogs. |
| `GET` | `/api/discogs/release/:id` | No | Consulta un lanzamiento de Discogs. |
| `GET` | `/api/push/vapid-public-key` | No | Clave pública necesaria para Web Push. |
| `POST` | `/api/push/subscribe` | Sí | Guarda una suscripción push. |
| `DELETE` | `/api/push/subscribe` | Sí | Elimina una suscripción por `endpoint`. |
| `POST` | `/api/push/notify` | Admin | Envía un broadcast sujeto a cooldown. |
| `GET` | `/api/push/subscriptions` | Admin | Devuelve solo el total de suscripciones. |
| `GET` | `/api/push/check-sheet` | Admin | Diagnóstico de almacenamiento push. |

## Datos principales

El inventario usa las propiedades de interfaz `Artista`, `Disco`, `Año`, `Genero`, `Tipo`, `Formato`, `Recibido`, `Visible` e imágenes. En la base de datos se normalizan a columnas en minúsculas. Las rutas de edición, ocultamiento y recepción verifican que el registro pertenezca al usuario autenticado.

No se puede crear un duplicado para el mismo usuario y formato. Se identifica por ID de Discogs cuando existe; sin ese ID, por artista, disco y año normalizados. El mismo lanzamiento con otro formato sí se permite. Para una base existente, revisa y ejecuta primero [la migración de protección contra duplicados](./migrations/20260922_inventory_duplicate_protection.sql): no borra duplicados automáticamente.

## Operación

- El frontend se configura mediante `config.json` y apunta a la ruta base `/api`.
- El chequeo en segundo plano inicia junto al servidor y notifica cambios en inventario mediante Web Push, solo a los dispositivos del usuario que tuvo cambios.
- Para una base existente, ejecuta [la migración de propiedad de suscripciones push](./migrations/20260923_push_subscription_ownership.sql). Los dispositivos ya registrados deben volver a iniciar sesión para asociarse a su usuario.
- Revisa el esquema SQL antes de desplegar cambios de base de datos.

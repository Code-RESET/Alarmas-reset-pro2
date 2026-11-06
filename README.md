# Alarmas-reset-pro2
Esta es la nueva versión

## Inicio de sesión (correo y contraseña)

La app pide **iniciar sesión con correo y contraseña** (`js/auth-gate.js`). No se usa el login de Google: no abre ventana emergente, que era lo que se cerraba sola en el celular. Cada dispositivo inicia sesión una vez y la sesión queda guardada, también para usar la app sin señal.

Todos los dispositivos siguen compartiendo los mismos datos (`usuarios/compartido/...`), pero las reglas de Firestore solo dejan entrar a cuentas autorizadas: las que tienen un documento en la colección `permitidos` cuyo ID es el UID de la cuenta. Antes las reglas eran `if true` y cualquiera con la configuración pública del proyecto podía leer, alterar o borrar órdenes y pagos.

### Puesta en marcha — en este orden

> ⚠️ **No publiques las reglas nuevas antes del paso 4.** En cuanto se publiquen, cualquier teléfono sin sesión deja de ver los datos.

1. **Activar el método de acceso:** Firebase Console → Authentication → Sign-in method → **Correo electrónico/contraseña** → Habilitar. (No actives "Vínculo por correo".)
2. **Crear las cuentas:** Authentication → Users → **Agregar usuario** (correo y contraseña) para cada persona. Copia el **UID** de cada una.
3. **Autorizar las cuentas:** Firestore Database → Iniciar colección **`permitidos`** → un documento por cuenta con **ID = el UID** copiado y cualquier campo (por ejemplo `nombre: "Ángel"`).
   - Si alguien entra con una cuenta no autorizada, la app muestra "Cuenta sin acceso" con su UID para que lo copies.
4. **Publicar la app nueva** (GitHub Pages) e **iniciar sesión en cada teléfono y PC**. Mientras las reglas viejas sigan publicadas, todo funciona igual que antes.
5. **Publicar las reglas:** `firebase deploy --only firestore:rules` (o copiar `firestore.rules` en Firestore Database → Reglas → Publicar).
6. **Para quitar el acceso a alguien:** borra su documento en `permitidos` (y si quieres, desactiva la cuenta en Authentication).

Para cerrar sesión en un dispositivo: menú lateral → **Cerrar sesión**.

## Seguridad — pasos pendientes en consola (no se pueden hacer desde el código)

Protecciones adicionales al inicio de sesión:

1. **App Check (capa extra: bloquea scripts que no sean esta app) — YA REGISTRADO**
   - App web registrada en Firebase Console → App Check con proveedor **reCAPTCHA Enterprise** (Firebase ya no ofrece reCAPTCHA v3 clásico para apps nuevas). La site key ya está en `js/firebase-init.js` (`APP_CHECK_SITE_KEY`).
   - Falta: esperar unos días usando la app con normalidad y viendo en Firebase Console → App Check → Apps cómo sube el % de peticiones "verificadas".
   - Solo cuando ese % esté alto, activar App Check → APIs → Cloud Firestore → **Enforce**. Esto es lo que realmente bloquea a cualquiera que no use esta app — y se puede revertir con un toque desde ahí mismo si algo falla. Firestore rules no se toca para esto.

2. **Endpoint `exportManual` protegido con secreto** (ya en el código)
   - `firebase functions:secrets:set EXPORT_MANUAL_TOKEN` (cualquier valor largo/aleatorio).
   - Llamar al endpoint con el header `X-Export-Token: <ese valor>`. Sin este secreto configurado, el endpoint responde 403 a cualquiera — cerrado por defecto, no abierto.

3. **Backups de Firestore** (ningún cambio de código; 1 clic en consola)
   - Firebase Console → Firestore Database → Backups → crear un programa de backups diario/semanal. Protege contra un borrado accidental o un error de la app.

4. **Alertas de presupuesto** (evita sorpresas de facturación si alguien abusa de la API)
   - Google Cloud Console → Billing → Budgets & Alerts → crear un presupuesto mensual con aviso al 50/90/100%.

5. **Restringir la API key de Firebase** (reduce abuso de cuota, opcional/adicional a App Check)
   - Google Cloud Console → APIs & Services → Credentials → la key de este proyecto → restringirla a las APIs que realmente usa la app (Firestore, Cloud Messaging).

## Modo offline

La app funciona normalmente sin internet: lee la última copia conocida de los datos guardada en el dispositivo (persistencia offline nativa de Firestore, además de la cola de sincronización propia para las escrituras). Los cambios hechos sin conexión se suben solos en cuanto vuelve la señal.

## Correcciones incluidas en esta actualización

- Se quitó el inicio de sesión obligatorio y todo el código de Firebase Authentication que quedaba — decisión explícita para evitar bloqueos de login en algunos dispositivos.
- Se activó la persistencia offline de Firestore — antes, si no había red al abrir la app, la lista de órdenes/clientes/citas se quedaba vacía indefinidamente.
- Corregido un hueco de seguridad (XSS) en el nombre y garantía de producto al imprimir/compartir una boleta.
- Se agregó un límite contra doble envío al guardar una orden nueva (evitaba duplicados).
- Si falla el guardado de una cita, la pantalla ahora revierte al estado real en vez de quedar desincronizada.
- `checklist.html` (cotizaciones) todavía tenía el login de Google completo (pantalla de "Iniciar sesión", `getAuth`, `signInWithPopup`, etc.), a pesar de que ya no queda ningún flujo funcional para completarlo — quedaba bloqueando esa pantalla. Se quitó y ahora usa la misma ruta de datos compartida (`usuarios/compartido/...`) que el resto de la app, con persistencia offline igual que `index.html`.
- Se eliminaron 3 funciones muertas (nunca llamadas): `resetPanelCompleto` y `_detenerListenersFirebase` en `checklist.html`, `_detenerListenersFirestore` en `index.html` — sobrantes del login que ya no existe.
- Se eliminaron los íconos `icon-192.svg` e `icon-512.svg`, sin ninguna referencia en el proyecto (el manifest usa las versiones `.png`).

## Pruebas

En `tests/` (requiere Node 18+ y Java para los emuladores de Firebase):

```bash
cd tests
npm install
npx playwright install chromium   # solo la primera vez
npm test
```

- `npm run test:functions` — utilidades de fecha de las Cloud Functions (no necesita emuladores).
- `npm run test:emuladores` — levanta los emuladores de Auth y Firestore y corre:
  - **Reglas** (`rules.test.mjs`): sin sesión o sin autorización no se lee ni escribe nada; `permitidos` no se puede editar desde la app.
  - **Punta a punta** (`e2e.test.cjs`): la app real en Chromium — login, cuenta no autorizada, abonos por transacción, edición concurrente que conserva abonos, archivado, cambio de estado con verificación, folio de cotización compartido y redirección de `checklist.html`.

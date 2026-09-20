# Alarmas-reset-pro2
Esta es la nueva versión

## Sincronización sin inicio de sesión

Por decisión explícita del dueño de los datos, esta app **ya no pide iniciar sesión con Google**. Todos los dispositivos leen y escriben la misma ruta compartida en Firestore (`usuarios/compartido/...`), protegida únicamente por las reglas del proyecto — no hay control de acceso por cuenta.

**Importante:** con esto, cualquier persona que conozca la configuración de Firebase de este proyecto puede leer y editar los datos. Se optó por esto deliberadamente para evitar los problemas de inicio de sesión (ventana emergente que se cerraba sola sin completar el login en el celular). El código de Firebase Authentication (Google Sign-In) fue eliminado por completo del proyecto — no queda ningún rastro de esa integración.

## Seguridad — pasos pendientes en consola (no se pueden hacer desde el código)

El código ya trae protecciones listas pero **inactivas hasta que las configures** (para no romper nada por sorpresa). Ninguna de estas requiere volver a pedir login:

1. **App Check (recomendado, es el reemplazo real del login para bloquear acceso ajeno) — YA REGISTRADO**
   - App web registrada en Firebase Console → App Check con proveedor **reCAPTCHA Enterprise** (Firebase ya no ofrece reCAPTCHA v3 clásico para apps nuevas). La site key ya está en `js/firebase-init.js` (`APP_CHECK_SITE_KEY`).
   - Falta: esperar unos días usando la app con normalidad y viendo en Firebase Console → App Check → Apps cómo sube el % de peticiones "verificadas".
   - Solo cuando ese % esté alto, activar App Check → APIs → Cloud Firestore → **Enforce**. Esto es lo que realmente bloquea a cualquiera que no use esta app — y se puede revertir con un toque desde ahí mismo si algo falla. Firestore rules no se toca para esto.

2. **Endpoint `exportManual` protegido con secreto** (ya en el código)
   - `firebase functions:secrets:set EXPORT_MANUAL_TOKEN` (cualquier valor largo/aleatorio).
   - Llamar al endpoint con el header `X-Export-Token: <ese valor>`. Sin este secreto configurado, el endpoint responde 403 a cualquiera — cerrado por defecto, no abierto.

3. **Backups de Firestore** (ningún cambio de código; 1 clic en consola)
   - Firebase Console → Firestore Database → Backups → crear un programa de backups diario/semanal. Protege contra un borrado accidental o malicioso mientras la ruta siga abierta.

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

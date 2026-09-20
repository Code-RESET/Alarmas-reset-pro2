// ═══════════════════════════════════════
// MÓDULO: firebase-init.js
// Extraído 1:1 de index.html (ago-2026) — misma lógica, mismo comportamiento.
// Expone en window(): _useFirebase, _uid, _firebaseDb, _firebaseModules,
// _activarNotificaciones — exactamente igual que antes, para que el resto
// del código (aún en index.html) siga funcionando sin cambios.
// ═══════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { collection, addDoc, updateDoc, deleteDoc, doc, setDoc, onSnapshot, orderBy, query, limit, getDocs, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getMessaging, getToken, isSupported, onMessage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";

// ══════════════════════════════════════════════════
// 🔥 CONFIGURACIÓN FIREBASE — REEMPLAZA CON TUS DATOS
// ══════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyAOUGIWvrPtdKf9pnoYlh3NIHHiBO_R7mE",
  authDomain: "alarmas-reset-e3484.firebaseapp.com",
  projectId: "alarmas-reset-e3484",
  storageBucket: "alarmas-reset-e3484.firebasestorage.app",
  messagingSenderId: "1096561116547",
  appId: "1:1096561116547:web:b13df05c092785723aa2b6",
  measurementId: "G-TJD208HVFB"
};
// 🔔 NOTIFICACIONES PUSH — genera esta clave en:
// Firebase Console → Configuración del proyecto → Cloud Messaging →
// "Certificados push web" → Generar par de claves. Pega aquí la clave pública.
const VAPID_KEY = 'PEGA_AQUI_TU_VAPID_KEY';
// 🛡️ APP CHECK — evita que scripts ajenos usen esta config de Firebase fuera
// de esta app. Registrada en Firebase Console → App Check → app web →
// reCAPTCHA Enterprise (Firebase ya no ofrece reCAPTCHA v3 clásico para
// apps nuevas). Configurarla aquí NO bloquea nada todavía — el bloqueo real
// solo empieza cuando se active "Enforce" para Firestore en Firebase
// Console → App Check → APIs, paso reversible con un toque en cualquier
// momento desde ahí mismo si algo falla.
const APP_CHECK_SITE_KEY = '6Lc66MUtAAAAAAzD3qsjDRaEV8o-T3l9RFB4D4DG';
const fbConfigured = firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes('TU_')
  && firebaseConfig.projectId && !String(firebaseConfig.projectId).includes('TU_');
window._useFirebase = false;
// Sin login: todos los dispositivos comparten la misma ruta de datos,
// protegida solo por reglas de Firestore abiertas (ver README). No se usa
// Firebase Auth en absoluto — un residuo de sesión de Google guardado en el
// navegador de una versión anterior ya no puede desviar los datos a otra ruta.
window._uid = 'compartido';
if (fbConfigured) {
  try {
    const app = initializeApp(firebaseConfig);
    // Solo se activa si ya pegaste tu clave real arriba — ver comentario de
    // APP_CHECK_SITE_KEY. Envuelto en su propio try/catch para que, si algo
    // sale mal (clave inválida, red, etc.), el resto de la app siga
    // funcionando exactamente igual que hoy.
    if (!String(APP_CHECK_SITE_KEY).includes('PEGA_AQUI')) {
      try {
        initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
          isTokenAutoRefreshEnabled: true
        });
      } catch(e) {
        console.warn('App Check no inicializado:', e);
      }
    }
    // Persistencia offline nativa de Firestore: además de la cola propia que
    // ya reintenta las escrituras fallidas, esto hace que las LECTURAS
    // también funcionen sin internet (antes, si no había red al abrir la
    // app, la lista de órdenes/clientes/citas se quedaba vacía indefinidamente
    // porque el listener de Firestore nunca recibía su primer resultado)
    const db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
    window._firebaseDb = db;
    window._firebaseModules = { collection, addDoc, updateDoc, deleteDoc, doc, setDoc, onSnapshot, orderBy, query, limit, getDocs, runTransaction };
    window._useFirebase = true;

    // 🔔 Notificaciones push (FCM) — requiere VAPID_KEY configurada arriba.
    window._activarNotificaciones = async () => {
      if (!(await isSupported().catch(()=>false))) { window.dispatchEvent(new CustomEvent('pushResult', { detail: { ok:false, msg:'Este navegador no soporta notificaciones push.' } })); return; }
      if (String(VAPID_KEY).includes('PEGA_AQUI')) { window.dispatchEvent(new CustomEvent('pushResult', { detail: { ok:false, msg:'Falta configurar la VAPID key (ver comentario en el código).' } })); return; }
      if (!window._uid) { window.dispatchEvent(new CustomEvent('pushResult', { detail: { ok:false, msg:'Inicia sesión primero.' } })); return; }
      try {
        const permiso = await Notification.requestPermission();
        if (permiso !== 'granted') { window.dispatchEvent(new CustomEvent('pushResult', { detail: { ok:false, msg:'Permiso de notificaciones denegado.' } })); return; }
        const reg = await navigator.serviceWorker.ready;
        const messaging = getMessaging(app);
        const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
        if (!token) { window.dispatchEvent(new CustomEvent('pushResult', { detail: { ok:false, msg:'No se pudo obtener el token de notificaciones.' } })); return; }
        await setDoc(doc(db, 'usuarios', window._uid, 'fcm_tokens', token), { token, ua: navigator.userAgent, fecha: Date.now() });
        onMessage(messaging, payload => {
          window.dispatchEvent(new CustomEvent('pushForeground', { detail: payload }));
        });
        window.dispatchEvent(new CustomEvent('pushResult', { detail: { ok:true, msg:'✅ Notificaciones activadas' } }));
      } catch(e) {
        console.error(e);
        window.dispatchEvent(new CustomEvent('pushResult', { detail: { ok:false, msg:'Error: ' + e.message } }));
      }
    };
  } catch(e) {
    console.warn('Firebase no inicializado:', e);
    window._useFirebase = false;
  }
}
// FIX (ago-2026): antes esto se disparaba de forma SÍNCRONA, justo al
// terminar de ejecutarse este módulo. Como firebase-init.js es el primer
// módulo del documento, el evento 'firebaseReady' llegaba a initAppData()
// -> cargarOrdenes() ANTES de que data-ordenes.js (que viene después en la
// lista de módulos) hubiera terminado de ejecutarse y definir esa función
// en window — causando "ReferenceError: cargarOrdenes is not defined" y
// dejando la app sin datos. setTimeout(...,0) difiere el disparo a la
// siguiente vuelta del bucle de eventos, momento en el que TODOS los
// módulos (incluido data-ordenes.js, data-clientes.js, data-citas.js) ya
// terminaron de ejecutarse, sin excepción.
setTimeout(() => window.dispatchEvent(new Event('firebaseReady')), 0);

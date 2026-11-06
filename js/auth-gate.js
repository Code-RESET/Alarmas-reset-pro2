// ═══════════════════════════════════════
// MÓDULO: auth-gate.js — inicio de sesión con correo y contraseña.
//
// Por qué: sin login, las reglas de Firestore tenían que estar abiertas
// (`if true`) y cualquiera con la config pública del proyecto podía leer,
// alterar o borrar órdenes, pagos y clientes.
//
// Correo/contraseña en vez de Google: no abre ventana emergente (la que se
// cerraba sola en el celular). Cada dispositivo inicia sesión una vez; la
// sesión queda guardada en el navegador y se restaura también SIN señal,
// así que el modo offline sigue funcionando igual.
//
// Los datos siguen en la misma ruta compartida (usuarios/compartido/...):
// solo cambia QUIÉN puede leerla. Las reglas (firestore.rules) permiten el
// acceso únicamente a cuentas que tengan un documento en permitidos/{uid}.
// ═══════════════════════════════════════
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const MENSAJES = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  'auth/network-request-failed': 'Sin conexión. Para el primer inicio de sesión se necesita internet.',
  'auth/user-disabled': 'Esta cuenta está desactivada.'
};
const msg = e => MENSAJES[e && e.code] || ('No se pudo iniciar sesión (' + ((e && (e.code || e.message)) || e) + ').');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#x27;' }[c]));
}

function overlay() {
  let el = document.getElementById('auth-gate');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'auth-gate';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'auth-gate-title');
  el.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg,#0a0a0f);color:var(--text,#f0f0f5);font-family:var(--font-body,system-ui,sans-serif)';
  const montar = () => document.body.appendChild(el);
  if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar, { once: true });
  return el;
}

const CAJA = 'width:100%;max-width:360px;background:var(--surface,#13131a);border:1px solid var(--border,#2a2a38);border-radius:14px;padding:24px';
const INPUT = 'width:100%;box-sizing:border-box;padding:12px 14px;margin-top:6px;border-radius:8px;border:1px solid var(--border,#2a2a38);background:var(--surface2,#1c1c26);color:inherit;font-size:16px';
const BTN = 'width:100%;padding:13px;border:none;border-radius:8px;background:var(--accent,#ff6b35);color:#fff;font-weight:700;font-size:15px;cursor:pointer';
const LINK = 'background:none;border:none;color:var(--muted,#8a8aa0);font-size:13px;cursor:pointer;text-decoration:underline;padding:8px 0';

function mostrarLogin(auth) {
  const el = overlay();
  el.style.display = 'flex';
  el.innerHTML = `
    <form style="${CAJA}" novalidate>
      <h1 id="auth-gate-title" style="font-family:var(--font-display,inherit);font-size:22px;margin:0 0 4px">RESET Alarmas y GPS</h1>
      <p style="margin:0 0 20px;color:var(--muted,#8a8aa0);font-size:14px">Inicia sesión para ver y editar las órdenes.</p>
      <label style="display:block;font-size:13px;font-weight:600">Correo
        <input id="ag-email" type="email" autocomplete="username" inputmode="email" required style="${INPUT}"></label>
      <label style="display:block;font-size:13px;font-weight:600;margin-top:14px">Contraseña
        <input id="ag-pass" type="password" autocomplete="current-password" required style="${INPUT}"></label>
      <div id="ag-error" role="alert" style="min-height:20px;margin:12px 0;color:var(--red,#ef233c);font-size:13px"></div>
      <button id="ag-btn" type="submit" style="${BTN}">Entrar</button>
      <button id="ag-reset" type="button" style="${LINK}">¿Olvidaste tu contraseña?</button>
    </form>`;
  const form = el.querySelector('form');
  const $ = id => el.querySelector('#' + id);
  const err = t => { $('ag-error').textContent = t; };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('ag-email').value.trim(), pass = $('ag-pass').value;
    if (!email || !pass) { err('Escribe tu correo y contraseña.'); return; }
    $('ag-btn').disabled = true; $('ag-btn').textContent = 'Entrando…'; err('');
    try {
      // Si App Check/reCAPTCHA o la red no responden, no dejar el botón girando para siempre.
      await Promise.race([
        signInWithEmailAndPassword(auth, email, pass),
        new Promise((_, rej) => setTimeout(() => rej({ code: 'auth/network-request-failed' }), 20000))
      ]);
    }
    catch (e2) { err(msg(e2)); $('ag-btn').disabled = false; $('ag-btn').textContent = 'Entrar'; }
  });
  $('ag-reset').addEventListener('click', async () => {
    const email = $('ag-email').value.trim();
    if (!email) { err('Escribe tu correo arriba y vuelve a tocar "¿Olvidaste tu contraseña?".'); return; }
    try { await sendPasswordResetEmail(auth, email); err(''); $('ag-error').style.color = 'var(--green,#06d6a0)'; $('ag-error').textContent = 'Si el correo está registrado, te llegará un enlace para cambiar la contraseña.'; }
    catch (e2) { err(msg(e2)); }
  });
  setTimeout(() => $('ag-email')?.focus(), 50);
}

function mostrarNoAutorizado(auth, user) {
  const el = overlay();
  el.style.display = 'flex';
  el.innerHTML = `
    <div style="${CAJA}">
      <h1 id="auth-gate-title" style="font-family:var(--font-display,inherit);font-size:20px;margin:0 0 10px">Cuenta sin acceso</h1>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.5">La cuenta <strong>${esc(user.email)}</strong> todavía no está autorizada. Pide al administrador que la agregue en Firestore → <code>permitidos</code> con este ID:</p>
      <code id="ag-uid" style="display:block;word-break:break-all;padding:10px;border-radius:8px;background:var(--surface2,#1c1c26);font-size:13px;margin-bottom:16px;user-select:all">${esc(user.uid)}</code>
      <button id="ag-retry" type="button" style="${BTN}">Ya me autorizaron, reintentar</button>
      <button id="ag-out" type="button" style="${LINK}">Usar otra cuenta</button>
    </div>`;
  el.querySelector('#ag-retry').addEventListener('click', () => location.reload());
  el.querySelector('#ag-out').addEventListener('click', () => signOut(auth));
}

function ocultar() {
  const el = document.getElementById('auth-gate');
  if (el) el.remove();
}

/**
 * Bloquea la página hasta que haya una sesión autorizada.
 * @param app   instancia de Firebase
 * @param db    instancia de Firestore (para verificar permitidos/{uid})
 * @param onListo  se llama UNA vez cuando la sesión está lista
 * @param opciones.redirigirA  si se indica, en vez de mostrar el formulario
 *                 se manda a esa página (checklist.html → index.html)
 */
export function protegerConLogin(app, db, onListo, opciones = {}) {
  const auth = getAuth(app);
  window._authPendiente = true;
  let listo = false;
  window.cerrarSesion = async () => {
    try { await signOut(auth); } catch (e) { console.error(e); }
  };
  onAuthStateChanged(auth, async user => {
    if (!user) {
      window._authUser = null;
      // Se cerró sesión con la app ya cargada: recargar para soltar los
      // listeners y los datos en memoria.
      if (listo) { location.reload(); return; }
      if (opciones.redirigirA) { location.replace(opciones.redirigirA); return; }
      mostrarLogin(auth);
      return;
    }
    window._authUser = user;
    // ¿La cuenta está autorizada? Si no hay señal, getDoc puede fallar o
    // leer de la caché: en ese caso se deja pasar (las reglas del servidor
    // siguen siendo la protección real; sin autorización no se sube nada).
    try {
      const snap = await getDoc(doc(db, 'permitidos', user.uid));
      if (!snap.exists()) { mostrarNoAutorizado(auth, user); return; }
    } catch (e) {
      if (e && e.code === 'permission-denied') { mostrarNoAutorizado(auth, user); return; }
      console.warn('No se pudo verificar la autorización (sin señal?):', e);
    }
    ocultar();
    window._authPendiente = false;
    if (!listo) { listo = true; onListo(user); }
  });
}

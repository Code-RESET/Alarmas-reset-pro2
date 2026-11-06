// ═══════════════════════════════════════
// MÓDULO: firestore-paths.js
// Extraído 1:1 de index.html (ago-2026) — mismas funciones, mismo
// comportamiento. Puras: solo arman referencias de Firestore a partir de
// window._firebaseDb / window._uid (fijados por firebase-init.js).
// Se exponen en window() para que el resto del código (aún en index.html,
// como script clásico no-modular) las siga llamando igual: colOrdenes(),
// docOrden(id), etc. — sin cambiar ni un call site.
// ═══════════════════════════════════════

function colOrdenes() {
  const { collection } = window._firebaseModules;
  return collection(window._firebaseDb, 'usuarios', window._uid, 'ordenes');
}
function docOrden(id) {
  const { doc } = window._firebaseModules;
  return doc(window._firebaseDb, 'usuarios', window._uid, 'ordenes', id);
}
function colExportLogs() {
  const { collection } = window._firebaseModules;
  return collection(window._firebaseDb, 'usuarios', window._uid, 'export_logs');
}
function colClientes() {
  const { collection } = window._firebaseModules;
  return collection(window._firebaseDb, 'usuarios', window._uid, 'clientes');
}
function docCliente(id) {
  const { doc } = window._firebaseModules;
  return doc(window._firebaseDb, 'usuarios', window._uid, 'clientes', id);
}
function colCitas() {
  const { collection } = window._firebaseModules;
  return collection(window._firebaseDb, 'usuarios', window._uid, 'citas');
}
function docCita(id) {
  const { doc } = window._firebaseModules;
  return doc(window._firebaseDb, 'usuarios', window._uid, 'citas', id);
}
// FIX (ago-2026): esta función no existía — archivarOrdenesDelMes() la
// referenciaba sin declarar, lo que lanzaba ReferenceError en silencio
// (atrapado por el catch) y por eso las órdenes archivadas NUNCA se
// borraban de Firestore: se acumulaban para siempre en 'ordenes',
// haciendo crecer el listener sin límite mes tras mes.
function colArchivados() {
  const { collection } = window._firebaseModules;
  return collection(window._firebaseDb, 'usuarios', window._uid, 'ordenes_archivadas');
}
// Gastos de materiales generales (herramientas, cable, terminales, etc.) —
// no van ligados a una orden específica. Mismo patrón que colClientes().
function colGastos() {
  const { collection } = window._firebaseModules;
  return collection(window._firebaseDb, 'usuarios', window._uid, 'gastos');
}
function docGasto(id) {
  const { doc } = window._firebaseModules;
  return doc(window._firebaseDb, 'usuarios', window._uid, 'gastos', id);
}

// Exponer en window para que index.html (script clásico) las siga usando
// como funciones globales, exactamente igual que antes de modularizar.
window.colOrdenes = colOrdenes;
window.docOrden = docOrden;
window.colExportLogs = colExportLogs;
window.colClientes = colClientes;
window.docCliente = docCliente;
window.colCitas = colCitas;
window.docCita = docCita;
window.colArchivados = colArchivados;
window.colGastos = colGastos;
window.docGasto = docGasto;

// ═══════════════════════════════════════
// Escrituras que no se quedan colgadas sin señal.
// Firestore usa caché persistente (IndexedDB): una escritura hecha sin
// conexión queda guardada en el dispositivo y se sube sola al volver la red,
// aunque se cierre la app. Pero la promesa de setDoc/updateDoc no se
// resuelve hasta que el servidor confirma, así que hacer `await` sin red
// dejaba los modales abiertos indefinidamente. _fsEscribir espera la
// confirmación unos segundos; si no llega, devuelve 'pendiente' (la
// escritura ya está en la cola local de Firestore). Un rechazo real del
// servidor (reglas, datos inválidos) sí se propaga como error si llega a
// tiempo, y se avisa con toast si llega después.
// ═══════════════════════════════════════
function _fsEscribir(promesa, ms = 4000) {
  let tarde = false;
  promesa.catch(e => {
    if (tarde) {
      console.error('Escritura rechazada por Firestore:', e);
      window.toast && window.toast('⚠️ Un cambio no se pudo guardar en la nube: ' + (e.code || e.message || e));
    }
  });
  return Promise.race([
    promesa.then(() => 'ok'),
    new Promise(res => setTimeout(() => { tarde = true; res('pendiente'); }, ms))
  ]);
}
// Referencia nueva con ID generado en el cliente (sin esperar al servidor).
function nuevoDoc(col) {
  const { doc } = window._firebaseModules;
  return doc(col);
}
window._fsEscribir = _fsEscribir;
window.nuevoDoc = nuevoDoc;

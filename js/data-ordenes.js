// ═══════════════════════════════════════
// MÓDULO: data/ordenes.js
// Extraído de index.html (ago-2026) — misma lógica, mismo comportamiento.
// Como es un módulo ES6, no comparte el scope léxico del <script> clásico
// donde vive el resto de la app. Por eso todo lo que antes se llamaba "a
// pelo" (ordenes, IDB, renderAll, toast, colOrdenes, etc.) aquí se llama
// con prefijo window. — son las mismas funciones/variables globales de
// siempre, solo que accedidas explícitamente vía el objeto global que sí
// comparten todos los scripts de la página.
//
// fsListenerStarted / _unsubOrdenes quedan como estado privado de este
// módulo (antes eran variables del <script> principal, pero solo las usaba
// cargarOrdenes(), así que viven mejor aquí).
// ═══════════════════════════════════════

let fsListenerStarted = false;
let _unsubOrdenes = null;

async function cargarOrdenesLocal() {
  await window.IDB.init();
  try {
    if (window.IDB.db) {
      const data = await window.IDB.getAll();
      if (data && data.length > 0) {
        window.ordenes = data.sort((a,b)=>(b.fecha_creacion||0)-(a.fecha_creacion||0));
        window.renderAll(); window._ordenesListas = true; return;
      }
      const ls = localStorage.getItem('alarmas_ordenes');
      if (ls) {
        try { window.ordenes = JSON.parse(ls); await window.IDB.putAll(window.ordenes); } catch(e) { window.ordenes = []; }
        window.renderAll(); window._ordenesListas = true; return;
      }
    }
    const data = localStorage.getItem('alarmas_ordenes');
    window.ordenes = data ? JSON.parse(data) : [];
  } catch(e) {
    window.ordenes = [];
    console.error(e);
  }
  window.renderAll();
  window._ordenesListas = true;
}

async function cargarOrdenes() {
  if (window._useFirebase && window._firebaseDb && window._firebaseModules && window._uid) {
    try {
      const { onSnapshot, orderBy, query, limit } = window._firebaseModules;
      // Tope de seguridad: con el archivado mensual ya reparado, la colección
      // activa debería quedarse chica siempre. Este limit() es solo una red
      // de protección para que el listener nunca vuelva a leer una colección
      // sin control si el archivado falla por cualquier otra razón futura.
      const q = query(window.colOrdenes(), orderBy('fecha_creacion','desc'), limit(window.ORDENES_LIMIT_SEGURIDAD));
      if (!fsListenerStarted) {
        fsListenerStarted = true;
        _unsubOrdenes = onSnapshot(q, snap => {
          window.ordenes = snap.docs.map(d=>({id:d.id,...d.data()}));
          window.renderAll();
          window._ordenesListas = true;
        }, err => {
          console.error(err);
          if (!window._uid) return; // sesión ya cerrada — listener obsoleto, ignorar
          window.toast('⚠️ Firestore no disponible — modo local');
          window._useFirebase = false;
          fsListenerStarted = false;
          window.updateFirebaseBadge();
          cargarOrdenesLocal();
        });
      }
      return;
    } catch(e) { console.error(e); }
  }
  cargarOrdenesLocal();
}

// Campos de dinero que el formulario de edición NO debe pisar a ciegas:
// otro dispositivo pudo registrar un abono (o cambiar el estado) mientras
// este tenía el formulario abierto.
//   base = { a_cuenta_total, estado } tal como estaban al abrir el formulario.
// Si el usuario no tocó "A cuenta" ni "Estado", se conservan los valores del
// servidor. Si sí los tocó, "A cuenta" se ajusta por la DIFERENCIA (así un
// abono concurrente no se pierde) y queda un registro del ajuste en abonos.
function _parcheEdicion(orden, base) {
  const parche = {...orden};
  delete parche.id; delete parche.a_cuenta_total; delete parche.abonos; delete parche.estado;
  const deltaACuenta = Math.round(((orden.a_cuenta_total||0) - (base?.a_cuenta_total||0)) * 100) / 100;
  const estadoCambiado = !base || (orden.estado||'') !== (base.estado||'');
  return { parche, deltaACuenta, estadoCambiado };
}

async function guardarOrden(orden, base) {
  if (window._useFirebase && window._firebaseDb && window._uid) {
    try {
      const { setDoc, updateDoc, runTransaction, increment, arrayUnion } = window._firebaseModules;
      if (orden.id) {
        const id = orden.id;
        const ref = window.docOrden(id);
        const { parche, deltaACuenta, estadoCambiado } = _parcheEdicion(orden, base);
        const ajuste = deltaACuenta ? { monto: deltaACuenta, fecha: Date.now(), id: 'aj_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6), tipo: 'ajuste' } : null;
        if (navigator.onLine) {
          try {
            await runTransaction(window._firebaseDb, async (tx) => {
              const snap = await tx.get(ref);
              if (!snap.exists()) throw new Error('ORDEN_NO_EXISTE');
              const srv = snap.data();
              const upd = {...parche};
              if (ajuste) {
                upd.a_cuenta_total = Math.round(((srv.a_cuenta_total||0) + deltaACuenta) * 100) / 100;
                upd.abonos = [...(srv.abonos||[]), ajuste];
              }
              if (estadoCambiado) upd.estado = orden.estado;
              tx.update(ref, upd);
            });
            return 'ok';
          } catch(e) {
            if (e.message === 'ORDEN_NO_EXISTE') { window.toast('⚠️ Esta orden ya no existe'); throw e; }
            if (e.code && e.code !== 'unavailable' && e.code !== 'failed-precondition') throw e;
            // sin red real: sigue al camino offline
          }
        }
        // Sin conexión: transformaciones atómicas (increment/arrayUnion) que
        // Firestore guarda en su cola persistente y aplica en el servidor sin
        // sobrescribir lo que otro dispositivo haya escrito.
        const upd = {...parche};
        if (ajuste) { upd.a_cuenta_total = increment(deltaACuenta); upd.abonos = arrayUnion(ajuste); }
        if (estadoCambiado) upd.estado = orden.estado;
        return await window._fsEscribir(updateDoc(ref, upd));
      } else {
        const data = {...orden};
        data.fecha_creacion = Date.now();
        const ref = window.nuevoDoc(window.colOrdenes());
        return await window._fsEscribir(setDoc(ref, data));
      }
    } catch(e) {
      console.error(e);
      if (e.message !== 'ORDEN_NO_EXISTE') window.toast('⚠️ No se pudo guardar la orden: ' + (e.code || e.message || e));
      throw e;
    }
  }
  if (orden.id) {
    const idx = window.ordenes.findIndex(o=>o.id===orden.id);
    if (idx >= 0) window.ordenes[idx] = {...window.ordenes[idx], ...orden};
    else window.ordenes.unshift(orden);
  } else {
    orden.id = 'local_'+Date.now();
    orden.fecha_creacion = Date.now();
    window.ordenes.unshift(orden);
  }
  window.guardarLocal();
  window.renderAll();
  return 'ok';
}

async function eliminarOrden(id) {
  const ok = await window.confirmarAccion('Eliminar orden', '¿Eliminar esta orden? Esta acción no se puede deshacer.', '🗑️', 'Eliminar');
  if (!ok) return;
  if (window._useFirebase && window._firebaseDb && window._uid) {
    try {
      const { deleteDoc } = window._firebaseModules;
      await window._fsEscribir(deleteDoc(window.docOrden(id)));
      window.toast('Orden eliminada');
      return;
    } catch(e) {
      console.error(e);
      window.toast('⚠️ Error al eliminar: ' + (e.message || e));
      return;
    }
  }
  window.ordenes = window.ordenes.filter(o => o.id !== id);
  window.guardarLocal();
  window.renderAll();
  window.toast('Orden eliminada');
}

// Exponer en window para que index.html (script clásico) y los onclick
// inline del HTML (ej. onclick="eliminarOrden('${o.id}')") las sigan
// llamando exactamente igual que antes.
window.cargarOrdenesLocal = cargarOrdenesLocal;
window.cargarOrdenes = cargarOrdenes;
window.guardarOrden = guardarOrden;
window.eliminarOrden = eliminarOrden;

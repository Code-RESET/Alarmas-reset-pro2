// ═══════════════════════════════════════
// MÓDULO: data-gastos.js
// Gastos de materiales generales (herramientas, cable, terminales, cinta,
// etc.) — no ligados a una orden específica. Mismo patrón exacto que
// data-clientes.js: listener en tiempo real con Firebase, respaldo en
// localStorage si no hay Firebase, mismas convenciones de nombres.
// ═══════════════════════════════════════

let gastosListenerStarted = false;
let _unsubGastos = null;

async function cargarGastosLocal() {
  try {
    const data = localStorage.getItem('alarmas_gastos');
    window.gastos = data ? JSON.parse(data) : [];
  } catch(e) { window.gastos = []; }
  window.renderGastos();
}

function guardarGastosLocal() {
  try { localStorage.setItem('alarmas_gastos', JSON.stringify(window.gastos)); } catch(e) {}
}

async function cargarGastos() {
  if (window._useFirebase && window._firebaseDb && window._firebaseModules && window._uid) {
    try {
      const { onSnapshot, orderBy, query } = window._firebaseModules;
      const q = query(window.colGastos(), orderBy('fecha','desc'));
      if (!gastosListenerStarted) {
        gastosListenerStarted = true;
        _unsubGastos = onSnapshot(q, snap => {
          window.gastos = snap.docs.map(d=>({id:d.id,...d.data()}));
          window.renderGastos();
        }, err => {
          console.error(err);
          if (!window._uid) return; // sesión ya cerrada — listener obsoleto, ignorar
          gastosListenerStarted = false;
          cargarGastosLocal();
        });
      }
      return;
    } catch(e) { console.error(e); }
  }
  cargarGastosLocal();
}

async function guardarGasto(gasto) {
  const data = {...gasto};
  if (window._useFirebase && window._firebaseDb && window._uid) {
    try {
      const { addDoc, updateDoc } = window._firebaseModules;
      if (data.id) {
        const id = data.id; delete data.id;
        await updateDoc(window.docGasto(id), data);
        return id;
      } else {
        const ref = await addDoc(window.colGastos(), data);
        return ref.id;
      }
    } catch(e) {
      console.error(e);
      window.toast('⚠️ No se pudo guardar el gasto en Firebase');
      return null;
    }
  }
  if (data.id) {
    const idx = window.gastos.findIndex(g=>g.id===data.id);
    if (idx>=0) window.gastos[idx] = data;
  } else {
    data.id = 'local_gasto_'+Date.now();
    window.gastos.unshift(data);
  }
  guardarGastosLocal();
  window.renderGastos();
  return data.id;
}

async function eliminarGasto(id) {
  const ok = await window.confirmarAccion('Eliminar gasto', '¿Eliminar este gasto?', '🗑️', 'Eliminar');
  if (!ok) return;
  if (window._useFirebase && window._firebaseDb && window._uid) {
    try {
      const { deleteDoc } = window._firebaseModules;
      await deleteDoc(window.docGasto(id));
      window.toast('Gasto eliminado');
    } catch(e) {
      console.error(e);
      window.toast('⚠️ Error al eliminar: ' + (e.message || e));
    }
    return;
  }
  window.gastos = window.gastos.filter(g => g.id !== id);
  guardarGastosLocal();
  window.renderGastos();
  window.toast('Gasto eliminado');
}

// Exponer en window — mismo motivo que en data-clientes.js: código clásico
// y onclick inline del HTML siguen llamando estas funciones sin cambios.
window.cargarGastosLocal = cargarGastosLocal;
window.guardarGastosLocal = guardarGastosLocal;
window.cargarGastos = cargarGastos;
window.guardarGasto = guardarGasto;
window.eliminarGasto = eliminarGasto;

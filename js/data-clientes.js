// ═══════════════════════════════════════
// MÓDULO: data/clientes.js
// Extraído de index.html (ago-2026) — misma lógica, mismo comportamiento.
// Mismo patrón que data-ordenes.js: referencias cruzadas vía window.,
// estado del listener (clientesListenerStarted/_unsubClientes) como
// variables privadas del módulo.
// ═══════════════════════════════════════

let clientesListenerStarted = false;
let _unsubClientes = null;

async function cargarClientesLocal() {
  try {
    const data = localStorage.getItem('alarmas_clientes');
    window.clientes = data ? JSON.parse(data) : [];
  } catch(e) { window.clientes = []; }
  window.renderClientes();
}

function guardarClientesLocal() {
  try { localStorage.setItem('alarmas_clientes', JSON.stringify(window.clientes)); } catch(e) {}
}

async function cargarClientes() {
  if (window._useFirebase && window._firebaseDb && window._firebaseModules && window._uid) {
    try {
      const { onSnapshot, orderBy, query } = window._firebaseModules;
      const q = query(window.colClientes(), orderBy('nombre_lower','asc'));
      if (!clientesListenerStarted) {
        clientesListenerStarted = true;
        _unsubClientes = onSnapshot(q, snap => {
          window.clientes = snap.docs.map(d=>({id:d.id,...d.data()}));
          window.renderClientes();
        }, err => {
          console.error(err);
          if (!window._uid) return; // sesión ya cerrada — listener obsoleto, ignorar
          clientesListenerStarted = false;
          cargarClientesLocal();
        });
      }
      return;
    } catch(e) { console.error(e); }
  }
  cargarClientesLocal();
}

async function guardarCliente(cliente) {
  const data = {...cliente};
  data.nombre_lower = (data.nombre||'').trim().toLowerCase();
  if (window._useFirebase && window._firebaseDb && window._uid) {
    try {
      const { setDoc, updateDoc } = window._firebaseModules;
      if (data.id) {
        const id = data.id; delete data.id;
        await window._fsEscribir(updateDoc(window.docCliente(id), data));
        return id;
      } else {
        // ID generado localmente: funciona igual sin señal (queda en la
        // cola persistente de Firestore) en vez de quedarse esperando.
        const ref = window.nuevoDoc(window.colClientes());
        await window._fsEscribir(setDoc(ref, data));
        return ref.id;
      }
    } catch(e) {
      console.error(e);
      window.toast('⚠️ No se pudo guardar el cliente en Firebase');
      return null;
    }
  }
  if (data.id) {
    const idx = window.clientes.findIndex(c=>c.id===data.id);
    if (idx>=0) window.clientes[idx] = data;
  } else {
    data.id = 'local_cli_'+Date.now();
    window.clientes.unshift(data);
  }
  guardarClientesLocal();
  window.renderClientes();
  return data.id;
}

async function eliminarCliente(id) {
  const ok = await window.confirmarAccion('Eliminar cliente', '¿Eliminar este cliente? Sus órdenes no se borran, mantienen su historial.', '🗑️', 'Eliminar');
  if (!ok) return;
  const okBorrado = await _borrarClienteSilencioso(id);
  if (okBorrado) window.toast('Cliente eliminado');
  window.cerrarModalCliente();
}

// Borra un cliente sin pedir confirmación (para uso interno, p.ej. fusión de duplicados)
async function _borrarClienteSilencioso(id) {
  if (window._useFirebase && window._firebaseDb && window._uid) {
    try {
      const { deleteDoc } = window._firebaseModules;
      await window._fsEscribir(deleteDoc(window.docCliente(id)));
      return true;
    } catch(e) {
      console.error(e);
      window.toast('⚠️ Error al eliminar: ' + (e.message || e));
      return false;
    }
  }
  window.clientes = window.clientes.filter(c => c.id !== id);
  guardarClientesLocal();
  window.renderClientes();
  return true;
}

// Exponer en window — mismo motivo que en data-ordenes.js: código clásico
// y onclick inline del HTML siguen llamando estas funciones sin cambios.
window.cargarClientesLocal = cargarClientesLocal;
window.guardarClientesLocal = guardarClientesLocal;
window.cargarClientes = cargarClientes;
window.guardarCliente = guardarCliente;
window.eliminarCliente = eliminarCliente;
window._borrarClienteSilencioso = _borrarClienteSilencioso;

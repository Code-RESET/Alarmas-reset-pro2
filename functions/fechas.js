// Utilidades de fecha para las Cloud Functions (sin dependencias, para
// poder probarlas con `node tests/functions.test.cjs`).
const TZ = 'America/Monterrey';
// 'AAAA-MM-DD' de una fecha vista en la zona del negocio.
function fechaLocal(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
// Mes (AAAA-MM) al que pertenece una orden: fecha de instalación o, si no
// tiene, la de creación (igual que la app).
function mesDeOrden(o) {
  if (o.fecha_instalacion) return String(o.fecha_instalacion).slice(0, 7);
  return o.fecha_creacion ? fechaLocal(new Date(o.fecha_creacion)).slice(0, 7) : '';
}
const saldoDe = o => (o.total || 0) - (o.a_cuenta_total || 0);
const conSaldo = o => ['PENDIENTE', 'EN_PROCESO'].includes((o.estado || '').toUpperCase()) && saldoDe(o) > 0.01;
// Órdenes del reporte de un mes: las del mes + las que siguen con saldo
// pendiente de meses anteriores (para que "Por cobrar" esté completo).
// Antes se exportaba TODO el historial y se rotulaba "facturado en el período".
const ordenesDelReporte = (ordenes, mes) => ordenes.filter(o => mesDeOrden(o) === mes || conSaldo(o));

// ¿Hoy (en hora del negocio) es el último día del mes?
function esUltimoDiaDelMes(ahora = new Date()) {
  const hoy = fechaLocal(ahora);
  const manana = fechaLocal(new Date(ahora.getTime() + 24 * 60 * 60 * 1000));
  return hoy.slice(0, 7) !== manana.slice(0, 7);
}

// Suma meses sin desbordar: 31-ago + 6 meses = 28/29-feb (antes daba 3-mar
// y la alerta de garantía llegaba tarde).
function sumarMeses(fechaStr, meses) {
  const d = new Date(fechaStr + 'T00:00:00Z');
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d;
}

module.exports = { TZ, fechaLocal, mesDeOrden, saldoDe, conSaldo, ordenesDelReporte, esUltimoDiaDelMes, sumarMeses };

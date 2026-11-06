// Utilidades de fecha de las Cloud Functions (functions/fechas.js).
// Ejecutar con: node tests/functions.test.cjs   (no necesita instalar nada)
const assert = require('assert');
const f = require('../functions/fechas');

const casos = [
  // B2: la exportación ya no depende del día 30 (que no existe en febrero)
  ['28-feb-2026 (no bisiesto) es último día', () => assert.strictEqual(f.esUltimoDiaDelMes(new Date('2026-02-28T14:00:00Z')), true)],
  ['28-feb-2028 (bisiesto) NO es último día', () => assert.strictEqual(f.esUltimoDiaDelMes(new Date('2028-02-28T14:00:00Z')), false)],
  ['29-feb-2028 sí es último día', () => assert.strictEqual(f.esUltimoDiaDelMes(new Date('2028-02-29T14:00:00Z')), true)],
  ['30-abr es último día; 30-may no', () => {
    assert.strictEqual(f.esUltimoDiaDelMes(new Date('2026-04-30T14:00:00Z')), true);
    assert.strictEqual(f.esUltimoDiaDelMes(new Date('2026-05-30T14:00:00Z')), false);
  }],
  // Fechas en hora de Monterrey, no UTC
  ['31-oct 20:00 en Monterrey sigue siendo octubre', () => assert.strictEqual(f.fechaLocal(new Date('2026-11-01T02:00:00Z')), '2026-10-31')],
  ['mes de una orden sin fecha de instalación usa hora local', () =>
    assert.strictEqual(f.mesDeOrden({ fecha_creacion: Date.parse('2026-11-01T02:00:00Z') }), '2026-10')],
  // sumarMeses no se desborda
  ['31-ago + 6 meses = 28-feb', () => assert.strictEqual(f.sumarMeses('2026-08-31', 6).toISOString().slice(0, 10), '2027-02-28')],
  ['31-ene + 12 meses = 31-ene', () => assert.strictEqual(f.sumarMeses('2026-01-31', 12).toISOString().slice(0, 10), '2027-01-31')],
  ['15-mar + 6 meses = 15-sep', () => assert.strictEqual(f.sumarMeses('2026-03-15', 6).toISOString().slice(0, 10), '2026-09-15')],
  // Reporte mensual: órdenes del mes + saldos vivos, no todo el historial
  ['reporte incluye las del mes y las que aún deben', () => {
    const ords = [
      { id: 'mes', fecha_instalacion: '2026-11-10', estado: 'PAGADO', total: 100, a_cuenta_total: 100 },
      { id: 'debe', fecha_instalacion: '2026-08-01', estado: 'PENDIENTE', total: 100, a_cuenta_total: 20 },
      { id: 'vieja', fecha_instalacion: '2026-08-01', estado: 'PAGADO', total: 100, a_cuenta_total: 100 }
    ];
    assert.deepStrictEqual(f.ordenesDelReporte(ords, '2026-11').map(o => o.id), ['mes', 'debe']);
  }]
];

let fallos = 0;
for (const [nombre, fn] of casos) {
  try { fn(); console.log('PASS ' + nombre); }
  catch (e) { fallos++; console.log('FAIL ' + nombre + '  → ' + e.message); }
}
process.exit(fallos ? 1 : 0);

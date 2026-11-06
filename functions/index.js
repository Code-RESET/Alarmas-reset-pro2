/**
 * Firebase Cloud Functions — Alarmas Reset Pro
 * Exportación automática mensual a Microsoft 365 (OneDrive/Excel)
 *
 * REQUISITOS PREVIOS:
 * 1. Cuenta Firebase en plan Blaze (necesario para llamadas de red externas)
 *    → firebase.google.com → Upgrade to Blaze (~$0 para este volumen)
 *
 * 2. Registro de App en Azure Active Directory:
 *    → portal.azure.com → Azure AD → App registrations → New registration
 *    → Name: "Alarmas Reset Export"
 *    → Supported accounts: "Accounts in any organizational directory and personal Microsoft accounts"
 *    → Redirect URI: (dejar vacío para client_credentials flow)
 *    → Permisos: Microsoft Graph → Application permissions → Files.ReadWrite.All, User.ReadWrite.All
 *    → Crear Client Secret en: Certificates & secrets → New client secret
 *
 * 3. Guardar en Firebase Secrets:
 *    firebase functions:secrets:set AZURE_TENANT_ID
 *    firebase functions:secrets:set AZURE_CLIENT_ID
 *    firebase functions:secrets:set AZURE_CLIENT_SECRET
 *    firebase functions:secrets:set ONEDRIVE_USER_EMAIL
 *    firebase functions:secrets:set EXPORT_MANUAL_TOKEN   ← protege el
 *      trigger manual (ver exportManual más abajo); usa cualquier valor
 *      largo y aleatorio, y llama al endpoint con el header
 *      "X-Export-Token: <ese-valor>". Sin este secreto configurado, el
 *      endpoint responde 403 a cualquier llamada (cerrado por defecto).
 *
 * 4. Desplegar:
 *    cd functions && npm install
 *    firebase deploy --only functions
 *
 * 5. La app no pide login: todos los dispositivos comparten la misma ruta
 *    usuarios/compartido/ordenes (ver README). Este archivo lee las órdenes
 *    con collectionGroup('ordenes'), que requiere un índice de grupo de
 *    colecciones para el orderBy('fecha_creacion'). Si el primer despliegue/
 *    ejecución falla con "requires an index", Firestore imprime en el log
 *    un link para crearlo con un clic (Console → Firestore → Indexes →
 *    Collection group).
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const ExcelJS = require('exceljs');

initializeApp();

// Secrets (configurados en Firebase Console o via CLI)
const AZURE_TENANT_ID    = defineSecret('AZURE_TENANT_ID');
const AZURE_CLIENT_ID    = defineSecret('AZURE_CLIENT_ID');
const AZURE_CLIENT_SECRET = defineSecret('AZURE_CLIENT_SECRET');
const ONEDRIVE_USER_EMAIL = defineSecret('ONEDRIVE_USER_EMAIL');
// Protege exportManual (ver más abajo): sin esto, cualquiera que encontrara
// la URL podía disparar la exportación a voluntad (gasto de Graph API/
// Functions y fuga del link de OneDrive en la respuesta). Configúralo con:
//   firebase functions:secrets:set EXPORT_MANUAL_TOKEN
// y luego llama al endpoint con el header "X-Export-Token: <ese-valor>".
const EXPORT_MANUAL_TOKEN = defineSecret('EXPORT_MANUAL_TOKEN');

const ESTADO_LABELS = {
  PENDIENTE: 'Pendiente',
  PAGADO: 'Pagado',
  TERMO: 'Termo',
  EN_PROCESO: 'En proceso'
};

// Fechas en zona del negocio, mes de cada orden y selección del reporte.
const { TZ, fechaLocal, mesDeOrden, ordenesDelReporte, esUltimoDiaDelMes, sumarMeses } = require('./fechas');

// ════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL — Exportación automática el último día del mes
// ════════════════════════════════════════════════════════
exports.exportMensualM365 = onSchedule({
  // Antes '0 8 30 * *': en febrero no hay día 30 y nunca se exportaba.
  // Ahora corre los días 28-31 y solo trabaja si es el último día del mes.
  schedule: '0 8 28-31 * *',
  timeZone: TZ,
  retryCount: 3,                     // Reintentos automáticos ante fallo
  secrets: [AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, ONEDRIVE_USER_EMAIL]
}, async (event) => {
  const db = getFirestore();
  const inicio = Date.now();
  const hoy = fechaLocal();
  if (!esUltimoDiaDelMes()) {
    console.log(`${hoy} no es el último día del mes. Omitiendo.`);
    return;
  }
  const mes = hoy.slice(0, 7); // "YYYY-MM" en hora de Monterrey
  const logRef = db.collection('export_logs').doc();

  // Verificar si ya se exportó este mes (evita duplicados en reintento)
  const exportExistente = await db.collection('export_logs')
    .where('mes', '==', mes)
    .where('estado', '==', 'exito')
    .limit(1)
    .get();

  if (!exportExistente.empty) {
    console.log(`Ya existe exportación exitosa para ${mes}. Omitiendo.`);
    return;
  }

  // Log de inicio
  await logRef.set({
    mes,
    tipo: 'automatico_mensual',
    estado: 'iniciado',
    fecha_inicio: Timestamp.now(),
    intento: event.retryCount || 1
  });

  try {
    // 1. Obtener todas las órdenes de Firestore
    console.log('Leyendo órdenes de Firestore...');
    // Las órdenes viven en usuarios/compartido/ordenes; collectionGroup las
    // encuentra sin depender de la ruta exacta.
    const snapshot = await db.collectionGroup('ordenes')
      .orderBy('fecha_creacion', 'desc')
      .get();
    // Ignora documentos sueltos que hayan quedado en /ordenes de nivel raíz
    // (colección antigua, previa a usuarios/{uid}/ordenes) — no tienen
    // documento padre, así que d.ref.parent.parent sería null.
    const ordenes = ordenesDelReporte(snapshot.docs
      .filter(d => d.ref.parent.parent)
      .map(d => ({ id: d.id, ...d.data() })), mes);
    const delMes = ordenes.filter(o => mesDeOrden(o) === mes);
    console.log(`${ordenes.length} órdenes en el reporte (${delMes.length} del mes).`);

    // 2. Construir archivo Excel
    console.log('Construyendo Excel...');
    const buffer = await buildExcel(ordenes, mes);

    // 3. Subir a OneDrive
    const filename = `AlarmasReset-${mes}.xlsx`;
    console.log(`Subiendo ${filename} a OneDrive...`);
    const fileUrl = await uploadToOneDrive(buffer, filename);
    console.log(`Subido exitosamente: ${fileUrl}`);

    // 4. Log de éxito
    await logRef.update({
      estado: 'exito',
      filename,
      url: fileUrl,
      fecha_fin: Timestamp.now(),
      duracion_ms: Date.now() - inicio,
      ordenes_exportadas: ordenes.length,
      total_facturado: delMes.reduce((s, o) => s + (o.total || 0), 0),
      ganancia: delMes.reduce((s, o) =>
        s + (o.productos || []).reduce((g, p) =>
          g + (parseFloat(p.costo) || 0) - (parseFloat(p.inversion) || 0), 0), 0)
    });

    console.log(`✅ Exportación mensual completada: ${filename}`);

  } catch (error) {
    console.error('Error en exportación mensual:', error);

    await logRef.update({
      estado: 'error',
      error_mensaje: error.message,
      error_stack: error.stack?.slice(0, 500),
      fecha_fin: Timestamp.now(),
      duracion_ms: Date.now() - inicio
    });

    // Re-lanzar para que Firebase reintente (retryCount: 3)
    throw error;
  }
});

// ════════════════════════════════════════════════════════
// FUNCIÓN MANUAL — Trigger HTTP para pruebas
// Llamar con: POST /exportManual (solo desde Firebase Console o curl)
// ════════════════════════════════════════════════════════
exports.exportManual = require('firebase-functions/v2/https').onRequest({
  secrets: [AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, ONEDRIVE_USER_EMAIL, EXPORT_MANUAL_TOKEN],
  cors: false
}, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // Requiere el secreto EXPORT_MANUAL_TOKEN (ver definición arriba). Si aún
  // no lo configuraste, el endpoint queda cerrado por defecto — seguro,
  // no abierto — hasta que corras el comando indicado en ese comentario.
  const tokenEsperado = process.env.EXPORT_MANUAL_TOKEN;
  const tokenRecibido = req.get('X-Export-Token');
  if (!tokenEsperado || tokenRecibido !== tokenEsperado) {
    res.status(403).json({ error: 'No autorizado' });
    return;
  }

  try {
    const db = getFirestore();
    const snapshot = await db.collectionGroup('ordenes').orderBy('fecha_creacion', 'desc').get();
    const mes = fechaLocal().slice(0, 7);
    const ordenes = ordenesDelReporte(snapshot.docs
      .filter(d => d.ref.parent.parent)
      .map(d => ({ id: d.id, ...d.data() })), mes);
    const buffer = await buildExcel(ordenes, mes);
    const filename = `AlarmasReset-${mes}-manual.xlsx`;
    const fileUrl = await uploadToOneDrive(buffer, filename);

    await db.collection('export_logs').add({
      mes, tipo: 'manual', estado: 'exito',
      filename, url: fileUrl,
      fecha_inicio: Timestamp.now(),
      ordenes_exportadas: ordenes.length
    });

    res.json({ success: true, url: fileUrl, filename, ordenes: ordenes.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════
// CONSTRUCTOR DE EXCEL (3 hojas con formato profesional)
// ════════════════════════════════════════════════════════
async function buildExcel(ordenes, mes) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Alarmas y GPS Reset';
  wb.lastModifiedBy = 'Sistema Automático';
  wb.created = new Date();
  wb.modified = new Date();

  const COLOR_HEADER  = { argb: 'FF0A0C0F' };
  const COLOR_TEXT    = { argb: 'FFFFFFFF' };
  const COLOR_ACCENT  = { argb: 'FFFF6B35' };
  const COLOR_GREEN   = { argb: 'FF06D6A0' };
  const COLOR_RED     = { argb: 'FFEF233C' };
  const ESTADO_COLORS = {
    PAGADO:     { argb: 'FFD4EDDA' },
    PENDIENTE:  { argb: 'FFFFF3CD' },
    EN_PROCESO: { argb: 'FFD1ECF1' },
    TERMO:      { argb: 'FFFFE5CC' }
  };

  function applyHeaderStyle(row) {
    row.font = { bold: true, color: COLOR_TEXT, size: 10, name: 'Calibri' };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: COLOR_HEADER };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    row.height = 18;
  }

  // ── Hoja 1: Órdenes ──────────────────────────────────
  const ws1 = wb.addWorksheet('Órdenes', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
  });
  ws1.columns = [
    { header: 'ID',              key: 'id',        width: 22 },
    { header: 'Cliente',         key: 'cliente',   width: 24 },
    { header: 'Vehículo',        key: 'vehiculo',  width: 24 },
    { header: 'F. Instalación',  key: 'fInst',     width: 16 },
    { header: 'F. Pago',         key: 'fPago',     width: 16 },
    { header: 'Estado',          key: 'estado',    width: 14 },
    { header: 'Total',           key: 'total',     width: 14 },
    { header: 'A Cuenta',        key: 'aCuenta',   width: 14 },
    { header: 'Saldo',           key: 'saldo',     width: 14 },
    { header: 'Notas',           key: 'notas',     width: 36 },
  ];
  applyHeaderStyle(ws1.getRow(1));

  const FMT_MXN = '"$"#,##0.00';

  ordenes.forEach((o, idx) => {
    const t = o.total || 0, a = o.a_cuenta_total || 0, saldo = t - a;
    const est = (o.estado || 'PENDIENTE').toUpperCase();
    const row = ws1.addRow({
      id: o.id || '',
      cliente: o.cliente || '',
      vehiculo: o.vehiculo || '',
      fInst: o.fecha_instalacion || '',
      fPago: o.fecha_pago || '',
      estado: ESTADO_LABELS[est] || est,
      total: t, aCuenta: a, saldo,
      notas: o.recordatorios || ''
    });

    // Fondo alterno
    const bg = idx % 2 === 0
      ? { argb: 'FFFAFAFA' }
      : { argb: 'FFFFFFFF' };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: bg };

    // Color estado
    const estadoCell = row.getCell('estado');
    if (ESTADO_COLORS[est]) {
      estadoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: ESTADO_COLORS[est] };
    }
    estadoCell.alignment = { horizontal: 'center' };

    // Formato moneda
    ['total', 'aCuenta'].forEach(k => {
      row.getCell(k).numFmt = FMT_MXN;
    });

    // Saldo — rojo si positivo, verde si 0
    const saldoCell = row.getCell('saldo');
    saldoCell.numFmt = FMT_MXN;
    saldoCell.font = { color: saldo > 0 ? COLOR_RED : COLOR_GREEN, bold: saldo > 0 };
  });

  // Fila totales
  const lastRow1 = ws1.lastRow.number + 1;
  const totRow = ws1.addRow({
    cliente: 'TOTALES', estado: '',
    total: ordenes.reduce((s, o) => s + (o.total || 0), 0),
    aCuenta: ordenes.reduce((s, o) => s + (o.a_cuenta_total || 0), 0),
    saldo: ordenes.reduce((s, o) => s + (o.total || 0) - (o.a_cuenta_total || 0), 0)
  });
  totRow.font = { bold: true };
  totRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
  ['total', 'aCuenta', 'saldo'].forEach(k => {
    totRow.getCell(k).numFmt = FMT_MXN;
    totRow.getCell(k).font = { bold: true };
  });

  // ── Hoja 2: Servicios ─────────────────────────────────
  const ws2 = wb.addWorksheet('Servicios', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  ws2.columns = [
    { header: 'ID Orden',   key: 'id',        width: 22 },
    { header: 'Cliente',    key: 'cliente',   width: 24 },
    { header: 'Vehículo',   key: 'vehiculo',  width: 24 },
    { header: 'Estado',     key: 'estado',    width: 14 },
    { header: 'Servicio',   key: 'servicio',  width: 34 },
    { header: 'Costo',      key: 'costo',     width: 14 },
    { header: 'Inversión',  key: 'inversion', width: 14 },
    { header: 'Ganancia',   key: 'ganancia',  width: 14 },
    { header: 'Garantía',   key: 'garantia',  width: 18 },
  ];
  applyHeaderStyle(ws2.getRow(1));

  let idx2 = 0;
  ordenes.forEach(o => {
    const est = (o.estado || 'PENDIENTE').toUpperCase();
    (o.productos || []).forEach(p => {
      const c = parseFloat(p.costo) || 0;
      const inv = parseFloat(p.inversion) || 0;
      const row = ws2.addRow({
        id: o.id || '', cliente: o.cliente || '', vehiculo: o.vehiculo || '',
        estado: ESTADO_LABELS[est] || est,
        servicio: p.nombre || '',
        costo: c, inversion: inv, ganancia: c - inv,
        garantia: p.garantia || 'Sin garantía'
      });
      const bg = idx2 % 2 === 0 ? { argb: 'FFFAFAFA' } : { argb: 'FFFFFFFF' };
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: bg };
      ['costo', 'inversion'].forEach(k => { row.getCell(k).numFmt = FMT_MXN; });
      const ganCell = row.getCell('ganancia');
      ganCell.numFmt = FMT_MXN;
      ganCell.font = { color: c - inv >= 0 ? COLOR_GREEN : COLOR_RED };
      row.getCell('estado').alignment = { horizontal: 'center' };
      idx2++;
    });
  });

  // ── Hoja 3: Resumen financiero ────────────────────────
  const ws3 = wb.addWorksheet('Resumen');
  ws3.getColumn(1).width = 32;
  ws3.getColumn(2).width = 24;

  // Facturado y ganancia: solo órdenes del mes. "Por cobrar": todo saldo vivo.
  const delMes = ordenes.filter(o => mesDeOrden(o) === mes);
  const totalFac = delMes.reduce((s, o) => s + (o.total || 0), 0);
  const totalGan = delMes.reduce((s, o) =>
    s + (o.productos || []).reduce((g, p) =>
      g + (parseFloat(p.costo) || 0) - (parseFloat(p.inversion) || 0), 0), 0);
  const porCobrar = ordenes
    .filter(o => ['PENDIENTE', 'EN_PROCESO'].includes((o.estado || '').toUpperCase()))
    .reduce((s, o) => s + (o.total || 0) - (o.a_cuenta_total || 0), 0);

  // Encabezado
  const titleRow = ws3.addRow(['RESUMEN FINANCIERO MENSUAL']);
  titleRow.font = { bold: true, size: 16, color: COLOR_ACCENT };
  ws3.addRow(['Alarmas y GPS Reset — Solo Led Auto']);
  ws3.addRow([`Período: ${new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}`]);
  ws3.addRow([`Generado: ${new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })}`]);
  ws3.addRow([]);

  // Métricas financieras
  const addMetric = (label, value, isCurrency = true, color = null) => {
    const row = ws3.addRow([label, value]);
    row.getCell(1).font = { bold: false, size: 11 };
    row.getCell(2).font = { bold: true, size: 12, color: color || { argb: 'FF111111' } };
    if (isCurrency) row.getCell(2).numFmt = FMT_MXN;
    row.getCell(2).alignment = { horizontal: 'right' };
    return row;
  };

  const hdr1 = ws3.addRow(['FINANZAS', '']);
  hdr1.font = { bold: true, size: 11, color: COLOR_TEXT };
  hdr1.fill = { type: 'pattern', pattern: 'solid', fgColor: COLOR_HEADER };

  addMetric('Total facturado en el período', totalFac, true, { argb: 'FFFFD166' });
  addMetric('Ganancia estimada', totalGan, true, { argb: 'FF06D6A0' });
  addMetric('Por cobrar (pendiente + en proceso)', porCobrar, true, { argb: 'FFEF233C' });

  ws3.addRow([]);
  const hdr2 = ws3.addRow(['ÓRDENES', '']);
  hdr2.font = { bold: true, size: 11, color: COLOR_TEXT };
  hdr2.fill = { type: 'pattern', pattern: 'solid', fgColor: COLOR_HEADER };

  addMetric('Total de órdenes', ordenes.length, false);
  addMetric('Pendientes', ordenes.filter(o => o.estado === 'PENDIENTE').length, false, { argb: 'FFFF6B35' });
  addMetric('En proceso', ordenes.filter(o => o.estado === 'EN_PROCESO').length, false, { argb: 'FF4361EE' });
  addMetric('Pagadas', ordenes.filter(o => o.estado === 'PAGADO').length, false, { argb: 'FF06D6A0' });
  addMetric('Termo', ordenes.filter(o => o.estado === 'TERMO').length, false, { argb: 'FFFFD166' });

  ws3.addRow([]);
  ws3.addRow(['Exportado automáticamente por Alarmas Reset Pro — Sistema v2.0']);

  // Buffer final
  return await wb.xlsx.writeBuffer();
}

// ════════════════════════════════════════════════════════
// SUBIDA A ONEDRIVE VÍA MICROSOFT GRAPH API
// ════════════════════════════════════════════════════════
async function uploadToOneDrive(buffer, filename) {
  const credential = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID,
    process.env.AZURE_CLIENT_ID,
    process.env.AZURE_CLIENT_SECRET
  );

  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default']
  });

  const client = Client.initWithMiddleware({ authProvider });
  const userEmail = process.env.ONEDRIVE_USER_EMAIL;

  // Crear carpeta /AlarmasReset si no existe
  try {
    await client
      .api(`/users/${userEmail}/drive/root/children`)
      .post({
        name: 'AlarmasReset',
        folder: {},
        '@microsoft.graph.conflictBehavior': 'replace'
      });
  } catch (e) {
    // La carpeta ya existe — es el error esperado
    if (!e.message?.includes('nameAlreadyExists') && e.statusCode !== 409) {
      console.warn('Advertencia al crear carpeta:', e.message);
    }
  }

  // Subir archivo (reemplaza si ya existe)
  const uploadPath = `/users/${userEmail}/drive/root:/AlarmasReset/${filename}:/content`;
  const response = await client
    .api(uploadPath)
    .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .put(Buffer.from(buffer));

  return response.webUrl || '';
}

// ════════════════════════════════════════════════════════
// NOTIFICACIONES PUSH — cobros vencidos y garantías por vencer
// ════════════════════════════════════════════════════════
// Requiere que el usuario active las notificaciones en la app (botón
// "🔔 Notificaciones" del menú), lo que registra su token en
// usuarios/{uid}/fcm_tokens. No necesita secrets adicionales: usa las
// mismas credenciales de Admin SDK que el resto de este archivo.
const GARANTIA_MESES = { 'GARANTIA 6 MESES': 6, 'GARANTIA 1 AÑO': 12 };
const DIAS_AVISO_GARANTIA = 7;   // avisar cuando falten <= N días para vencer
const DIAS_AVISO_COBRO = 15;     // avisar si el saldo lleva pendiente >= N días

exports.notificarPendientes = onSchedule({
  schedule: '0 9 * * *', // todos los días a las 9:00 AM
  timeZone: TZ
}, async () => {
  const db = getFirestore();
  const hoy = new Date();

  // Agrupar las órdenes por el id de documento padre (usuarios/{id}/ordenes/...) —
  // hoy solo existe "compartido", pero esto sigue funcionando si algún día
  // vuelve a haber más de una ruta.
  const ordenesSnap = await db.collectionGroup('ordenes').get();
  const porUsuario = {};
  ordenesSnap.forEach(doc => {
    // Ignora documentos sueltos que hayan quedado en /ordenes de nivel raíz
    // (no tienen documento padre, así que doc.ref.parent.parent es null).
    if (!doc.ref.parent.parent) return;
    const uid = doc.ref.parent.parent.id;
    (porUsuario[uid] = porUsuario[uid] || []).push({ id: doc.id, ...doc.data() });
  });

  for (const uid of Object.keys(porUsuario)) {
    const ordenes = porUsuario[uid];
    const avisos = [];

    // Cobros pendientes con más de DIAS_AVISO_COBRO días de antigüedad
    const pendientes = ordenes.filter(o => {
      if (!['PENDIENTE', 'EN_PROCESO'].includes((o.estado || '').toUpperCase())) return false;
      const saldo = (o.total || 0) - (o.a_cuenta_total || 0);
      if (saldo <= 0 || !o.fecha_instalacion) return false;
      const dias = (hoy - new Date(o.fecha_instalacion + 'T00:00:00Z')) / 86400000;
      return dias >= DIAS_AVISO_COBRO;
    });
    if (pendientes.length) {
      const totalPend = pendientes.reduce((s, o) => s + (o.total || 0) - (o.a_cuenta_total || 0), 0);
      avisos.push({
        title: `💰 ${pendientes.length} cobro(s) pendiente(s)`,
        body: `${pendientes.slice(0, 3).map(o => o.cliente || 'Cliente').join(', ')} — por cobrar: $${totalPend.toLocaleString('es-MX')}`
      });
    }

    // Garantías próximas a vencer
    const garantiasPorVencer = [];
    ordenes.forEach(o => {
      (o.productos || []).forEach(p => {
        const meses = GARANTIA_MESES[p.garantia];
        if (!meses || !o.fecha_instalacion) return;
        const vencimiento = sumarMeses(o.fecha_instalacion, meses);
        const diasParaVencer = (vencimiento - hoy) / 86400000;
        if (diasParaVencer >= 0 && diasParaVencer <= DIAS_AVISO_GARANTIA) {
          garantiasPorVencer.push({ cliente: o.cliente || 'Cliente', dias: Math.ceil(diasParaVencer) });
        }
      });
    });
    if (garantiasPorVencer.length) {
      avisos.push({
        title: `🛡️ ${garantiasPorVencer.length} garantía(s) por vencer`,
        body: garantiasPorVencer.slice(0, 3).map(g => `${g.cliente} (${g.dias}d)`).join(', ')
      });
    }

    if (!avisos.length) continue;

    const tokensSnap = await db.collection('usuarios').doc(uid).collection('fcm_tokens').get();
    if (tokensSnap.empty) continue;
    const tokens = tokensSnap.docs.map(d => d.id);

    for (const aviso of avisos) {
      try {
        const resp = await getMessaging().sendEachForMulticast({
          tokens,
          notification: { title: aviso.title, body: aviso.body },
          webpush: { fcmOptions: { link: '/' } }
        });
        resp.responses.forEach((r, i) => {
          const code = r.error?.code;
          if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')) {
            db.collection('usuarios').doc(uid).collection('fcm_tokens').doc(tokens[i]).delete().catch(() => {});
          }
        });
      } catch (e) {
        console.error(`Error enviando push a uid ${uid}:`, e.message);
      }
    }
  }
});

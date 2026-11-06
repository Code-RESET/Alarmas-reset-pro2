// Prueba de punta a punta: la app real (index.html / checklist.html) en
// Chromium, con el SDK de Firebase servido desde node_modules y Auth +
// Firestore redirigidos a los emuladores locales.
//
// Ejecutar desde tests/:  npm install && npm run test:emuladores
//
// Cubre: login, cuenta no autorizada, abonos por transacción, edición
// concurrente que conserva abonos (A2), archivado en lote (A5), cambio de
// estado con verificación (B4), folio de cotización compartido (B3) y
// redirección de checklist.html sin sesión.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const NM = path.join(__dirname, 'node_modules/firebase');
const PROJ = 'alarmas-reset-e3484';
const FS = `http://127.0.0.1:8085/v1/projects/${PROJ}/databases/(default)/documents`;
const ADMIN = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };
const PASS = 'secreto123';

let fallos = 0;
function verificar(nombre, cond, detalle) {
  console.log((cond ? 'PASS ' : 'FAIL ') + nombre + (cond ? '' : '  → ' + JSON.stringify(detalle)));
  if (!cond) fallos++;
}

// ── Servidor estático de la app ──
const TIPOS = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
function servir() {
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      const p = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(RAIZ) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { resp.writeHead(404); resp.end(); return; }
      resp.writeHead(200, { 'Content-Type': TIPOS[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(resp);
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

// ── Datos de prueba en los emuladores ──
async function crearCuenta(email) {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=x', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS, returnSecureToken: true })
  });
  return (await r.json()).localId;
}
const docFS = (ruta, fields) => fetch(`${FS}/${ruta}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields }) });
const leerFS = async ruta => (await (await fetch(`${FS}/${ruta}`, { headers: ADMIN })).json()).fields || null;
const S = v => ({ stringValue: v }), N = v => ({ integerValue: String(v) });

async function nuevaPagina(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(e.message));
  // SDK de Firebase local en vez de gstatic.com
  await p.route(/www\.gstatic\.com\/firebasejs\/10\.12\.0\/(firebase-[a-z-]+\.js)/, r => {
    const f = r.request().url().match(/(firebase-[a-z-]+\.js)/)[1];
    r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(NM, f)) });
  });
  // reCAPTCHA / App Check simulados (Auth espera el token de App Check)
  await p.route(/recaptcha\/enterprise\.js/, r => r.fulfill({ status: 200, contentType: 'application/javascript',
    body: 'window.grecaptcha={enterprise:{ready:cb=>setTimeout(cb,0),execute:()=>Promise.resolve("x"),render:()=>1}};' }));
  await p.route(/firebaseappcheck\.googleapis\.com/, r => r.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ token: 'x', ttl: '3600s' }) }));
  // Auth y Firestore → emuladores
  await p.route(/^https:\/\/(identitytoolkit|securetoken)\.googleapis\.com\//, async r => {
    r.fulfill({ response: await r.fetch({ url: r.request().url().replace('https://', 'http://127.0.0.1:9099/') }) });
  });
  await p.route(/^https:\/\/firestore\.googleapis\.com\//, async r => {
    try { r.fulfill({ response: await r.fetch({ url: r.request().url().replace('https://firestore.googleapis.com', 'http://127.0.0.1:8085'), timeout: 60000 }) }); }
    catch (e) { r.abort().catch(() => {}); }
  });
  await p.route(/googletagmanager|alcdn|msauth|fonts\.g/, r => r.abort());
  return { ctx, p, errores };
}

async function login(p, base, email) {
  await p.goto(base + '/index.html');
  await p.waitForSelector('#ag-email', { timeout: 15000 });
  await p.fill('#ag-email', email); await p.fill('#ag-pass', 'incorrecta'); await p.click('#ag-btn');
  await p.waitForFunction(() => document.getElementById('ag-error')?.textContent, null, { timeout: 15000 });
  const errMal = await p.textContent('#ag-error');
  await p.fill('#ag-pass', PASS); await p.click('#ag-btn');
  await p.waitForTimeout(6000);
  return errMal;
}

(async () => {
  const srv = await servir();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const uid = await crearCuenta('dueno@reset.mx');
  await crearCuenta('intruso@reset.mx');
  await docFS(`permitidos/${uid}`, { nombre: S('Dueño') });
  await docFS('usuarios/compartido/ordenes/o1', {
    vehiculo: S('Tsuru'), cliente: S('Juan'), estado: S('PENDIENTE'), total: N(1000), a_cuenta_total: N(400),
    fecha_creacion: N(Date.now()), productos: { arrayValue: { values: [{ mapValue: { fields: { nombre: S('GPS'), costo: N(1000) } } }] } }
  });

  const browser = await chromium.launch();

  // ── Cuenta autorizada ──
  {
    const { ctx, p, errores } = await nuevaPagina(browser, base);
    const errMal = await login(p, base, 'dueno@reset.mx');
    verificar('contraseña incorrecta muestra mensaje', /incorrectos/.test(errMal), errMal);
    const st = await p.evaluate(() => ({ gate: !!document.getElementById('auth-gate'), n: (window.ordenes || []).length }));
    verificar('login correcto carga las órdenes', !st.gate && st.n === 1, st);

    await p.evaluate(() => abonarOrden('o1', 100));
    await p.waitForTimeout(1500);
    verificar('abono llega al servidor (400+100)', (await leerFS('usuarios/compartido/ordenes/o1')).a_cuenta_total.integerValue === '500');

    // A2: "Editar" abierto con a_cuenta=500; otro dispositivo abona 200; se guarda una nota
    const baseEd = await p.evaluate(() => { const o = ordenes.find(o => o.id === 'o1'); return { a_cuenta_total: o.a_cuenta_total, estado: o.estado }; });
    await fetch(`${FS}:commit`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ writes: [{ transform: {
      document: `projects/${PROJ}/databases/(default)/documents/usuarios/compartido/ordenes/o1`,
      fieldTransforms: [{ fieldPath: 'a_cuenta_total', increment: N(200) }] } }] }) });
    await p.evaluate(async b => {
      await guardarOrden({ ...ordenes.find(o => o.id === 'o1'), a_cuenta_total: b.a_cuenta_total, estado: b.estado, recordatorios: 'nota editada' }, b);
    }, baseEd);
    await p.waitForTimeout(1500);
    const o1 = await leerFS('usuarios/compartido/ordenes/o1');
    verificar('A2: editar conserva el abono de otro dispositivo (700)', o1.a_cuenta_total.integerValue === '700' && o1.recordatorios.stringValue === 'nota editada', o1.a_cuenta_total);

    // B4: la pantalla cree PENDIENTE pero otro dispositivo ya puso TERMO
    await docFS('usuarios/compartido/ordenes/o2', { vehiculo: S('Aveo'), cliente: S('Ana'), estado: S('PENDIENTE'), total: N(0), a_cuenta_total: N(0), fecha_creacion: N(Date.now()) });
    await p.waitForTimeout(1500);
    await fetch(`${FS}/usuarios/compartido/ordenes/o2?updateMask.fieldPaths=estado`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields: { estado: S('TERMO') } }) });
    await p.evaluate(() => { const o = ordenes.find(o => o.id === 'o2'); o.estado = 'PENDIENTE'; return cambiarEstado('o2', 'EN_PROCESO'); });
    await p.waitForTimeout(1000);
    verificar('B4: no revierte un estado cambiado en otro dispositivo', (await leerFS('usuarios/compartido/ordenes/o2')).estado.stringValue === 'TERMO');
    await p.evaluate(() => cambiarEstado('o2', 'EN_PROCESO'));
    await p.waitForTimeout(1000);
    verificar('B4: con el estado al día sí cambia', (await leerFS('usuarios/compartido/ordenes/o2')).estado.stringValue === 'EN_PROCESO');

    // A5: archivar una orden PAGADA de un mes anterior
    const arch = await p.evaluate(async () => {
      await window._firebaseModules.setDoc(docOrden('vieja'), { vehiculo: 'Aveo', cliente: 'Ana', estado: 'PAGADO', total: 300, a_cuenta_total: 300, fecha_instalacion: '2026-01-15', fecha_creacion: 1 });
      await new Promise(r => setTimeout(r, 1000));
      const ok = await archivarOrdenesDelMes([ordenes.find(o => o.id === 'vieja')]);
      await new Promise(r => setTimeout(r, 1500));
      return { ok, sigue: ordenes.some(o => o.id === 'vieja') };
    });
    const archDoc = await leerFS('usuarios/compartido/ordenes_archivadas/vieja');
    verificar('A5: archivado mueve la orden', arch.ok && !arch.sigue && archDoc?.mes?.stringValue === '2026-01', { arch, archDoc: !!archDoc });

    // B3: folio de cotización compartido
    const folios = await p.evaluate(async () => [await _reservarFolioCot(), await _reservarFolioCot()]);
    const cont = await leerFS('usuarios/compartido/contadores/cotizaciones');
    verificar('B3: folios consecutivos desde el contador compartido', folios[1] === folios[0] + 1 && cont.ultimo.integerValue === String(folios[1]), { folios, cont });

    await p.reload(); await p.waitForTimeout(6000);
    verificar('la sesión sigue al recargar', await p.evaluate(() => !document.getElementById('auth-gate') && !!window._authUser));

    await p.goto(base + '/checklist.html'); await p.waitForTimeout(5000);
    verificar('checklist.html abre con sesión', p.url().endsWith('checklist.html') && await p.evaluate(() => !!window._authUser));
    verificar('sin errores de JavaScript', errores.length === 0, errores);
    await ctx.close();
  }

  // ── Cuenta no autorizada ──
  {
    const { ctx, p } = await nuevaPagina(browser, base);
    await login(p, base, 'intruso@reset.mx');
    const st = await p.evaluate(() => ({ txt: document.getElementById('auth-gate')?.innerText || '', n: (window.ordenes || []).length }));
    verificar('cuenta no autorizada ve "Cuenta sin acceso" y ningún dato', /Cuenta sin acceso/.test(st.txt) && st.n === 0, st);
    await ctx.close();
  }

  // ── checklist.html sin sesión ──
  {
    const { ctx, p } = await nuevaPagina(browser, base);
    await p.goto(base + '/checklist.html'); await p.waitForTimeout(5000);
    verificar('checklist.html sin sesión manda al login', p.url().endsWith('index.html'), p.url());
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

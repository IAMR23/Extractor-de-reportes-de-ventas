const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createPdfDiscovery } = require('./services/pdf-discovery.service');
const { descargarPdfDerechaPorResponse } = require('./services/pdf-direct-url-download.service');

class ReporteError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReporteError';
    this.code = code;
  }
}

function sanitizeFileName(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildPdfPath(usuario, fechaInicio, fechaFin) {
  const fechaCarpeta = fechaInicio;
  const dir = path.join(config.reportesDir, fechaCarpeta);
  const fileName = [
    sanitizeFileName(usuario.name),
    sanitizeFileName(config.nombreReporte),
    fechaInicio,
    fechaFin
  ].join('_') + '.pdf';

  ensureDir(dir);
  return path.join(dir, fileName);
}

async function waitForVisible(page, selector, errorCode, errorMessage) {
  try {
    await page.locator(selector).waitFor({
      state: 'visible',
      timeout: config.timeoutMs
    });
  } catch (error) {
    throw new ReporteError(errorCode, errorMessage);
  }
}

async function iniciarSesion(page, usuario) {
  const { selectors } = config;

  try {
    await page.goto(config.systemUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeoutMs
    });
  } catch (error) {
    throw new ReporteError('PAGINA_NO_CARGO', 'La página de login no cargó dentro del tiempo esperado.');
  }

  await waitForVisible(page, selectors.usuarioInput, 'PAGINA_NO_CARGO', 'No se encontró el input usuario en la pantalla de login.');

  await page.locator(selectors.usuarioInput).fill(usuario.username);
  await page.locator(selectors.passwordInput).fill(usuario.password);

  const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);

  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: config.timeoutMs }).catch(() => null),
    page.locator(selectors.loginButton).click()
  ]);

  const popup = await popupPromise;
  const activePage = popup || page;
  activePage.setDefaultTimeout(config.timeoutMs);
  await activePage.waitForLoadState('domcontentloaded', { timeout: config.timeoutMs }).catch(() => null);

  const loginCorrecto = activePage.locator(selectors.loginSuccessMarker).waitFor({
    state: 'visible',
    timeout: Math.min(config.timeoutMs, 15000)
  }).then(() => 'OK').catch(() => null);

  const loginIncorrecto = page.locator(selectors.loginErrorMarker).waitFor({
    state: 'visible',
    timeout: Math.min(config.timeoutMs, 15000)
  }).then(() => 'ERROR').catch(() => null);

  const resultado = await Promise.race([loginCorrecto, loginIncorrecto]);

  if (resultado === 'ERROR') {
    throw new ReporteError('LOGIN_INCORRECTO', 'El sistema mostro un mensaje de login incorrecto.');
  }

  if (resultado !== 'OK') {
    throw new ReporteError('LOGIN_INCORRECTO', 'Login incorrecto o no se encontró la pantalla principal.');
  }
  return activePage;
}

async function irAModuloReportes(page) {
  const { selectors } = config;

  await page.waitForLoadState('domcontentloaded', { timeout: config.timeoutMs }).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: config.timeoutMs }).catch(() => null);

  await clickMenuText(page, selectors.reportesMenuText, 'No se encontro el menu Cierre de Caja.');
  await clickMenuText(page, selectors.reportesSubMenuText, 'No se encontro la opcion Cierre de Caja (Distribuidor).');
  await clickMenuText(page, selectors.reportesSubMenuSasText, 'No se encontro la opcion Cierre de Caja Sas.');

  const frame = await esperarFrame(page, selectors.reportesFrameName);
  await frame.waitForLoadState('domcontentloaded', { timeout: config.timeoutMs }).catch(() => null);
  return frame;
}

/*

  await waitForVisible(
    page,
    selectors.reportesMenu,
    'MODULO_REPORTES_NO_ENCONTRADO',
    'No se encontró el menú o enlace del módulo de reportes.'
  );

  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: config.timeoutMs }).catch(() => null),
    page.locator(selectors.reportesMenu).click()
  ]);

  await waitForVisible(
    page,
    selectors.reportesSubMenu,
    'MODULO_REPORTES_NO_ENCONTRADO',
    'No se encontro la opcion Cierre de Caja (Distribuidor).'
  );

  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: config.timeoutMs }).catch(() => null),
    page.locator(selectors.reportesSubMenu).click()
  ]);

  await waitForVisible(
    page,
    selectors.reportesSubMenuSas,
    'MODULO_REPORTES_NO_ENCONTRADO',
    'No se encontro la opcion Cierre de Caja Sas.'
  );

  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: config.timeoutMs }).catch(() => null),
    page.locator(selectors.reportesSubMenuSas).click()
  ]);

  const frame = await esperarFrame(page, selectors.reportesFrameName);
  await frame.waitForLoadState('domcontentloaded', { timeout: config.timeoutMs }).catch(() => null);
  return frame;
}

*/

async function clickMenuText(page, text, errorMessage) {
  const locator = page.getByText(text, { exact: true }).first();

  try {
    await locator.waitFor({ state: 'visible', timeout: config.timeoutMs });
    await locator.click();
    await page.waitForLoadState('domcontentloaded', { timeout: config.timeoutMs }).catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: config.timeoutMs }).catch(() => null);
    await page.waitForTimeout(config.selectors.menuClickDelayMs);
  } catch (error) {
    throw new ReporteError('MODULO_REPORTES_NO_ENCONTRADO', errorMessage);
  }
}

async function esperarFrame(page, frameName) {
  const deadline = Date.now() + config.timeoutMs;

  while (Date.now() < deadline) {
    const frame = page.frame({ name: frameName });
    if (frame) return frame;
    await page.waitForTimeout(500);
  }

  throw new ReporteError('MODULO_REPORTES_NO_ENCONTRADO', `No se encontro el frame ${frameName}.`);
}

function buildSpanishDateLabels(fecha) {
  const [year, month, day] = fecha.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const labels = [
    new Intl.DateTimeFormat('es-EC', { dateStyle: 'full', timeZone: 'UTC' }).format(date),
    new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeZone: 'UTC' }).format(date),
    fecha
  ];

  return [...new Set(labels.map((label) => label.toLowerCase()))];
}

function getMonthDiffFromToday(fecha) {
  const [year, month] = fecha.split('-').map(Number);
  const today = new Date();
  return (year - today.getFullYear()) * 12 + (month - 1 - today.getMonth());
}

async function navegarMesDatepicker(dialog, fecha) {
  const diff = getMonthDiffFromToday(fecha);
  if (diff === 0) return;

  const directionSelector = diff < 0
    ? 'button[aria-label*="anterior" i], button[aria-label*="previous" i], button[title*="anterior" i], button[title*="previous" i]'
    : 'button[aria-label*="siguiente" i], button[aria-label*="next" i], button[title*="siguiente" i], button[title*="next" i]';

  const clicks = Math.abs(diff);
  for (let i = 0; i < clicks; i += 1) {
    const button = dialog.locator(directionSelector).first();
    await button.waitFor({ state: 'visible', timeout: config.timeoutMs });
    await button.click();
  }
}

async function seleccionarFechaDatepicker(pageOrFrame, buttonSelector, dialogSelector, valueSelector, fecha) {
  await waitForVisible(
    pageOrFrame,
    buttonSelector,
    'MODULO_REPORTES_NO_ENCONTRADO',
    `No se encontro el datepicker ${buttonSelector}.`
  );

  await pageOrFrame.locator(buttonSelector).click();
  const dialog = pageOrFrame.locator(dialogSelector);
  await dialog.waitFor({ state: 'visible', timeout: config.timeoutMs });
  await navegarMesDatepicker(dialog, fecha);

  const labels = buildSpanishDateLabels(fecha);
  for (const label of labels) {
    const option = dialog.locator(`button[aria-label*="${label}" i], [data-date="${fecha}"]`).first();
    if (await option.count()) {
      await option.click();
      await pageOrFrame.locator(valueSelector).waitFor({ state: 'visible', timeout: config.timeoutMs });
      return;
    }
  }

  const day = String(Number(fecha.slice(-2)));
  const dayButton = dialog.getByRole('button', { name: new RegExp(`^${day}$`) }).first();
  if (await dayButton.count()) {
    await dayButton.click();
    await pageOrFrame.locator(valueSelector).waitFor({ state: 'visible', timeout: config.timeoutMs });
    return;
  }

  throw new ReporteError('MODULO_REPORTES_NO_ENCONTRADO', `No se pudo seleccionar la fecha ${fecha}.`);
}

async function seleccionarFechas(pageOrFrame, fechaInicio, fechaFin) {
  const { selectors } = config;

  await waitForVisible(
    pageOrFrame,
    selectors.fechaInicioInput,
    'MODULO_REPORTES_NO_ENCONTRADO',
    'No se encontró el input fecha inicio.'
  );

  await seleccionarFechaDatepicker(
    pageOrFrame,
    selectors.fechaInicioInput,
    selectors.fechaInicioDialog,
    selectors.fechaInicioValue,
    fechaInicio
  );

  await seleccionarFechaDatepicker(
    pageOrFrame,
    selectors.fechaFinInput,
    selectors.fechaFinDialog,
    selectors.fechaFinValue,
    fechaFin
  );
}

async function esperarDescargaDesdePagina(page, clickAction) {
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: config.timeoutMs }),
      clickAction()
    ]);
    return download;
  } catch (error) {
    throw new ReporteError('PDF_NO_DESCARGADO', 'El PDF no se descargó dentro del tiempo esperado.');
  }
}

async function generarYDescargarPdf(pageOrFrame) {
  const { selectors } = config;
  const ownerPage = typeof pageOrFrame.waitForEvent === 'function' ? pageOrFrame : pageOrFrame.page();

  await waitForVisible(
    pageOrFrame,
    selectors.generarPdfButton,
    'MODULO_REPORTES_NO_ENCONTRADO',
    'No se encontró el botón generar PDF.'
  );

  const popupPromise = ownerPage.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
  const downloadPromise = ownerPage.waitForEvent('download', { timeout: config.timeoutMs }).catch(() => null);

  await pageOrFrame.locator(selectors.generarPdfButton).click();

  const popup = await popupPromise;

  if (popup) {
    await popup.waitForLoadState('domcontentloaded', { timeout: config.timeoutMs }).catch(() => null);

    const botonDescarga = popup.locator(selectors.descargarPdfButton);
    const botonVisible = await botonDescarga.first().waitFor({
      state: 'visible',
      timeout: 10000
    }).then(() => true).catch(() => false);

    if (botonVisible) {
      return esperarDescargaDesdePagina(popup, () => botonDescarga.first().click());
    }

    const popupDownload = await popup.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    if (popupDownload) return popupDownload;

    throw new ReporteError('PDF_NO_DESCARGADO', 'El popup se abrió, pero no inició ninguna descarga PDF.');
  }

  const download = await downloadPromise;
  if (download) return download;

  throw new ReporteError('POPUP_NO_ABRIO', 'No se abrió popup ni se detectó descarga directa.');
}

async function descargarPdfDesdeVisorActual(pageOrFrame, context) {
  const { selectors } = config;
  const ownerPage = typeof pageOrFrame.waitForEvent === 'function' ? pageOrFrame : pageOrFrame.page();
  const pages = [ownerPage, ...context.pages()].filter((page, index, list) => list.indexOf(page) === index);

  for (const page of pages) {
    const targets = [page, ...page.frames()];

    for (const target of targets) {
      const button = target.locator(selectors.descargarPdfButton).first();
      const exists = await button.waitFor({
        state: 'attached',
        timeout: 3000
      }).then(() => true).catch(() => false);

      if (!exists) continue;

      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: config.timeoutMs }),
          button.click({ force: true })
        ]);
        return download;
      } catch (error) {
        // Try the next page/frame candidate.
      }
    }
  }

  throw new ReporteError('PDF_NO_DESCARGADO', 'No se pudo descargar desde el visor PDF ya abierto.');
}

async function guardarDescarga(download, destinoPdf) {
  await download.saveAs(destinoPdf);

  const stat = fs.statSync(destinoPdf);
  if (stat.size === 0) {
    throw new ReporteError('ARCHIVO_VACIO', 'El archivo PDF descargado está vacío.');
  }

  return destinoPdf;
}

async function cerrarSesion(page) {
  const selector = config.selectors.logoutButton;
  const logout = page.locator(selector);

  if (await logout.count()) {
    await logout.first().click({ timeout: 5000 }).catch(() => null);
  }
}

async function descargarReporte(browser, usuario, fechaInicio, fechaFin) {
  let context;
  let page;
  let pdfDiscovery;
  let debugArchivo = null;
  let directDebugArchivo = null;

  try {
    context = await browser.newContext({
      acceptDownloads: true,
      ignoreHTTPSErrors: true
    });

    page = await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);

    page = await iniciarSesion(page, usuario);
    const reportesFrame = await irAModuloReportes(page);
    await seleccionarFechas(reportesFrame, fechaInicio, fechaFin);

    const destinoPdf = buildPdfPath(usuario, fechaInicio, fechaFin);
    let metodo = null;
    let pdfUrl = null;

    pdfDiscovery = createPdfDiscovery({
      page,
      usuario,
      fechaInicio,
      fechaFin
    });

    try {
      try {
        const resultadoDirecto = await descargarPdfDerechaPorResponse({
          pageOrFrame: reportesFrame,
          context,
          destinoPdf,
          usuario,
          fechaInicio,
          fechaFin
        });

        metodo = resultadoDirecto.metodo;
        pdfUrl = resultadoDirecto.pdfUrl;
      } catch (directError) {
        directDebugArchivo = directError.debug ? directError.debug.debugPath : null;
        const download = await descargarPdfDesdeVisorActual(reportesFrame, context);
        await guardarDescarga(download, destinoPdf);
        metodo = 'VISUAL_FALLBACK';
      }
    } finally {
      debugArchivo = await pdfDiscovery.save().catch(() => null);
      pdfDiscovery.stop();
    }

    await cerrarSesion(page);

    return {
      usuario: usuario.name,
      fechaInicio,
      fechaFin,
      archivo: destinoPdf,
      debugArchivo,
      directDebugArchivo,
      metodo,
      pdfUrl,
      estado: 'DESCARGADO',
      mensaje: 'PDF descargado correctamente.'
    };
  } catch (error) {
    const mensaje = error instanceof ReporteError ? error.message : error.message || String(error);

    return {
      usuario: usuario.name,
      fechaInicio,
      fechaFin,
      archivo: null,
      debugArchivo,
      directDebugArchivo,
      estado: 'ERROR',
      codigo: error.code || 'ERROR_DESCONOCIDO',
      mensaje
    };
  } finally {
    if (context) {
      await context.close().catch(() => null);
    }
  }
}

module.exports = {
  descargarReporte,
  ReporteError
};

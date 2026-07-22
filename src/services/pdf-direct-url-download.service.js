const fs = require('fs');
const path = require('path');
const config = require('../config');

class PdfDirectResponseDownloadError extends Error {
  constructor(message, debug = {}) {
    super(message);
    this.name = 'PdfDirectResponseDownloadError';
    this.code = 'PDF_DIRECT_RESPONSE_DOWNLOAD_FAILED';
    this.debug = debug;
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

function buildDebugPath(usuario, fechaInicio) {
  const debugDir = path.join(config.reportesDir, fechaInicio, 'debug');
  fs.mkdirSync(debugDir, { recursive: true });
  return path.join(debugDir, `${sanitizeFileName(usuario.name)}_direct_pdf_debug.json`);
}

function sanitizeUrlForOutput(url) {
  if (!url) return url;

  try {
    const parsedUrl = new URL(url);
    for (const key of parsedUrl.searchParams.keys()) {
      if (/(token|auth|authorization|password|pass|clave|contrasena|contraseña|pwd|session|api[_-]?key|key)/i.test(key)) {
        parsedUrl.searchParams.set(key, '***');
      }
    }
    return parsedUrl.toString();
  } catch (error) {
    return String(url).replace(/((token|auth|authorization|password|pass|clave|contrasena|contrase%C3%B1a|pwd|session|api[_-]?key|key)=)[^&]*/gi, '$1***');
  }
}

function sanitizeErrorForOutput(error) {
  if (!error) return null;

  return String(error.message || error)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/(cookie|authorization|set-cookie|proxy-authorization):[^\r\n]*/gi, '$1: ***')
    .replace(/((token|auth|authorization|password|pass|clave|contrasena|contrase%C3%B1a|pwd|session|api[_-]?key|key)=)[^&\s]*/gi, '$1***');
}

function normalizePdfUrl(url) {
  return encodeURI(String(url || '').trim());
}

function isRightPdfResponse(response) {
  const url = response.url();
  const lowerUrl = url.toLowerCase();

  return response.status() === 200
    && lowerUrl.includes('/reportesjasper/reports/')
    && url.includes('CierreCajaVentas')
    && lowerUrl.includes('.pdf');
}

function looksLikePdf(buffer) {
  if (!buffer || buffer.length < 4) return false;
  return buffer.subarray(0, 4).toString('utf8') === '%PDF';
}

function writeDebug({
  usuario,
  fechaInicio,
  fechaFin,
  pdfUrl,
  status,
  contentType,
  error
}) {
  const debugPath = buildDebugPath(usuario, fechaInicio);
  const payload = {
    usuario: usuario.name,
    fechaInicio,
    fechaFin,
    pdfUrl: sanitizeUrlForOutput(pdfUrl),
    status: status || null,
    contentType: contentType || null,
    'content-type': contentType || null,
    error: sanitizeErrorForOutput(error),
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(debugPath, JSON.stringify(payload, null, 2), 'utf8');
  return debugPath;
}

async function descargarPdfDerechaPorResponse({
  pageOrFrame,
  context,
  destinoPdf,
  usuario,
  fechaInicio,
  fechaFin
}) {
  const ownerPage = typeof pageOrFrame.waitForResponse === 'function' ? pageOrFrame : pageOrFrame.page();
  let pdfUrl = null;
  let status = null;
  let contentType = null;

  try {
    const { selectors } = config;
    await pageOrFrame.locator(selectors.generarPdfButton).waitFor({
      state: 'visible',
      timeout: config.timeoutMs
    });

    const responsePromise = ownerPage.waitForResponse(isRightPdfResponse, {
      timeout: config.timeoutMs
    });

    await pageOrFrame.locator(selectors.generarPdfButton).click();

    const pdfResponse = await responsePromise;
    pdfUrl = pdfResponse.url();
    status = pdfResponse.status();
    contentType = pdfResponse.headers()['content-type'] || null;

    const normalizedUrl = normalizePdfUrl(pdfUrl);
    let buffer;

    try {
      const directResponse = await context.request.get(normalizedUrl);
      status = directResponse.status();
      contentType = directResponse.headers()['content-type'] || contentType;

      if (!directResponse.ok()) {
        throw new Error(`La descarga directa respondio HTTP ${status}.`);
      }

      buffer = await directResponse.body();
    } catch (requestError) {
      buffer = await pdfResponse.body();
      status = pdfResponse.status();
      contentType = pdfResponse.headers()['content-type'] || contentType;
    }

    if (!buffer || buffer.length === 0) {
      throw new Error('La descarga directa devolvio un archivo vacio.');
    }

    if (!looksLikePdf(buffer)) {
      throw new Error('El archivo descargado no contiene cabecera %PDF.');
    }

    fs.writeFileSync(destinoPdf, buffer);

    return {
      estado: 'DESCARGADO',
      metodo: 'DIRECT_FROM_RESPONSE_URL',
      archivo: destinoPdf,
      pdfUrl: sanitizeUrlForOutput(pdfUrl)
    };
  } catch (error) {
    const debugPath = writeDebug({
      usuario,
      fechaInicio,
      fechaFin,
      pdfUrl,
      status,
      contentType,
      error
    });

    throw new PdfDirectResponseDownloadError(error.message, {
      debugPath,
      pdfUrl: sanitizeUrlForOutput(pdfUrl),
      status,
      contentType
    });
  }
}

module.exports = {
  descargarPdfDerechaPorResponse,
  PdfDirectResponseDownloadError
};

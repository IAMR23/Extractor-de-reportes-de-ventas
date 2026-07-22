const fs = require('fs');
const path = require('path');
const config = require('../config');

class PdfEmbeddedDownloadError extends Error {
  constructor(message, debug = {}) {
    super(message);
    this.name = 'PdfEmbeddedDownloadError';
    this.code = 'PDF_EMBEDDED_DOWNLOAD_FAILED';
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
  return path.join(debugDir, `${sanitizeFileName(usuario.name)}_embedded_pdf_debug.json`);
}

function isIgnoredUrl(url) {
  return !url || String(url).trim().toLowerCase().startsWith('chrome-extension://');
}

function normalizePdfUrl(rawUrl, baseUrl) {
  if (isIgnoredUrl(rawUrl)) return null;

  const encodedUrl = String(rawUrl).trim().replace(/ /g, '%20');
  return new URL(encodedUrl, baseUrl).toString();
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

function isCompatiblePdfContentType(contentType) {
  const text = String(contentType || '').toLowerCase();
  return text.includes('application/pdf')
    || text.includes('application/octet-stream')
    || text.includes('binary')
    || text.includes('pdf');
}

function looksLikePdf(buffer) {
  if (!buffer || buffer.length < 4) return false;
  return buffer.subarray(0, 4).toString('utf8') === '%PDF';
}

async function collectPdfElements(pageOrFrame) {
  return pageOrFrame.locator('embed[original-url], embed[type*="pdf"], iframe, object').evaluateAll((elements) => {
    return elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return {
        index,
        tagName: element.tagName,
        originalUrl: element.getAttribute('original-url'),
        src: element.getAttribute('src'),
        data: element.getAttribute('data'),
        type: element.getAttribute('type'),
        visible: rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
    });
  });
}

function pickPdfCandidate(elements, baseUrl) {
  const candidates = [];

  for (const element of elements) {
    for (const attrName of ['originalUrl', 'data', 'src']) {
      const normalizedUrl = normalizePdfUrl(element[attrName], baseUrl);
      if (!normalizedUrl) continue;

      candidates.push({
        ...element,
        attrName,
        pdfUrl: normalizedUrl
      });
    }
  }

  const cierreCajaVentas = candidates.find((candidate) => (
    candidate.visible && candidate.pdfUrl.includes('CierreCajaVentas')
  )) || candidates.find((candidate) => candidate.pdfUrl.includes('CierreCajaVentas'));

  if (cierreCajaVentas) return cierreCajaVentas;

  const visibleOriginalUrlEmbeds = candidates.filter((candidate) => (
    candidate.visible
    && candidate.tagName.toLowerCase() === 'embed'
    && candidate.attrName === 'originalUrl'
  ));

  return visibleOriginalUrlEmbeds.at(-1) || candidates.filter((candidate) => candidate.visible).at(-1) || candidates.at(-1) || null;
}

function writeDebug({ usuario, fechaInicio, fechaFin, elements, chosen, status, contentType, error }) {
  const debugPath = buildDebugPath(usuario, fechaInicio);
  const payload = {
    usuario: usuario.name,
    fechaInicio,
    fechaFin,
    generatedAt: new Date().toISOString(),
    cantidadEmbedsEncontrados: elements.length,
    elements: elements.map((element) => ({
      tagName: element.tagName,
      originalUrl: sanitizeUrlForOutput(element.originalUrl),
      src: sanitizeUrlForOutput(element.src),
      data: sanitizeUrlForOutput(element.data),
      type: element.type,
      visible: element.visible,
      left: element.left,
      top: element.top,
      width: element.width,
      height: element.height
    })),
    urlElegida: chosen ? sanitizeUrlForOutput(chosen.pdfUrl) : null,
    statusHttp: status || null,
    contentType: contentType || null,
    error: error ? String(error.message || error) : null
  };

  fs.writeFileSync(debugPath, JSON.stringify(payload, null, 2), 'utf8');
  return debugPath;
}

async function descargarPdfDerechaDesdeEmbed({
  pageOrFrame,
  context,
  destinoPdf,
  usuario,
  fechaInicio,
  fechaFin
}) {
  const elements = await collectPdfElements(pageOrFrame);
  const baseUrl = typeof pageOrFrame.url === 'function' ? pageOrFrame.url() : pageOrFrame.page().url();
  const chosen = pickPdfCandidate(elements, baseUrl);
  let status = null;
  let contentType = null;

  try {
    if (!chosen) {
      throw new Error('No se encontro una URL PDF valida en embed, iframe u object.');
    }

    const response = await context.request.get(chosen.pdfUrl);
    status = response.status();
    contentType = response.headers()['content-type'] || '';

    if (status !== 200) {
      throw new Error(`La descarga directa respondio HTTP ${status}.`);
    }

    if (!isCompatiblePdfContentType(contentType)) {
      throw new Error(`Content-Type no compatible para PDF: ${contentType || '(vacio)'}.`);
    }

    const buffer = await response.body();
    if (!buffer || buffer.length === 0) {
      throw new Error('La descarga directa devolvio un archivo vacio.');
    }

    if (!looksLikePdf(buffer)) {
      throw new Error('El archivo descargado no inicia con %PDF.');
    }

    fs.writeFileSync(destinoPdf, buffer);

    return {
      estado: 'DESCARGADO',
      metodo: 'DIRECT_FROM_RIGHT_EMBED_ORIGINAL_URL',
      archivo: destinoPdf,
      pdfUrl: sanitizeUrlForOutput(chosen.pdfUrl)
    };
  } catch (error) {
    const debugPath = writeDebug({
      usuario,
      fechaInicio,
      fechaFin,
      elements,
      chosen,
      status,
      contentType,
      error
    });

    throw new PdfEmbeddedDownloadError(error.message, {
      debugPath,
      cantidadEmbedsEncontrados: elements.length,
      urlElegida: chosen ? sanitizeUrlForOutput(chosen.pdfUrl) : null,
      statusHttp: status,
      contentType
    });
  }
}

module.exports = {
  descargarPdfDerechaDesdeEmbed,
  PdfEmbeddedDownloadError
};

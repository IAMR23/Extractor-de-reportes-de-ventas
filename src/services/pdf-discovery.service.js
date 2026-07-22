const fs = require('fs');
const path = require('path');
const config = require('../config');

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
  'x-auth-token'
]);

const BASIC_HEADER_ALLOWLIST = new Set([
  'accept',
  'authorization',
  'cache-control',
  'content-disposition',
  'content-length',
  'content-type',
  'cookie',
  'origin',
  'pragma',
  'referer',
  'set-cookie',
  'user-agent',
  'x-requested-with'
]);

function sanitizeFileName(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function maskSecret(value) {
  if (!value) return value;
  const text = String(value);
  if (text.length <= 12) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 6)}***${text.slice(-4)}`;
}

function sanitizeHeaders(headers = {}) {
  return Object.entries(headers).reduce((result, [name, value]) => {
    const normalizedName = name.toLowerCase();
    if (!BASIC_HEADER_ALLOWLIST.has(normalizedName)) return result;

    result[normalizedName] = SENSITIVE_HEADERS.has(normalizedName)
      ? maskSecret(value)
      : value;

    return result;
  }, {});
}

function sanitizePostData(postData) {
  if (!postData) return null;

  let parsed;
  try {
    parsed = JSON.parse(postData);
  } catch (error) {
    parsed = null;
  }

  if (parsed && typeof parsed === 'object') {
    return JSON.stringify(redactObject(parsed));
  }

  return postData
    .replace(/((password|pass|clave|contrasena|contrase%C3%B1a|pwd)=)[^&]*/gi, '$1***')
    .replace(/("(password|pass|clave|contrasena|contraseña|pwd)"\s*:\s*")[^"]*(")/gi, '$1***$3');
}

function sanitizeUrl(url) {
  try {
    const parsedUrl = new URL(url);
    for (const key of parsedUrl.searchParams.keys()) {
      if (/(password|pass|clave|contrasena|contraseña|pwd)/i.test(key)) {
        parsedUrl.searchParams.set(key, '***');
      }
    }
    return parsedUrl.toString();
  } catch (error) {
    return String(url).replace(/((password|pass|clave|contrasena|contrase%C3%B1a|pwd)=)[^&]*/gi, '$1***');
  }
}

function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject);

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((result, [key, item]) => {
      const normalizedKey = key.toLowerCase();
      result[key] = /(password|pass|clave|contrasena|contraseña|pwd)/i.test(normalizedKey)
        ? '***'
        : redactObject(item);
      return result;
    }, {});
  }

  return value;
}

function isPdfCandidate(contentType, contentDisposition) {
  const text = `${contentType || ''} ${contentDisposition || ''}`.toLowerCase();
  return [
    'application/pdf',
    'application/octet-stream',
    'binary',
    'attachment',
    'filename'
  ].some((token) => text.includes(token));
}

function buildDebugPath(usuario, fechaInicio) {
  const debugDir = path.join(config.reportesDir, fechaInicio, 'debug');
  fs.mkdirSync(debugDir, { recursive: true });
  return path.join(debugDir, `${sanitizeFileName(usuario.name)}_network.json`);
}

function createPdfDiscovery({ page, usuario, fechaInicio, fechaFin }) {
  const entries = [];
  const attachedPages = new Set();
  const handlers = [];

  function addHandler(target, event, handler) {
    target.on(event, handler);
    handlers.push({ target, event, handler });
  }

  function attach(targetPage, source) {
    if (!targetPage || attachedPages.has(targetPage)) return;
    attachedPages.add(targetPage);

    addHandler(targetPage, 'request', (request) => {
      entries.push({
        type: 'request',
        source,
        timestamp: new Date().toISOString(),
        method: request.method(),
        url: sanitizeUrl(request.url()),
        status: null,
        contentType: null,
        contentDisposition: null,
        requestHeaders: sanitizeHeaders(request.headers()),
        responseHeaders: null,
        postData: sanitizePostData(request.postData()),
        isPdfCandidate: false
      });
    });

    addHandler(targetPage, 'response', async (response) => {
      const request = response.request();
      const responseHeaders = response.headers();
      const contentType = responseHeaders['content-type'] || '';
      const contentDisposition = responseHeaders['content-disposition'] || '';

      entries.push({
        type: 'response',
        source,
        timestamp: new Date().toISOString(),
        method: request.method(),
        url: sanitizeUrl(response.url()),
        status: response.status(),
        contentType,
        contentDisposition,
        requestHeaders: sanitizeHeaders(request.headers()),
        responseHeaders: sanitizeHeaders(responseHeaders),
        postData: sanitizePostData(request.postData()),
        isPdfCandidate: isPdfCandidate(contentType, contentDisposition)
      });
    });

    addHandler(targetPage, 'popup', (popup) => {
      attach(popup, 'popup');
    });
  }

  attach(page, 'page');

  async function save() {
    const filePath = buildDebugPath(usuario, fechaInicio);
    const payload = {
      usuario: usuario.name,
      fechaInicio,
      fechaFin,
      generatedAt: new Date().toISOString(),
      totalEntries: entries.length,
      candidates: entries.filter((entry) => entry.isPdfCandidate),
      entries
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return filePath;
  }

  function stop() {
    for (const { target, event, handler } of handlers) {
      target.off(event, handler);
    }
    handlers.length = 0;
    attachedPages.clear();
  }

  return {
    attach,
    save,
    stop
  };
}

module.exports = {
  createPdfDiscovery
};

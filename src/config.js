require('dotenv').config();

const path = require('path');

const requiredEnv = ['SYSTEM_URL'];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta configurar ${name} en el archivo .env`);
  }
  return value;
}

function getBooleanEnv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'si'].includes(value.toLowerCase());
}

function getNumberEnv(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : defaultValue;
}

for (const envName of requiredEnv) {
  requireEnv(envName);
}

const config = {
  systemUrl: process.env.SYSTEM_URL,
  headless: getBooleanEnv('HEADLESS', false),
  slowMo: getNumberEnv('SLOW_MO_MS', 0),
  timeoutMs: getNumberEnv('TIMEOUT_MS', 45000),
  fechaInicio: process.env.FECHA_INICIO,
  fechaFin: process.env.FECHA_FIN,
  reportesDir: path.resolve(__dirname, '..', 'reportes'),
  nombreReporte: 'facturacion',
  selectors: {
    // input usuario real del sistema.
    usuarioInput: '#user',

    // input password real del sistema.
    passwordInput: '#password',

    // boton login real del sistema.
    loginButton: '#btn_login',

    // Marcador visible solo cuando el login fue correcto.
    // En la pantalla principal de la captura aparece el enlace "Salir".
    loginSuccessMarker: 'text=Salir',

    // TODO: mensaje de login incorrecto, si existe.
    loginErrorMarker: '.alert-danger, .error-login',

    // TODO: menú o enlace del módulo de reportes.
    reportesMenuText: 'Cierre de Caja',
    reportesSubMenuText: 'Cierre de Caja (Distribuidor)',
    reportesSubMenuSasText: 'Cierre de Caja Sas',
    menuClickDelayMs: 1000,
    reportesFrameName: 'main',

    // TODO: input fecha inicio.
    fechaInicioInput: '#startDate',
    fechaInicioDialog: '#startDate__dialog_',
    fechaInicioValue: '#startDate__value_',

    // TODO: input fecha fin.
    fechaFinInput: '#endDate',
    fechaFinDialog: '#endDate__dialog_',
    fechaFinValue: '#endDate__value_',

    // TODO: botón generar PDF.
    generarPdfButton: 'button.btn.btn-secondary:has(img[src*="pdf.png"])',

    // TODO: botón descargar si el popup muestra un botón antes de descargar.
    descargarPdfButton: 'viewer-download-controls#downloads cr-icon-button#save[title="Descargar"], viewer-download-controls#downloads cr-icon-button#save[aria-label="Descargar"]',

    // boton cerrar sesion, si aplica.
    logoutButton: 'text=Salir'
  }
};

module.exports = config;

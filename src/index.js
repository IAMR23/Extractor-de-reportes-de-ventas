const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const config = require('./config');
const usuarios = require('./usuarios');
const { descargarReporte } = require('./descargarReporte');

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function validarFecha(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    throw new Error(`${name} debe tener formato YYYY-MM-DD. Valor recibido: ${value || '(vacío)'}`);
  }
}

function getRangoFechas() {
  const fechaInicio = getArg('inicio') || config.fechaInicio;
  const fechaFin = getArg('fin') || config.fechaFin;

  validarFecha(fechaInicio, 'fechaInicio');
  validarFecha(fechaFin, 'fechaFin');

  return { fechaInicio, fechaFin };
}

function guardarLog(fechaInicio, resultados) {
  const logDir = path.join(config.reportesDir, fechaInicio);
  fs.mkdirSync(logDir, { recursive: true });

  const logPath = path.join(logDir, 'log.json');
  fs.writeFileSync(logPath, JSON.stringify(resultados, null, 2), 'utf8');
  return logPath;
}

async function main() {
  const { fechaInicio, fechaFin } = getRangoFechas();
  const resultados = [];
  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMo
  });

  try {
    console.log(`Iniciando descarga secuencial para ${usuarios.length} usuarios.`);
    console.log(`Rango: ${fechaInicio} a ${fechaFin}`);
    console.log(`Navegador visible: ${config.headless ? 'no' : 'si'}`);

    for (const usuario of usuarios) {
      console.log(`Procesando ${usuario.name}...`);
      const resultado = await descargarReporte(browser, usuario, fechaInicio, fechaFin);
      resultados.push(resultado);

      if (resultado.estado === 'DESCARGADO') {
        console.log(`OK ${usuario.name}: ${resultado.archivo}`);
      } else {
        console.error(`ERROR ${usuario.name}: ${resultado.mensaje}`);
      }
    }

    const logPath = guardarLog(fechaInicio, resultados);
    console.log(`Log guardado en: ${logPath}`);

    const errores = resultados.filter((resultado) => resultado.estado === 'ERROR');
    if (errores.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close().catch(() => null);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

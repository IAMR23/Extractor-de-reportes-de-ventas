# Contexto del proyecto

Automatizador web con Node.js + Playwright para descargar reportes PDF de CrediTV.

Flujo:
1. Login con 4 usuarios desde .env.
2. Abrir pestaña nueva del sistema.
3. Entrar a Cierre de Caja.
4. Seleccionar Cierre de Caja (Distribuidor).
5. Usar frame main.
6. Seleccionar fechas startDate/endDate.
7. Generar PDF.
8. Descargar desde visor Chrome con botón #save.
9. Guardar en reportes/YYYY-MM-DD/.
10. Crear log.json.

Pendiente:
- Probar con credenciales reales.
- Ajustar selectores si alguno falla.
- Luego crear módulo para leer PDFs y comparar TVs vendidas vs facturadas.
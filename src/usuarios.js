function getUsuario(index) {
  const name = process.env[`USER${index}_NAME`];
  const username = process.env[`USER${index}_USERNAME`];
  const password = process.env[`USER${index}_PASSWORD`];

  if (!name && !username && !password) return null;

  if (!name || !username || !password) {
    throw new Error(`Credenciales incompletas para USER${index} en .env`);
  }

  return { name, username, password };
}

const usuarios = [1, 2, 3, 4].map(getUsuario).filter(Boolean);

if (usuarios.length !== 4) {
  throw new Error(`Debes configurar exactamente 4 usuarios. Usuarios encontrados: ${usuarios.length}`);
}

module.exports = usuarios;

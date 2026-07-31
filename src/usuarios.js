const sucursales = {
  1: 'NUEVA AURORA',
  2: 'CAUPICHO',
  3: 'SANGOLQUI',
  4: 'CHILLOGALLO'
};

function getUsuario(index) {
  const name = process.env[`USER${index}_NAME`];
  const username = process.env[`USER${index}_USERNAME`];
  const password = process.env[`USER${index}_PASSWORD`];

  if (!name && !username && !password) return null;

  if (!name || !username || !password) {
    throw new Error(`Credenciales incompletas para USER${index} en .env`);
  }

  return {
    name,
    username,
    password,
    sucursal: sucursales[index]
  };
}

const usuarios = [1, 2, 3, 4].map(getUsuario).filter(Boolean);

if (usuarios.length !== 4) {
  throw new Error(`Debes configurar exactamente 4 usuarios. Usuarios encontrados: ${usuarios.length}`);
}

module.exports = usuarios;

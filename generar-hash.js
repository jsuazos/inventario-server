// generar-hash.js
import bcrypt from 'bcrypt';

const contraseña = 'javo123'; // 🔑 Cambia por la clave que quieras encriptar

bcrypt.hash(contraseña, 10).then(hash => {
  console.log(`Hash de "${contraseña}":\n${hash}`);
});

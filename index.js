// inventario-server/index.js

import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';

dotenv.config();

const app = express();

// Permitir CORS
app.use(cors());

// Middleware para parsear JSON
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post('/api/login', async (req, res) => {
  const { usuario, contrasena } = req.body;

  if (!usuario || !contrasena) {
    return res.status(400).json({ error: 'Faltan campos' });
  }

  try {
    // Verifica que USUARIOS_JSON exista y sea válido
    const usuariosJSON = process.env.USUARIOS_JSON;
    if (!usuariosJSON) {
      console.error('USUARIOS_JSON no está definido en variables de entorno');
      return res.status(500).json({ error: 'Configuración inválida del servidor' });
    }

    const usuarios = JSON.parse(usuariosJSON);
    const user = usuarios.find(u => u.usuario === usuario);

    console.log('Usuario recibido:', usuario);
    console.log('Usuario encontrado:', user);

    if (!user || !user.hash) {
      return res.status(401).json({ error: 'Usuario o contraseña inválidos' });
    }

    const esValida = await bcrypt.compare(contrasena, user.hash);
    if (!esValida) {
      return res.status(401).json({ error: 'Usuario o contraseña inválidos' });
    }

    res.json({ mensaje: 'Login correcto' });

  } catch (error) {
    console.error('Error al procesar login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});


// Proxy para inventario EXCEL
app.get('/api/inventario', async (req, res) => {
  const url = `https://script.google.com/macros/s/${process.env.SECRET_TOKEN_INVENTARIO}/exec?path=INVENTARIO&action=read`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error al consultar Inventario:', error);
    res.status(500).json({ error: 'Error al consultar Inventario' });
  }
});

// Proxy para Fanart.tv
app.get('/api/fanart', async (req, res) => {
  const artistMbId = req.query.mbid;
  if (!artistMbId) return res.status(400).json({ error: 'Falta el parámetro mbid' });

  const url = `https://webservice.fanart.tv/v3/music/${artistMbId}?api_key=${process.env.FANART_API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error al consultar Fanart.tv:', error);
    res.status(500).json({ error: 'Error al consultar Fanart.tv' });
  }
});

// Proxy para Discogs (ya existente)
app.get('/api/discogs', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Falta el parámetro q' });

  const url = `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&token=${process.env.DISCOGS_TOKEN}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error en Discogs:', error);
    res.status(500).json({ error: 'Error al consultar Discogs' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor proxy corriendo en http://localhost:${PORT}`);
});

// server.js
// Backend + Frontend de SmartCampusGuide con Express y PostgreSQL

const express = require('express');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');
const QRCode = require('qrcode');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
app.use(express.json());

// ---------------- CONFIGURACIÓN CORS ----------------
app.use(cors({
  origin: "https://smarcampus.onrender.com"
}));

// ---------------- CONFIGURACIÓN FRONTEND ----------------
app.use(express.static(path.join(__dirname, 'web')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'));
});

// ---------------- CONFIGURACIÓN POSTGRES ----------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://smartcampus_e3qk_user:VcilJQhBclQrE8dlUTEnOqQA3rUL1L1K@dpg-d9hstto4n6ts73bg0em0-a.oregon-postgres.render.com:5432/smartcampus_e3qk",
  ssl: { rejectUnauthorized: false }
});

// ---------------- FUNCIÓN AUXILIAR PARA REGISTRO ----------------
async function registrarAccion({ id_usuario, accion, modulo, detalle, dispositivo, ip, resultado, duracion_segundos }) {
  try {
    await pool.query(
      `INSERT INTO logsactividad 
       (id_usuario, accion, modulo, detalle, dispositivo, ip, resultado, duracion_segundos, fecha) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [id_usuario, accion, modulo, detalle, dispositivo, ip, resultado, duracion_segundos]
    );

    await pool.query(
      `INSERT INTO huella_usuarios 
       (id_usuario, accion, modulo, detalle, dispositivo, ip, resultado, duracion_segundos, fecha_hora) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [id_usuario, accion, modulo, detalle, dispositivo, ip, resultado, duracion_segundos]
    );
  } catch (err) {
    console.error("Error registrando acción:", err);
  }
}

// ---------------- LOGIN ----------------
app.post('/login', async (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password) {
    return res.status(400).json({ error: "Faltan credenciales" });
  }

  try {
    const result = await pool.query("SELECT * FROM usuarios WHERE correo=$1", [correo]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const usuario = result.rows[0];

    // Validar contraseña con bcrypt
    const valido = await bcrypt.compare(password, usuario.password_hash);
    if (!valido) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    // Registrar acción en actividad y huella
    await registrarAccion({
      id_usuario: usuario.id_usuario,
      accion: 'LOGIN',
      modulo: 'Autenticación',
      detalle: `Usuario ${usuario.nombre} inició sesión`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    // Respuesta final (solo datos básicos)
    res.json({
      mensaje: "Login correcto",
      usuario: {
        id_usuario: usuario.id_usuario,
        nombre: usuario.nombre,
        correo: usuario.correo,
        rol: usuario.rol // 👈 ahora también devuelve el rol
      }
    });
  } catch (err) {
    console.error("Error en login:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});


// === Videoclases ===
app.get("/videoclases", async (req, res) => {
  const result = await pool.query("SELECT id, titulo, profesor FROM videoclases");
  res.json(result.rows);
});

app.post("/videoclases", async (req, res) => {
  const { titulo, profesor } = req.body;
  await pool.query("INSERT INTO videoclases (titulo, profesor) VALUES ($1, $2)", [titulo, profesor]);
  res.json({ mensaje: "Videoclase creada" });
});

app.put("/videoclases/:id", async (req, res) => {
  const { id } = req.params;
  const { titulo, profesor } = req.body;
  await pool.query("UPDATE videoclases SET titulo=$1, profesor=$2 WHERE id=$3", [titulo, profesor, id]);
  res.json({ mensaje: "Videoclase modificada" });
});

app.delete("/videoclases/:id", async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM videoclases WHERE id=$1", [id]);
  res.json({ mensaje: "Videoclase eliminada" });
});











// === Métricas WiFi ===
app.get("/metricaswifi", async (req, res) => {
  const result = await pool.query("SELECT * FROM metricaswifi");
  res.json(result.rows);
});

// === Radio UNGE ===
app.get("/radiounge", async (req, res) => {
  const result = await pool.query("SELECT * FROM radio_programas");
  res.json(result.rows);
});

// === Transporte Escolar ===
app.get("/transporteescolar", async (req, res) => {
  const result = await pool.query("SELECT * FROM transporte");
  res.json(result.rows);
});

// === Mapa ===
app.get("/mapa", async (req, res) => {
  const result = await pool.query("SELECT nombre, coordenadas FROM lugares");
  res.json(result.rows);
});





// ---------------- USUARIOS CRUD ----------------
app.get('/usuarios', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM usuarios ORDER BY id_usuario');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/usuarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM usuarios WHERE id_usuario=$1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    // 👇 Registrar acción
    await registrarAccion({
      id_usuario: id,
      accion: 'CONSULTAR',
      modulo: 'Usuarios',
      detalle: `Consulta de usuario ${id}`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/usuarios", async (req, res) => {
  const { nombre, correo, rol, password } = req.body;
  try {
    const passwordHash = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      "INSERT INTO usuarios (nombre, correo, rol, password_hash) VALUES ($1, $2, $3, $4) RETURNING *",
      [nombre, correo, rol, passwordHash]
    );

    // 👇 Registrar acción
    await registrarAccion({
      id_usuario: result.rows[0].id_usuario,
      accion: 'CREAR',
      modulo: 'Usuarios',
      detalle: `Usuario ${nombre} creado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/usuarios/:id", async (req, res) => {
  const { id } = req.params;
  const { nombre, correo, rol, password } = req.body;
  try {
    let result;
    if (password && password.trim() !== "") {
      const passwordHash = bcrypt.hashSync(password, 10);
      result = await pool.query(
        "UPDATE usuarios SET nombre=$1, correo=$2, rol=$3, password_hash=$4 WHERE id_usuario=$5 RETURNING *",
        [nombre, correo, rol, passwordHash, id]
      );
    } else {
      result = await pool.query(
        "UPDATE usuarios SET nombre=$1, correo=$2, rol=$3 WHERE id_usuario=$4 RETURNING *",
        [nombre, correo, rol, id]
      );
    }
    if (result.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

    // 👇 Registrar acción
    await registrarAccion({
      id_usuario: id,
      accion: 'EDITAR',
      modulo: 'Usuarios',
      detalle: `Usuario ${nombre} actualizado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/usuarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM usuarios WHERE id_usuario=$1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    // 👇 Registrar acción
    await registrarAccion({
      id_usuario: id,
      accion: 'ELIMINAR',
      modulo: 'Usuarios',
      detalle: `Usuario ${id} eliminado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ message: 'Usuario eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// ENDPOINTS CRUD PROFESORES
// =========================

// Listar todos los profesores con datos completos
app.get('/profesores', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id_profesor AS id,
             u.nombre AS nombre,
             u.correo,
             COALESCE(string_agg(DISTINCT d.nombre, ', '), '') AS departamentos,
             COALESCE(string_agg(DISTINCT c.nombre, ', '), '') AS carreras,
             COALESCE(string_agg(DISTINCT a.nombre, ', '), '') AS asignaturas
      FROM profesores p
      LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
      LEFT JOIN profesor_departamento pd ON p.id_profesor = pd.id_profesor
      LEFT JOIN departamentos d ON pd.id_departamento = d.id_departamento
      LEFT JOIN profesor_carrera pc ON p.id_profesor = pc.id_profesor
      LEFT JOIN carreras c ON pc.id_carrera = c.id_carrera
      LEFT JOIN profesor_asignatura pa ON p.id_profesor = pa.id_profesor
      LEFT JOIN asignaturas a ON pa.id_asignatura = a.id_asignatura
      GROUP BY p.id_profesor, u.nombre, u.correo
      ORDER BY p.id_profesor ASC;
    `);

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Profesores',
      detalle: 'Listado de profesores consultado',
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo profesores" });
  }
});

// Obtener profesor por ID con arrays de relaciones
app.get('/profesores/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const profesor = await pool.query(`
      SELECT p.id_profesor AS id,
             u.nombre AS nombre,
             u.correo,
             p.id_usuario
      FROM profesores p
      LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
      WHERE p.id_profesor = $1
    `, [id]);

    if (profesor.rows.length === 0) return res.status(404).json({ error: 'Profesor no encontrado' });

    const departamentos = await pool.query('SELECT id_departamento FROM profesor_departamento WHERE id_profesor=$1', [id]);
    const carreras = await pool.query('SELECT id_carrera FROM profesor_carrera WHERE id_profesor=$1', [id]);
    const asignaturas = await pool.query('SELECT id_asignatura FROM profesor_asignatura WHERE id_profesor=$1', [id]);

    const data = {
      ...profesor.rows[0],
      departamentos_ids: departamentos.rows.map(r => r.id_departamento),
      carreras_ids: carreras.rows.map(r => r.id_carrera),
      asignaturas_ids: asignaturas.rows.map(r => r.id_asignatura)
    };

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear profesor
app.post('/profesores', async (req, res) => {
  try {
    const { id_usuario, departamentos_ids, carreras_ids, asignaturas_ids } = req.body;
    const result = await pool.query(
      'INSERT INTO profesores (id_usuario) VALUES ($1) RETURNING id_profesor',
      [id_usuario]
    );
    const id_profesor = result.rows[0].id_profesor;

    if (departamentos_ids?.length) {
      for (const depId of departamentos_ids) {
        await pool.query('INSERT INTO profesor_departamento (id_profesor, id_departamento) VALUES ($1, $2)', [id_profesor, depId]);
      }
    }
    if (carreras_ids?.length) {
      for (const carId of carreras_ids) {
        await pool.query('INSERT INTO profesor_carrera (id_profesor, id_carrera) VALUES ($1, $2)', [id_profesor, carId]);
      }
    }
    if (asignaturas_ids?.length) {
      for (const asigId of asignaturas_ids) {
        await pool.query('INSERT INTO profesor_asignatura (id_profesor, id_asignatura) VALUES ($1, $2)', [id_profesor, asigId]);
      }
    }

    await registrarAccion({
      id_usuario,
      accion: 'CREAR',
      modulo: 'Profesores',
      detalle: `Profesor ${id_profesor} creado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ mensaje: 'Profesor creado correctamente', id_profesor });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Actualizar profesor
app.put('/profesores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { id_usuario, departamentos_ids, carreras_ids, asignaturas_ids } = req.body;

    await pool.query('UPDATE profesores SET id_usuario=$1 WHERE id_profesor=$2', [id_usuario, id]);

    await pool.query('DELETE FROM profesor_departamento WHERE id_profesor=$1', [id]);
    await pool.query('DELETE FROM profesor_carrera WHERE id_profesor=$1', [id]);
    await pool.query('DELETE FROM profesor_asignatura WHERE id_profesor=$1', [id]);

    if (departamentos_ids?.length) {
      for (const depId of departamentos_ids) {
        await pool.query('INSERT INTO profesor_departamento (id_profesor, id_departamento) VALUES ($1, $2)', [id, depId]);
      }
    }
    if (carreras_ids?.length) {
      for (const carId of carreras_ids) {
        await pool.query('INSERT INTO profesor_carrera (id_profesor, id_carrera) VALUES ($1, $2)', [id, carId]);
      }
    }
    if (asignaturas_ids?.length) {
      for (const asigId of asignaturas_ids) {
        await pool.query('INSERT INTO profesor_asignatura (id_profesor, id_asignatura) VALUES ($1, $2)', [id, asigId]);
      }
    }

    await registrarAccion({
      id_usuario,
      accion: 'EDITAR',
      modulo: 'Profesores',
      detalle: `Profesor ${id} actualizado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ mensaje: 'Profesor actualizado correctamente', id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Eliminar profesor
app.delete('/profesores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM profesor_departamento WHERE id_profesor=$1', [id]);
    await pool.query('DELETE FROM profesor_carrera WHERE id_profesor=$1', [id]);
    await pool.query('DELETE FROM profesor_asignatura WHERE id_profesor=$1', [id]);
    const result = await pool.query('DELETE FROM profesores WHERE id_profesor=$1 RETURNING id_profesor', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profesor no encontrado' });

    await registrarAccion({
      id_usuario: null,
      accion: 'ELIMINAR',
      modulo: 'Profesores',
      detalle: `Profesor ${id} eliminado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ mensaje: 'Profesor eliminado correctamente', id: result.rows[0].id_profesor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// ---------------- ESTUDIANTES CRUD ----------------

// Obtener todos los estudiantes
app.get('/estudiantes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.id_estudiante AS id,
             u.nombre,
             u.correo,
             e.matricula,
             e.id_usuario
      FROM estudiantes e
      JOIN usuarios u ON e.id_usuario = u.id_usuario
      ORDER BY e.id_estudiante
    `);

    // 👇 Registrar acción
    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Estudiantes',
      detalle: 'Consulta de todos los estudiantes',
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener un estudiante por ID
app.get('/estudiantes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT e.id_estudiante AS id,
             e.id_usuario,
             e.matricula,
             u.nombre,
             u.correo
      FROM estudiantes e
      JOIN usuarios u ON e.id_usuario = u.id_usuario
      WHERE e.id_estudiante=$1
    `, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Estudiante no encontrado' });

    // 👇 Registrar acción
    await registrarAccion({
      id_usuario: result.rows[0].id_usuario,
      accion: 'CONSULTAR',
      modulo: 'Estudiantes',
      detalle: `Consulta de estudiante ${id}`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear estudiante
app.post('/estudiantes', async (req, res) => {
  try {
    const { id_usuario, matricula } = req.body;
    const result = await pool.query(
      `INSERT INTO estudiantes (id_usuario, matricula)
       VALUES ($1, $2)
       RETURNING id_estudiante AS id, id_usuario, matricula`,
      [id_usuario, matricula]
    );

    // 👇 Registrar acción
    await registrarAccion({
      id_usuario,
      accion: 'CREAR',
      modulo: 'Estudiantes',
      detalle: `Estudiante ${matricula} creado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Actualizar estudiante
app.put('/estudiantes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { id_usuario, matricula } = req.body;
    const result = await pool.query(
      `UPDATE estudiantes
       SET id_usuario=$1, matricula=$2
       WHERE id_estudiante=$3
       RETURNING id_estudiante AS id, id_usuario, matricula`,
      [id_usuario, matricula, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Estudiante no encontrado' });

    // 👇 Registrar acción
    await registrarAccion({
      id_usuario,
      accion: 'EDITAR',
      modulo: 'Estudiantes',
      detalle: `Estudiante ${id} actualizado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Eliminar estudiante
app.delete('/estudiantes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM estudiantes
       WHERE id_estudiante=$1
       RETURNING id_estudiante AS id, id_usuario, matricula`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Estudiante no encontrado' });

    // 👇 Registrar acción
    await registrarAccion({
      id_usuario: result.rows[0].id_usuario,
      accion: 'ELIMINAR',
      modulo: 'Estudiantes',
      detalle: `Estudiante ${id} eliminado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ mensaje: 'Estudiante eliminado correctamente', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Navegación en el mapa (acciones registradas)
app.get('/mapa_estadisticas', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT accion AS zona, COUNT(*) AS total
      FROM logsactividad
      GROUP BY accion
      ORDER BY total DESC
    `);

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Mapa',
      detalle: 'Consulta de estadísticas de navegación en el mapa',
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Oyentes de Radio UNGE
app.get('/oyentes_radio', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.titulo_programa AS programa, COUNT(e.usuario_id) AS oyentes
      FROM estadisticas_escucha e
      JOIN radiounge r ON e.id_programa = r.id
      GROUP BY r.titulo_programa
      ORDER BY oyentes DESC
    `);

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Radio UNGE',
      detalle: 'Consulta de oyentes de Radio UNGE',
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📻 CRUD de Programas de Radio UNGE
app.get('/radiounge', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM radiounge ORDER BY id ASC");

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Radio UNGE',
      detalle: 'Consulta de todos los programas de Radio UNGE',
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener un programa por ID
app.get('/radiounge/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM radiounge WHERE id=$1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Programa no encontrado" });
    }

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Radio UNGE',
      detalle: `Consulta de programa ${id}`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear programa
app.post('/radiounge', async (req, res) => {
  try {
    const { titulo_programa, tipo_id, fecha_hora_inicio, fecha_hora_fin, es_en_vivo, locutorio_id } = req.body;

    await pool.query(
      "INSERT INTO radiounge (titulo_programa, tipo_id, fecha_hora_inicio, fecha_hora_fin, es_en_vivo, locutorio_id) VALUES ($1,$2,$3,$4,$5,$6)",
      [titulo_programa, tipo_id, fecha_hora_inicio, fecha_hora_fin, es_en_vivo, locutorio_id]
    );

    await registrarAccion({
      id_usuario: null,
      accion: 'CREAR',
      modulo: 'Radio UNGE',
      detalle: `Programa ${titulo_programa} creado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.sendStatus(201);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// ENDPOINTS CRUD DEPARTAMENTOS
// =========================

// Listar departamentos
app.get('/departamentos', async (req, res) => {
  try {
    const result = await pool.query('SELECT id_departamento, nombre FROM departamentos ORDER BY id_departamento ASC');

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Departamentos',
      detalle: 'Listado de departamentos consultado',
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo departamentos" });
  }
});

// Crear departamento
app.post('/departamentos', async (req, res) => {
  try {
    const { nombre } = req.body;
    const result = await pool.query(
      'INSERT INTO departamentos (nombre) VALUES ($1) RETURNING *',
      [nombre]
    );

    await registrarAccion({
      id_usuario: null,
      accion: 'CREAR',
      modulo: 'Departamentos',
      detalle: `Departamento ${result.rows[0].id_departamento} creado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Actualizar departamento
app.put('/departamentos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body;
    const result = await pool.query(
      'UPDATE departamentos SET nombre=$1 WHERE id_departamento=$2 RETURNING *',
      [nombre, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Departamento no encontrado' });

    await registrarAccion({
      id_usuario: null,
      accion: 'EDITAR',
      modulo: 'Departamentos',
      detalle: `Departamento ${id} actualizado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Eliminar departamento
app.delete('/departamentos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM departamentos WHERE id_departamento=$1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Departamento no encontrado' });

    await registrarAccion({
      id_usuario: null,
      accion: 'ELIMINAR',
      modulo: 'Departamentos',
      detalle: `Departamento ${id} eliminado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ mensaje: 'Departamento eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ---------------- CARRERAS CRUD ----------------
app.get('/carreras', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM carreras ORDER BY id_carrera');

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Carreras',
      detalle: 'Consulta de todas las carreras',
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/carreras/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM carreras WHERE id_carrera=$1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Carrera no encontrada' });

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Carreras',
      detalle: `Consulta de carrera ${id}`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/carreras', async (req, res) => {
  try {
    const { nombre } = req.body;
    const result = await pool.query(
      'INSERT INTO carreras (nombre) VALUES ($1) RETURNING *',
      [nombre]
    );

    await registrarAccion({
      id_usuario: null,
      accion: 'CREAR',
      modulo: 'Carreras',
      detalle: `Carrera ${nombre} creada`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/carreras/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body;
    const result = await pool.query(
      'UPDATE carreras SET nombre=$1 WHERE id_carrera=$2 RETURNING *',
      [nombre, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Carrera no encontrada' });

    await registrarAccion({
      id_usuario: null,
      accion: 'EDITAR',
      modulo: 'Carreras',
      detalle: `Carrera ${id} actualizada`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/carreras/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM carreras WHERE id_carrera=$1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Carrera no encontrada' });

    await registrarAccion({
      id_usuario: null,
      accion: 'ELIMINAR',
      modulo: 'Carreras',
      detalle: `Carrera ${id} eliminada`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ mensaje: 'Carrera eliminada correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- EDIFICIOS CRUD ----------------
app.get('/edificios', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id_edificio AS id, nombre, ubicacion, lat, lng FROM edificios ORDER BY id_edificio'
    );

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Edificios',
      detalle: 'Consulta de todos los edificios',
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/edificios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id_edificio AS id, nombre, ubicacion, lat, lng FROM edificios WHERE id_edificio=$1',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Edificio no encontrado' });

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Edificios',
      detalle: `Consulta de edificio ${id}`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/edificios', async (req, res) => {
  try {
    const { nombre, ubicacion, lat, lng } = req.body;
    const result = await pool.query(
      'INSERT INTO edificios (nombre, ubicacion, lat, lng) VALUES ($1, $2, $3, $4) RETURNING id_edificio AS id, nombre, ubicacion, lat, lng',
      [nombre, ubicacion, lat, lng]
    );

    await registrarAccion({
      id_usuario: null,
      accion: 'CREAR',
      modulo: 'Edificios',
      detalle: `Edificio ${nombre} creado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/edificios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, ubicacion, lat, lng } = req.body;
    const result = await pool.query(
      'UPDATE edificios SET nombre=$1, ubicacion=$2, lat=$3, lng=$4 WHERE id_edificio=$5 RETURNING id_edificio AS id, nombre, ubicacion, lat, lng',
      [nombre, ubicacion, lat, lng, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Edificio no encontrado' });

    await registrarAccion({
      id_usuario: null,
      accion: 'EDITAR',
      modulo: 'Edificios',
      detalle: `Edificio ${id} actualizado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/edificios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM edificios WHERE id_edificio=$1 RETURNING id_edificio AS id, nombre, ubicacion, lat, lng',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Edificio no encontrado' });

    await registrarAccion({
      id_usuario: null,
      accion: 'ELIMINAR',
      modulo: 'Edificios',
      detalle: `Edificio ${id} eliminado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ mensaje: 'Edificio eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- MAPA: BÚSQUEDA Y HUELLA ----------------

// Buscar edificio por nombre
app.get('/api/map/search', async (req, res) => {
  try {
    const { nombre } = req.query;
    const result = await pool.query(
      "SELECT * FROM edificios WHERE nombre ILIKE $1 LIMIT 1",
      [nombre]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Edificio no encontrado" });

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Mapa',
      detalle: `Búsqueda de edificio ${nombre}`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Registrar huella de usuario
app.post('/api/map/huella', async (req, res) => {
  try {
    const { usuario_id, edificio_id } = req.body;
    const result = await pool.query(
      "INSERT INTO huella_usuarios (usuario_id, edificio_id, fecha_busqueda) VALUES ($1, $2, NOW()) RETURNING *",
      [usuario_id, edificio_id]
    );

    await registrarAccion({
      id_usuario: usuario_id,
      accion: 'CREAR',
      modulo: 'Mapa',
      detalle: `Huella registrada en edificio ${edificio_id}`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ mensaje: "Huella registrada", data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Marcar llegada y enviar mensaje
app.post('/api/map/arrived', async (req, res) => {
  try {
    const { usuario_id, edificio_id } = req.body;
    const result = await pool.query(
      "UPDATE huella_usuarios SET tiempo_llegada=NOW(), mensaje_enviado=TRUE WHERE usuario_id=$1 AND edificio_id=$2 RETURNING *",
      [usuario_id, edificio_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Huella no encontrada" });

    await registrarAccion({
      id_usuario: usuario_id,
      accion: 'EDITAR',
      modulo: 'Mapa',
      detalle: `Usuario ${usuario_id} llegó al edificio ${edificio_id}`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ mensaje: "Bienvenido al edificio!", data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// =========================
// ENDPOINTS CRUD ASIGNATURAS
// =========================

// Listar asignaturas
app.get('/asignaturas', async (req, res) => {
  try {
    const result = await pool.query('SELECT id_asignatura, nombre FROM asignaturas ORDER BY id_asignatura ASC');

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Asignaturas',
      detalle: 'Listado de asignaturas consultado',
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo asignaturas" });
  }
});

// Crear asignatura
app.post('/asignaturas', async (req, res) => {
  try {
    const { nombre } = req.body;
    const result = await pool.query(
      'INSERT INTO asignaturas (nombre) VALUES ($1) RETURNING *',
      [nombre]
    );

    await registrarAccion({
      id_usuario: null,
      accion: 'CREAR',
      modulo: 'Asignaturas',
      detalle: `Asignatura ${result.rows[0].id_asignatura} creada`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Actualizar asignatura
app.put('/asignaturas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body;
    const result = await pool.query(
      'UPDATE asignaturas SET nombre=$1 WHERE id_asignatura=$2 RETURNING *',
      [nombre, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Asignatura no encontrada' });

    await registrarAccion({
      id_usuario: null,
      accion: 'EDITAR',
      modulo: 'Asignaturas',
      detalle: `Asignatura ${id} actualizada`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Eliminar asignatura
app.delete('/asignaturas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM asignaturas WHERE id_asignatura=$1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Asignatura no encontrada' });

    await registrarAccion({
      id_usuario: null,
      accion: 'ELIMINAR',
      modulo: 'Asignaturas',
      detalle: `Asignatura ${id} eliminada`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ mensaje: 'Asignatura eliminada correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------- TIPOS DE SENSORES CRUD ----------------
app.get('/tipos_sensores', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tipos_sensores ORDER BY id_tipo');

    // Depuración: imprime el primer registro
    console.log(result.rows[0]);

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Tipos de Sensores',
      detalle: 'Consulta de todos los tipos de sensores',
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/tipos_sensores', async (req, res) => {
  try {
    const { nombre } = req.body;
    const result = await pool.query(
      'INSERT INTO tipos_sensores (nombre) VALUES ($1) RETURNING *',
      [nombre]
    );

    await registrarAccion({
      id_usuario: null,
      accion: 'CREAR',
      modulo: 'Tipos de Sensores',
      detalle: `Tipo de sensor ${nombre} creado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/tipos_sensores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body;
    const result = await pool.query(
      'UPDATE tipos_sensores SET nombre=$1 WHERE id_tipo=$2 RETURNING *',
      [nombre, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de sensor no encontrado' });
    }

    await registrarAccion({
      id_usuario: null,
      accion: 'EDITAR',
      modulo: 'Tipos de Sensores',
      detalle: `Tipo de sensor ${id} actualizado a ${nombre}`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/tipos_sensores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM tipos_sensores WHERE id_tipo=$1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tipo no encontrado' });

    await registrarAccion({
      id_usuario: null,
      accion: 'ELIMINAR',
      modulo: 'Tipos de Sensores',
      detalle: `Tipo de sensor ${id} eliminado`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ mensaje: 'Tipo eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------- AULAS CRUD ----------------

// Listar todas las aulas
app.get('/aulas', async (req, res) => {
  try {
    const result = await pool.query('SELECT id_aula, nombre FROM aulas ORDER BY id_aula');

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Aulas',
      detalle: 'Consulta de todas las aulas',
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear aula
app.post('/aulas', async (req, res) => {
  try {
    const { nombre } = req.body;
    const result = await pool.query(
      'INSERT INTO aulas (nombre) VALUES ($1) RETURNING *',
      [nombre]
    );

    await registrarAccion({
      id_usuario: null,
      accion: 'CREAR',
      modulo: 'Aulas',
      detalle: `Aula ${nombre} creada`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Actualizar aula
app.put('/aulas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body;
    const result = await pool.query(
      'UPDATE aulas SET nombre=$1 WHERE id_aula=$2 RETURNING *',
      [nombre, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Aula no encontrada' });

    await registrarAccion({
      id_usuario: null,
      accion: 'EDITAR',
      modulo: 'Aulas',
      detalle: `Aula ${id} actualizada`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Eliminar aula
app.delete('/aulas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM aulas WHERE id_aula=$1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Aula no encontrada' });

    await registrarAccion({
      id_usuario: null,
      accion: 'ELIMINAR',
      modulo: 'Aulas',
      detalle: `Aula ${id} eliminada`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({ message: 'Aula eliminada correctamente' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});



// ---------------- SENSORES CRUD ----------------
app.get('/sensores', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id_sensor,
             ts.nombre AS tipo,
             a.codigo || ' - ' || a.nombre AS aula,
             s.ubicacion,
             l.valor, l.fecha, l.hora
      FROM sensores s
      JOIN tipos_sensores ts ON s.id_tipo = ts.id_tipo
      JOIN aulas a ON s.id_aula = a.id_aula
      LEFT JOIN LATERAL (
        SELECT valor, fecha, hora
        FROM lecturas
        WHERE id_sensor = s.id_sensor
        ORDER BY fecha DESC, hora DESC
        LIMIT 1
      ) l ON true
      ORDER BY s.id_sensor;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al obtener sensores');
  }
});

// ✅ Nuevo endpoint: obtener un sensor individual
app.get('/sensores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id_sensor, id_tipo, id_aula, ubicacion
       FROM sensores
       WHERE id_sensor = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sensor no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/sensores', async (req, res) => {
  try {
    const { id_aula, id_tipo, ubicacion } = req.body;
    const result = await pool.query(
      'INSERT INTO sensores (id_aula, id_tipo, ubicacion) VALUES ($1, $2, $3) RETURNING *',
      [id_aula, id_tipo, ubicacion]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/sensores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { id_aula, id_tipo, ubicacion } = req.body;
    const result = await pool.query(
      'UPDATE sensores SET id_aula=$1, id_tipo=$2, ubicacion=$3 WHERE id_sensor=$4 RETURNING *',
      [id_aula, id_tipo, ubicacion, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sensor no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/sensores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM sensores WHERE id_sensor=$1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sensor no encontrado' });
    res.json({ mensaje: 'Sensor eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- LECTURAS DE SENSORES ----------------
app.post('/sensores/data', async (req, res) => {
  try {
    const { id_sensor, valor } = req.body;
    const fecha = new Date().toISOString().split("T")[0];
    const hora = new Date().toISOString().split("T")[1].split(".")[0];
    const result = await pool.query(
      'INSERT INTO lecturas (id_sensor, valor, fecha, hora) VALUES ($1, $2, $3, $4) RETURNING *',
      [id_sensor, valor, fecha, hora]
    );
    res.json({ mensaje: 'Lectura registrada', data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------- HISTORIAL DE SENSORES ----------------
app.get('/sensores/:id/historial', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT valor, fecha, hora
       FROM lecturas
       WHERE id_sensor = $1
       ORDER BY fecha ASC, hora ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error obteniendo historial:", err);
    res.status(500).json({ error: "Error al obtener historial del sensor" });
  }
});






// ---------------- MÉTRICAS WIFI ----------------

// Listado con filtros opcionales
app.get('/metricaswifi', async (req, res) => {
  try {
    const { fechaInicio, fechaFin, idAula } = req.query;

    let query = `
      SELECT id_wifi, id_aula, usuarios_conectados, ancho_banda, latencia, jitter,
             perdida_paquetes, nivel_senal, fecha
      FROM metricaswifi
      WHERE 1=1
    `;
    const params = [];

    if (fechaInicio) {
      params.push(fechaInicio);
      query += ` AND fecha >= $${params.length}`;
    }
    if (fechaFin) {
      params.push(fechaFin);
      query += ` AND fecha <= $${params.length}`;
    }
    if (idAula) {
      params.push(idAula);
      query += ` AND id_aula = $${params.length}`;
    }

    query += ` ORDER BY fecha ASC`;

    const result = await pool.query(query, params);
    console.log("Resultados métricas WiFi:", result.rows); // depuración
    res.json(result.rows);
  } catch (err) {
    console.error("Error en GET /metricaswifi:", err);
    res.status(500).json({ error: err.message });
  }
});

// Insertar métricas WiFi (para ESP32 o pruebas)
app.post('/metricaswifi', async (req, res) => {
  try {
    const { id_aula, usuarios_conectados, ancho_banda, latencia, jitter, perdida_paquetes, nivel_senal } = req.body;

    const query = `
      INSERT INTO metricaswifi (id_aula, usuarios_conectados, ancho_banda, latencia, jitter, perdida_paquetes, nivel_senal, fecha)
      VALUES ($1,$2,$3,$4,$5,$6,$7, CURRENT_TIMESTAMP)
      RETURNING *;
    `;

    const values = [id_aula, usuarios_conectados, ancho_banda, latencia, jitter, perdida_paquetes, nivel_senal];
    const result = await pool.query(query, values);

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Error en POST /metricaswifi:", err);
    res.status(500).json({ error: err.message });
  }
});

// Actualizar métricas WiFi por ID
app.put('/metricaswifi/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { id_aula, usuarios_conectados, ancho_banda, latencia, jitter, perdida_paquetes, nivel_senal } = req.body;

    const query = `
      UPDATE metricaswifi
      SET id_aula = $1,
          usuarios_conectados = $2,
          ancho_banda = $3,
          latencia = $4,
          jitter = $5,
          perdida_paquetes = $6,
          nivel_senal = $7
      WHERE id_wifi = $8
      RETURNING *;
    `;

    const values = [id_aula, usuarios_conectados, ancho_banda, latencia, jitter, perdida_paquetes, nivel_senal, id];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Métrica WiFi no encontrada" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error en PUT /metricaswifi/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

// Eliminar métricas WiFi por ID
app.delete('/metricaswifi/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const query = `DELETE FROM metricaswifi WHERE id_wifi = $1 RETURNING *;`;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Métrica WiFi no encontrada" });
    }

    res.json({ message: "Métrica WiFi eliminada correctamente", deleted: result.rows[0] });
  } catch (err) {
    console.error("Error en DELETE /metricaswifi/:id:", err);
    res.status(500).json({ error: err.message });
  }
});



// ==================== MÓDULO HUELLA ====================

// Endpoint: métricas para el dashboard Huella
app.get('/api/huella/metricas', async (req, res) => {
  try {
    const totalAcciones = await pool.query('SELECT COUNT(*) FROM huella_usuarios');
    const usuariosActivos = await pool.query('SELECT COUNT(DISTINCT id_usuario) FROM huella_usuarios');

    // Usuarios conectados en los últimos 5 minutos
    const usuariosConectados = await pool.query(`
      SELECT COUNT(DISTINCT id_usuario) 
      FROM huella_usuarios 
      WHERE fecha_hora > NOW() - INTERVAL '5 minutes'
    `);

    // Módulo más usado
    const moduloTop = await pool.query(`
      SELECT modulo, COUNT(*) AS total 
      FROM huella_usuarios 
      GROUP BY modulo 
      ORDER BY total DESC LIMIT 1
    `);

    // Tiempo acumulado en Radio
    const tiempoRadio = await pool.query(`
      SELECT COALESCE(SUM(duracion_segundos),0) AS total 
      FROM huella_usuarios WHERE modulo ILIKE 'Radio%'
    `);

    // Acciones por módulo
    const accionesPorModulo = await pool.query(`
      SELECT modulo, COUNT(*) AS total 
      FROM huella_usuarios 
      GROUP BY modulo
    `);

    // Top 5 usuarios más activos
    const usuariosMasActivos = await pool.query(`
      SELECT id_usuario, COUNT(*) AS total 
      FROM huella_usuarios 
      GROUP BY id_usuario 
      ORDER BY total DESC LIMIT 5
    `);

    await registrarAccion({
      id_usuario: null,
      accion: 'CONSULTAR',
      modulo: 'Huella',
      detalle: 'Consulta de métricas de huella',
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json({
      totalAcciones: parseInt(totalAcciones.rows[0].count),
      usuariosActivos: parseInt(usuariosActivos.rows[0].count),
      usuariosConectados: parseInt(usuariosConectados.rows[0].count),
      moduloTop: moduloTop.rows[0]?.modulo || '-',
      tiempoRadio: parseInt(tiempoRadio.rows[0].total),
      accionesPorModulo: Object.fromEntries(accionesPorModulo.rows.map(r => [r.modulo, parseInt(r.total)])),
      usuariosMasActivos: Object.fromEntries(usuariosMasActivos.rows.map(r => [`Usuario ${r.id_usuario}`, parseInt(r.total)]))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener métricas de huella' });
  }
});

// Endpoint: registrar una nueva huella
app.post('/api/huella', async (req, res) => {
  try {
    const { id_usuario, accion, modulo, detalle, dispositivo, ip, resultado, duracion_segundos } = req.body;
    const query = `
      INSERT INTO huella_usuarios 
      (id_usuario, accion, modulo, detalle, dispositivo, ip, resultado, duracion_segundos, fecha_hora)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      RETURNING *;
    `;
    const values = [id_usuario, accion, modulo, detalle, dispositivo, ip, resultado, duracion_segundos];
    const result = await pool.query(query, values);

    await registrarAccion({
      id_usuario,
      accion,
      modulo,
      detalle,
      dispositivo,
      ip,
      resultado,
      duracion_segundos
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar huella' });
  }
});

// Endpoint: historial de un usuario
app.get('/api/huella/:id_usuario', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM huella_usuarios WHERE id_usuario=$1 ORDER BY fecha_hora DESC',
      [req.params.id_usuario]
    );

    await registrarAccion({
      id_usuario: req.params.id_usuario,
      accion: 'CONSULTAR',
      modulo: 'Huella',
      detalle: `Consulta historial de huella del usuario ${req.params.id_usuario}`,
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener historial de huella' });
  }
});

// =======================
// ENDPOINTS ACTIVIDAD
// =======================

// Obtener registros de actividad con filtros
app.get('/api/logsactividad', async (req, res) => {
  const { usuario, modulo, inicio, fin } = req.query;

  let query = `SELECT * FROM logsactividad WHERE 1=1`;
  let params = [];

  if (usuario) {
    params.push(usuario);
    query += ` AND id_usuario = $${params.length}`;
  }
  if (modulo) {
    params.push(modulo);
    query += ` AND modulo ILIKE $${params.length}`;
  }
  if (inicio) {
    params.push(inicio);
    query += ` AND fecha >= $${params.length}`;
  }
  if (fin) {
    params.push(fin);
    query += ` AND fecha <= $${params.length}`;
  }

  query += ` ORDER BY fecha DESC`;

  try {
    const result = await pool.query(query, params);

    await registrarAccion({
      id_usuario: usuario || null,
      accion: 'CONSULTAR',
      modulo: 'Actividad',
      detalle: 'Consulta de registros de actividad',
      dispositivo: 'Web',
      ip: req.ip,
      resultado: 'OK',
      duracion_segundos: 0
    });

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener actividad' });
  }
});

// Insertar nueva actividad
app.post('/api/logsactividad', async (req, res) => {
  const { id_usuario, accion, modulo, detalle, dispositivo, ip, resultado, duracion_segundos } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO logsactividad 
       (id_usuario, accion, modulo, detalle, dispositivo, ip, resultado, duracion_segundos, fecha) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
      [id_usuario, accion, modulo, detalle, dispositivo, ip, resultado, duracion_segundos]
    );

    await registrarAccion({
      id_usuario,
      accion,
      modulo,
      detalle,
      dispositivo,
      ip,
      resultado,
      duracion_segundos
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar actividad' });
  }
});






//[-------------ENDPOINTS TRANSPORTE-------------]
// ---- BUSES ----

// Obtener todos los buses
app.get('/transporteescolar/buses', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id_bus, numero, placa, conductor, capacidad, estado FROM buses ORDER BY id_bus'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener un bus específico
app.get('/transporteescolar/buses/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT id_bus, numero, placa, conductor, capacidad, estado FROM buses WHERE id_bus=$1',
      [id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear un bus
app.post('/transporteescolar/buses', async (req, res) => {
  const { numero, placa, conductor, capacidad, estado } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO buses (numero, placa, conductor, capacidad, estado)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [numero, placa, conductor, capacidad, estado]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar un bus
app.put('/transporteescolar/buses/:id', async (req, res) => {
  const { id } = req.params;
  const { numero, placa, conductor, capacidad, estado } = req.body;
  try {
    const result = await pool.query(
      `UPDATE buses SET numero=$1, placa=$2, conductor=$3, capacidad=$4, estado=$5
       WHERE id_bus=$6 RETURNING *`,
      [numero, placa, conductor, capacidad, estado, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar un bus
app.delete('/transporteescolar/buses/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM buses WHERE id_bus=$1', [id]);
    res.json({ message: 'Bus eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// -------- RUTAS --------

// Obtener todas las rutas
app.get('/transporteescolar/rutas', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rutas ORDER BY id_ruta');
    res.json(result.rows);
  } catch (err) {
    console.error("Error al obtener rutas:", err);
    res.status(500).json({ error: err.message });
  }
});

// Obtener una ruta específica
app.get('/transporteescolar/rutas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM rutas WHERE id_ruta=$1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ruta no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error al obtener ruta:", err);
    res.status(500).json({ error: err.message });
  }
});

// Crear una nueva ruta
app.post('/transporteescolar/rutas', async (req, res) => {
  const { nombre, descripcion, hora_inicio, hora_fin } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO rutas (nombre, descripcion, hora_inicio, hora_fin)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [nombre, descripcion, hora_inicio, hora_fin]
    );
    res.status(201).json(result.rows[0]); // 201 Created
  } catch (err) {
    console.error("Error al crear ruta:", err);
    res.status(500).json({ error: err.message });
  }
});

// Actualizar una ruta
app.put('/transporteescolar/rutas/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, hora_inicio, hora_fin } = req.body;
  try {
    const result = await pool.query(
      `UPDATE rutas SET nombre=$1, descripcion=$2, hora_inicio=$3, hora_fin=$4
       WHERE id_ruta=$5 RETURNING *`,
      [nombre, descripcion, hora_inicio, hora_fin, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ruta no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error al actualizar ruta:", err);
    res.status(500).json({ error: err.message });
  }
});

// Eliminar una ruta
app.delete('/transporteescolar/rutas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM rutas WHERE id_ruta=$1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ruta no encontrada' });
    }
    res.json({ message: 'Ruta eliminada' });
  } catch (err) {
    console.error("Error al eliminar ruta:", err);
    res.status(500).json({ error: err.message });
  }
});


// -------- PARADAS --------

// Obtener todas las paradas
app.get('/transporteescolar/paradas', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM paradas ORDER BY id_parada');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener todas las paradas de una ruta específica
app.get('/transporteescolar/rutas/:id/paradas', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM paradas WHERE id_ruta=$1 ORDER BY orden',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear una nueva parada
app.post('/transporteescolar/paradas', async (req, res) => {
  const { id_ruta, nombre, latitud, longitud, orden } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO paradas (id_ruta, nombre, latitud, longitud, orden)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id_ruta, nombre, latitud, longitud, orden]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar una parada
app.put('/transporteescolar/paradas/:id', async (req, res) => {
  const { id } = req.params;
  const { id_ruta, nombre, latitud, longitud, orden } = req.body;
  try {
    const result = await pool.query(
      `UPDATE paradas SET id_ruta=$1, nombre=$2, latitud=$3, longitud=$4, orden=$5
       WHERE id_parada=$6 RETURNING *`,
      [id_ruta, nombre, latitud, longitud, orden, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Parada no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar una parada
app.delete('/transporteescolar/paradas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM paradas WHERE id_parada=$1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Parada no encontrada' });
    }
    res.json({ message: 'Parada eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// -------- POSICIONES --------

// Registrar posición GPS (desde SIM800/ESP)
app.post('/transporteescolar/posiciones', async (req, res) => {
  const { id_bus, id_ruta, latitud, longitud, velocidad, direccion, fecha_hora } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO posiciones (id_bus, id_ruta, latitud, longitud, velocidad, direccion, fecha_hora)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id_bus, id_ruta, latitud, longitud, velocidad, direccion, fecha_hora]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener todas las posiciones (historial completo)
app.get('/transporteescolar/posiciones', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id_posicion, id_bus, id_ruta, latitud, longitud, velocidad, direccion, fecha_hora
       FROM posiciones
       ORDER BY fecha_hora ASC`
    );
    res.json(result.rows); // 🔑 devolver todas las filas
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Última posición de cada bus
app.get('/transporteescolar/posiciones/actual', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (id_bus) id_bus, id_ruta, latitud, longitud, velocidad, direccion, fecha_hora
       FROM posiciones
       ORDER BY id_bus, fecha_hora DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Historial de posiciones de un bus específico
app.get('/transporteescolar/buses/:id/posiciones', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT id_posicion, id_bus, id_ruta, latitud, longitud, velocidad, direccion, fecha_hora
       FROM posiciones
       WHERE id_bus=$1
       ORDER BY fecha_hora ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar una posición (opcional, útil para limpiar datos de prueba)
app.delete('/transporteescolar/posiciones/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM posiciones WHERE id_posicion=$1', [id]);
    res.json({ message: 'Posición eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




//-------PASAJEROS--------
// Registrar subida de pasajero
app.post('/pasajeros', async (req, res) => {
  const { id_bus, id_usuario } = req.body;
  const result = await pool.query(
    `INSERT INTO pasajeros_bus (id_bus, id_usuario, estado)
     VALUES ($1,$2,'A BORDO') RETURNING *`,
    [id_bus, id_usuario]
  );
  res.json(result.rows[0]);
});

// Registrar bajada de pasajero
app.put('/pasajeros/:id', async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(
    `UPDATE pasajeros_bus SET estado='BAJADO' WHERE id_pasajero=$1 RETURNING *`,
    [id]
  );
  res.json(result.rows[0]);
});


//-----ALERTAS-------
// Registrar alerta
app.post('/alertas', async (req, res) => {
  const { id_bus, tipo, descripcion } = req.body;
  const result = await pool.query(
    `INSERT INTO alertas_bus (id_bus, tipo, descripcion)
     VALUES ($1,$2,$3) RETURNING *`,
    [id_bus, tipo, descripcion]
  );
  res.json(result.rows[0]);
});

// Obtener alertas recientes
app.get('/alertas', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM alertas_bus ORDER BY timestamp DESC LIMIT 50'
  );
  res.json(result.rows);
});


//------METRICAS-----
// Métricas rápidas
app.get('/transporte/metricas', async (req, res) => {
  const busesActivos = await pool.query("SELECT COUNT(*) FROM buses WHERE estado='EN SERVICIO'");
  const rutas = await pool.query("SELECT COUNT(*) FROM rutas");
  const pasajerosHoy = await pool.query("SELECT COUNT(*) FROM pasajeros_bus WHERE DATE(fecha)=CURRENT_DATE");
  const alertas = await pool.query("SELECT COUNT(*) FROM alertas_bus WHERE DATE(timestamp)=CURRENT_DATE");

  res.json({
    activos: busesActivos.rows[0].count,
    rutas: rutas.rows[0].count,
    pasajeros_hoy: pasajerosHoy.rows[0].count,
    alertas: alertas.rows[0].count
  });
});

// Gráfica pasajeros por ruta
app.get('/transporte/grafica', async (req, res) => {
  const result = await pool.query(`
    SELECT r.nombre AS ruta, COUNT(p.id_pasajero) AS pasajeros
    FROM rutas r
    LEFT JOIN paradas pa ON pa.id_ruta = r.id_ruta
    LEFT JOIN pasajeros_bus p ON p.id_bus IN (
      SELECT id_bus FROM buses WHERE id_bus IN (
        SELECT id_bus FROM posiciones_bus WHERE id_bus IS NOT NULL
      )
    )
    GROUP BY r.nombre
  `);

  res.json({
    labels: result.rows.map(r => r.ruta),
    values: result.rows.map(r => r.pasajeros)
  });
});


//----------ENDPOINTS T-ESCOLAR-------------



// Obtener todos los registros de transporteescolar
app.get('/transporteescolar', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transporteescolar ORDER BY fecha ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener transporteescolar:', err);
    res.status(500).json({ error: 'Error al obtener datos' });
  }
});

// Obtener métricas rápidas (último registro)
app.get('/transporteescolar/metricas', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transporteescolar ORDER BY fecha DESC LIMIT 1');
    const ultimo = result.rows[0];
    res.json({
      buses_en_servicio: ultimo?.buses_en_servicio ?? 0,
      rutas_activas: ultimo?.rutas_activas ?? 0,
      capacidad: ultimo?.capacidad ?? 0,
      alertas_hoy: ultimo?.alertas_hoy ?? 0
    });
  } catch (err) {
    console.error('Error al obtener métricas:', err);
    res.status(500).json({ error: 'Error al obtener métricas' });
  }
});

// Obtener datos para gráfica de ocupación promedio
app.get('/transporteescolar/grafica', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT fecha, ocupacion_promedio FROM transporteescolar ORDER BY fecha ASC'
    );
    const labels = result.rows.map(r => r.fecha);
    const values = result.rows.map(r => r.ocupacion_promedio);
    res.json({ labels, values });
  } catch (err) {
    console.error('Error al obtener gráfica:', err);
    res.status(500).json({ error: 'Error al obtener datos de gráfica' });
  }
});

// Insertar un nuevo registro de métricas diarias
app.post('/transporteescolar', async (req, res) => {
  try {
    const query = `
      INSERT INTO transporteescolar (
        fecha, capacidad, buses_en_servicio, buses_fuera_servicio,
        rutas_activas, alertas_hoy, ocupacion_promedio, tiempo_promedio_llegada, ruta
      )
      VALUES (
        CURRENT_DATE,
        (SELECT SUM(capacidad) FROM buses),
        (SELECT COUNT(*) FROM buses WHERE estado = 'EN SERVICIO'),
        (SELECT COUNT(*) FROM buses WHERE estado = 'FUERA DE SERVICIO'),
        (SELECT COUNT(*) FROM rutas),
        (SELECT COUNT(*) FROM alertas WHERE fecha::date = CURRENT_DATE),
        (SELECT AVG(capacidad) FROM buses),
        (SELECT AVG(hora_fin - hora_inicio) FROM rutas),
        (SELECT nombre FROM rutas LIMIT 1)
      )
      RETURNING *;
    `;
    const result = await pool.query(query);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al insertar métricas:', err);
    res.status(500).json({ error: 'Error al insertar métricas' });
  }
});



// =======================
// ENDPOINTS VIDEOCLASES
// =======================

// Obtener todas las videoclases
app.get('/videoclases', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM videoclases ORDER BY fecha_inicio ASC');
    const ahora = new Date();

    const clases = result.rows.map(clase => {
      const inicio = new Date(clase.fecha_inicio);
      const fin = clase.fecha_fin ? new Date(clase.fecha_fin) : null;

      // Recalcular estado dinámicamente
      let estadoCalculado = clase.estado;
      if (clase.estado !== 'CANCELADA') {
        if (ahora >= inicio && (!fin || ahora <= fin)) {
          estadoCalculado = 'EN_CURSO';
        } else if (fin && ahora > fin) {
          estadoCalculado = 'FINALIZADA';
        } else if (ahora < inicio) {
          estadoCalculado = 'PROGRAMADA';
        }
      }

      return {
        ...clase,
        fecha_inicio: inicio.toISOString().slice(0,19), // "YYYY-MM-DDTHH:mm:ss" sin Z
        fecha_fin: fin ? fin.toISOString().slice(0,19) : null,
        estado: estadoCalculado
      };
    });

    res.json(clases);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo videoclases' });
  }
});

// Crear nueva videoclase
app.post('/videoclases', async (req, res) => {
  const { titulo, descripcion, profesor_id, fecha_inicio, fecha_fin, invitados, estado } = req.body;
  try {
    // Generar enlace dinámico Jitsi
    const enlace = `https://meet.jit.si/${encodeURIComponent(titulo)}-${Date.now()}`;
    const result = await pool.query(
      `INSERT INTO videoclases (titulo, descripcion, profesor_id, fecha_inicio, fecha_fin, enlace, invitados, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [titulo, descripcion, profesor_id, fecha_inicio, fecha_fin, enlace, invitados, estado]
    );

    const clase = result.rows[0];
    // Normalizar fechas
    clase.fecha_inicio = new Date(clase.fecha_inicio).toISOString().slice(0,19);
    clase.fecha_fin = clase.fecha_fin ? new Date(clase.fecha_fin).toISOString().slice(0,19) : null;

    res.json(clase);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando videoclase' });
  }
});

// Actualizar videoclase existente
app.put('/videoclases/:id', async (req, res) => {
  const { id } = req.params;
  const { titulo, descripcion, fecha_inicio, fecha_fin, estado, invitados } = req.body;
  try {
    const result = await pool.query(
      `UPDATE videoclases
       SET titulo=$1, descripcion=$2, fecha_inicio=$3, fecha_fin=$4, estado=$5, invitados=$6, actualizado_en=NOW()
       WHERE id_videoclase=$7 RETURNING *`,
      [titulo, descripcion, fecha_inicio, fecha_fin, estado, invitados, id]
    );
    if(result.rows.length === 0) return res.status(404).json({ error: 'Videoclase no encontrada' });

    const clase = result.rows[0];
    // Normalizar fechas
    clase.fecha_inicio = new Date(clase.fecha_inicio).toISOString().slice(0,19);
    clase.fecha_fin = clase.fecha_fin ? new Date(clase.fecha_fin).toISOString().slice(0,19) : null;

    res.json(clase);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando videoclase' });
  }
});

// Eliminar videoclase
app.delete('/videoclases/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM videoclases WHERE id_videoclase=$1 RETURNING *', [id]);
    if(result.rows.length === 0) return res.status(404).json({ error: 'Videoclase no encontrada' });
    res.json({ message: 'Videoclase eliminada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando videoclase' });
  }
});



// =========================
// ENDPOINTS DE ASISTENCIA
// =========================

const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

// 0. Endpoints de Departamentos y Carreras
app.get('/departamentos', async (req, res) => {
  try {
    const result = await pool.query(`SELECT id_departamento, nombre FROM departamentos ORDER BY nombre ASC`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo departamentos" });
  }
});

app.get('/carreras', async (req, res) => {
  try {
    const result = await pool.query(`SELECT id_carrera, nombre FROM carreras ORDER BY nombre ASC`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo carreras" });
  }
});

// 1. Generar QR para un aula
app.post('/qr/generar', async (req, res) => {
  try {
    const { id_aula, id_asignatura, semana } = req.body;
    const codigo = uuidv4();
    const fechaGeneracion = new Date();
    const validoHasta = new Date();
    validoHasta.setDate(fechaGeneracion.getDate() + 7); // válido por 1 semana

    const result = await pool.query(`
      INSERT INTO qr_aulas (id_aula, id_asignatura, semana, codigo_qr, fecha_generacion, valido_hasta)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [id_aula, id_asignatura, semana, codigo, fechaGeneracion, validoHasta]);

    const qrImage = await QRCode.toDataURL(codigo);

    res.json({ ...result.rows[0], qr_image: qrImage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error generando QR" });
  }
});

// 2. Validar QR escaneado
app.post('/qr/validar', async (req, res) => {
  try {
    const { codigo_qr } = req.body;
    const result = await pool.query(`
      SELECT * FROM qr_aulas
      WHERE codigo_qr = $1 AND valido_hasta >= CURRENT_TIMESTAMP
    `, [codigo_qr]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "QR inválido o caducado" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error validando QR" });
  }
});

// 3. Registrar asistencia profesor usando QR
app.post('/asistencia', async (req, res) => {
  try {
    const { id_profesor, id_departamento, id_carrera, id_asignatura, id_aula, codigo_qr } = req.body;

    // Validar QR primero
    const qr = await pool.query(`
      SELECT id_qr FROM qr_aulas
      WHERE codigo_qr = $1 AND valido_hasta >= CURRENT_TIMESTAMP
    `, [codigo_qr]);

    if (qr.rows.length === 0) {
      return res.status(400).json({ error: "QR inválido o caducado" });
    }

    const id_qr = qr.rows[0].id_qr;

    const result = await pool.query(`
      INSERT INTO asistencia (
        id_profesor, id_departamento, id_carrera, id_asignatura, id_aula,
        fecha, hora_entrada, validacion, codigo_qr, id_qr
      ) VALUES (
        $1, $2, $3, $4, $5,
        CURRENT_DATE, CURRENT_TIMESTAMP, TRUE, $6, $7
      ) RETURNING *
    `, [id_profesor, id_departamento, id_carrera, id_asignatura, id_aula, codigo_qr, id_qr]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error registrando asistencia" });
  }
});

// 4. Listar asistencias con filtros y JOINs
app.get('/asistencia', async (req, res) => {
  try {
    const { departamento, carrera, fecha } = req.query;
    let filtros = [];
    let valores = [];
    let i = 1;

    if (departamento) { filtros.push(`a.id_departamento = $${i++}`); valores.push(departamento); }
    if (carrera) { filtros.push(`a.id_carrera = $${i++}`); valores.push(carrera); }
    if (fecha) { filtros.push(`a.fecha = $${i++}`); valores.push(fecha); }

    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

    const result = await pool.query(`
      SELECT a.id_asistencia,
             u.nombre AS profesor,
             d.nombre AS departamento,
             c.nombre AS carrera,
             asig.nombre AS asignatura,
             au.nombre AS aula,
             a.fecha,
             a.hora_entrada,
             a.validacion,
             a.codigo_qr
      FROM asistencia a
      JOIN profesores p ON a.id_profesor = p.id_profesor
      JOIN usuarios u ON p.id_usuario = u.id_usuario
      JOIN departamentos d ON a.id_departamento = d.id_departamento
      JOIN carreras c ON a.id_carrera = c.id_carrera
      JOIN asignaturas asig ON a.id_asignatura = asig.id_asignatura
      JOIN aulas au ON a.id_aula = au.id_aula
      ${where}
      ORDER BY a.fecha DESC, a.hora_entrada DESC
    `, valores);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo asistencias" });
  }
});

// 5. Métricas de asistencia
app.get('/asistencia/metricas', async (req, res) => {
  try {
    const hoy = new Date().toISOString().split('T')[0];

    const asistenciasHoy = await pool.query(
      `SELECT COUNT(*) FROM asistencia WHERE fecha = $1 AND validacion = true`,
      [hoy]
    );

    const faltasHoy = await pool.query(
      `SELECT COUNT(*) FROM asistencia WHERE fecha = $1 AND validacion = false`,
      [hoy]
    );

    const totalProfesores = await pool.query(`SELECT COUNT(*) FROM profesores`);

    const tardanzasHoy = await pool.query(
      `SELECT COUNT(*) FROM asistencia WHERE fecha = $1 AND hora_entrada > '08:15'`,
      [hoy]
    );

    res.json({
      asistencias_hoy: parseInt(asistenciasHoy.rows[0].count),
      faltas: parseInt(faltasHoy.rows[0].count),
      tardanzas: parseInt(tardanzasHoy.rows[0].count),
      total_profesores: parseInt(totalProfesores.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Gráfica de asistencia
app.get('/asistencia/grafica', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT fecha, COUNT(*) AS total
       FROM asistencia
       WHERE validacion = true
       GROUP BY fecha
       ORDER BY fecha ASC
       LIMIT 7`
    );

    res.json({
      labels: result.rows.map(r => r.fecha),
      values: result.rows.map(r => parseInt(r.total))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// 7. Obtener asistencia por ID
app.get('/asistencia/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`SELECT * FROM asistencia WHERE id_asistencia=$1`, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Actualizar asistencia
app.put('/asistencia/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fecha, hora_entrada, validacion } = req.body;
    await pool.query(
      `UPDATE asistencia
       SET fecha=$2, hora_entrada=$3, validacion=$4
       WHERE id_asistencia=$1`,
      [id, fecha, hora_entrada, validacion]
    );
    res.json({ message: 'Asistencia actualizada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Eliminar asistencia
app.delete('/asistencia/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM asistencia WHERE id_asistencia=$1`, [id]);
    res.json({ message: 'Asistencia eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// =========================
// CRON JOB SEMANAL DE QR
// =========================

// Generar un nuevo QR semanal para cada aula
cron.schedule('0 8 * * MON', async () => {
  try {
    const aulas = await pool.query('SELECT id_aula FROM aulas');
    for (const aula of aulas.rows) {
      const codigoQR = require('uuid').v4();
      const fechaGeneracion = new Date();
      const validoHasta = new Date();
      validoHasta.setDate(fechaGeneracion.getDate() + 7);

      await pool.query(
        `INSERT INTO qr_aulas (id_aula, codigo_qr, fecha_generacion, valido_hasta)
         VALUES ($1, $2, $3, $4)`,
        [aula.id_aula, codigoQR, fechaGeneracion, validoHasta]
      );

      console.log(`✅ Nuevo QR generado para aula ${aula.id_aula}: ${codigoQR}`);
    }
  } catch (err) {
    console.error('❌ Error generando QR semanal:', err);
  }
});





// ---------------- INICIO SERVIDOR ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

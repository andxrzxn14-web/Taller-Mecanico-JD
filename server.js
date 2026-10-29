require("dotenv").config();


const express = require("express");
const sql = require("mssql");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const path = require("path");
const fs = require('fs');
const crypto = require("crypto");
const app = express();
const { GoogleGenAI } = require("@google/genai");

const gemini = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;
    console.log(
    "Estado de Gemini:",
    gemini ? "CONFIGURADO" : "NO CONFIGURADO"
);
// Control temporal de intentos fallidos del PIN de reportes
const intentosPinReportes = new Map();
app.use(express.json());

// ===================== SESIONES =====================

app.use(session({
    secret: "J&D-Taller-2026-Clave-Secreta",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false,
        maxAge: 1000 * 60 * 60 // 1 hora
    }
}));
/* ===================== CONEXIÓN A SQL SERVER ===================== */
const config = {
    user: "usersql",
    password: "root123",
    server: "localhost",
    port: 53509,
    database: "TallerMecanicoDB",
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};
app.get('/api/backup', requiereReportes, async (req, res) => {
    try {
        const fecha = new Date();

        const año = fecha.getFullYear();
        const mes = String(fecha.getMonth() + 1).padStart(2, '0');
        const dia = String(fecha.getDate()).padStart(2, '0');

        const hora = String(fecha.getHours()).padStart(2, '0');
        const minuto = String(fecha.getMinutes()).padStart(2, '0');
        const segundo = String(fecha.getSeconds()).padStart(2, '0');

        const nombreBackup =
            `TallerMecanicoDB_${año}-${mes}-${dia}_${hora}-${minuto}-${segundo}.bak`;

        const rutaBackup = `C:\\SQLBackups\\${nombreBackup}`;

        const pool = await sql.connect(config);

        const query = `
            BACKUP DATABASE [TallerMecanicoDB]
            TO DISK = N'${rutaBackup}'
            WITH INIT,
            NAME = N'Backup Taller Mecánico';
        `;

        await pool.request().query(query);

        res.json({
            success: true,
            mensaje: 'Copia de seguridad realizada correctamente',
            archivo: nombreBackup,
            ruta: rutaBackup
        });

    } catch (error) {
        console.error('Error realizando backup:', error);

        res.status(500).json({
            success: false,
            mensaje: 'Error al realizar la copia de seguridad',
            error: error.message
        });
    }
});
// ===================== CONEXIÓN A SQL SERVER =====================

let poolPromise = null;

function getPool() {
    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool(config)
            .connect()
            .catch(error => {
                poolPromise = null;
                throw error;
            });
    }

    return poolPromise;
}

// ===================== COMPROBAR SESIÓN =====================

function requiereSesion(req, res, next) {
    if (req.session && req.session.usuario) {
        return next();
    }

    if (req.path.startsWith('/api/')) {
        return res.status(401).json({
            ok: false,
            mensaje: 'Debes iniciar sesión.'
        });
    }

   return res.redirect('/acceso.html');
}
// ========== ASISTENTE INTELIGENTE J&D CON GEMINI ==========

app.post("/api/asistente-ia", requiereSesion, async (req, res) => {

    const pregunta = String(req.body?.pregunta || "").trim();

    if (!pregunta) {
        return res.status(400).json({
            ok: false,
            mensaje: "Escribe una pregunta."
        });
    }

    if (pregunta.length > 2000) {
        return res.status(400).json({
            ok: false,
            mensaje: "La pregunta es demasiado larga."
        });
    }

    if (!gemini) {
        return res.status(503).json({
            ok: false,
            mensaje: "Gemini no está configurado. Revisa GEMINI_API_KEY."
        });
    }

    try {

        const instrucciones = `
Eres el asistente inteligente del Taller Mecánico J&D.

Tu trabajo es responder preguntas de manera clara,
profesional y sencilla.

Puedes responder sobre:

- Diagnóstico de fallas mecánicas.
- Problemas de motores.
- Sistemas de frenos.
- Transmisión.
- Suspensión.
- Problemas eléctricos.
- Mantenimiento preventivo.
- Reparaciones automotrices.
- Recomendaciones de mantenimiento.
- Preguntas generales de cualquier tema.

Cuando el usuario pregunte por una falla automotriz:

1. Explica las posibles causas.
2. Indica qué componentes revisar.
3. Propón soluciones breves.
4. Recomienda acudir a un mecánico cuando sea necesario.

No presentes posibles causas como diagnósticos confirmados.
Si existe riesgo para la seguridad, indícalo.

Responde siempre en español.

No inventes información sobre clientes, órdenes ni
reparaciones registradas en el taller.
No tienes acceso directo a la base de datos.

Organiza tus respuestas de manera fácil de leer.
`;

        const resultado = await gemini.models.generateContent({

            model: "gemini-3.5-flash-lite",

            contents: pregunta,

            config: {
                systemInstruction: instrucciones,
                maxOutputTokens: 1000
            }

        });

        const respuesta = resultado.text?.trim();

        if (!respuesta) {
            return res.status(502).json({
                ok: false,
                mensaje: "Gemini no generó ninguna respuesta."
            });
        }

        return res.json({
            ok: true,
            respuesta: respuesta
        });

    } catch (error) {

        console.error("ERROR GEMINI:", error.message);

        const codigo = error.status || error.code;

        if (codigo === 429) {
            return res.status(429).json({
                ok: false,
                mensaje: "Se alcanzó el límite de consultas de Gemini. Inténtalo más tarde."
            });
        }

        return res.status(502).json({
            ok: false,
            mensaje: "No se pudo conectar con Gemini. Revisa la clave API, el modelo y tu conexión a internet."
        });

    }

});
// ===================== SOLO ADMINISTRADOR =====================

function requiereAdmin(req, res, next) {
    if (!req.session || !req.session.usuario) {
        return requiereSesion(req, res, next);
    }

    if (req.session.usuario.rol !== 'administrador') {
        return res.status(403).send(
            'Acceso exclusivo para administradores.'
        );
    }

    return next();
}

// ===================== CONTROL DE REPORTES =====================

function requiereReportes(req, res, next) {
    if (!req.session || !req.session.usuario) {
        return requiereSesion(req, res, next);
    }

    if (req.session.usuario.rol !== 'administrador') {
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({
                ok: false,
                mensaje: 'Solo el administrador puede acceder a reportes.'
            });
        }

        return res.status(403).send(
            'Acceso exclusivo para administradores.'
        );
    }

    const hasta = Number(req.session.reportesHasta || 0);

    if (!hasta || Date.now() >= hasta) {
        req.session.reportesHasta = null;

        if (req.path.startsWith('/api/')) {
            return res.status(403).json({
                ok: false,
                mensaje: 'El tiempo de acceso a reportes ha finalizado.'
            });
        }

        return res.redirect('/index.html?reportes=expirado');
    }

    return next();
}


/* ===================== LOGIN CON DNI Y CONTRASEÑA ===================== */

app.post('/api/login-dni', async (req, res) => {
    try {
        const dni = String(
            (req.body && req.body.dni) || ''
        ).trim();

        const password = String(
            (req.body && req.body.password) || ''
        );

        if (!/^\d{8}$/.test(dni) || !password) {
            return res.status(400).json({
                ok: false,
                mensaje: 'Ingresa tu DNI de 8 dígitos y tu contraseña.'
            });
        }

        const pool = await getPool();

        const resultado = await pool.request()
            .input('dni', sql.VarChar(8), dni)
            .query(`
                SELECT dni, nombres, rol, password_hash
                FROM dbo.AccesoDNI
                WHERE dni = @dni
                  AND activo = 1
            `);

        if (resultado.recordset.length === 0) {
            return res.status(401).json({
                ok: false,
                mensaje: 'DNI o contraseña incorrectos.'
            });
        }

        const usuarioDB = resultado.recordset[0];

        if (!usuarioDB.password_hash) {
            return res.status(401).json({
                ok: false,
                mensaje: 'DNI o contraseña incorrectos.'
            });
        }

        const contrasenaCorrecta = await bcrypt.compare(
            password,
            usuarioDB.password_hash
        );

        if (!contrasenaCorrecta) {
            return res.status(401).json({
                ok: false,
                mensaje: 'DNI o contraseña incorrectos.'
            });
        }

        const rol = String(usuarioDB.rol || '')
            .trim()
            .toLowerCase();

        if (!['administrador', 'mecanico'].includes(rol)) {
            return res.status(403).json({
                ok: false,
                mensaje: 'El usuario no tiene un rol autorizado.'
            });
        }

        req.session.regenerate(error => {
            if (error) {
                console.error('Error creando sesión:', error);

                return res.status(500).json({
                    ok: false,
                    mensaje: 'No se pudo iniciar la sesión.'
                });
            }

            req.session.usuario = {
                dni: usuarioDB.dni,
                nombre: usuarioDB.nombres,
                rol: rol
            };

            req.session.save(errorGuardar => {
                if (errorGuardar) {
                    console.error(
                        'Error guardando sesión:',
                        errorGuardar
                    );

                    return res.status(500).json({
                        ok: false,
                        mensaje: 'No se pudo guardar la sesión.'
                    });
                }

                return res.json({
                    ok: true,
                    rol: rol,
                    destino: '/index.html'
                });
            });
        });

    } catch (error) {
        console.error('Error en login con DNI:', error);

        return res.status(500).json({
            ok: false,
            mensaje: 'Error al verificar tus credenciales.'
        });
    }
});


// ===================== INFORMACIÓN DEL USUARIO =====================

app.get('/api/sesion', (req, res) => {
    if (!req.session || !req.session.usuario) {
        return res.status(401).json({
            ok: false,
            mensaje: 'No has iniciado sesión.'
        });
    }

    return res.json({
        ok: true,
        usuario: req.session.usuario
    });
});

// ===================== CERRAR SESIÓN =====================

app.post('/api/logout', requiereSesion, (req, res) => {
    req.session.destroy(error => {
        if (error) {
            return res.status(500).json({
                ok: false,
                mensaje: 'No se pudo cerrar la sesión.'
            });
        }

        res.clearCookie('connect.sid');

        return res.json({ ok: true });
    });
});

// ===================== ABRIR REPORTES POR 2 MINUTOS =====================


app.post('/api/reportes/abrir', requiereAdmin, (req, res) => {
    const ahora = Date.now();

    const pinCorrecto = String(
        process.env.REPORTES_PIN || ''
    ).trim();

    const pinIngresado = String(
        (req.body && req.body.pin) || ''
    ).trim();

    // Comprobar que el PIN se configuró en Windows
    if (!/^\d{6}$/.test(pinCorrecto)) {
        return res.status(500).json({
            ok: false,
            mensaje: 'El PIN de reportes no está configurado correctamente en Windows.'
        });
    }

    // Identificar al cliente que está intentando ingresar
    const claveIP = req.ip ||
        req.socket.remoteAddress ||
        'desconocido';

    const control = intentosPinReportes.get(claveIP) || {
        intentos: 0,
        bloqueadoHasta: 0
    };

    // Comprobar bloqueo por intentos fallidos
    if (control.bloqueadoHasta > ahora) {
        const segundos = Math.ceil(
            (control.bloqueadoHasta - ahora) / 1000
        );

        return res.status(429).json({
            ok: false,
            mensaje: `Acceso temporalmente bloqueado. Intenta nuevamente en ${segundos} segundos.`
        });
    }

    // Comparar el PIN sin dejarlo registrado en el servidor
    let pinValido = false;

    if (/^\d{6}$/.test(pinIngresado)) {
        pinValido = crypto.timingSafeEqual(
            Buffer.from(pinIngresado, 'utf8'),
            Buffer.from(pinCorrecto, 'utf8')
        );
    }

    // PIN incorrecto
    if (!pinValido) {
        control.intentos += 1;

        if (control.intentos >= 3) {
            control.intentos = 0;
            control.bloqueadoHasta = ahora + (5 * 60 * 1000);

            intentosPinReportes.set(claveIP, control);

            return res.status(429).json({
                ok: false,
                mensaje: 'Has alcanzado 3 intentos fallidos. Acceso bloqueado durante 5 minutos.'
            });
        }

        intentosPinReportes.set(claveIP, control);

        return res.status(401).json({
            ok: false,
            mensaje: `PIN incorrecto. Intento ${control.intentos} de 3.`
        });
    }

    // PIN correcto: reiniciar el contador de intentos
    intentosPinReportes.delete(claveIP);

    // No reiniciar el tiempo si ya existe un acceso vigente
    const hastaActual = Number(
        req.session.reportesHasta || 0
    );

    if (hastaActual <= ahora) {
        req.session.reportesHasta = ahora + (120 * 1000);
    }

    // Guardar el permiso temporal en la sesión del administrador
    req.session.save(error => {
        if (error) {
            console.error('Error guardando acceso a reportes:', error);

            return res.status(500).json({
                ok: false,
                mensaje: 'No se pudo guardar la autorización.'
            });
        }

        res.set('Cache-Control', 'no-store');

        return res.json({
            ok: true,
            destino: '/Reportes.html',
            hasta: req.session.reportesHasta
        });
    });
});


// También permite abrir reportes desde una dirección protegida
app.get('/reportes/abrir', requiereReportes, (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.redirect('/Reportes.html');
});

// Consultar cuánto tiempo queda para reportes
app.get('/api/reportes/estado', requiereReportes, (req, res) => {
    res.set('Cache-Control', 'no-store');

    return res.json({
        ok: true,
        hasta: req.session.reportesHasta
    });
});

/* ===== DATOS EXCLUSIVOS DE REPORTES ===== */

app.get('/api/reportes/ordenes', requiereReportes, wrap(async (req, res) => {
    const pool = await getPool();

    const r = await pool.request().query(`
        SELECT
            o.orden_id AS id,
            v.placa,
            v.marca,
            v.modelo,
            v.kilometraje,
            p.nombres,
            p.apellidos,
            o.estado,
            o.prioridad,
            CONVERT(varchar(10), o.fecha, 23) AS fecha,
            (
                SELECT TOP 1 s.descripcion
                FROM Sintoma s
                WHERE s.orden_id = o.orden_id
                ORDER BY s.sintoma_id
            ) AS sintoma
        FROM OrdenTrabajo o
        JOIN Vehiculo v
            ON v.vehiculo_id = o.vehiculo_id
        JOIN Propietario p
            ON p.propietario_id = v.propietario_id
        ORDER BY o.fecha DESC, o.orden_id DESC
    `);

    res.set('Cache-Control', 'no-store');

    res.json(r.recordset.map(o => ({
        id: o.id,
        placa: o.placa,
        cliente: nombreCompleto(o.nombres, o.apellidos),
        marcaModelo: [o.marca, o.modelo].filter(Boolean).join(' '),
        kilometraje: o.kilometraje,
        prioridad: normEstado(o.prioridad) || 'Normal',
        estado: normEstado(o.estado) || 'Pendiente',
        sintoma: o.sintoma || '',
        fecha: o.fecha
    })));
}));

app.get('/api/reportes/mantenimientos', requiereReportes, wrap(async (req, res) => {
    const pool = await getPool();

    const r = await pool.request().query(`
        SELECT
            m.mantenimiento_id AS id,
            v.placa,
            ISNULL(m.tipo, ISNULL(m.descripcion, 'Mantenimiento')) AS tipo,
            m.kilometraje AS kmActual,
            m.km_proximo AS kmProximo,
            CONVERT(varchar(10), m.fecha_programada, 23) AS fechaProgramada,
            m.estado,
            m.descripcion AS notas,
            CONVERT(varchar(10), m.fecha, 23) AS fecha
        FROM Mantenimiento m
        JOIN Vehiculo v
            ON v.vehiculo_id = m.vehiculo_id
        ORDER BY m.fecha DESC, m.mantenimiento_id DESC
    `);

    res.set('Cache-Control', 'no-store');

    res.json(r.recordset.map(m => ({
        id: m.id,
        placa: m.placa,
        tipo: m.tipo,
        kmActual: m.kmActual,
        kmProximo: m.kmProximo,
        fechaProgramada: m.fechaProgramada || '',
        estado: normEstado(m.estado) || 'Programado',
        notas: m.notas && m.notas !== m.tipo ? m.notas : '',
        fecha: m.fecha
    })));
}));

/* ===== LISTAR CONSTANCIAS PARA EL ADMINISTRADOR ===== */

app.get(
    "/api/reportes/constancias",
    requiereReportes,
    wrap(async (req, res) => {
        const pool = await getPool();

        const resultado = await pool.request().query(`
            SELECT
                constancia_id,
                orden_id,
                placa,
                marca_modelo,
                anio,
                kilometraje,
                cliente,
                sintoma,
                estado_orden,
                prioridad,
                mecanico_nombre,
                CONVERT(varchar(19), fecha_reparacion, 120)
                    AS fecha_reparacion,
                detalle_reparacion,
                enviado_por_dni,
                CONVERT(varchar(19), fecha_envio, 120)
                    AS fecha_envio,
                estado_revision
            FROM dbo.ConstanciaReparacion
            ORDER BY
                CASE
                    WHEN estado_revision = N'Pendiente' THEN 0
                    ELSE 1
                END,
                fecha_envio DESC
        `);

        res.set("Cache-Control", "no-store");

        return res.json(resultado.recordset);
    })
);

/* ===== MARCAR UNA CONSTANCIA COMO REVISADA ===== */

app.put(
    "/api/reportes/constancias/:id/revision",
    requiereReportes,
    wrap(async (req, res) => {
        const id = String(req.params.id || "");

        const esGuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
                .test(id);

        if (!esGuid) {
            throw httpError(400, "Identificador de constancia inválido.");
        }

        const pool = await getPool();

        const resultado = await pool.request()
            .input("id", sql.UniqueIdentifier, id)
            .query(`
                UPDATE dbo.ConstanciaReparacion
                SET estado_revision = N'Revisada'
                WHERE constancia_id = @id
            `);

        if (resultado.rowsAffected[0] === 0) {
            throw httpError(404, "No se encontró la constancia.");
        }

        res.set("Cache-Control", "no-store");

        return res.json({
            ok: true,
            mensaje: "Constancia marcada como revisada."
        });
    })
);

/* ===== CERRAR SOLO EL ACCESO A REPORTES ===== */

app.post('/api/reportes/cerrar', requiereAdmin, (req, res) => {
    req.session.reportesHasta = null;

    req.session.save(error => {
        if (error) {
            return res.status(500).json({
                ok: false,
                mensaje: 'No se pudo cerrar el acceso a reportes.'
            });
        }

        return res.json({ ok: true });
    });
});

// ===================== PROTEGER LAS PÁGINAS =====================

// Estas páginas requieren que el usuario inicie sesión
app.get([
    '/',
    '/index.html',
    '/Orden.html',
    '/Mantenimiento.html',
    '/historial.html'
], requiereSesion, (req, res) => {
    const archivo = req.path === '/'
        ? 'index.html'
        : req.path.substring(1);

    return res.sendFile(
        path.join(__dirname, 'public', archivo)
    );
});

// Reportes requiere administrador y tiempo vigente
app.get([
    '/Reportes.html',
    '/reportes',
    '/reportes.html'
], requiereReportes, (req, res) => {
    res.set('Cache-Control', 'no-store');

    return res.sendFile(
        path.join(__dirname, 'public', 'Reportes.html')
    );
});

// Los archivos CSS, JavaScript y la página de login siguen disponibles
app.use(
    express.static(path.join(__dirname, 'public'), {
        index: false
    })
);

// Las demás API requieren una sesión iniciada

/* ===== LOGIN ORIGINAL DE REPORTES ===== */

app.post('/api/login', async (req, res) => {
    try {
        const usuario = String(
            (req.body && req.body.usuario) || ''
        ).trim();

        const clave = String(
            (req.body && req.body.clave) || ''
        );

        if (!usuario || !clave) {
            return res.status(400).json({
                ok: false,
                mensaje: 'Ingresa tu usuario y contraseña.'
            });
        }

        const pool = await getPool();

        const resultado = await pool.request()
            .input('usuario', sql.VarChar(50), usuario)
            .input('password', sql.VarChar(255), clave)
            .query(`
                SELECT id_usuario, usuario, nombre, rol
                FROM UsuariosReportes
                WHERE usuario = @usuario
                  AND password = @password
            `);

        if (resultado.recordset.length === 0) {
            return res.status(401).json({
                ok: false,
                mensaje: 'Usuario o contraseña incorrectos.'
            });
        }

        const usuarioDB = resultado.recordset[0];
        const rol = String(usuarioDB.rol || '')
            .trim()
            .toLowerCase();

        if (rol !== 'admin' && rol !== 'administrador') {
            return res.status(403).json({
                ok: false,
                mensaje: 'Solo el administrador puede acceder a reportes.'
            });
        }

        req.session.regenerate(error => {
            if (error) {
                return res.status(500).json({
                    ok: false,
                    mensaje: 'No se pudo iniciar la sesión.'
                });
            }

            req.session.usuario = {
                id: usuarioDB.id_usuario,
                usuario: usuarioDB.usuario,
                nombre: usuarioDB.nombre,
                rol: 'administrador'
            };

            // Acceso a reportes por 120 segundos
            req.session.reportesHasta = Date.now() + 120000;

            req.session.save(errorGuardar => {
                if (errorGuardar) {
                    return res.status(500).json({
                        ok: false,
                        mensaje: 'No se pudo guardar la sesión.'
                    });
                }

                return res.json({
                    ok: true,
                    destino: '/Reportes.html'
                });
            });
        });

    } catch (error) {
        console.error('Error en login de reportes:', error);

        return res.status(500).json({
            ok: false,
            mensaje: 'Error al iniciar sesión en reportes.'
        });
    }
});

    // ===================== LOGIN DE REPORTES =====================

app.post("/api/login", async (req, res) => {

    try {

        const { usuario, clave } = req.body;

        if (!usuario || !clave) {
            return res.status(400).json({
                ok: false,
                mensaje: "Ingresa tu usuario y tu contraseña."
            });
        }

        const pool = await getPool();

        const resultado = await pool.request()
            .input("usuario", sql.VarChar(50), usuario.trim())
            .input("password", sql.VarChar(255), clave)
            .query(`
                SELECT id_usuario, usuario, nombre, rol
                FROM UsuariosReportes
                WHERE usuario = @usuario
                AND password = @password
            `);

        if (resultado.recordset.length === 0) {

            return res.status(401).json({
                ok: false,
                mensaje: "Usuario o contraseña incorrectos."
            });

        }

        const usuarioDB = resultado.recordset[0];

        // Guardamos al usuario en la sesión
        req.session.usuario = {
            id: usuarioDB.id_usuario,
            usuario: usuarioDB.usuario,
            nombre: usuarioDB.nombre,
            rol: usuarioDB.rol
        };

        res.json({
            ok: true,
            destino: "/reportes"
        });

    } catch (error) {

        console.error("Error en login:", error);

        res.status(500).json({
            ok: false,
            mensaje: "Error al iniciar sesión."
        });
    }

});
// ===================== PROTECCIÓN DE REPORTES =====================

function requiereLogin(req, res, next) {

    if (req.session && req.session.usuario) {
        return next();
    }

    // Si intenta entrar a la página directamente
    if (req.path === "/reportes" || req.path === "/reportes.html") {
        return res.redirect("/login.html");
    }

    return res.status(401).json({
        error: "Debes iniciar sesión para acceder a los reportes."
    });
}// ===================== PÁGINA DE REPORTES =====================

app.get("/reportes", requiereLogin, (req, res) => {
    res.sendFile(path.join(process.cwd(), "public", "reportes.html"));
});

app.get("/reportes.html", requiereLogin, (req, res) => {
    res.sendFile(path.join(process.cwd(), "public", "reportes.html"));
});

app.use(express.static(path.join(process.cwd(), "public")));
app.post("/api/logout", (req, res) => {

    req.session.destroy((error) => {

        if (error) {
            return res.status(500).json({
                ok: false,
                mensaje: "No se pudo cerrar sesión."
            });
        }

        res.json({
            ok: true
        });

    });

})



/* ===================== PREPARACIÓN DE LA BASE ===================== */
// Agrega las columnas que la web necesita y que el script original no traía
// (prioridad de la orden y datos del mantenimiento preventivo), y crea un usuario
// por defecto porque OrdenTrabajo.usuario_id es obligatorio.
let preparadoPromise = null;
function preparar() {
    if (!preparadoPromise) {
        preparadoPromise = (async () => {
            const pool = await getPool();
            const pasos = [
                `IF COL_LENGTH('OrdenTrabajo','prioridad') IS NULL
                    ALTER TABLE OrdenTrabajo ADD prioridad VARCHAR(20) NOT NULL
                    CONSTRAINT DF_Orden_Prioridad DEFAULT 'Normal'`,
                `IF COL_LENGTH('Mantenimiento','tipo') IS NULL
                    ALTER TABLE Mantenimiento ADD tipo VARCHAR(100) NULL`,
                `IF COL_LENGTH('Mantenimiento','km_proximo') IS NULL
                    ALTER TABLE Mantenimiento ADD km_proximo INT NULL`,
                `IF COL_LENGTH('Mantenimiento','fecha_programada') IS NULL
                    ALTER TABLE Mantenimiento ADD fecha_programada DATE NULL`,
                `IF COL_LENGTH('Mantenimiento','estado') IS NULL
                    ALTER TABLE Mantenimiento ADD estado VARCHAR(30) NOT NULL
                    CONSTRAINT DF_Mant_Estado DEFAULT 'Programado'`,
                `IF NOT EXISTS (SELECT 1 FROM Usuario)
                    INSERT INTO Usuario (nombres, correo, contrasena, rol, estado)
                    VALUES ('Mecanico', 'mecanico@jdtaller.com', 'sin-login', 'mecanico', 'activo')`
            ];
            for (const paso of pasos) {
                await pool.request().query(paso);
            }
            console.log("Base de datos lista (" + config.database + ")");
        })().catch(err => {
            preparadoPromise = null;
            throw err;
        });
    }
    return preparadoPromise;
}

// Todas las rutas /api esperan a que la base esté preparada
app.use("/api", async (req, res, next) => {
    try {
        await preparar();
        next();
    } catch (error) {
        console.error("Error de conexión/preparación:", error.message);
        res.status(500).json({
            error: "No se pudo conectar con la base de datos: " + error.message
        });
    }
});

/* ===================== UTILIDADES ===================== */
const ESTADOS_ORDEN = ["Pendiente", "En proceso", "Completada"];
const PRIORIDADES = ["Normal", "Alta", "Urgente"];
const ESTADOS_MANT = ["Programado", "Realizado"];

function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

function wrap(fn) {
    return (req, res) => {
        Promise.resolve(fn(req, res)).catch(error => {
            // Los errores de validación (4xx) no necesitan stack en consola
            if (!error.status || error.status >= 500) console.error(error);
            res.status(error.status || 500).json({ error: error.message });
        });
    };
}

function normEstado(s) {
    if (!s) return "";
    const t = String(s).trim();
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function textoOpcional(v, max) {
    if (v == null) return null;
    const t = String(v).trim();
    if (!t) return null;
    return t.slice(0, max);
}

function enteroOpcional(v) {
    if (v === "" || v == null) return null;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 0 || n > 2147483647) return null;
    return n;
}

function validarPlaca(placa) {
    const p = String(placa || "").trim().toUpperCase();
    if (!p) throw httpError(400, "La placa/VIN es obligatoria.");
    if (p.length > 10) throw httpError(400, "La placa/VIN admite como máximo 10 caracteres.");
    return p;
}

// "Juan Carlos Mendoza García" -> nombres "Juan Carlos", apellidos "Mendoza García"
function partirNombre(cliente) {
    const partes = String(cliente || "").trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return { nombres: "Sin registrar", apellidos: "-" };
    if (partes.length === 1) return { nombres: partes[0].slice(0, 100), apellidos: "-" };
    if (partes.length === 2) return { nombres: partes[0].slice(0, 100), apellidos: partes[1].slice(0, 100) };
    return {
        nombres: partes.slice(0, partes.length - 2).join(" ").slice(0, 100),
        apellidos: partes.slice(-2).join(" ").slice(0, 100)
    };
}

function nombreCompleto(nombres, apellidos) {
    if (!nombres || nombres === "Sin registrar") return "";
    return (nombres + (apellidos && apellidos !== "-" ? " " + apellidos : "")).trim();
}

// Busca el vehículo por placa; si no existe lo crea (junto con su propietario)
async function obtenerOCrearVehiculo(tx, datos) {
    const rq = () => new sql.Request(tx);
    const km = enteroOpcional(datos.kilometraje);

    const found = await rq()
        .input("placa", sql.VarChar(10), datos.placa)
        .query("SELECT vehiculo_id FROM Vehiculo WHERE placa = @placa");

    if (found.recordset.length) {
        const id = found.recordset[0].vehiculo_id;
        if (km !== null) {
            await rq()
                .input("id", sql.Int, id)
                .input("km", sql.Int, km)
                .query(`UPDATE Vehiculo SET kilometraje = @km
                        WHERE vehiculo_id = @id AND (kilometraje IS NULL OR kilometraje < @km)`);
        }
        return id;
    }

    // Propietario: reutiliza uno con el mismo nombre o crea uno nuevo
    const { nombres, apellidos } = partirNombre(datos.cliente);
    let propietarioId;
    const existente = await rq()
        .input("n", sql.VarChar(100), nombres)
        .input("a", sql.VarChar(100), apellidos)
        .query(`SELECT TOP 1 propietario_id FROM Propietario
                WHERE nombres = @n AND apellidos = @a AND documento LIKE 'SD-%'
                ORDER BY propietario_id`);
    if (existente.recordset.length && nombres !== "Sin registrar") {
        propietarioId = existente.recordset[0].propietario_id;
    } else {
        // documento es obligatorio y único: se genera uno provisional
        const documento = "SD-" + Date.now() + Math.floor(Math.random() * 90 + 10);
        const p = await rq()
            .input("n", sql.VarChar(100), nombres)
            .input("a", sql.VarChar(100), apellidos)
            .input("d", sql.VarChar(20), documento)
            .query(`INSERT INTO Propietario (nombres, apellidos, documento)
                    OUTPUT INSERTED.propietario_id
                    VALUES (@n, @a, @d)`);
        propietarioId = p.recordset[0].propietario_id;
    }

    // "Toyota Corolla" -> marca "Toyota", modelo "Corolla"
    const [marca, ...resto] = String(datos.marcaModelo || "").trim().split(/\s+/).filter(Boolean);
    const v = await rq()
        .input("pid", sql.Int, propietarioId)
        .input("placa", sql.VarChar(10), datos.placa)
        .input("marca", sql.VarChar(50), marca ? marca.slice(0, 50) : null)
        .input("modelo", sql.VarChar(50), resto.length ? resto.join(" ").slice(0, 50) : null)
        .input("km", sql.Int, km)
        .query(`INSERT INTO Vehiculo (propietario_id, placa, marca, modelo, kilometraje)
                OUTPUT INSERTED.vehiculo_id
                VALUES (@pid, @placa, @marca, @modelo, @km)`);
    return v.recordset[0].vehiculo_id;
}

async function usuarioPorDefecto(tx) {
    const r = await new sql.Request(tx).query("SELECT TOP 1 usuario_id FROM Usuario ORDER BY usuario_id");
    if (!r.recordset.length) throw httpError(500, "No hay ningún usuario registrado en la tabla Usuario.");
    return r.recordset[0].usuario_id;
}

async function enTransaccion(fn) {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
        const resultado = await fn(tx);
        await tx.commit();
        return resultado;
    } catch (error) {
        try { await tx.rollback(); } catch (e) { /* ya revertida */ }
        throw error;
    }
}

function idParam(req) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) throw httpError(400, "Identificador inválido.");
    return id;
}

/* ===================== VEHÍCULOS ===================== */
app.get("/api/vehiculos", wrap(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request().query("SELECT * FROM Vehiculo");
    res.json(result.recordset);
}));

/* ==========================================
   BÚSQUEDA INTELIGENTE DE DIAGNÓSTICOS J&D
   ========================================== */

app.get(
    "/api/busqueda-inteligente",
    requiereSesion,
    wrap(async (req, res) => {

        const consulta = String(req.query.q || "").trim().slice(0, 200);

        if (consulta.length < 3) {
            return res.json({
                ok: true,
                causas: [],
                coincidencias: []
            });
        }

        // Normalizar el texto para facilitar búsquedas con o sin tildes
        const normalizar = texto => String(texto || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();

        const texto = normalizar(consulta);

        const palabrasIgnoradas = new Set([
            "que", "como", "para", "por", "con", "del",
            "las", "los", "una", "uno", "unos", "unas",
            "tiene", "esta", "este", "cuando", "hace",
            "carro", "vehiculo", "vehiculos", "algo",
            "desde", "hacia", "sobre", "entre"
        ]);

        const palabrasOriginales = [
            ...new Set(
                (texto.match(/[a-z0-9]+/g) || [])
                    .filter(p =>
                        p.length >= 3 &&
                        !palabrasIgnoradas.has(p)
                    )
            )
        ].slice(0, 8);

        // Añadir sinónimos frecuentes de síntomas automotrices
        const terminos = new Set(palabrasOriginales);

        if (/(ruido|sonido|chirrido|chillido|crujido|zumbido|roce)/.test(texto)) {
            [
                "ruido", "sonido", "chirrido",
                "chillido", "crujido", "zumbido"
            ].forEach(t => terminos.add(t));
        }

        if (/(llanta|rueda|neumatico|rodamiento)/.test(texto)) {
            [
                "llanta", "rueda",
                "neumatico", "rodamiento"
            ].forEach(t => terminos.add(t));
        }

        if (/(freno|pastilla|disco|cristaliz)/.test(texto)) {
            [
                "freno", "pastilla", "disco",
                "cristalizada", "cristalizadas",
                "cristalizado", "cristalizados"
            ].forEach(t => terminos.add(t));
        }

        const terminosBusqueda = [...terminos].slice(0, 16);

        if (terminosBusqueda.length === 0) {
            return res.json({
                ok: true,
                causas: [],
                coincidencias: []
            });
        }

        
const causas = [];

const agregarCausa = (titulo, detalle, solucion) => {
    if (!causas.some(c => c.titulo === titulo)) {
        causas.push({
            titulo,
            detalle,
            solucion
        });
    }
};

const mencionaRuido =
    /(ruido|sonido|chirrido|chillido|crujido|zumbido|roce|cristaliz)/.test(texto);

const mencionaRueda =
    /(llanta|rueda|neumatico|freno|pastilla|disco|rodamiento|cristaliz)/.test(texto);

// 1. Ruido en ruedas o frenos
if (mencionaRuido && mencionaRueda) {
    agregarCausa(
        "Pastillas de freno cristalizadas o desgastadas",
        "Posible causa si el chirrido aparece al frenar.",
        "Inspeccionar pastillas y discos; medir el desgaste y sustituir lo que corresponda."
    );

    agregarCausa(
        "Objeto extraño rozando la rueda",
        "Una piedra o un protector desplazado puede producir un roce repetitivo.",
        "Inspeccionar la rueda, el disco y su protector; retirar el objeto si se confirma."
    );

    agregarCausa(
        "Rodamiento de rueda desgastado",
        "Un zumbido que aumenta con la velocidad puede justificar revisar el rodamiento.",
        "Comprobar holgura, ruido y estado del rodamiento; reemplazarlo si está defectuoso."
    );
}

// 2. Vibraciones
if (/(vibracion|vibra|tiembla|temblor|sacudida)/.test(texto)) {
    agregarCausa(
        "Desequilibrio de rueda o neumático",
        "Puede provocar vibraciones que aumentan a determinadas velocidades.",
        "Revisar neumáticos y realizar equilibrado si se confirma el desequilibrio."
    );

    agregarCausa(
        "Holgura en suspensión o dirección",
        "Puede causar vibraciones, especialmente al pasar por irregularidades.",
        "Inspeccionar rótulas, bujes, fijaciones y componentes de dirección."
    );
}

// 3. Motor sobrecalentado
if (/(sobrecalienta|recalienta|temperatura|calienta|hierve)/.test(texto)) {
    agregarCausa(
        "Problema en el sistema de refrigeración",
        "Podría existir una fuga, un nivel bajo de refrigerante o una falla de circulación.",
        "Con el motor frío, revisar nivel y fugas; comprobar ventilador y termostato."
    );
}

// 4. Motor que no arranca
if (/(no arranca|no enciende|arranque|bateria|encendido)/.test(texto)) {
    agregarCausa(
        "Batería descargada o conexiones deficientes",
        "Es una posibilidad si el motor gira lentamente o solo se escuchan clics.",
        "Medir la batería y revisar bornes, conexiones y sistema de carga."
    );

    agregarCausa(
        "Falla del sistema de arranque",
        "Puede estar relacionada con el motor de arranque u otro componente eléctrico.",
        "Comprobar alimentación eléctrica, motor de arranque y códigos de avería."
    );
}

// 5. Fugas
if (/(fuga|gotea|pierde aceite|refrigerante)/.test(texto)) {
    agregarCausa(
        "Posible fuga de fluido",
        "El origen depende del color, la ubicación y las características del líquido.",
        "Identificar el fluido y localizar la fuga antes de sustituir juntas o componentes."
    );
}

// 6. Problemas al frenar
if (/(freno|frenar|frenada|pedal|no frena)/.test(texto)) {
    agregarCausa(
        "Desgaste o falla del sistema de frenos",
        "El ruido, la vibración o un pedal anormal pueden tener distintas causas.",
        "Inspeccionar pastillas, discos, líquido y posibles fugas. Si frena mal, no conducir."
    );
}

// 7. Dirección dura
if (/(direccion dura|volante duro|cuesta girar|direccion pesada)/.test(texto)) {
    agregarCausa(
        "Problema en la asistencia de dirección",
        "Puede estar relacionado con la asistencia eléctrica o hidráulica.",
        "Revisar testigos, alimentación eléctrica, nivel de fluido si aplica y componentes."
    );
}

// 8. Humo del motor
if (/(humo|humareda|sale humo|humo blanco|humo azul|humo negro)/.test(texto)) {
    agregarCausa(
        "Combustión anormal o presencia de fluidos",
        "El color del humo y las condiciones de aparición ayudan a identificar el origen.",
        "Comprobar refrigerante, aceite, admisión y combustión; evitar circular si el humo es abundante."
    );
}

// 9. Pérdida de potencia
if (/(pierde potencia|sin fuerza|no tiene fuerza|falta de potencia)/.test(texto)) {
    agregarCausa(
        "Problema de admisión, combustible o encendido",
        "Un filtro obstruido, una falla de alimentación o un fallo de encendido pueden reducir la potencia.",
        "Leer códigos de avería y revisar filtros, admisión y sistema de combustible."
    );
}

// 10. Búsqueda sin una regla conocida
if (causas.length === 0) {
    agregarCausa(
        "Se necesita precisar el síntoma",
        "Con la descripción actual no se puede sugerir una causa específica con suficiente fundamento.",
        "Indicar cuándo ocurre, qué ruido produce, en qué zona y si cambia al acelerar, frenar o girar."
    );
}

        // Crear una condición SQL parametrizada por cada término
        const condiciones = terminosBusqueda.map((_, i) => `
            (
                ISNULL(s.sintoma, '') LIKE @term${i}
                OR ISNULL(d.diagnostico, '') LIKE @term${i}
                OR ISNULL(d.resultado, '') LIKE @term${i}
                OR ISNULL(r.reparacion, '') LIKE @term${i}
                OR ISNULL(r.observaciones, '') LIKE @term${i}
                OR ISNULL(v.placa, '') LIKE @term${i}
                OR ISNULL(v.marca, '') LIKE @term${i}
                OR ISNULL(v.modelo, '') LIKE @term${i}
                OR ISNULL(p.nombres, '') LIKE @term${i}
                OR ISNULL(p.apellidos, '') LIKE @term${i}
            )
        `).join(" OR ");

        const pool = await getPool();
        const solicitud = pool.request();

        terminosBusqueda.forEach((termino, i) => {
            solicitud.input(
                "term" + i,
                sql.NVarChar(120),
                "%" + termino + "%"
            );
        });

        const resultado = await solicitud.query(`
            SELECT TOP (80)
                o.orden_id AS id,
                CONVERT(varchar(10), o.fecha, 23) AS fecha,
                o.estado,
                v.placa,
                v.marca,
                v.modelo,
                v.anio,
                v.kilometraje,
                p.nombres,
                p.apellidos,
                s.sintoma,
                d.diagnostico,
                d.resultado AS resultadoDiagnostico,
                r.reparacion,
                r.observaciones
            FROM OrdenTrabajo o
            INNER JOIN Vehiculo v
                ON v.vehiculo_id = o.vehiculo_id
            LEFT JOIN Propietario p
                ON p.propietario_id = v.propietario_id

            OUTER APPLY (
                SELECT TOP (1)
                    si.descripcion AS sintoma
                FROM Sintoma si
                WHERE si.orden_id = o.orden_id
                ORDER BY si.sintoma_id DESC
            ) s

            OUTER APPLY (
                SELECT TOP (1)
                    dg.descripcion AS diagnostico,
                    dg.resultado
                FROM Diagnostico dg
                WHERE dg.orden_id = o.orden_id
                ORDER BY dg.diagnostico_id DESC
            ) d

            OUTER APPLY (
                SELECT TOP (1)
                    rp.descripcion AS reparacion,
                    rp.observaciones
                FROM Reparacion rp
                WHERE rp.orden_id = o.orden_id
                ORDER BY rp.reparacion_id DESC
            ) r

            WHERE ${condiciones}
            ORDER BY o.fecha DESC, o.orden_id DESC
        `);

        // Ordenar las coincidencias dando más peso a los síntomas,
        // diagnósticos y reparaciones que a los datos del vehículo.
        const coincidencias = resultado.recordset.map(fila => {
            const sintoma = normalizar(fila.sintoma);
            const diagnostico = normalizar(fila.diagnostico);
            const resultadoDiag = normalizar(fila.resultadoDiagnostico);
            const reparacion = normalizar(fila.reparacion);
            const observaciones = normalizar(fila.observaciones);

            const textoVehiculo = normalizar([
                fila.placa,
                fila.marca,
                fila.modelo,
                fila.nombres,
                fila.apellidos
            ].join(" "));

            let puntuacion = 0;

            palabrasOriginales.forEach(p => {
                if (sintoma.includes(p)) puntuacion += 5;
                if (diagnostico.includes(p)) puntuacion += 4;
                if (resultadoDiag.includes(p)) puntuacion += 3;
                if (reparacion.includes(p)) puntuacion += 3;
                if (observaciones.includes(p)) puntuacion += 2;
                if (textoVehiculo.includes(p)) puntuacion += 1;
            });

            return {
                id: fila.id,
                fecha: fila.fecha,
                estado: fila.estado,
                placa: fila.placa,
                marcaModelo: [fila.marca, fila.modelo]
                    .filter(Boolean).join(" "),
                anio: fila.anio,
                kilometraje: fila.kilometraje,
                cliente: nombreCompleto(
                    fila.nombres,
                    fila.apellidos
                ),
                sintoma: fila.sintoma || "",
                diagnostico: fila.diagnostico || "",
                resultadoDiagnostico: fila.resultadoDiagnostico || "",
                reparacion: fila.reparacion || "",
                observaciones: fila.observaciones || "",
                puntuacion
            };
        }).sort((a, b) =>
            b.puntuacion - a.puntuacion ||
            String(b.fecha).localeCompare(String(a.fecha))
        ).slice(0, 10);

        res.set("Cache-Control", "no-store");

        return res.json({
            ok: true,
            causas: causas.slice(0, 5),
            coincidencias
        });
    })
);

/* ===================== ÓRDENES DE TRABAJO ===================== */
app.get("/api/ordenes", wrap(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().query(`
        SELECT o.orden_id AS id, v.placa, v.marca, v.modelo, v.kilometraje,
               p.nombres, p.apellidos, o.estado, o.prioridad,
               CONVERT(varchar(10), o.fecha, 23) AS fecha,
               (SELECT TOP 1 s.descripcion FROM Sintoma s
                 WHERE s.orden_id = o.orden_id ORDER BY s.sintoma_id) AS sintoma
        FROM OrdenTrabajo o
        JOIN Vehiculo v    ON v.vehiculo_id = o.vehiculo_id
        JOIN Propietario p ON p.propietario_id = v.propietario_id
        ORDER BY o.fecha DESC, o.orden_id DESC`);

    res.json(r.recordset.map(o => ({
        id: o.id,
        placa: o.placa,
        cliente: nombreCompleto(o.nombres, o.apellidos),
        marcaModelo: [o.marca, o.modelo].filter(Boolean).join(" "),
        kilometraje: o.kilometraje,
        prioridad: normEstado(o.prioridad) || "Normal",
        estado: normEstado(o.estado) || "Pendiente",
        sintoma: o.sintoma || "",
        fecha: o.fecha
    })));
}));

app.post("/api/ordenes", wrap(async (req, res) => {
    const b = req.body || {};
    const placa = validarPlaca(b.placa);
    const sintoma = textoOpcional(b.sintoma, 255);
    if (!sintoma) throw httpError(400, "El síntoma / motivo de ingreso es obligatorio.");
    const estado = ESTADOS_ORDEN.includes(b.estado) ? b.estado : "Pendiente";
    const prioridad = PRIORIDADES.includes(b.prioridad) ? b.prioridad : "Normal";

    const id = await enTransaccion(async tx => {
        const vehiculoId = await obtenerOCrearVehiculo(tx, {
            placa,
            cliente: b.cliente,
            marcaModelo: b.marcaModelo,
            kilometraje: b.kilometraje
        });
        const usuarioId = await usuarioPorDefecto(tx);

        const o = await new sql.Request(tx)
            .input("vid", sql.Int, vehiculoId)
            .input("uid", sql.Int, usuarioId)
            .input("estado", sql.VarChar(30), estado)
            .input("prioridad", sql.VarChar(20), prioridad)
            .query(`INSERT INTO OrdenTrabajo (vehiculo_id, usuario_id, estado, prioridad)
                    OUTPUT INSERTED.orden_id
                    VALUES (@vid, @uid, @estado, @prioridad)`);
        const ordenId = o.recordset[0].orden_id;

        await new sql.Request(tx)
            .input("oid", sql.Int, ordenId)
            .input("d", sql.VarChar(255), sintoma)
            .query("INSERT INTO Sintoma (orden_id, descripcion) VALUES (@oid, @d)");
        return ordenId;
    });

    res.status(201).json({ ok: true, id });
}));

app.put("/api/ordenes/:id/estado", wrap(async (req, res) => {
    const id = idParam(req);
    const estado = req.body && req.body.estado;
    if (!ESTADOS_ORDEN.includes(estado)) throw httpError(400, "Estado no válido.");
    const pool = await getPool();
    const r = await pool.request()
        .input("id", sql.Int, id)
        .input("estado", sql.VarChar(30), estado)
        .query("UPDATE OrdenTrabajo SET estado = @estado WHERE orden_id = @id");
    if (!r.rowsAffected[0]) throw httpError(404, "La orden no existe.");
    res.json({ ok: true });
}));

app.delete("/api/ordenes/:id", wrap(async (req, res) => {
    const id = idParam(req);
    await enTransaccion(async tx => {
        await new sql.Request(tx).input("id", sql.Int, id).query(`
            DELETE FROM Repuesto WHERE reparacion_id IN
                (SELECT reparacion_id FROM Reparacion WHERE orden_id = @id);
            DELETE FROM Reparacion  WHERE orden_id = @id;
            DELETE FROM Diagnostico WHERE orden_id = @id;
            DELETE FROM Sintoma     WHERE orden_id = @id;
            DELETE FROM OrdenTrabajo WHERE orden_id = @id;`);
    });
    res.json({ ok: true });
}));

/* ===================== ENVÍO DE CONSTANCIAS ===================== */

app.post(
    "/api/constancias",
    requiereSesion,
    wrap(async (req, res) => {

        const usuario = req.session.usuario;
        const rol = String(usuario.rol || "").trim().toLowerCase();

        // Solo los mecánicos pueden enviar constancias
        if (rol !== "mecanico") {
            return res.status(403).json({
                ok: false,
                mensaje: "Solo un mecánico puede enviar constancias."
            });
        }

        const ordenId = Number(req.body.ordenId);
        const mecanicoNombre = String(
            req.body.mecanicoNombre || ""
        ).trim();

        const fechaTexto = String(
            req.body.fechaReparacion || ""
        ).trim();

        const detalle = String(
            req.body.detalleReparacion || ""
        ).trim();

        // Validaciones básicas
        if (!Number.isSafeInteger(ordenId) || ordenId <= 0) {
            return res.status(400).json({
                ok: false,
                mensaje: "La orden seleccionada no es válida."
            });
        }

        if (mecanicoNombre.length < 3 || mecanicoNombre.length > 120) {
            return res.status(400).json({
                ok: false,
                mensaje: "Ingresa el nombre completo del mecánico."
            });
        }

        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fechaTexto)) {
            return res.status(400).json({
                ok: false,
                mensaje: "Selecciona una fecha y hora de reparación válidas."
            });
        }

        const fechaReparacion = new Date(fechaTexto);

        if (Number.isNaN(fechaReparacion.getTime())) {
            return res.status(400).json({
                ok: false,
                mensaje: "La fecha de reparación no es válida."
            });
        }

        if (!detalle || detalle.length > 3000) {
            return res.status(400).json({
                ok: false,
                mensaje: "Los detalles son obligatorios y no deben superar los 3000 caracteres."
            });
        }

        const pool = await getPool();

        // Consultar los datos reales de la orden en la base de datos
        const resultadoOrden = await pool.request()
            .input("id", sql.Int, ordenId)
            .query(`
                SELECT
                    o.orden_id,
                    o.estado,
                    o.prioridad,
                    v.placa,
                    v.marca,
                    v.modelo,
                    v.anio,
                    v.kilometraje,
                    p.nombres,
                    p.apellidos,
                    (
                        SELECT TOP 1 s.descripcion
                        FROM Sintoma s
                        WHERE s.orden_id = o.orden_id
                        ORDER BY s.sintoma_id
                    ) AS sintoma
                FROM OrdenTrabajo o
                INNER JOIN Vehiculo v
                    ON v.vehiculo_id = o.vehiculo_id
                INNER JOIN Propietario p
                    ON p.propietario_id = v.propietario_id
                WHERE o.orden_id = @id
            `);

        if (resultadoOrden.recordset.length === 0) {
            return res.status(404).json({
                ok: false,
                mensaje: "No se encontró la orden de trabajo."
            });
        }

        const orden = resultadoOrden.recordset[0];

        if (
            String(orden.estado || "").trim().toLowerCase()
            !== "completada"
        ) {
            return res.status(409).json({
                ok: false,
                mensaje: "Solo puedes enviar constancias de órdenes completadas."
            });
        }

        const marcaModelo = [
            orden.marca,
            orden.modelo
        ].filter(Boolean).join(" ");

        const cliente = nombreCompleto(
            orden.nombres,
            orden.apellidos
        );

        // Guardar la constancia con los datos obtenidos de SQL Server
        const guardado = await pool.request()
            .input("orden_id", sql.Int, orden.orden_id)
            .input("placa", sql.VarChar(10), orden.placa)
            .input("marca_modelo", sql.NVarChar(120), marcaModelo || null)
            .input("anio", sql.Int, orden.anio ?? null)
            .input("kilometraje", sql.Int, orden.kilometraje ?? null)
            .input("cliente", sql.NVarChar(200), cliente || null)
            .input("sintoma", sql.NVarChar(500), orden.sintoma || null)
            .input("estado_orden", sql.NVarChar(30), orden.estado)
            .input("prioridad", sql.NVarChar(30), orden.prioridad || null)
            .input("mecanico_nombre", sql.NVarChar(120), mecanicoNombre)
            .input("fecha_reparacion", sql.DateTime2(0), fechaReparacion)
            .input("detalle_reparacion", sql.NVarChar(sql.MAX), detalle)
            .input("dni", sql.VarChar(8), usuario.dni || null)
            .query(`
                INSERT INTO dbo.ConstanciaReparacion (
                    orden_id,
                    placa,
                    marca_modelo,
                    anio,
                    kilometraje,
                    cliente,
                    sintoma,
                    estado_orden,
                    prioridad,
                    mecanico_nombre,
                    fecha_reparacion,
                    detalle_reparacion,
                    enviado_por_dni
                )
                OUTPUT INSERTED.constancia_id
                VALUES (
                    @orden_id,
                    @placa,
                    @marca_modelo,
                    @anio,
                    @kilometraje,
                    @cliente,
                    @sintoma,
                    @estado_orden,
                    @prioridad,
                    @mecanico_nombre,
                    @fecha_reparacion,
                    @detalle_reparacion,
                    @dni
                )
            `);

        res.set("Cache-Control", "no-store");

        return res.status(201).json({
            ok: true,
            mensaje: "Constancia enviada al administrador correctamente.",
            constanciaId: guardado.recordset[0].constancia_id
        });
    })
);

/* ===================== MANTENIMIENTO PREVENTIVO ===================== */
app.get("/api/mantenimientos", wrap(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().query(`
        SELECT m.mantenimiento_id AS id, v.placa,
               ISNULL(m.tipo, ISNULL(m.descripcion, 'Mantenimiento')) AS tipo,
               m.kilometraje AS kmActual, m.km_proximo AS kmProximo,
               CONVERT(varchar(10), m.fecha_programada, 23) AS fechaProgramada,
               m.estado, m.descripcion AS notas,
               CONVERT(varchar(10), m.fecha, 23) AS fecha
        FROM Mantenimiento m
        JOIN Vehiculo v ON v.vehiculo_id = m.vehiculo_id
        ORDER BY m.fecha DESC, m.mantenimiento_id DESC`);

    res.json(r.recordset.map(m => ({
        id: m.id,
        placa: m.placa,
        tipo: m.tipo,
        kmActual: m.kmActual,
        kmProximo: m.kmProximo,
        fechaProgramada: m.fechaProgramada || "",
        estado: normEstado(m.estado) || "Programado",
        notas: m.notas && m.notas !== m.tipo ? m.notas : "",
        fecha: m.fecha
    })));
}));

app.post("/api/mantenimientos", wrap(async (req, res) => {
    const b = req.body || {};
    const placa = validarPlaca(b.placa);
    const tipo = textoOpcional(b.tipo, 100);
    if (!tipo) throw httpError(400, "El tipo de mantenimiento es obligatorio.");
    const estado = ESTADOS_MANT.includes(b.estado) ? b.estado : "Programado";
    const fechaProgramada = /^\d{4}-\d{2}-\d{2}$/.test(b.fechaProgramada || "") ? b.fechaProgramada : null;
    const kmActual = enteroOpcional(b.kmActual);
    const kmProximo = enteroOpcional(b.kmProximo);
    const notas = textoOpcional(b.notas, 255);

    const id = await enTransaccion(async tx => {
        const vehiculoId = await obtenerOCrearVehiculo(tx, { placa, kilometraje: kmActual });
        const m = await new sql.Request(tx)
            .input("vid", sql.Int, vehiculoId)
            .input("km", sql.Int, kmActual)
            .input("desc", sql.VarChar(255), notas)
            .input("tipo", sql.VarChar(100), tipo)
            .input("kmp", sql.Int, kmProximo)
            .input("fp", sql.VarChar(10), fechaProgramada)
            .input("estado", sql.VarChar(30), estado)
            .query(`INSERT INTO Mantenimiento
                        (vehiculo_id, kilometraje, descripcion, tipo, km_proximo, fecha_programada, estado)
                    OUTPUT INSERTED.mantenimiento_id
                    VALUES (@vid, @km, @desc, @tipo, @kmp, TRY_CONVERT(date, @fp, 23), @estado)`);
        return m.recordset[0].mantenimiento_id;
    });

    res.status(201).json({ ok: true, id });
}));

app.put("/api/mantenimientos/:id/estado", wrap(async (req, res) => {
    const id = idParam(req);
    const estado = req.body && req.body.estado;
    if (!ESTADOS_MANT.includes(estado)) throw httpError(400, "Estado no válido.");
    const pool = await getPool();
    const r = await pool.request()
        .input("id", sql.Int, id)
        .input("estado", sql.VarChar(30), estado)
        .query("UPDATE Mantenimiento SET estado = @estado WHERE mantenimiento_id = @id");
    if (!r.rowsAffected[0]) throw httpError(404, "El mantenimiento no existe.");
    res.json({ ok: true });
}));

app.delete("/api/mantenimientos/:id", wrap(async (req, res) => {
    const id = idParam(req);
    const pool = await getPool();
    await pool.request()
        .input("id", sql.Int, id)
        .query("DELETE FROM Mantenimiento WHERE mantenimiento_id = @id");
    res.json({ ok: true });
}));

/* ===================== HISTORIAL DEL VEHÍCULO ===================== */
// GET /api/historial?placa=ABC-123  (sin placa devuelve el vehículo con actividad más reciente)
app.get("/api/historial", wrap(async (req, res) => {
    const pool = await getPool();
    const placa = String(req.query.placa || "").trim().toUpperCase().replace(/[%_\[\]]/g, "");

    let q;
    if (placa) {
        q = await pool.request()
            .input("placa", sql.VarChar(10), placa.slice(0, 10))
            .query(`SELECT TOP 1 v.vehiculo_id, v.placa, v.marca, v.modelo, v.anio, v.kilometraje,
                           p.nombres, p.apellidos
                    FROM Vehiculo v JOIN Propietario p ON p.propietario_id = v.propietario_id
                    WHERE v.placa LIKE '%' + @placa + '%'
                    ORDER BY CASE WHEN v.placa = @placa THEN 0 ELSE 1 END, v.vehiculo_id`);
        if (!q.recordset.length) throw httpError(404, "No se encontró ningún vehículo con la placa \"" + placa + "\".");
    } else {
        q = await pool.request().query(`
            SELECT TOP 1 v.vehiculo_id, v.placa, v.marca, v.modelo, v.anio, v.kilometraje,
                   p.nombres, p.apellidos
            FROM Vehiculo v JOIN Propietario p ON p.propietario_id = v.propietario_id
            ORDER BY ISNULL((SELECT MAX(o.fecha) FROM OrdenTrabajo o WHERE o.vehiculo_id = v.vehiculo_id),
                            '19000101') DESC, v.vehiculo_id DESC`);
        if (!q.recordset.length) throw httpError(404, "Todavía no hay vehículos registrados.");
    }

    const v = q.recordset[0];
    const vid = v.vehiculo_id;
    const dePlaca = "SELECT orden_id FROM OrdenTrabajo WHERE vehiculo_id = @vid";

    const [ordenes, sintomas, diagnosticos, reparaciones, repuestos] = await Promise.all([
        pool.request().input("vid", sql.Int, vid).query(
            `SELECT orden_id, CONVERT(varchar(10), fecha, 23) AS fecha, estado, prioridad
             FROM OrdenTrabajo WHERE vehiculo_id = @vid ORDER BY fecha DESC, orden_id DESC`),
        pool.request().input("vid", sql.Int, vid).query(
            `SELECT orden_id, descripcion FROM Sintoma WHERE orden_id IN (${dePlaca}) ORDER BY sintoma_id`),
        pool.request().input("vid", sql.Int, vid).query(
            `SELECT orden_id, descripcion, resultado FROM Diagnostico
             WHERE orden_id IN (${dePlaca}) ORDER BY diagnostico_id`),
        pool.request().input("vid", sql.Int, vid).query(
            `SELECT reparacion_id, orden_id, descripcion, observaciones FROM Reparacion
             WHERE orden_id IN (${dePlaca}) ORDER BY reparacion_id`),
        pool.request().input("vid", sql.Int, vid).query(
            `SELECT rp.reparacion_id, rp.nombre, rp.cantidad, rp.estado
             FROM Repuesto rp JOIN Reparacion r ON r.reparacion_id = rp.reparacion_id
             WHERE r.orden_id IN (${dePlaca}) ORDER BY rp.repuesto_id`)
    ]);

    const repuestosPorReparacion = {};
    repuestos.recordset.forEach(r => {
        (repuestosPorReparacion[r.reparacion_id] = repuestosPorReparacion[r.reparacion_id] || []).push({
            nombre: r.nombre, cantidad: r.cantidad, estado: r.estado
        });
    });

    const agrupar = (filas, mapa) => {
        const out = {};
        filas.forEach(f => { (out[f.orden_id] = out[f.orden_id] || []).push(mapa(f)); });
        return out;
    };
    const sintomasPor = agrupar(sintomas.recordset, f => f.descripcion);
    const diagPor = agrupar(diagnosticos.recordset, f => ({ descripcion: f.descripcion, resultado: f.resultado }));
    const repPor = agrupar(reparaciones.recordset, f => ({
        descripcion: f.descripcion,
        observaciones: f.observaciones,
        repuestos: repuestosPorReparacion[f.reparacion_id] || []
    }));

    res.json({
        vehiculo: {
            placa: v.placa,
            marcaModelo: [v.marca, v.modelo].filter(Boolean).join(" "),
            anio: v.anio,
            kilometraje: v.kilometraje,
            propietario: nombreCompleto(v.nombres, v.apellidos)
        },
        ordenes: ordenes.recordset.map(o => ({
            id: o.orden_id,
            fecha: o.fecha,
            estado: normEstado(o.estado) || "Pendiente",
            prioridad: normEstado(o.prioridad) || "Normal",
            sintomas: sintomasPor[o.orden_id] || [],
            diagnosticos: diagPor[o.orden_id] || [],
            reparaciones: repPor[o.orden_id] || []
        }))
    });
}));

/* ===================== ARRANQUE ===================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor: http://localhost:" + PORT);
    // Intenta conectar desde el arranque para avisar enseguida si algo falla
    preparar().catch(err => {
        console.error("\nNo se pudo conectar con SQL Server:", err.message);
        console.error("Revisa usuario/contraseña, que el servicio SQL Server (y SQL Server Browser) estén iniciados y que TCP/IP esté habilitado.\n");
    });
});

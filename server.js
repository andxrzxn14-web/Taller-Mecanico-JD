require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");
const { GoogleGenAI } = require("@google/genai");

const app = express();

/* ===================== CONFIGURACIÃ“N GENERAL ===================== */

if (!process.env.DATABASE_URL) {
    throw new Error("Falta configurar DATABASE_URL en el archivo .env");
}

if (!process.env.SESSION_SECRET) {
    throw new Error("Falta configurar SESSION_SECRET en el archivo .env");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

pool.on("error", error => {
    console.error("Error inesperado en PostgreSQL:", error.message);
});

async function getPool() {
    return pool;
}

const gemini = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

console.log("Estado de Gemini:", gemini ? "CONFIGURADO" : "NO CONFIGURADO");

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(session({
    name: "jd.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 1000 * 60 * 60
    }
}));

/* ===================== PREPARACIÃ“N DE NEON ===================== */

let preparadoPromise = null;

function preparar() {
    if (!preparadoPromise) {
        preparadoPromise = pool.query("SELECT 1 AS conexion")
            .then(() => {
                console.log("ConexiÃ³n exitosa a Neon PostgreSQL.");
                console.log("Base de datos lista.");
            })
            .catch(error => {
                preparadoPromise = null;
                throw error;
            });
    }

    return preparadoPromise;
}

// Comprueba que Neon estÃ© disponible antes de atender cualquier API.
app.use("/api", async (req, res, next) => {
    try {
        await preparar();
        next();
    } catch (error) {
        console.error("Error de conexiÃ³n con Neon:", error.message);
        return res.status(503).json({
            ok: false,
            mensaje: "No se pudo conectar con la base de datos. IntÃ©ntalo nuevamente."
        });
    }
});

/* ===================== UTILIDADES GENERALES ===================== */

const ESTADOS_ORDEN = ["Pendiente", "En proceso", "Completada"];
const PRIORIDADES = ["Normal", "Alta", "Urgente"];
const ESTADOS_MANT = ["Programado", "Realizado"];

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function wrap(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(error => {
            if (!error.status || error.status >= 500) {
                console.error("Error en API:", error);
            }

            const status = error.status || 500;
            return res.status(status).json({
                ok: false,
                error: status >= 500 ? "OcurriÃ³ un error interno del servidor." : error.message,
                mensaje: status >= 500 ? "OcurriÃ³ un error interno del servidor." : error.message
            });
        });
    };
}

function normEstado(valor) {
    if (!valor) return "";
    const texto = String(valor).trim();
    return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
}

function textoOpcional(valor, maximo) {
    if (valor == null) return null;
    const texto = String(valor).trim();
    return texto ? texto.slice(0, maximo) : null;
}

function enteroOpcional(valor) {
    if (valor === "" || valor == null) return null;
    if (!/^\d+$/.test(String(valor).trim())) return null;
    const numero = Number(valor);
    if (!Number.isSafeInteger(numero) || numero < 0 || numero > 2147483647) return null;
    return numero;
}

function validarPlaca(placa) {
    const valor = String(placa || "").trim().toUpperCase();
    if (!valor) throw httpError(400, "La placa/VIN es obligatoria.");
    if (valor.length > 10) {
        throw httpError(400, "La placa/VIN admite como mÃ¡ximo 10 caracteres.");
    }
    return valor;
}

function partirNombre(cliente) {
    const partes = String(cliente || "").trim().split(/\s+/).filter(Boolean);

    if (partes.length === 0) {
        return { nombres: "Sin registrar", apellidos: "-" };
    }

    if (partes.length === 1) {
        return { nombres: partes[0].slice(0, 100), apellidos: "-" };
    }

    if (partes.length === 2) {
        return {
            nombres: partes[0].slice(0, 100),
            apellidos: partes[1].slice(0, 100)
        };
    }

    return {
        nombres: partes.slice(0, -2).join(" ").slice(0, 100),
        apellidos: partes.slice(-2).join(" ").slice(0, 100)
    };
}

function nombreCompleto(nombres, apellidos) {
    if (!nombres || nombres === "Sin registrar") return "";
    return (nombres + (apellidos && apellidos !== "-" ? " " + apellidos : "")).trim();
}

function idParam(req) {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw httpError(400, "Identificador invÃ¡lido.");
    }
    return id;
}

function normalizarTexto(texto) {
    return String(texto || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

/* ===================== SESIONES Y PERMISOS ===================== */

function requiereSesion(req, res, next) {
    if (req.session && req.session.usuario) return next();

    if (req.path.startsWith("/api/")) {
        return res.status(401).json({
            ok: false,
            mensaje: "Debes iniciar sesiÃ³n."
        });
    }

    return res.redirect("/acceso.html");
}

function requiereAdmin(req, res, next) {
    if (!req.session || !req.session.usuario) {
        return requiereSesion(req, res, next);
    }

    if (String(req.session.usuario.rol || "").toLowerCase() !== "administrador") {
        return res.status(403).json({
            ok: false,
            mensaje: "Acceso exclusivo para administradores."
        });
    }

    return next();
}

function requiereReportes(req, res, next) {
    if (!req.session || !req.session.usuario) {
        return requiereSesion(req, res, next);
    }

    if (String(req.session.usuario.rol || "").toLowerCase() !== "administrador") {
        return res.status(403).json({
            ok: false,
            mensaje: "Solo el administrador puede acceder a reportes."
        });
    }

    const hasta = Number(req.session.reportesHasta || 0);

    if (!hasta || Date.now() >= hasta) {
        req.session.reportesHasta = null;

        if (req.path.startsWith("/api/")) {
            return res.status(403).json({
                ok: false,
                mensaje: "El tiempo de acceso a reportes ha finalizado."
            });
        }

        return res.redirect("/index.html?reportes=expirado");
    }

    return next();
}

function regenerarSesion(req, datosUsuario, reportesHasta = null) {
    return new Promise((resolve, reject) => {
        req.session.regenerate(error => {
            if (error) return reject(error);

            req.session.usuario = datosUsuario;
            if (reportesHasta) req.session.reportesHasta = reportesHasta;

            req.session.save(errorGuardar => {
                if (errorGuardar) return reject(errorGuardar);
                resolve();
            });
        });
    });
}

/* ===================== LOGIN CON DNI Y CONTRASEÃ‘A ===================== */

app.post("/api/login-dni", wrap(async (req, res) => {
    const dni = String(req.body?.dni || "").trim();
    const password = String(req.body?.password || "");

    if (!/^\d{8}$/.test(dni) || !password) {
        throw httpError(400, "Ingresa tu DNI de 8 dÃ­gitos y tu contraseÃ±a.");
    }

    const resultado = await pool.query(
        `SELECT dni, nombres, rol, password_hash
         FROM public.accesodni
         WHERE dni = $1 AND activo = TRUE
         LIMIT 1`,
        [dni]
    );

    if (!resultado.rows.length || !resultado.rows[0].password_hash) {
        throw httpError(401, "DNI o contraseÃ±a incorrectos.");
    }

    const usuarioDB = resultado.rows[0];
    const contrasenaCorrecta = await bcrypt.compare(password, usuarioDB.password_hash);

    if (!contrasenaCorrecta) {
        throw httpError(401, "DNI o contraseÃ±a incorrectos.");
    }

    const rol = String(usuarioDB.rol || "").trim().toLowerCase();

    if (!["administrador", "mecanico"].includes(rol)) {
        throw httpError(403, "El usuario no tiene un rol autorizado.");
    }

    await regenerarSesion(req, {
        dni: usuarioDB.dni,
        nombre: usuarioDB.nombres,
        rol
    });

    return res.json({
        ok: true,
        rol,
        destino: "/index.html"
    });
}));

/* ===================== LOGIN ANTERIOR DE REPORTES ===================== */

// Se conserva esta ruta para que siga funcionando la pantalla antigua de reportes.
// Si la contraseÃ±a estaba guardada en texto plano, se convierte a bcrypt al iniciar sesiÃ³n.
app.post("/api/login", wrap(async (req, res) => {
    const usuario = String(req.body?.usuario || "").trim();
    const clave = String(req.body?.clave || "");

    if (!usuario || !clave) {
        throw httpError(400, "Ingresa tu usuario y contraseÃ±a.");
    }

    const resultado = await pool.query(
        `SELECT id_usuario, usuario, password, nombre, rol
         FROM public.usuariosreportes
         WHERE usuario = $1
         LIMIT 1`,
        [usuario]
    );

    if (!resultado.rows.length) {
        throw httpError(401, "Usuario o contraseÃ±a incorrectos.");
    }

    const usuarioDB = resultado.rows[0];
    const passwordDB = String(usuarioDB.password || "");
    let correcta = false;

    if (/^\$2[aby]\$/.test(passwordDB)) {
        correcta = await bcrypt.compare(clave, passwordDB);
    } else {
        const a = Buffer.from(clave, "utf8");
        const b = Buffer.from(passwordDB, "utf8");
        correcta = a.length === b.length && crypto.timingSafeEqual(a, b);

        if (correcta) {
            const nuevoHash = await bcrypt.hash(clave, 12);
            await pool.query(
                `UPDATE public.usuariosreportes SET password = $1 WHERE id_usuario = $2`,
                [nuevoHash, usuarioDB.id_usuario]
            );
        }
    }

    if (!correcta) throw httpError(401, "Usuario o contraseÃ±a incorrectos.");

    const rol = String(usuarioDB.rol || "").trim().toLowerCase();
    if (rol !== "admin" && rol !== "administrador") {
        throw httpError(403, "Solo el administrador puede acceder a reportes.");
    }

    await regenerarSesion(req, {
        id: usuarioDB.id_usuario,
        usuario: usuarioDB.usuario,
        nombre: usuarioDB.nombre,
        rol: "administrador"
    }, Date.now() + 120000);

    return res.json({ ok: true, destino: "/Reportes.html" });
}));

/* ===================== INFORMACIÃ“N Y CIERRE DE SESIÃ“N ===================== */

app.get("/api/sesion", (req, res) => {
    if (!req.session || !req.session.usuario) {
        return res.status(401).json({
            ok: false,
            mensaje: "No has iniciado sesiÃ³n."
        });
    }

    return res.json({ ok: true, usuario: req.session.usuario });
});

app.post("/api/logout", requiereSesion, (req, res) => {
    req.session.destroy(error => {
        if (error) {
            return res.status(500).json({
                ok: false,
                mensaje: "No se pudo cerrar la sesiÃ³n."
            });
        }

        res.clearCookie("jd.sid", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax"
        });

        return res.json({ ok: true });
    });
});

/* ===================== ASISTENTE INTELIGENTE GEMINI ===================== */

app.post("/api/asistente-ia", requiereSesion, wrap(async (req, res) => {
    const pregunta = String(req.body?.pregunta || "").trim();

    if (!pregunta) throw httpError(400, "Escribe una pregunta.");
    if (pregunta.length > 2000) throw httpError(400, "La pregunta es demasiado larga.");
    if (!gemini) {
        throw httpError(503, "Gemini no estÃ¡ configurado. Revisa GEMINI_API_KEY.");
    }

    const instrucciones = `
Eres el asistente inteligente del Taller MecÃ¡nico J&D.
Responde de manera clara, profesional y sencilla, siempre en espaÃ±ol.
Puedes orientar sobre motores, frenos, transmisiÃ³n, suspensiÃ³n, electricidad,
mantenimiento preventivo y reparaciones automotrices.
Cuando se describa una falla, explica posibles causas, componentes que revisar
y soluciones breves. No presentes posibilidades como diagnÃ³sticos confirmados.
Si existe riesgo para la seguridad, indÃ­calo claramente.
No inventes datos de clientes, Ã³rdenes ni reparaciones del taller: no tienes
acceso directo a la base de datos.
`;

    try {
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
            throw httpError(502, "Gemini no generÃ³ ninguna respuesta.");
        }

        return res.json({ ok: true, respuesta });
    } catch (error) {
        console.error("ERROR GEMINI:", error.message);

        if (error.status === 400 || error.status === 429 || error.status === 503) {
            return res.status(error.status).json({
                ok: false,
                mensaje: error.status === 429
                    ? "Se alcanzÃ³ el lÃ­mite de consultas de Gemini. IntÃ©ntalo mÃ¡s tarde."
                    : "No se pudo generar una respuesta con Gemini. Revisa la clave API y el modelo."
            });
        }

        return res.status(502).json({
            ok: false,
            mensaje: "No se pudo conectar con Gemini. Revisa la clave API, el modelo y tu conexiÃ³n a internet."
        });
    }
}));

/* ===================== ACCESO TEMPORAL A REPORTES ===================== */

const intentosPinReportes = new Map();

app.post("/api/reportes/abrir", requiereAdmin, (req, res) => {
    const ahora = Date.now();
    const pinCorrecto = String(process.env.REPORTES_PIN || "").trim();
    const pinIngresado = String(req.body?.pin || "").trim();

    if (!/^\d{6}$/.test(pinCorrecto)) {
        return res.status(500).json({
            ok: false,
            mensaje: "El PIN de reportes no estÃ¡ configurado correctamente."
        });
    }

    const claveIP = req.ip || req.socket.remoteAddress || "desconocido";
    const control = intentosPinReportes.get(claveIP) || {
        intentos: 0,
        bloqueadoHasta: 0
    };

    if (control.bloqueadoHasta > ahora) {
        const segundos = Math.ceil((control.bloqueadoHasta - ahora) / 1000);
        return res.status(429).json({
            ok: false,
            mensaje: `Acceso temporalmente bloqueado. Intenta nuevamente en ${segundos} segundos.`
        });
    }

    let pinValido = false;
    if (/^\d{6}$/.test(pinIngresado)) {
        pinValido = crypto.timingSafeEqual(
            Buffer.from(pinIngresado, "utf8"),
            Buffer.from(pinCorrecto, "utf8")
        );
    }

    if (!pinValido) {
        control.intentos += 1;

        if (control.intentos >= 3) {
            control.intentos = 0;
            control.bloqueadoHasta = ahora + 5 * 60 * 1000;
            intentosPinReportes.set(claveIP, control);

            return res.status(429).json({
                ok: false,
                mensaje: "Has alcanzado 3 intentos fallidos. Acceso bloqueado durante 5 minutos."
            });
        }

        intentosPinReportes.set(claveIP, control);
        return res.status(401).json({
            ok: false,
            mensaje: `PIN incorrecto. Intento ${control.intentos} de 3.`
        });
    }

    intentosPinReportes.delete(claveIP);

    const hastaActual = Number(req.session.reportesHasta || 0);
    if (hastaActual <= ahora) {
        req.session.reportesHasta = ahora + 120000;
    }

    req.session.save(error => {
        if (error) {
            console.error("Error guardando acceso a reportes:", error);
            return res.status(500).json({
                ok: false,
                mensaje: "No se pudo guardar la autorizaciÃ³n."
            });
        }

        res.set("Cache-Control", "no-store");
        return res.json({
            ok: true,
            destino: "/Reportes.html",
            hasta: req.session.reportesHasta
        });
    });
});

app.get("/api/reportes/estado", requiereReportes, (req, res) => {
    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, hasta: req.session.reportesHasta });
});

app.post("/api/reportes/cerrar", requiereAdmin, (req, res) => {
    req.session.reportesHasta = null;

    req.session.save(error => {
        if (error) {
            return res.status(500).json({
                ok: false,
                mensaje: "No se pudo cerrar el acceso a reportes."
            });
        }
        return res.json({ ok: true });
    });
});

app.get("/reportes/abrir", requiereReportes, (req, res) => {
    res.set("Cache-Control", "no-store");
    return res.redirect("/Reportes.html");
});

/* ===================== REPORTES: Ã“RDENES ===================== */

app.get("/api/reportes/ordenes", requiereReportes, wrap(async (req, res) => {
    const resultado = await pool.query(`
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
            TO_CHAR(o.fecha, 'YYYY-MM-DD') AS fecha,
            (
                SELECT s.descripcion
                FROM public.sintoma s
                WHERE s.orden_id = o.orden_id
                ORDER BY s.sintoma_id
                LIMIT 1
            ) AS sintoma
        FROM public.ordentrabajo o
        JOIN public.vehiculo v ON v.vehiculo_id = o.vehiculo_id
        JOIN public.propietario p ON p.propietario_id = v.propietario_id
        ORDER BY o.fecha DESC, o.orden_id DESC
    `);

    res.set("Cache-Control", "no-store");
    return res.json(resultado.rows.map(o => ({
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

/* ===================== REPORTES: MANTENIMIENTOS ===================== */

app.get("/api/reportes/mantenimientos", requiereReportes, wrap(async (req, res) => {
    const resultado = await pool.query(`
        SELECT
            m.mantenimiento_id AS id,
            v.placa,
            COALESCE(m.tipo, m.descripcion, 'Mantenimiento') AS tipo,
            m.kilometraje AS "kmActual",
            m.km_proximo AS "kmProximo",
            TO_CHAR(m.fecha_programada, 'YYYY-MM-DD') AS "fechaProgramada",
            m.estado,
            m.descripcion AS notas,
            TO_CHAR(m.fecha, 'YYYY-MM-DD') AS fecha
        FROM public.mantenimiento m
        JOIN public.vehiculo v ON v.vehiculo_id = m.vehiculo_id
        ORDER BY m.fecha DESC, m.mantenimiento_id DESC
    `);

    res.set("Cache-Control", "no-store");
    return res.json(resultado.rows.map(m => ({
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

/* ===================== REPORTES: CONSTANCIAS ===================== */

app.get("/api/reportes/constancias", requiereReportes, wrap(async (req, res) => {
    const resultado = await pool.query(`
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
            TO_CHAR(fecha_reparacion, 'YYYY-MM-DD HH24:MI:SS') AS fecha_reparacion,
            detalle_reparacion,
            enviado_por_dni,
            TO_CHAR(fecha_envio, 'YYYY-MM-DD HH24:MI:SS') AS fecha_envio,
            estado_revision
        FROM public.constanciareparacion
        ORDER BY
            CASE WHEN estado_revision = 'Pendiente' THEN 0 ELSE 1 END,
            fecha_envio DESC
    `);

    res.set("Cache-Control", "no-store");
    return res.json(resultado.rows);
}));

app.put("/api/reportes/constancias/:id/revision", requiereReportes, wrap(async (req, res) => {
    const id = String(req.params.id || "");
    const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    if (!esUuid) throw httpError(400, "Identificador de constancia invÃ¡lido.");

    const resultado = await pool.query(
        `UPDATE public.constanciareparacion
         SET estado_revision = 'Revisada'
         WHERE constancia_id = $1
         RETURNING constancia_id`,
        [id]
    );

    if (!resultado.rowCount) throw httpError(404, "No se encontrÃ³ la constancia.");

    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, mensaje: "Constancia marcada como revisada." });
}));

/* ===================== VEHÃCULOS Y TRANSACCIONES ===================== */

async function obtenerOCrearVehiculo(tx, datos) {
    const km = enteroOpcional(datos.kilometraje);

    const encontrado = await tx.query(
        `SELECT vehiculo_id
         FROM public.vehiculo
         WHERE placa = $1
         LIMIT 1`,
        [datos.placa]
    );

    if (encontrado.rows.length) {
        const id = encontrado.rows[0].vehiculo_id;

        if (km !== null) {
            await tx.query(
                `UPDATE public.vehiculo
                 SET kilometraje = $1
                 WHERE vehiculo_id = $2
                   AND (kilometraje IS NULL OR kilometraje < $1)`,
                [km, id]
            );
        }

        return id;
    }

    const { nombres, apellidos } = partirNombre(datos.cliente);
    let propietarioId;

    const existente = await tx.query(
        `SELECT propietario_id
         FROM public.propietario
         WHERE nombres = $1
           AND apellidos = $2
           AND documento LIKE 'SD-%'
         ORDER BY propietario_id
         LIMIT 1`,
        [nombres, apellidos]
    );

    if (existente.rows.length && nombres !== "Sin registrar") {
        propietarioId = existente.rows[0].propietario_id;
    } else {
        const documento = "SD-" + crypto.randomBytes(8).toString("hex");
        const propietario = await tx.query(
            `INSERT INTO public.propietario (nombres, apellidos, documento)
             VALUES ($1, $2, $3)
             RETURNING propietario_id`,
            [nombres, apellidos, documento]
        );
        propietarioId = propietario.rows[0].propietario_id;
    }

    const partesVehiculo = String(datos.marcaModelo || "").trim().split(/\s+/).filter(Boolean);
    const marca = partesVehiculo.length ? partesVehiculo[0].slice(0, 50) : null;
    const modelo = partesVehiculo.length > 1 ? partesVehiculo.slice(1).join(" ").slice(0, 50) : null;

    const vehiculo = await tx.query(
        `INSERT INTO public.vehiculo
            (propietario_id, placa, marca, modelo, kilometraje)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING vehiculo_id`,
        [propietarioId, datos.placa, marca, modelo, km]
    );

    return vehiculo.rows[0].vehiculo_id;
}

async function usuarioPorDefecto(tx) {
    const resultado = await tx.query(
        `SELECT usuario_id
         FROM public.usuario
         ORDER BY usuario_id
         LIMIT 1`
    );

    if (!resultado.rows.length) {
        throw httpError(500, "No hay ningÃºn usuario registrado en la tabla usuario.");
    }

    return resultado.rows[0].usuario_id;
}

async function enTransaccion(fn) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const resultado = await fn(client);
        await client.query("COMMIT");
        return resultado;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (errorRollback) {
            console.error("Error al revertir transacciÃ³n:", errorRollback.message);
        }
        throw error;
    } finally {
        client.release();
    }
}

app.get("/api/vehiculos", requiereSesion, wrap(async (req, res) => {
    const resultado = await pool.query(
        `SELECT * FROM public.vehiculo ORDER BY vehiculo_id DESC`
    );
    return res.json(resultado.rows);
}));

/* ===================== BÃšSQUEDA INTELIGENTE DE DIAGNÃ“STICOS ===================== */

app.get("/api/busqueda-inteligente", requiereSesion, wrap(async (req, res) => {
    const consulta = String(req.query.q || "").trim().slice(0, 200);

    if (consulta.length < 3) {
        return res.json({ ok: true, causas: [], coincidencias: [] });
    }

    const texto = normalizarTexto(consulta);
    const palabrasIgnoradas = new Set([
        "que", "como", "para", "por", "con", "del", "las", "los", "una", "uno",
        "unos", "unas", "tiene", "esta", "este", "cuando", "hace", "carro",
        "vehiculo", "vehiculos", "algo", "desde", "hacia", "sobre", "entre"
    ]);

    const palabrasOriginales = [...new Set(
        (texto.match(/[a-z0-9]+/g) || []).filter(p => p.length >= 3 && !palabrasIgnoradas.has(p))
    )].slice(0, 8);

    const terminos = new Set(palabrasOriginales);

    if (/(ruido|sonido|chirrido|chillido|crujido|zumbido|roce)/.test(texto)) {
        ["ruido", "sonido", "chirrido", "chillido", "crujido", "zumbido"].forEach(t => terminos.add(t));
    }
    if (/(llanta|rueda|neumatico|rodamiento)/.test(texto)) {
        ["llanta", "rueda", "neumatico", "rodamiento"].forEach(t => terminos.add(t));
    }
    if (/(freno|pastilla|disco|cristaliz)/.test(texto)) {
        ["freno", "pastilla", "disco", "cristalizada", "cristalizadas", "cristalizado", "cristalizados"].forEach(t => terminos.add(t));
    }

    const terminosBusqueda = [...terminos].slice(0, 16);
    if (!terminosBusqueda.length) {
        return res.json({ ok: true, causas: [], coincidencias: [] });
    }

    const causas = [];
    const agregarCausa = (titulo, detalle, solucion) => {
        if (!causas.some(c => c.titulo === titulo)) causas.push({ titulo, detalle, solucion });
    };

    const mencionaRuido = /(ruido|sonido|chirrido|chillido|crujido|zumbido|roce|cristaliz)/.test(texto);
    const mencionaRueda = /(llanta|rueda|neumatico|freno|pastilla|disco|rodamiento|cristaliz)/.test(texto);

    if (mencionaRuido && mencionaRueda) {
        agregarCausa("Pastillas de freno cristalizadas o desgastadas", "Posible causa si el chirrido aparece al frenar.", "Inspeccionar pastillas y discos; medir el desgaste y sustituir lo que corresponda.");
        agregarCausa("Objeto extraÃ±o rozando la rueda", "Una piedra o un protector desplazado puede producir un roce repetitivo.", "Inspeccionar la rueda, el disco y su protector; retirar el objeto si se confirma.");
        agregarCausa("Rodamiento de rueda desgastado", "Un zumbido que aumenta con la velocidad puede justificar revisar el rodamiento.", "Comprobar holgura, ruido y estado del rodamiento; reemplazarlo si estÃ¡ defectuoso.");
    }

    if (/(vibracion|vibra|tiembla|temblor|sacudida)/.test(texto)) {
        agregarCausa("Desequilibrio de rueda o neumÃ¡tico", "Puede provocar vibraciones que aumentan a determinadas velocidades.", "Revisar neumÃ¡ticos y realizar equilibrado si se confirma el desequilibrio.");
        agregarCausa("Holgura en suspensiÃ³n o direcciÃ³n", "Puede causar vibraciones, especialmente al pasar por irregularidades.", "Inspeccionar rÃ³tulas, bujes, fijaciones y componentes de direcciÃ³n.");
    }

    if (/(sobrecalienta|recalienta|temperatura|calienta|hierve)/.test(texto)) {
        agregarCausa("Problema en el sistema de refrigeraciÃ³n", "PodrÃ­a existir una fuga, un nivel bajo de refrigerante o una falla de circulaciÃ³n.", "Con el motor frÃ­o, revisar nivel y fugas; comprobar ventilador y termostato.");
    }

    if (/(no arranca|no enciende|arranque|bateria|encendido)/.test(texto)) {
        agregarCausa("BaterÃ­a descargada o conexiones deficientes", "Es una posibilidad si el motor gira lentamente o solo se escuchan clics.", "Medir la baterÃ­a y revisar bornes, conexiones y sistema de carga.");
        agregarCausa("Falla del sistema de arranque", "Puede estar relacionada con el motor de arranque u otro componente elÃ©ctrico.", "Comprobar alimentaciÃ³n elÃ©ctrica, motor de arranque y cÃ³digos de averÃ­a.");
    }

    if (/(fuga|gotea|pierde aceite|refrigerante)/.test(texto)) {
        agregarCausa("Posible fuga de fluido", "El origen depende del color, la ubicaciÃ³n y las caracterÃ­sticas del lÃ­quido.", "Identificar el fluido y localizar la fuga antes de sustituir juntas o componentes.");
    }

    if (/(freno|frenar|frenada|pedal|no frena)/.test(texto)) {
        agregarCausa("Desgaste o falla del sistema de frenos", "El ruido, la vibraciÃ³n o un pedal anormal pueden tener distintas causas.", "Inspeccionar pastillas, discos, lÃ­quido y posibles fugas. Si frena mal, no conducir.");
    }

    if (/(direccion dura|volante duro|cuesta girar|direccion pesada)/.test(texto)) {
        agregarCausa("Problema en la asistencia de direcciÃ³n", "Puede estar relacionado con la asistencia elÃ©ctrica o hidrÃ¡ulica.", "Revisar testigos, alimentaciÃ³n elÃ©ctrica, nivel de fluido si aplica y componentes.");
    }

    if (/(humo|humareda|sale humo|humo blanco|humo azul|humo negro)/.test(texto)) {
        agregarCausa("CombustiÃ³n anormal o presencia de fluidos", "El color del humo y las condiciones de apariciÃ³n ayudan a identificar el origen.", "Comprobar refrigerante, aceite, admisiÃ³n y combustiÃ³n; evitar circular si el humo es abundante.");
    }

    if (/(pierde potencia|sin fuerza|no tiene fuerza|falta de potencia)/.test(texto)) {
        agregarCausa("Problema de admisiÃ³n, combustible o encendido", "Un filtro obstruido, una falla de alimentaciÃ³n o un fallo de encendido pueden reducir la potencia.", "Leer cÃ³digos de averÃ­a y revisar filtros, admisiÃ³n y sistema de combustible.");
    }

    if (!causas.length) {
        agregarCausa("Se necesita precisar el sÃ­ntoma", "Con la descripciÃ³n actual no se puede sugerir una causa especÃ­fica con suficiente fundamento.", "Indicar cuÃ¡ndo ocurre, quÃ© ruido produce, en quÃ© zona y si cambia al acelerar, frenar o girar.");
    }

    const condiciones = terminosBusqueda.map((_, i) => {
        const p = `$${i + 1}`;
        return `(
            COALESCE(s.sintoma, '') ILIKE ${p}
            OR COALESCE(d.diagnostico, '') ILIKE ${p}
            OR COALESCE(d.resultado, '') ILIKE ${p}
            OR COALESCE(r.reparacion, '') ILIKE ${p}
            OR COALESCE(r.observaciones, '') ILIKE ${p}
            OR COALESCE(v.placa, '') ILIKE ${p}
            OR COALESCE(v.marca, '') ILIKE ${p}
            OR COALESCE(v.modelo, '') ILIKE ${p}
            OR COALESCE(p.nombres, '') ILIKE ${p}
            OR COALESCE(p.apellidos, '') ILIKE ${p}
        )`;
    }).join(" OR ");

    const valores = terminosBusqueda.map(termino => `%${termino}%`);

    const resultado = await pool.query(`
        SELECT
            o.orden_id AS id,
            TO_CHAR(o.fecha, 'YYYY-MM-DD') AS fecha,
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
            d.resultado AS "resultadoDiagnostico",
            r.reparacion,
            r.observaciones
        FROM public.ordentrabajo o
        INNER JOIN public.vehiculo v ON v.vehiculo_id = o.vehiculo_id
        LEFT JOIN public.propietario p ON p.propietario_id = v.propietario_id
        LEFT JOIN LATERAL (
            SELECT si.descripcion AS sintoma
            FROM public.sintoma si
            WHERE si.orden_id = o.orden_id
            ORDER BY si.sintoma_id DESC
            LIMIT 1
        ) s ON TRUE
        LEFT JOIN LATERAL (
            SELECT dg.descripcion AS diagnostico, dg.resultado
            FROM public.diagnostico dg
            WHERE dg.orden_id = o.orden_id
            ORDER BY dg.diagnostico_id DESC
            LIMIT 1
        ) d ON TRUE
        LEFT JOIN LATERAL (
            SELECT rp.descripcion AS reparacion, rp.observaciones
            FROM public.reparacion rp
            WHERE rp.orden_id = o.orden_id
            ORDER BY rp.reparacion_id DESC
            LIMIT 1
        ) r ON TRUE
        WHERE ${condiciones}
        ORDER BY o.fecha DESC, o.orden_id DESC
        LIMIT 80
    `, valores);

    const coincidencias = resultado.rows.map(fila => {
        const sintoma = normalizarTexto(fila.sintoma);
        const diagnostico = normalizarTexto(fila.diagnostico);
        const resultadoDiag = normalizarTexto(fila.resultadoDiagnostico);
        const reparacion = normalizarTexto(fila.reparacion);
        const observaciones = normalizarTexto(fila.observaciones);
        const textoVehiculo = normalizarTexto([
            fila.placa, fila.marca, fila.modelo, fila.nombres, fila.apellidos
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
            marcaModelo: [fila.marca, fila.modelo].filter(Boolean).join(" "),
            anio: fila.anio,
            kilometraje: fila.kilometraje,
            cliente: nombreCompleto(fila.nombres, fila.apellidos),
            sintoma: fila.sintoma || "",
            diagnostico: fila.diagnostico || "",
            resultadoDiagnostico: fila.resultadoDiagnostico || "",
            reparacion: fila.reparacion || "",
            observaciones: fila.observaciones || "",
            puntuacion
        };
    }).sort((a, b) => b.puntuacion - a.puntuacion || String(b.fecha).localeCompare(String(a.fecha)))
      .slice(0, 10);

    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, causas: causas.slice(0, 5), coincidencias });
}));

/* ===================== Ã“RDENES DE TRABAJO ===================== */

app.get("/api/ordenes", requiereSesion, wrap(async (req, res) => {
    const resultado = await pool.query(`
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
            TO_CHAR(o.fecha, 'YYYY-MM-DD') AS fecha,
            (
                SELECT s.descripcion
                FROM public.sintoma s
                WHERE s.orden_id = o.orden_id
                ORDER BY s.sintoma_id
                LIMIT 1
            ) AS sintoma
        FROM public.ordentrabajo o
        JOIN public.vehiculo v ON v.vehiculo_id = o.vehiculo_id
        JOIN public.propietario p ON p.propietario_id = v.propietario_id
        ORDER BY o.fecha DESC, o.orden_id DESC
    `);

    return res.json(resultado.rows.map(o => ({
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

app.post("/api/ordenes", requiereSesion, wrap(async (req, res) => {
    const body = req.body || {};
    const placa = validarPlaca(body.placa);
    const sintoma = textoOpcional(body.sintoma, 255);

    if (!sintoma) throw httpError(400, "El sÃ­ntoma / motivo de ingreso es obligatorio.");

    const estado = ESTADOS_ORDEN.includes(body.estado) ? body.estado : "Pendiente";
    const prioridad = PRIORIDADES.includes(body.prioridad) ? body.prioridad : "Normal";

    const id = await enTransaccion(async tx => {
        const vehiculoId = await obtenerOCrearVehiculo(tx, {
            placa,
            cliente: body.cliente,
            marcaModelo: body.marcaModelo,
            kilometraje: body.kilometraje
        });

        const usuarioId = await usuarioPorDefecto(tx);
        const orden = await tx.query(
            `INSERT INTO public.ordentrabajo
                (vehiculo_id, usuario_id, fecha, estado, prioridad)
             VALUES ($1, $2, NOW(), $3, $4)
             RETURNING orden_id`,
            [vehiculoId, usuarioId, estado, prioridad]
        );

        const ordenId = orden.rows[0].orden_id;
        await tx.query(
            `INSERT INTO public.sintoma (orden_id, descripcion)
             VALUES ($1, $2)`,
            [ordenId, sintoma]
        );

        return ordenId;
    });

    return res.status(201).json({ ok: true, id });
}));

app.put("/api/ordenes/:id/estado", requiereSesion, wrap(async (req, res) => {
    const id = idParam(req);
    const estado = req.body?.estado;
    if (!ESTADOS_ORDEN.includes(estado)) throw httpError(400, "Estado no vÃ¡lido.");

    const resultado = await pool.query(
        `UPDATE public.ordentrabajo SET estado = $1 WHERE orden_id = $2 RETURNING orden_id`,
        [estado, id]
    );

    if (!resultado.rowCount) throw httpError(404, "La orden no existe.");
    return res.json({ ok: true });
}));

app.delete("/api/ordenes/:id", requiereSesion, wrap(async (req, res) => {
    const id = idParam(req);

    await enTransaccion(async tx => {
        await tx.query(
            `DELETE FROM public.repuesto
             WHERE reparacion_id IN (
                 SELECT reparacion_id FROM public.reparacion WHERE orden_id = $1
             )`,
            [id]
        );
        await tx.query(`DELETE FROM public.reparacion WHERE orden_id = $1`, [id]);
        await tx.query(`DELETE FROM public.diagnostico WHERE orden_id = $1`, [id]);
        await tx.query(`DELETE FROM public.sintoma WHERE orden_id = $1`, [id]);

        const eliminado = await tx.query(
            `DELETE FROM public.ordentrabajo WHERE orden_id = $1 RETURNING orden_id`,
            [id]
        );

        if (!eliminado.rowCount) throw httpError(404, "La orden no existe.");
    });

    return res.json({ ok: true });
}));

/* ===================== ENVÃO DE CONSTANCIAS ===================== */

app.post("/api/constancias", requiereSesion, wrap(async (req, res) => {
    const usuario = req.session.usuario;
    const rol = String(usuario.rol || "").trim().toLowerCase();

    if (rol !== "mecanico") {
        throw httpError(403, "Solo un mecÃ¡nico puede enviar constancias.");
    }

    const ordenId = Number(req.body?.ordenId);
    const mecanicoNombre = String(usuario.nombre || req.body?.mecanicoNombre || "").trim();
    const fechaTexto = String(req.body?.fechaReparacion || "").trim();
    const detalle = String(req.body?.detalleReparacion || "").trim();

    if (!Number.isSafeInteger(ordenId) || ordenId <= 0) {
        throw httpError(400, "La orden seleccionada no es vÃ¡lida.");
    }

    if (mecanicoNombre.length < 3 || mecanicoNombre.length > 120) {
        throw httpError(400, "Ingresa el nombre completo del mecÃ¡nico.");
    }

    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fechaTexto)) {
        throw httpError(400, "Selecciona una fecha y hora de reparaciÃ³n vÃ¡lidas.");
    }

    const fechaValidacion = new Date(fechaTexto);
    if (Number.isNaN(fechaValidacion.getTime())) {
        throw httpError(400, "La fecha de reparaciÃ³n no es vÃ¡lida.");
    }

    if (!detalle || detalle.length > 3000) {
        throw httpError(400, "Los detalles son obligatorios y no deben superar los 3000 caracteres.");
    }

    const resultadoOrden = await pool.query(`
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
                SELECT s.descripcion
                FROM public.sintoma s
                WHERE s.orden_id = o.orden_id
                ORDER BY s.sintoma_id
                LIMIT 1
            ) AS sintoma
        FROM public.ordentrabajo o
        INNER JOIN public.vehiculo v ON v.vehiculo_id = o.vehiculo_id
        INNER JOIN public.propietario p ON p.propietario_id = v.propietario_id
        WHERE o.orden_id = $1
    `, [ordenId]);

    if (!resultadoOrden.rows.length) {
        throw httpError(404, "No se encontrÃ³ la orden de trabajo.");
    }

    const orden = resultadoOrden.rows[0];
    if (String(orden.estado || "").trim().toLowerCase() !== "completada") {
        throw httpError(409, "Solo puedes enviar constancias de Ã³rdenes completadas.");
    }

    const marcaModelo = [orden.marca, orden.modelo].filter(Boolean).join(" ");
    const cliente = nombreCompleto(orden.nombres, orden.apellidos);

    const guardado = await pool.query(`
        INSERT INTO public.constanciareparacion (
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
            enviado_por_dni,
            fecha_envio,
            estado_revision
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11::timestamp, $12, $13, NOW(), 'Pendiente'
        )
        RETURNING constancia_id
    `, [
        orden.orden_id,
        orden.placa,
        marcaModelo || null,
        orden.anio ?? null,
        orden.kilometraje ?? null,
        cliente || null,
        orden.sintoma || null,
        orden.estado,
        orden.prioridad || null,
        mecanicoNombre,
        fechaTexto.replace("T", " "),
        detalle,
        usuario.dni || null
    ]);

    res.set("Cache-Control", "no-store");
    return res.status(201).json({
        ok: true,
        mensaje: "Constancia enviada al administrador correctamente.",
        constanciaId: guardado.rows[0].constancia_id
    });
}));

/* ===================== MANTENIMIENTO PREVENTIVO ===================== */

app.get("/api/mantenimientos", requiereSesion, wrap(async (req, res) => {
    const resultado = await pool.query(`
        SELECT
            m.mantenimiento_id AS id,
            v.placa,
            COALESCE(m.tipo, m.descripcion, 'Mantenimiento') AS tipo,
            m.kilometraje AS "kmActual",
            m.km_proximo AS "kmProximo",
            TO_CHAR(m.fecha_programada, 'YYYY-MM-DD') AS "fechaProgramada",
            m.estado,
            m.descripcion AS notas,
            TO_CHAR(m.fecha, 'YYYY-MM-DD') AS fecha
        FROM public.mantenimiento m
        JOIN public.vehiculo v ON v.vehiculo_id = m.vehiculo_id
        ORDER BY m.fecha DESC, m.mantenimiento_id DESC
    `);

    return res.json(resultado.rows.map(m => ({
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

app.post("/api/mantenimientos", requiereSesion, wrap(async (req, res) => {
    const body = req.body || {};
    const placa = validarPlaca(body.placa);
    const tipo = textoOpcional(body.tipo, 100);
    if (!tipo) throw httpError(400, "El tipo de mantenimiento es obligatorio.");

    const estado = ESTADOS_MANT.includes(body.estado) ? body.estado : "Programado";
    const fechaProgramada = /^\d{4}-\d{2}-\d{2}$/.test(body.fechaProgramada || "")
        ? body.fechaProgramada
        : null;
    const kmActual = enteroOpcional(body.kmActual);
    const kmProximo = enteroOpcional(body.kmProximo);
    const notas = textoOpcional(body.notas, 255);

    const id = await enTransaccion(async tx => {
        const vehiculoId = await obtenerOCrearVehiculo(tx, {
            placa,
            kilometraje: kmActual
        });

        const mantenimiento = await tx.query(`
            INSERT INTO public.mantenimiento (
                vehiculo_id,
                fecha,
                kilometraje,
                descripcion,
                tipo,
                km_proximo,
                fecha_programada,
                estado
            ) VALUES ($1, NOW(), $2, $3, $4, $5, $6::date, $7)
            RETURNING mantenimiento_id
        `, [vehiculoId, kmActual, notas, tipo, kmProximo, fechaProgramada, estado]);

        return mantenimiento.rows[0].mantenimiento_id;
    });

    return res.status(201).json({ ok: true, id });
}));

app.put("/api/mantenimientos/:id/estado", requiereSesion, wrap(async (req, res) => {
    const id = idParam(req);
    const estado = req.body?.estado;
    if (!ESTADOS_MANT.includes(estado)) throw httpError(400, "Estado no vÃ¡lido.");

    const resultado = await pool.query(
        `UPDATE public.mantenimiento SET estado = $1 WHERE mantenimiento_id = $2 RETURNING mantenimiento_id`,
        [estado, id]
    );

    if (!resultado.rowCount) throw httpError(404, "El mantenimiento no existe.");
    return res.json({ ok: true });
}));

app.delete("/api/mantenimientos/:id", requiereSesion, wrap(async (req, res) => {
    const id = idParam(req);
    const resultado = await pool.query(
        `DELETE FROM public.mantenimiento WHERE mantenimiento_id = $1 RETURNING mantenimiento_id`,
        [id]
    );

    if (!resultado.rowCount) throw httpError(404, "El mantenimiento no existe.");
    return res.json({ ok: true });
}));

/* ===================== HISTORIAL DEL VEHÃCULO ===================== */

app.get("/api/historial", requiereSesion, wrap(async (req, res) => {
    const placa = String(req.query.placa || "")
        .trim()
        .toUpperCase()
        .replace(/[%_\[\]]/g, "")
        .slice(0, 10);

    let resultadoVehiculo;

    if (placa) {
        resultadoVehiculo = await pool.query(`
            SELECT
                v.vehiculo_id,
                v.placa,
                v.marca,
                v.modelo,
                v.anio,
                v.kilometraje,
                p.nombres,
                p.apellidos
            FROM public.vehiculo v
            JOIN public.propietario p ON p.propietario_id = v.propietario_id
            WHERE v.placa ILIKE $1
            ORDER BY CASE WHEN v.placa = $2 THEN 0 ELSE 1 END, v.vehiculo_id
            LIMIT 1
        `, [`%${placa}%`, placa]);

        if (!resultadoVehiculo.rows.length) {
            throw httpError(404, `No se encontrÃ³ ningÃºn vehÃ­culo con la placa "${placa}".`);
        }
    } else {
        resultadoVehiculo = await pool.query(`
            SELECT
                v.vehiculo_id,
                v.placa,
                v.marca,
                v.modelo,
                v.anio,
                v.kilometraje,
                p.nombres,
                p.apellidos
            FROM public.vehiculo v
            JOIN public.propietario p ON p.propietario_id = v.propietario_id
            ORDER BY COALESCE(
                (SELECT MAX(o.fecha)
                 FROM public.ordentrabajo o
                 WHERE o.vehiculo_id = v.vehiculo_id),
                TIMESTAMP '1900-01-01'
            ) DESC, v.vehiculo_id DESC
            LIMIT 1
        `);

        if (!resultadoVehiculo.rows.length) {
            throw httpError(404, "TodavÃ­a no hay vehÃ­culos registrados.");
        }
    }

    const vehiculo = resultadoVehiculo.rows[0];
    const vehiculoId = vehiculo.vehiculo_id;

    const [ordenes, sintomas, diagnosticos, reparaciones, repuestos] = await Promise.all([
        pool.query(`
            SELECT orden_id, TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, estado, prioridad
            FROM public.ordentrabajo
            WHERE vehiculo_id = $1
            ORDER BY fecha DESC, orden_id DESC
        `, [vehiculoId]),
        pool.query(`
            SELECT orden_id, descripcion
            FROM public.sintoma
            WHERE orden_id IN (SELECT orden_id FROM public.ordentrabajo WHERE vehiculo_id = $1)
            ORDER BY sintoma_id
        `, [vehiculoId]),
        pool.query(`
            SELECT orden_id, descripcion, resultado
            FROM public.diagnostico
            WHERE orden_id IN (SELECT orden_id FROM public.ordentrabajo WHERE vehiculo_id = $1)
            ORDER BY diagnostico_id
        `, [vehiculoId]),
        pool.query(`
            SELECT reparacion_id, orden_id, descripcion, observaciones
            FROM public.reparacion
            WHERE orden_id IN (SELECT orden_id FROM public.ordentrabajo WHERE vehiculo_id = $1)
            ORDER BY reparacion_id
        `, [vehiculoId]),
        pool.query(`
            SELECT rp.reparacion_id, rp.nombre, rp.cantidad, rp.estado
            FROM public.repuesto rp
            JOIN public.reparacion r ON r.reparacion_id = rp.reparacion_id
            WHERE r.orden_id IN (SELECT orden_id FROM public.ordentrabajo WHERE vehiculo_id = $1)
            ORDER BY rp.repuesto_id
        `, [vehiculoId])
    ]);

    const repuestosPorReparacion = {};
    repuestos.rows.forEach(r => {
        if (!repuestosPorReparacion[r.reparacion_id]) {
            repuestosPorReparacion[r.reparacion_id] = [];
        }
        repuestosPorReparacion[r.reparacion_id].push({
            nombre: r.nombre,
            cantidad: r.cantidad,
            estado: r.estado
        });
    });

    const agrupar = (filas, mapa) => {
        const salida = {};
        filas.forEach(fila => {
            if (!salida[fila.orden_id]) salida[fila.orden_id] = [];
            salida[fila.orden_id].push(mapa(fila));
        });
        return salida;
    };

    const sintomasPor = agrupar(sintomas.rows, fila => fila.descripcion);
    const diagnosticosPor = agrupar(diagnosticos.rows, fila => ({
        descripcion: fila.descripcion,
        resultado: fila.resultado
    }));
    const reparacionesPor = agrupar(reparaciones.rows, fila => ({
        descripcion: fila.descripcion,
        observaciones: fila.observaciones,
        repuestos: repuestosPorReparacion[fila.reparacion_id] || []
    }));

    return res.json({
        vehiculo: {
            placa: vehiculo.placa,
            marcaModelo: [vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" "),
            anio: vehiculo.anio,
            kilometraje: vehiculo.kilometraje,
            propietario: nombreCompleto(vehiculo.nombres, vehiculo.apellidos)
        },
        ordenes: ordenes.rows.map(orden => ({
            id: orden.orden_id,
            fecha: orden.fecha,
            estado: normEstado(orden.estado) || "Pendiente",
            prioridad: normEstado(orden.prioridad) || "Normal",
            sintomas: sintomasPor[orden.orden_id] || [],
            diagnosticos: diagnosticosPor[orden.orden_id] || [],
            reparaciones: reparacionesPor[orden.orden_id] || []
        }))
    });
}));

/* ===================== PÃGINAS PROTEGIDAS ===================== */

app.get([
    "/",
    "/index.html",
    "/Orden.html",
    "/Mantenimiento.html",
    "/historial.html"
], requiereSesion, (req, res) => {
    const archivo = req.path === "/" ? "index.html" : req.path.substring(1);
    return res.sendFile(path.join(__dirname, "public", archivo));
});

app.get([
    "/Reportes.html",
    "/reportes",
    "/reportes.html"
], requiereReportes, (req, res) => {
    res.set("Cache-Control", "no-store");
    return res.sendFile(path.join(__dirname, "public", "Reportes.html"));
});

// Recursos estÃ¡ticos y pantallas de acceso pÃºblicas.
app.use(express.static(path.join(__dirname, "public"), { index: false }));

/* ===================== RUTAS NO ENCONTRADAS Y ERRORES ===================== */

app.use("/api", (req, res) => {
    return res.status(404).json({
        ok: false,
        mensaje: "La ruta solicitada no existe."
    });
});

app.use((error, req, res, next) => {
    console.error("Error general del servidor:", error);
    if (res.headersSent) return next(error);
    return res.status(500).json({
        ok: false,
        mensaje: "OcurriÃ³ un error interno del servidor."
    });
});

/* ===================== ARRANQUE ===================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log("Servidor iniciado en el puerto " + PORT);

    try {
        await preparar();
        console.log("Taller MecÃ¡nico J&D listo para recibir conexiones.");
    } catch (error) {
        console.error("No se pudo conectar con Neon PostgreSQL:", error.message);
    }
});
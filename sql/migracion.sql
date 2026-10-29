-- Cambios que necesita la web sobre la base creada con taller.sql.
-- server.js los aplica solo al arrancar; este script es la versión manual
-- (por si el usuario "usersql" no tiene permiso para ALTER TABLE).
-- Se puede ejecutar varias veces sin problema.

USE TallerMecanicoDB;
GO

-- Prioridad de la orden (Normal / Alta / Urgente)
IF COL_LENGTH('OrdenTrabajo', 'prioridad') IS NULL
    ALTER TABLE OrdenTrabajo ADD prioridad VARCHAR(20) NOT NULL
        CONSTRAINT DF_Orden_Prioridad DEFAULT 'Normal';
GO

-- Datos del mantenimiento preventivo
IF COL_LENGTH('Mantenimiento', 'tipo') IS NULL
    ALTER TABLE Mantenimiento ADD tipo VARCHAR(100) NULL;
IF COL_LENGTH('Mantenimiento', 'km_proximo') IS NULL
    ALTER TABLE Mantenimiento ADD km_proximo INT NULL;
IF COL_LENGTH('Mantenimiento', 'fecha_programada') IS NULL
    ALTER TABLE Mantenimiento ADD fecha_programada DATE NULL;
IF COL_LENGTH('Mantenimiento', 'estado') IS NULL
    ALTER TABLE Mantenimiento ADD estado VARCHAR(30) NOT NULL
        CONSTRAINT DF_Mant_Estado DEFAULT 'Programado';
GO

-- OrdenTrabajo.usuario_id es obligatorio: se necesita al menos un usuario
IF NOT EXISTS (SELECT 1 FROM Usuario)
    INSERT INTO Usuario (nombres, correo, contrasena, rol, estado)
    VALUES ('Mecanico', 'mecanico@jdtaller.com', 'sin-login', 'mecanico', 'activo');
GO

-- Permisos para el usuario de la aplicación (ejecutar como administrador si hace falta)
-- USE TallerMecanicoDB;
-- CREATE USER usersql FOR LOGIN usersql;
-- ALTER ROLE db_owner ADD MEMBER usersql;

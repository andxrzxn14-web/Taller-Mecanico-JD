-- OPCIONAL: datos de ejemplo (los mismos que mostraba el historial de demostración).
-- Ejecutar DESPUÉS de taller.sql y de arrancar el servidor una vez (o de migracion.sql).

USE TallerMecanicoDB;
GO

IF NOT EXISTS (SELECT 1 FROM Usuario)
    INSERT INTO Usuario (nombres, correo, contrasena, rol, estado)
    VALUES ('Mecanico', 'mecanico@jdtaller.com', 'sin-login', 'mecanico', 'activo');

DECLARE @uid INT = (SELECT TOP 1 usuario_id FROM Usuario ORDER BY usuario_id);
DECLARE @pid INT, @vid INT, @oid INT, @rid INT;

INSERT INTO Propietario (nombres, apellidos, documento)
VALUES ('Juan Carlos', 'Mendoza García', 'DEMO-0001');
SET @pid = SCOPE_IDENTITY();

INSERT INTO Vehiculo (propietario_id, placa, marca, modelo, anio, kilometraje)
VALUES (@pid, 'AQ-2024-HX', 'Toyota', 'Corolla', 2019, 87340);
SET @vid = SCOPE_IDENTITY();

-- 15 agosto 2026: frenos
INSERT INTO OrdenTrabajo (vehiculo_id, usuario_id, fecha, estado, prioridad)
VALUES (@vid, @uid, '2026-08-15', 'Completada', 'Normal');
SET @oid = SCOPE_IDENTITY();
INSERT INTO Sintoma (orden_id, descripcion) VALUES (@oid, 'Ruido al frenar, pedal suave');
INSERT INTO Diagnostico (orden_id, descripcion, resultado)
VALUES (@oid, 'Pastillas de freno gastadas, tambor ligeramente rayado', 'Reemplazadas pastillas y ajustado sistema');
INSERT INTO Reparacion (orden_id, descripcion, fecha, observaciones)
VALUES (@oid, 'Revisión de frenos y cambio de pastillas', '2026-08-15', NULL);
SET @rid = SCOPE_IDENTITY();
INSERT INTO Repuesto (reparacion_id, nombre, descripcion, cantidad, estado)
VALUES (@rid, 'Pastillas de freno', 'Juego delantero', 1, 'nuevo');

-- 2 agosto 2026: alineación y balanceo
INSERT INTO OrdenTrabajo (vehiculo_id, usuario_id, fecha, estado, prioridad)
VALUES (@vid, @uid, '2026-08-02', 'Completada', 'Normal');
SET @oid = SCOPE_IDENTITY();
INSERT INTO Sintoma (orden_id, descripcion)
VALUES (@oid, 'Vehículo se tuerce hacia la derecha, vibración en el volante');
INSERT INTO Diagnostico (orden_id, descripcion, resultado)
VALUES (@oid, 'Desalineación en el eje frontal. Llantas desgastadas desigualmente', 'Realizada alineación 4 puntos y balanceo');
INSERT INTO Reparacion (orden_id, descripcion, fecha, observaciones)
VALUES (@oid, 'Alineación y balanceo de llantas', '2026-08-02', NULL);

-- 20 julio 2026: aceite y filtro
INSERT INTO OrdenTrabajo (vehiculo_id, usuario_id, fecha, estado, prioridad)
VALUES (@vid, @uid, '2026-07-20', 'Completada', 'Normal');
SET @oid = SCOPE_IDENTITY();
INSERT INTO Sintoma (orden_id, descripcion) VALUES (@oid, 'Mantenimiento preventivo programado');
INSERT INTO Diagnostico (orden_id, descripcion, resultado)
VALUES (@oid, 'Aceite oscuro, filtro saturado', 'Cambio de aceite 5W-30 y filtro nuevo');
INSERT INTO Reparacion (orden_id, descripcion, fecha, observaciones)
VALUES (@oid, 'Cambio de aceite y filtro', '2026-07-20', 'Próximo cambio: 87,340 km');

-- 10 junio 2026: sistema eléctrico
INSERT INTO OrdenTrabajo (vehiculo_id, usuario_id, fecha, estado, prioridad)
VALUES (@vid, @uid, '2026-06-10', 'Completada', 'Alta');
SET @oid = SCOPE_IDENTITY();
INSERT INTO Sintoma (orden_id, descripcion) VALUES (@oid, 'Luces intermitentes, batería descargando rápido');
INSERT INTO Diagnostico (orden_id, descripcion, resultado)
VALUES (@oid, 'Batería débil (11.8V). Alternador funcionando correctamente', 'Batería reemplazada, limpiadas conexiones');
INSERT INTO Reparacion (orden_id, descripcion, fecha, observaciones)
VALUES (@oid, 'Reparación de sistema eléctrico', '2026-06-10', NULL);

-- 15 mayo 2026: revisión anual
INSERT INTO OrdenTrabajo (vehiculo_id, usuario_id, fecha, estado, prioridad)
VALUES (@vid, @uid, '2026-05-15', 'Completada', 'Normal');
SET @oid = SCOPE_IDENTITY();
INSERT INTO Sintoma (orden_id, descripcion) VALUES (@oid, 'Revisión preventiva anual');
INSERT INTO Diagnostico (orden_id, descripcion, resultado)
VALUES (@oid, 'Vehículo en buen estado general. Llantas con 60% de desgaste', 'Se recomendó cambio de aceite el próximo mes');
INSERT INTO Reparacion (orden_id, descripcion, fecha, observaciones)
VALUES (@oid, 'Revisión general anual', '2026-05-15', NULL);
GO

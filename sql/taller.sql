CREATE DATABASE TallerMecanicoDB;
 
USE TallerMecanicoDB;
 
CREATE TABLE Propietario (
    propietario_id INT IDENTITY(1,1) PRIMARY KEY,
    nombres         VARCHAR(100) NOT NULL,
    apellidos       VARCHAR(100) NOT NULL,
    documento       VARCHAR(20)  NOT NULL UNIQUE,
    telefono        VARCHAR(20),
    correo          VARCHAR(100)
);
 
CREATE TABLE Usuario (
    usuario_id  INT IDENTITY(1,1) PRIMARY KEY,
    nombres     VARCHAR(100) NOT NULL,
    correo      VARCHAR(100) NOT NULL UNIQUE,
    contrasena  VARCHAR(255) NOT NULL,
    rol         VARCHAR(30)  NOT NULL,  
    estado      VARCHAR(20)  NOT NULL 
);

CREATE TABLE Vehiculo (
    vehiculo_id     INT IDENTITY(1,1) PRIMARY KEY,
    propietario_id  INT NOT NULL,
    placa           VARCHAR(10) NOT NULL UNIQUE,
    marca           VARCHAR(50),
    modelo          VARCHAR(50),
    anio            INT,
    kilometraje     INT,
    CONSTRAINT FK_Vehiculo_Propietario
        FOREIGN KEY (propietario_id) REFERENCES Propietario(propietario_id)
);

CREATE TABLE OrdenTrabajo (
    orden_id    INT IDENTITY(1,1) PRIMARY KEY,
    vehiculo_id INT NOT NULL,
    usuario_id  INT NOT NULL,
    fecha       DATETIME NOT NULL DEFAULT GETDATE(),
    estado      VARCHAR(30) NOT NULL DEFAULT 'pendiente',
    CONSTRAINT FK_Orden_Vehiculo
        FOREIGN KEY (vehiculo_id) REFERENCES Vehiculo(vehiculo_id),
    CONSTRAINT FK_Orden_Usuario
        FOREIGN KEY (usuario_id) REFERENCES Usuario(usuario_id)
);

CREATE TABLE Sintoma (
    sintoma_id  INT IDENTITY(1,1) PRIMARY KEY,
    orden_id    INT NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    CONSTRAINT FK_Sintoma_Orden
        FOREIGN KEY (orden_id) REFERENCES OrdenTrabajo(orden_id)
);

CREATE TABLE Diagnostico (
    diagnostico_id INT IDENTITY(1,1) PRIMARY KEY,
    orden_id       INT NOT NULL,
    descripcion    VARCHAR(255),
    resultado      VARCHAR(255),
    CONSTRAINT FK_Diagnostico_Orden
        FOREIGN KEY (orden_id) REFERENCES OrdenTrabajo(orden_id)
);

CREATE TABLE Reparacion (
    reparacion_id INT IDENTITY(1,1) PRIMARY KEY,
    orden_id      INT NOT NULL,
    descripcion   VARCHAR(255),
    fecha         DATETIME NOT NULL DEFAULT GETDATE(),
    observaciones VARCHAR(255),
    CONSTRAINT FK_Reparacion_Orden
        FOREIGN KEY (orden_id) REFERENCES OrdenTrabajo(orden_id)
);

CREATE TABLE Repuesto (
    repuesto_id   INT IDENTITY(1,1) PRIMARY KEY,
    reparacion_id INT NOT NULL,
    nombre        VARCHAR(100) NOT NULL,
    descripcion   VARCHAR(255),
    cantidad      INT NOT NULL DEFAULT 1,
    estado        VARCHAR(30) DEFAULT 'usado',
    CONSTRAINT FK_Repuesto_Reparacion
        FOREIGN KEY (reparacion_id) REFERENCES Reparacion(reparacion_id)
);

CREATE TABLE Mantenimiento (
    mantenimiento_id INT IDENTITY(1,1) PRIMARY KEY,
    vehiculo_id      INT NOT NULL,
    fecha            DATETIME NOT NULL DEFAULT GETDATE(),
    kilometraje      INT,
    descripcion      VARCHAR(255),
    CONSTRAINT FK_Mantenimiento_Vehiculo
        FOREIGN KEY (vehiculo_id) REFERENCES Vehiculo(vehiculo_id)
);

CREATE TABLE Recomendacion (
    recomendacion_id INT IDENTITY(1,1) PRIMARY KEY,
    vehiculo_id      INT NOT NULL,
    tipo             VARCHAR(50),
    descripcion      VARCHAR(255),
    fecha            DATETIME NOT NULL DEFAULT GETDATE(),
    estado           VARCHAR(30) DEFAULT 'pendiente',
    CONSTRAINT FK_Recomendacion_Vehiculo
        FOREIGN KEY (vehiculo_id) REFERENCES Vehiculo(vehiculo_id)
);
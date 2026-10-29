
const bcrypt = require("bcryptjs");
const readline = require("readline");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function preguntar(texto) {
    return new Promise(resolve => {
        rl.question(texto, resolve);
    });
}

function preguntarClaveOculta(texto) {
    return new Promise((resolve, reject) => {
        const stdin = process.stdin;
        let clave = "";

        if (typeof stdin.setRawMode !== "function") {
            reject(
                new Error(
                    "Abre una terminal interactiva de PowerShell."
                )
            );
            return;
        }

        process.stdout.write(texto);
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding("utf8");

        function restaurar() {
            stdin.removeListener("data", recibir);
            stdin.setRawMode(false);
            stdin.pause();
        }

        function recibir(tecla) {
            for (const caracter of tecla) {
                if (caracter === "\u0003") {
                    restaurar();
                    process.stdout.write("\n");
                    reject(new Error("Operación cancelada."));
                    return;
                }

                if (
                    caracter === "\r" ||
                    caracter === "\n"
                ) {
                    restaurar();
                    process.stdout.write("\n");
                    resolve(clave);
                    return;
                }

                if (
                    caracter === "\u007f" ||
                    caracter === "\b"
                ) {
                    clave = clave.slice(0, -1);
                    process.stdout.write("\b \b");
                } else {
                    clave += caracter;
                    process.stdout.write("*");
                }
            }
        }

        stdin.on("data", recibir);
    });
}

async function main() {
    try {
        const dni = (
            await preguntar("DNI del trabajador (8 dígitos): ")
        ).trim();

        if (!/^\d{8}$/.test(dni)) {
            throw new Error("El DNI debe tener 8 dígitos.");
        }

        rl.close();

        const clave = await preguntarClaveOculta(
            "Nueva contraseña (mínimo 10 caracteres): "
        );

        if (clave.length < 10) {
            throw new Error(
                "La contraseña debe tener al menos 10 caracteres."
            );
        }

        const hash = await bcrypt.hash(clave, 12);

        console.log("\nHash generado correctamente.");
        console.log("DNI:", dni);
        console.log("HASH:", hash);

        console.log(
            "\nCopia el hash para guardarlo en SQL Server. " +
            "No compartas tu contraseña."
        );
    } catch (error) {
        console.error("\nError:", error.message);
        process.exitCode = 1;
    } finally {
        if (!rl.closed) {
            rl.close();
        }
    }
}

main();

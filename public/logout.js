
/* ===== CERRAR SESIÓN GLOBAL J&D ===== */

(function () {
    'use strict';

    // Evitar duplicar el botón en la misma página
    if (document.getElementById('btnCerrarSesionGlobal')) {
        return;
    }

    const boton = document.createElement('button');

    boton.type = 'button';
    boton.id = 'btnCerrarSesionGlobal';
    boton.className = 'btn-cerrar-sesion-global';
    boton.setAttribute('aria-label', 'Cerrar sesión');

    boton.innerHTML = `
        <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path d="M10 17l5-5-5-5"/>
            <path d="M15 12H3"/>
            <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>
        </svg>
        <span>Cerrar sesión</span>
    `;

    document.body.appendChild(boton);

    boton.addEventListener('click', async function () {
        const confirmar = window.confirm(
            '¿Deseas cerrar tu sesión del Taller Mecánico J&D?'
        );

        if (!confirmar) {
            return;
        }

        boton.disabled = true;
        boton.querySelector('span').textContent = 'Cerrando sesión...';

        try {
            const respuesta = await fetch('/api/logout', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({}),
                cache: 'no-store'
            });

            // Si la sesión ya expiró, volver igualmente al acceso.
            if (respuesta.status === 401) {
                window.location.replace('/acceso.html');
                return;
            }

            const datos = await respuesta.json().catch(() => ({}));

            if (!respuesta.ok || datos.ok !== true) {
                throw new Error(
                    datos.mensaje || 'No se pudo cerrar la sesión.'
                );
            }

            // Reemplazar la página actual evita volver a ella
            // mediante el botón Atrás del navegador.
            window.location.replace('/acceso.html');

        } catch (error) {
            console.error('Error al cerrar sesión:', error);

            alert(
                error.message ||
                'No se pudo conectar con el servidor.'
            );

            boton.disabled = false;
            boton.querySelector('span').textContent = 'Cerrar sesión';
        }
    });
})();

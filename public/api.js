/* Utilidades compartidas por todas las páginas para hablar con el servidor */
async function api(url, options) {
  const opts = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {});
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new Error('No se pudo contactar con el servidor. ¿Está corriendo "node server.js"?');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* respuesta sin cuerpo */ }
  if (!res.ok) throw new Error((data && data.error) || ('Error ' + res.status));
  return data;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

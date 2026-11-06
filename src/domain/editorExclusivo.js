// SPC-001 Fase 2: exclusividad de edición entre pestañas de escritorio.
// Las Web Locks son del origen y perfil del navegador. No sustituyen la
// idempotencia de base de datos para otros equipos.
export function reservarEditorExclusivo(lockManager, legajo, maquina, requestId) {
  if (!legajo || !maquina || !requestId) {
    throw new Error('No se puede reservar un editor sin identidad y solicitud.');
  }
  let cerrado = false;
  let liberar = null;
  let contestado = false;
  let resolverListo;
  const listo = new Promise(resolve => { resolverListo = resolve; });
  const informar = permiso => {
    if (!contestado) { contestado = true; resolverListo(permiso); }
  };
  const soltar = () => {
    cerrado = true;
    if (liberar) liberar();
    // Si se desmontó antes del callback, no habilitar un editor obsoleto.
    informar(false);
  };
  if (!lockManager || typeof lockManager.request !== 'function') {
    informar(false);
    return { listo, soltar };
  }
  const nombre = ['spc-001-editor', legajo, maquina, requestId]
    .map(encodeURIComponent).join(':');
  Promise.resolve().then(() =>
    lockManager.request(nombre, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock || cerrado) { informar(false); return; }
      informar(true);
      await new Promise(resolve => {
        liberar = resolve;
        if (cerrado) resolve();
      });
    })
  ).catch(() => informar(false));
  return { listo, soltar };
}

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

// Reserva por máquina, no por UUID: impide que otra pestaña inicie, migre,
// expire o reconcilie una solicitud mientras el primer puesto está operando.
// No usa ifAvailable:false: una pestaña secundaria nunca queda esperando y
// escribiendo a destiempo. Se libera al desmontar o cambiar de máquina.
export function reservarPuestoMaquina(lockManager, maquina) {
  if (!maquina || typeof maquina !== 'string') {
    throw new Error('Máquina requerida para reservar el puesto.');
  }
  let cerrado = false;
  let liberar;
  let resuelto = false;
  let resolver;
  const listo = new Promise(resolve => { resolver = resolve; });
  const resolverUnaVez = ok => {
    if (!resuelto) { resuelto = true; resolver(ok); }
  };
  const soltar = () => {
    cerrado = true;
    if (liberar) liberar();
    resolverUnaVez(false);
  };
  if (!lockManager || typeof lockManager.request !== 'function') {
    resolverUnaVez(false);
    return { listo, soltar };
  }
  const nombre = 'spc-001-puesto-maquina:' + encodeURIComponent(maquina);
  Promise.resolve().then(() =>
    lockManager.request(nombre, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock || cerrado) { resolverUnaVez(false); return; }
      resolverUnaVez(true);
      await new Promise(resolve => {
        liberar = resolve;
        if (cerrado) resolve();
      });
    })
  ).catch(() => resolverUnaVez(false));
  return { listo, soltar };
}

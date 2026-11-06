// SPC-001 Fase 4 — un puesto compartido no debe mostrar datos de otro usuario.
// No se borra ninguna prueba, señal, borrador ni intento al cerrar sesión.
export function verificarSesionLocal({ storage, claveUsuario, authUser }) {
  if (!authUser?.id) return { ok: false, motivo: 'SIN_AUTH' };
  let raw;
  try { raw = storage.getItem(claveUsuario); }
  catch { return { ok: false, motivo: 'STORAGE_INACCESIBLE' }; }
  if (raw === null) return { ok: false, motivo: 'SIN_PERFIL_LOCAL' };
  try {
    const x = JSON.parse(raw);
    if (!x || typeof x !== 'object' || Array.isArray(x) ||
        !x.legajo || !x.authUserId || x.authUserId !== authUser.id) {
      return { ok: false, motivo: 'IDENTIDAD_NO_COINCIDE' };
    }
    return { ok: true, usuario: x };
  } catch { return { ok: false, motivo: 'PERFIL_CORRUPTO' }; }
}

// Solo se usa para informar sobre evidencia pendiente, nunca para eliminarla.
export function inventariarEvidenciaLocal(storage, legajo) {
  const prefijos = ['senal_plc_', 'spc_borrador_v1_', 'spc_intento_v1_'];
  if (!legajo || !storage) return { estado: 'INCIERTO', total: null };
  try {
    let total = 0;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (typeof key === 'string' && prefijos.some(p => key.startsWith(p + legajo + '_'))) total++;
    }
    return { estado: 'OK', total };
  } catch { return { estado: 'INCIERTO', total: null }; }
}

export function limpiarPerfilLocal(storage, claveUsuario) {
  try { storage.removeItem(claveUsuario); return true; }
  catch { return false; }
}

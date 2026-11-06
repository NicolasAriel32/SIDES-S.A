// Mantiene la clave histórica generada por Supabase JS para no dejar
// tokens huérfanos al introducir la limpieza explícita en un puesto Windows.
export function claveSesionAuthPorUrl(url) {
  try {
    const host = new URL(url).hostname.split('.')[0];
    return host ? `sb-${host}-auth-token` : null;
  } catch { return null; }
}

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

// Contrato servidor↔Auth. El legajo NO es suficiente para seleccionar un
// perfil: supervisor/admin puede consultar otros legajos por RLS.
export function verificarPerfilAutenticado({ perfil, authUser, legajoSolicitado = null }) {
  if (!authUser?.id || typeof authUser.id !== 'string') {
    return { ok: false, motivo: 'SIN_AUTH' };
  }
  if (!perfil || typeof perfil !== 'object' || Array.isArray(perfil) ||
      typeof perfil.id !== 'string' || perfil.id !== authUser.id ||
      typeof perfil.legajo !== 'string' || !perfil.legajo.trim()) {
    return { ok: false, motivo: 'PERFIL_NO_COINCIDE_CON_AUTH' };
  }
  if (legajoSolicitado !== null && perfil.legajo !== legajoSolicitado) {
    return { ok: false, motivo: 'LEGAJO_NO_COINCIDE' };
  }
  if (perfil.activo !== true) {
    return { ok: false, motivo: 'PERFIL_INACTIVO' };
  }
  if (!['operario', 'supervisor', 'admin', 'inspector', 'auditor'].includes(perfil.rol)) {
    return { ok: false, motivo: 'ROL_INVALIDO' };
  }
  return { ok: true, motivo: null, perfil };
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

// La evidencia en localStorage NO está cifrada. Impedir el uso rutinario de
// un mismo perfil de navegador por dos legajos reduce exposición accidental,
// sin afirmar privacidad frente a DevTools o acceso al perfil Windows.
export function comprobarPerfilCompartido(storage, legajo) {
  if (!storage || typeof legajo !== 'string' || !legajo.trim()) {
    return { ok: false, motivo: 'IDENTIDAD_INVALIDA' };
  }
  const prefijos = ['senal_plc_', 'spc_borrador_v1_', 'spc_intento_v1_'];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (typeof key !== 'string') continue;
      if (prefijos.some(p => key.startsWith(p) && !key.startsWith(p + legajo + '_'))) {
        return { ok: false, motivo: 'EVIDENCIA_DE_OTRO_LEGAJO' };
      }
    }
    return { ok: true, motivo: null };
  } catch {
    return { ok: false, motivo: 'STORAGE_INACCESIBLE' };
  }
}

// SPC-001 Fase 4: servicio autenticado inyectable y testeable sin navegador.
// Solo el servidor Supabase define UID, rol, legajo y estado activo.
import {
  verificarSesionLocal, verificarPerfilAutenticado, limpiarPerfilLocal, comprobarPerfilCompartido,
} from '../domain/seguridadPuesto.js';

export function borrarTokenAuthLocal(storage, authKey) {
  if (!authKey || !storage) return false;
  try { storage.removeItem(authKey); return true; }
  catch { return false; }
}

async function perfilVigente(supabase, authUser, legajo, mapUser) {
  const { data, error } = await supabase.from('usuarios').select('*')
    .eq('id', authUser.id).eq('legajo', legajo).maybeSingle();
  if (error) throw error;
  const v = verificarPerfilAutenticado({
    perfil: data, authUser, legajoSolicitado: legajo,
  });
  if (!v.ok) throw new Error(v.motivo);
  return { ...mapUser(data), authUserId: authUser.id };
}

export async function iniciarSesionPuesto({ supabase, storage, evidenciaStorage, key, authKey, mapUser, legajo, password }) {
  const solicitado = String(legajo || '').trim();
  if (!solicitado || !password) return null;
  let authData;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: `${solicitado}@sides.internal`, password,
    });
    if (error || !data?.user?.id) {
      limpiarPerfilLocal(storage, key);
      borrarTokenAuthLocal(storage, authKey);
      return null;
    }
    authData = data;
  } catch {
    limpiarPerfilLocal(storage, key);
    borrarTokenAuthLocal(storage, authKey);
    return null;
  }

  try {
    const user = await perfilVigente(supabase, authData.user, solicitado, mapUser);
    const aislamiento = comprobarPerfilCompartido(evidenciaStorage, user.legajo);
    if (!aislamiento.ok) throw new Error(aislamiento.motivo);
    storage.setItem(key, JSON.stringify(user));
    return user;
  } catch {
    try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* fail closed */ }
    limpiarPerfilLocal(storage, key);
    borrarTokenAuthLocal(storage, authKey);
    return null;
  }
}

export async function restaurarSesionPuesto({ supabase, storage, evidenciaStorage, key, authKey, mapUser }) {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user?.id) throw new Error('AUTH_NO_VERIFICABLE');
    const local = verificarSesionLocal({
      storage, claveUsuario: key, authUser: data.user,
    });
    if (!local.ok) throw new Error(local.motivo);
    const user = await perfilVigente(supabase, data.user, local.usuario.legajo, mapUser);
    const aislamiento = comprobarPerfilCompartido(evidenciaStorage, user.legajo);
    if (!aislamiento.ok) throw new Error(aislamiento.motivo);
    storage.setItem(key, JSON.stringify(user));
    return user;
  } catch {
    limpiarPerfilLocal(storage, key);
    borrarTokenAuthLocal(storage, authKey);
    return null;
  }
}

export async function cambiarPasswordPuesto({ supabase, storage, evidenciaStorage, key, authKey, mapUser, legajo, newPass }) {
  const current = await restaurarSesionPuesto({ supabase, storage, evidenciaStorage, key, authKey, mapUser });
  if (!current?.authUserId || current.legajo !== legajo || !newPass) return null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || data?.user?.id !== current.authUserId) return null;
    const { error: passwordError } = await supabase.auth.updateUser({ password: newPass });
    if (passwordError) return null;
    // Auth y el perfil no son una transacción distribuida.
    const { error: metadataError } = await supabase.rpc('marcar_password_cambiada');
    if (metadataError) return null;
    const updated = await perfilVigente(supabase, data.user, current.legajo, mapUser);
    storage.setItem(key, JSON.stringify(updated));
    return updated;
  } catch { return null; }
}

export async function cerrarSesionPuesto({ supabase, storage, key, authKey }) {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
  } finally {
    // Si Auth falló sin conexión, no dejar reutilizable el token persistido.
    // Esto NO equivale a revocar un access token ya emitido en Supabase.
    borrarTokenAuthLocal(storage, authKey);
    limpiarPerfilLocal(storage, key);
  }
}

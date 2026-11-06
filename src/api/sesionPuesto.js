// SPC-001 Fase 4: servicio autenticado inyectable y testeable sin navegador.
// Solo el servidor Supabase define UID, rol, legajo y estado activo.
import {
  verificarSesionLocal, verificarPerfilAutenticado, limpiarPerfilLocal,
} from '../domain/seguridadPuesto.js';

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

export async function iniciarSesionPuesto({ supabase, storage, key, mapUser, legajo, password }) {
  const solicitado = String(legajo || '').trim();
  if (!solicitado || !password) return null;
  let authData;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: `${solicitado}@sides.internal`, password,
    });
    if (error || !data?.user?.id) return null;
    authData = data;
  } catch { return null; }

  try {
    const user = await perfilVigente(supabase, authData.user, solicitado, mapUser);
    storage.setItem(key, JSON.stringify(user));
    return user;
  } catch {
    try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* fail closed */ }
    limpiarPerfilLocal(storage, key);
    return null;
  }
}

export async function restaurarSesionPuesto({ supabase, storage, key, mapUser }) {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user?.id) throw new Error('AUTH_NO_VERIFICABLE');
    const local = verificarSesionLocal({
      storage, claveUsuario: key, authUser: data.user,
    });
    if (!local.ok) throw new Error(local.motivo);
    const user = await perfilVigente(supabase, data.user, local.usuario.legajo, mapUser);
    storage.setItem(key, JSON.stringify(user));
    return user;
  } catch {
    limpiarPerfilLocal(storage, key);
    return null;
  }
}

export async function cambiarPasswordPuesto({ supabase, storage, key, mapUser, legajo, newPass }) {
  const current = await restaurarSesionPuesto({ supabase, storage, key, mapUser });
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

export async function cerrarSesionPuesto({ supabase, storage, key }) {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
  } finally {
    // Solo perfil UI; señales, intentos y borradores pertenecen a otro storage.
    limpiarPerfilLocal(storage, key);
  }
}

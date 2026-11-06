// SPC-001 Fase 2: control local de señales manuales, sin datos OT ni escritura remota.
// Una señal sin timestamp válido no se debe convertir automáticamente en PENDIENTE.
export const LIMITE_PENDIENTE_MS = 60 * 60 * 1000;

export function evaluarSenalManual(senal, maquinaId, ahoraMs = Date.now()) {
  if (!senal || typeof senal !== 'object' || Array.isArray(senal)) {
    return { estado: 'AUSENTE', motivo: null };
  }
  if (!maquinaId || senal.maquina !== maquinaId) {
    return { estado: 'INVALIDA', motivo: 'La señal guardada corresponde a otra máquina.' };
  }
  const inicio = typeof senal.fechaSenal === 'string' ? Date.parse(senal.fechaSenal) : NaN;
  if (!Number.isFinite(inicio) || !Number.isFinite(ahoraMs)) {
    return { estado: 'INVALIDA', motivo: 'La señal guardada no tiene una fecha válida.' };
  }
  const edadMs = ahoraMs - inicio;
  if (edadMs < -5 * 60 * 1000) {
    return { estado: 'INVALIDA', motivo: 'La señal tiene una fecha futura inconsistente.' };
  }
  if (edadMs >= LIMITE_PENDIENTE_MS) {
    return { estado: 'VENCIDA', edadMs: Math.max(0, edadMs), motivo: null };
  }
  return { estado: 'ACTIVA', edadMs: Math.max(0, edadMs), motivo: null };
}

export function crearAlmacenSenales(storage, legajo) {
  if (!storage || !legajo || typeof legajo !== 'string') {
    throw new Error('Se requiere almacenamiento y legajo para aislar las señales.');
  }
  const clave = (maquina) => 'senal_plc_' + legajo + '_' + maquina;
  return {
    leer(maquina) {
      try {
        const texto = storage.getItem(clave(maquina));
        if (!texto) return { senal: null, error: null };
        const senal = JSON.parse(texto);
        if (!senal || typeof senal !== 'object' || Array.isArray(senal)) {
          return { senal: null, error: 'La señal local no es un objeto válido.' };
        }
        return { senal, error: null };
      } catch {
        return { senal: null, error: 'No se pudo leer la señal local; no se borró.' };
      }
    },
    guardar(maquina, senal) {
      if (senal?.maquina !== maquina) return { ok: false, error: 'Máquina incorrecta.' };
      try {
        // Nunca sobrescribir un inicio no confirmado, ni siquiera uno malformado.
        if (storage.getItem(clave(maquina)) !== null) {
          return { ok: false, error: 'Ya existe una señal local. Recuperala antes de iniciar otra.' };
        }
        storage.setItem(clave(maquina), JSON.stringify(senal));
        return { ok: true, error: null };
      } catch {
        return { ok: false, error: 'No se pudo conservar la señal en este dispositivo.' };
      }
    },
    actualizarSiCoincide(maquina, senal, requestIdAnterior = null) {
      try {
        const texto = storage.getItem(clave(maquina));
        if (!texto) return { ok: false, error: 'La señal ya no existe.' };
        const actual = JSON.parse(texto);
        if (requestIdAnterior !== null && actual?.requestId !== requestIdAnterior) {
          return { ok: false, error: 'La señal fue reemplazada; no se modificó.' };
        }
        if (actual?.maquina !== maquina || senal?.maquina !== maquina) {
          return { ok: false, error: 'Máquina incorrecta.' };
        }
        storage.setItem(clave(maquina), JSON.stringify(senal));
        return { ok: true, error: null };
      } catch {
        return { ok: false, error: 'No se pudo actualizar la señal.' };
      }
    },
    eliminarSiCoincide(maquina, requestId) {
      if (!requestId) return false;
      try {
        const texto = storage.getItem(clave(maquina));
        if (!texto) return false;
        const actual = JSON.parse(texto);
        if (actual?.requestId !== requestId || actual?.maquina !== maquina) return false;
        storage.removeItem(clave(maquina));
        return true;
      } catch {
        return false;
      }
    },
  };
}

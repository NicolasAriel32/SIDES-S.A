// Fase 2: borrador por identidad, máquina y solicitud. Nunca reenvía automáticamente.
export function crearAlmacenBorradores(storage, legajo) {
  if (!legajo || !storage) throw new Error('Almacenamiento e identidad requeridos.');
  const clave = (maquina) => 'spc_borrador_v1_' + legajo + '_' + maquina;
  return {
    // Permite recuperar un borrador huérfano sin inventar un UUID. No lo borra.
    inspeccionar(maquina) {
      try {
        const raw = storage.getItem(clave(maquina));
        if (raw === null) return { borrador: null, requestId: null, error: null };
        const x = JSON.parse(raw);
        if (x?.version !== 1 || x?.maquina !== maquina ||
            typeof x?.requestId !== 'string' || !x.requestId ||
            !x.campos || typeof x.campos !== 'object' || Array.isArray(x.campos)) {
          return { borrador: null, requestId: null, error: 'El borrador local no tiene formato válido. Conservá los datos.' };
        }
        return { borrador: x.campos, requestId: x.requestId, error: null };
      } catch {
        return { borrador: null, requestId: null, error: 'El borrador local es ilegible. No se eliminó.' };
      }
    },
    leer(maquina, requestId) {
      try {
        const raw = storage.getItem(clave(maquina));
        if (!raw) return { borrador: null, error: null };
        const x = JSON.parse(raw);
        if (x?.version !== 1 || x?.maquina !== maquina || x?.requestId !== requestId) {
          return { borrador: null, error: 'Existe un borrador de otra solicitud; no se modificó.' };
        }
        if (!x.campos || typeof x.campos !== 'object' || Array.isArray(x.campos)) {
          return { borrador: null, error: 'El borrador local no tiene formato válido.' };
        }
        return { borrador: x.campos, error: null };
      } catch {
        return { borrador: null, error: 'No se pudo recuperar el borrador local.' };
      }
    },
    guardar(maquina, requestId, campos) {
      if (!maquina || !requestId || !campos || typeof campos !== 'object') return false;
      try {
        const actual = storage.getItem(clave(maquina));
        if (actual) {
          const previo = JSON.parse(actual);
          if (previo?.requestId !== requestId || previo?.maquina !== maquina) return false;
        }
        storage.setItem(clave(maquina), JSON.stringify({ version: 1, maquina, requestId, campos }));
        return true;
      } catch { return false; }
    },
    borrarConfirmado(maquina, requestId) {
      try {
        const raw = storage.getItem(clave(maquina));
        if (!raw) return true;
        const x = JSON.parse(raw);
        if (x?.requestId !== requestId || x?.maquina !== maquina) return false;
        storage.removeItem(clave(maquina));
        return true;
      } catch { return false; }
    },
  };
}
export function borradorTieneCarga(x) {
  if (!x) return false;
  return x.tuvoFalla !== null && x.tuvoFalla !== undefined ||
    Boolean(x.caja || x.lote || x.codigoProducto || x.obs ||
      (x.tiposSeleccionados || []).length || Number(x.cabezalesFalla) > 0);
}

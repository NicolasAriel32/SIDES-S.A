// SPC-001 — intento de envío durable y estable por UUID.
// Se guarda antes de invocar la RPC, para que un ACK perdido no permita
// enviar contenido distinto con el mismo request_id.
const mismaCarga = (a,b) => JSON.stringify(a) === JSON.stringify(b);

export function crearAlmacenIntentos(storage, legajo) {
  if (!storage || !legajo) throw new Error('Identidad y almacenamiento requeridos.');
  const clave = maquina => 'spc_intento_v1_' + legajo + '_' + maquina;
  return {
    preparar(maquina, requestId, payload) {
      if (!maquina || !requestId || payload?.request_id !== requestId ||
          payload?.id_maquina !== maquina) {
        throw new Error('Identidad del intento inconsistente.');
      }
      let original;
      try {
        const raw = storage.getItem(clave(maquina));
        original = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error('No se puede leer el intento anterior; no se enviaron datos.');
      }
      if (original !== null) {
        if (original?.version !== 1 || original?.maquina !== maquina ||
            original?.requestId !== requestId || !original.payload) {
          throw new Error('Existe un envío previo diferente o corrupto. No sobrescribas esta señal.');
        }
        if (!mismaCarga(original.payload, payload)) {
          throw new Error('Ya se intentó guardar este UUID con otros valores. Recuperá el formulario original antes de reenviar.');
        }
        return { payload: original.payload, yaExistia: true };
      }
      try {
        storage.setItem(clave(maquina), JSON.stringify({
          version: 1, maquina, requestId, payload,
        }));
        const actual = JSON.parse(storage.getItem(clave(maquina)) || 'null');
        if (actual?.requestId !== requestId || !mismaCarga(actual.payload, payload)) {
          throw new Error('Escritura no verificada');
        }
      } catch {
        throw new Error('No se pudo conservar el intento de envío. No se enviaron datos.');
      }
      return { payload, yaExistia: false };
    },
    leer(maquina) {
      try {
        const raw = storage.getItem(clave(maquina));
        return raw ? JSON.parse(raw) : null;
      } catch {
        return { version: -1, error: 'Registro de intento ilegible' };
      }
    },
    borrarConfirmado(maquina, requestId) {
      try {
        const raw = storage.getItem(clave(maquina));
        if (!raw) return true;
        const previo = JSON.parse(raw);
        if (previo?.requestId !== requestId || previo?.maquina !== maquina) return false;
        storage.removeItem(clave(maquina));
        return true;
      } catch {
        return false;
      }
    },
  };
}

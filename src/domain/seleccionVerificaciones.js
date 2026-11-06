// Muestreo aleatorio SIN reposición de registros del turno anterior.
// No altera el número de verificaciones definido por el flujo existente.
// Seguridad: esta selección sigue siendo del cliente y NO es una adjudicación
// atómica ni a prueba de manipulación. La habilitación industrial requiere RPC.
export function seleccionarVerificacionesAleatorias(registros, cantidad, aleatorio = Math.random) {
  if (!Array.isArray(registros) || !Number.isInteger(cantidad) || cantidad < 0
      || typeof aleatorio !== 'function') {
    throw new TypeError('Parámetros inválidos para selección aleatoria.');
  }
  // Se conserva la lista original intacta. Fisher-Yates parcial evita
  // el sesgo de Array.sort(() => Math.random() - 0.5).
  const bolsa = [...registros];
  const objetivo = Math.min(cantidad, bolsa.length);
  for (let i = 0; i < objetivo; i += 1) {
    const valor = aleatorio();
    if (typeof valor !== 'number' || !Number.isFinite(valor)
        || valor < 0 || valor >= 1) {
      throw new TypeError('Generador aleatorio inválido.');
    }
    const j = i + Math.floor(valor * (bolsa.length - i));
    [bolsa[i], bolsa[j]] = [bolsa[j], bolsa[i]];
  }
  return bolsa.slice(0, objetivo);
}

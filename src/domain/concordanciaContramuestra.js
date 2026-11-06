// SIDES · Concordancia físico-documental de contramuestras.
// NO se repite el ensayo de estanqueidad, ni se altera el resultado original.
import { CABEZALES_POR_MUESTRA } from './estanqueidad.js';

export const RESULTADOS_CONTRAMUESTRA = Object.freeze({
  OK: 'OK', DISCREPANCIA: 'DISCREPANCIA',
});

const enteroNoNegativo = x => typeof x === 'number' &&
  Number.isSafeInteger(x) && x >= 0 && x <= 2147483647;
const texto = x => typeof x === 'string' && x.trim().length > 0;

/**
 * Una fuente incompleta o un formulario contradictorio bloquean el guardado.
 * Diferencias FÍSICAS registradas de forma consistente son DISCREPANCIA.
 * El servidor debe repetir todos estos chequeos con la prueba leída de DB.
 */
export function evaluarConcordanciaContramuestra(prueba, hallazgo) {
  const razones = [];
  const add = codigo => { if (!razones.includes(codigo)) razones.push(codigo); };

  if (!prueba || typeof prueba !== 'object' || !hallazgo ||
      typeof hallazgo !== 'object') {
    return { listo: false, resultado: null, razones: ['DATOS_INCOMPLETOS'] };
  }

  const esperados = prueba.cabezalesDefectuosos;
  if (!texto(prueba.caja) || !texto(prueba.lote)) add('REFERENCIAS_DIGITALES_INCOMPLETAS');
  if (!['OK', 'RECHAZADO'].includes(prueba.resultado) ||
      prueba.anulada === true ||
      ['ANULADA', 'ANULADO', 'PENDIENTE', 'CANCELADA'].includes(prueba.estadoFinal)) {
    add('PRUEBA_NO_EVALUABLE');
  }
  if (!enteroNoNegativo(esperados) || esperados > CABEZALES_POR_MUESTRA ||
      (prueba.resultado === 'OK' && esperados !== 0) ||
      (prueba.resultado === 'RECHAZADO' && esperados < 1)) {
    add('DEFECTUOSOS_DIGITALES_INVALIDOS');
  }

  const total = hallazgo.cantidadEncontrada;
  const defectuosos = hallazgo.defectuososEncontrados;
  if (!enteroNoNegativo(total)) add('CANTIDAD_FISICA_INVALIDA');
  if (!enteroNoNegativo(defectuosos) ||
      (enteroNoNegativo(total) && defectuosos > total)) {
    add('DEFECTUOSOS_FISICOS_INVALIDOS');
  }
  if (!['si_todas', 'parcial', 'no'].includes(hallazgo.muestrasPresentes)) {
    add('PRESENCIA_SIN_RESPONDER');
  } else if (enteroNoNegativo(total) && (
    (hallazgo.muestrasPresentes === 'no' && total !== 0) ||
    (hallazgo.muestrasPresentes === 'parcial' && (total === 0 || total >= CABEZALES_POR_MUESTRA)) ||
    (hallazgo.muestrasPresentes === 'si_todas' && total < CABEZALES_POR_MUESTRA)
  )) {
    add('PRESENCIA_Y_CANTIDAD_CONTRADICTORIAS');
  }
  if (typeof hallazgo.coincideEtiquetaLote !== 'boolean' ||
      typeof hallazgo.coincideCaja !== 'boolean') {
    add('IDENTIFICACION_SIN_RESPONDER');
  }

  if (razones.length > 0) {
    return { listo: false, resultado: null, razones };
  }

  const sinDefectosFisicos = total - defectuosos;
  const sinDefectosDigitales = CABEZALES_POR_MUESTRA - esperados;
  const coinciden = total === CABEZALES_POR_MUESTRA &&
    defectuosos === esperados &&
    sinDefectosFisicos === sinDefectosDigitales &&
    hallazgo.muestrasPresentes === 'si_todas' &&
    hallazgo.coincideCaja === true &&
    hallazgo.coincideEtiquetaLote === true;

  return {
    listo: true,
    resultado: coinciden ? RESULTADOS_CONTRAMUESTRA.OK : RESULTADOS_CONTRAMUESTRA.DISCREPANCIA,
    razones: [],
    esperado: {
      total: CABEZALES_POR_MUESTRA,
      defectuosos: esperados,
      sinDefectos: sinDefectosDigitales,
    },
    encontrado: {
      total, defectuosos, sinDefectos: sinDefectosFisicos,
    },
  };
}

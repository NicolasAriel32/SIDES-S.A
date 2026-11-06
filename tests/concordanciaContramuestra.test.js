import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluarConcordanciaContramuestra as evaluar } from '../src/domain/concordanciaContramuestra.js';

const prueba = (v={}) => ({
  caja: 'CAJA-100', lote: 'LOTE-A', resultado: 'RECHAZADO',
  cabezalesDefectuosos: 3, anulada: false, estadoFinal: 'PENDIENTE_APROBACION', ...v,
});
const fisico = (v={}) => ({
  muestrasPresentes: 'si_todas', cantidadEncontrada: 20,
  defectuososEncontrados: 3, coincideEtiquetaLote: true,
  coincideCaja: true, ...v,
});

test('20 con tres defectuosos y 17 sin defectos: concordancia OK', () => {
  const x = evaluar(prueba(), fisico());
  assert.equal(x.listo, true);
  assert.equal(x.resultado, 'OK');
  assert.deepEqual(x.esperado, { total: 20, defectuosos: 3, sinDefectos: 17 });
  assert.deepEqual(x.encontrado, { total: 20, defectuosos: 3, sinDefectos: 17 });
});

test('20 sin defectos para prueba OK: concordancia OK', () => {
  const x = evaluar(prueba({ resultado: 'OK', cabezalesDefectuosos: 0 }),
    fisico({ defectuososEncontrados: 0 }));
  assert.equal(x.resultado, 'OK');
});

test('20 encontrados con 2 defectuosos frente a 3 registrados: DISCREPANCIA', () => {
  const x = evaluar(prueba(), fisico({ defectuososEncontrados: 2 }));
  assert.equal(x.listo, true);
  assert.equal(x.resultado, 'DISCREPANCIA');
});

test('21 encontrados: DISCREPANCIA, no falso OK', () => {
  assert.equal(evaluar(prueba(), fisico({ cantidadEncontrada: 21 })).resultado, 'DISCREPANCIA');
});

test('19 encontrados: DISCREPANCIA con presencia parcial', () => {
  const x = evaluar(prueba(), fisico({ muestrasPresentes: 'parcial', cantidadEncontrada: 19 }));
  assert.equal(x.resultado, 'DISCREPANCIA');
});

test('contramuestra ausente: DISCREPANCIA, 0 encontrados', () => {
  const x = evaluar(prueba(), fisico({
    muestrasPresentes: 'no', cantidadEncontrada: 0, defectuososEncontrados: 0,
    coincideEtiquetaLote: false, coincideCaja: false,
  }));
  assert.equal(x.resultado, 'DISCREPANCIA');
});

test('caja o lote diferente implica DISCREPANCIA', () => {
  for (const k of ['coincideCaja', 'coincideEtiquetaLote']) {
    assert.equal(evaluar(prueba(), fisico({ [k]: false })).resultado, 'DISCREPANCIA');
  }
});

test('falta cantidad digital: bloquea, no convierte NULL en 0 ni discrepancia automática', () => {
  for (const n of [null, undefined, '', '3', NaN, -1, 21]) {
    const r = evaluar(prueba({ cabezalesDefectuosos: n }), fisico());
    assert.equal(r.listo, false);
    assert.equal(r.resultado, null);
    assert.ok(r.razones.includes('DEFECTUOSOS_DIGITALES_INVALIDOS'));
  }
});

test('faltan caja/lote o resultado inválido: bloquea', () => {
  for (const p of [
    prueba({ caja: null }), prueba({ lote: '' }),
    prueba({ resultado: 'PENDIENTE' }), prueba({ anulada: true }),
    prueba({ estadoFinal: 'ANULADA' }),
    prueba({ resultado: 'OK', cabezalesDefectuosos: 2 }),
    prueba({ resultado: 'RECHAZADO', cabezalesDefectuosos: 0 }),
  ]) assert.equal(evaluar(p, fisico()).listo, false);
});

test('no admite cantidad vacía, fraccionaria, negativa o más defectos que cabezales', () => {
  for (const cantidad of [null, undefined, '', -1, 1.5, NaN]) {
    assert.equal(evaluar(prueba(), fisico({ cantidadEncontrada: cantidad })).listo, false);
  }
  for (const defectuosos of [null, undefined, '', -1, 1.5, NaN, 21]) {
    assert.equal(evaluar(prueba(), fisico({ defectuososEncontrados: defectuosos })).listo, false);
  }
});

test('selección física contradice cantidad: bloquea antes de guardar', () => {
  for (const f of [
    fisico({ muestrasPresentes: 'no', cantidadEncontrada: 20 }),
    fisico({ muestrasPresentes: 'parcial', cantidadEncontrada: 20 }),
    fisico({ muestrasPresentes: 'parcial', cantidadEncontrada: 0 }),
    fisico({ muestrasPresentes: 'si_todas', cantidadEncontrada: 19 }),
  ]) assert.equal(evaluar(prueba(), f).listo, false);
});

test('booleans sin responder o en formato textual bloquean', () => {
  for (const valor of [null, undefined, 'true', 'false']) {
    assert.equal(evaluar(prueba(), fisico({ coincideCaja: valor })).listo, false);
  }
});

test('entrada no objeto falla de forma segura', () => {
  assert.equal(evaluar(null, fisico()).resultado, null);
  assert.equal(evaluar(prueba(), undefined).listo, false);
});

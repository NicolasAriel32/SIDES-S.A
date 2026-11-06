import test from 'node:test';
import assert from 'node:assert/strict';
import { seleccionarVerificacionesAleatorias } from '../src/domain/seleccionVerificaciones.js';

test('selecciona dos controles del turno anterior sin repetir ni mutar la lista original', () => {
  const originales = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
  const copia = originales.map(x => x.id);
  const elegidas = seleccionarVerificacionesAleatorias(originales, 2, () => 0.999999);
  assert.equal(elegidas.length, 2);
  assert.equal(new Set(elegidas.map(x => x.id)).size, 2);
  assert.deepEqual(elegidas.map(x => x.id), ['D', 'A']);
  assert.deepEqual(originales.map(x => x.id), copia);
});
test('selecciona cada registro con posibilidad cuando hay un solo cupo', () => {
  const input = ['A','B','C','D'];
  const obtenidos = new Set();
  for (const p of [0, 0.25, 0.50, 0.75]) {
    const x = seleccionarVerificacionesAleatorias(input, 1, () => p);
    obtenidos.add(x[0]);
  }
  assert.deepEqual([...obtenidos].sort(), input);
});
test('sin registros no genera controles ficticios', () => {
  assert.deepEqual(seleccionarVerificacionesAleatorias([], 2), []);
});
test('no inventa controles si el turno anterior tiene menos pruebas', () => {
  assert.deepEqual(seleccionarVerificacionesAleatorias(['PR-1'], 2), ['PR-1']);
});
test('0 solicitudes produce lista vacía sin modificar registros', () => {
  const x = ['a', 'b'];
  assert.deepEqual(seleccionarVerificacionesAleatorias(x, 0), []);
  assert.deepEqual(x, ['a', 'b']);
});
test('rechaza cantidad no entera, lista incorrecta y fuente aleatoria malformada', () => {
  assert.throws(() => seleccionarVerificacionesAleatorias(null, 2), TypeError);
  assert.throws(() => seleccionarVerificacionesAleatorias(['a'], 1.5), TypeError);
  assert.throws(() => seleccionarVerificacionesAleatorias(['a'], -1), TypeError);
  for (const aleatorio of [() => -0.1, () => 1, () => NaN, () => '0.5']) {
    assert.throws(() => seleccionarVerificacionesAleatorias(['a'], 1, aleatorio), TypeError);
  }
});

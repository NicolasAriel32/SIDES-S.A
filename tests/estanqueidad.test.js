import test from 'node:test';
import assert from 'node:assert/strict';
import { CABEZALES_POR_MUESTRA, validarResultadoEstanqueidad, resumirPruebasConFalla } from '../src/domain/estanqueidad.js';

test('prueba OK: 20 inspeccionados, cero afectados y sin tipos', () => {
  assert.equal(CABEZALES_POR_MUESTRA, 20);
  assert.equal(validarResultadoEstanqueidad({ estado: 'OK', cabezalesFalla: 0, tipos: [] }).ok, true);
});

test('prueba OK no admite cantidades o tipos incompatibles', () => {
  assert.equal(validarResultadoEstanqueidad({ estado: 'OK', cabezalesFalla: 1 }).ok, false);
  assert.equal(validarResultadoEstanqueidad({ estado: 'OK', cabezalesFalla: 0, tipos: ['EST'] }).ok, false);
});

test('una falla requiere al menos un cabezal y un tipo', () => {
  assert.equal(validarResultadoEstanqueidad({ estado: 'RECHAZADO', cabezalesFalla: 0, tipos: ['EST'] }).ok, false);
  assert.equal(validarResultadoEstanqueidad({ estado: 'RECHAZADO', cabezalesFalla: 2, tipos: [] }).ok, false);
  assert.equal(validarResultadoEstanqueidad({ estado: 'RECHAZADO', cabezalesFalla: 2, tipos: ['EST'] }).ok, true);
});

test('rechaza fuera de rango, fracciones y tipos duplicados', () => {
  for (const n of [-1, 21, 1.5, NaN]) {
    assert.equal(validarResultadoEstanqueidad({ estado: 'RECHAZADO', cabezalesFalla: n, tipos: ['EST'] }).ok, false);
  }
  assert.equal(validarResultadoEstanqueidad({ estado: 'RECHAZADO', cabezalesFalla: 2, tipos: ['EST', 'EST'] }).ok, false);
});

test('permite hasta 20 cabezales únicos con distintos tipos', () => {
  assert.equal(validarResultadoEstanqueidad({ estado: 'RECHAZADO', cabezalesFalla: 20, tipos: ['EST', 'CLV'] }).ok, true);
});

test('PENDIENTE automático no se confunde con una prueba evaluada', () => {
  assert.equal(validarResultadoEstanqueidad({ estado: 'PENDIENTE', autoPendiente: true }).ok, true);
  assert.equal(validarResultadoEstanqueidad({ estado: 'PENDIENTE', autoPendiente: false }).ok, false);
});

test('KPI de pruebas con falla excluye pendientes del denominador', () => {
  const res = resumirPruebasConFalla([
    { estado: 'OK', estadoFinal: 'OK' },
    { estado: 'RECHAZADO', estadoFinal: 'PENDIENTE_APROBACION' },
    { estado: 'PENDIENTE', estadoFinal: 'PENDIENTE' },
    { estado: 'OK', estadoFinal: 'PENDIENTE' },
  ]);
  assert.deepEqual(res, { evaluables: 2, conFalla: 1, ok: 1, porcentajeConFalla: 50 });
});

test('sin pruebas evaluables no se muestra un 0% ficticio', () => {
  assert.deepEqual(resumirPruebasConFalla([{ estado: 'PENDIENTE', estadoFinal: 'PENDIENTE' }]), {
    evaluables: 0, conFalla: 0, ok: 0, porcentajeConFalla: null,
  });
});

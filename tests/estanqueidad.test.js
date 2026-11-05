import test from 'node:test';
import assert from 'node:assert/strict';
import { CABEZALES_POR_MUESTRA, validarResultadoEstanqueidad, resumirPruebasConFalla } from '../src/domain/estanqueidad.js';

const validar = (p) => validarResultadoEstanqueidad(p);
test('una muestra tiene 20 cabezales; OK requiere cero afectados', () => {
  assert.equal(CABEZALES_POR_MUESTRA, 20);
  assert.equal(validar({ estado: 'OK', cabezalesFalla: 0, tipos: [] }).ok, true);
  assert.equal(validar({ estado: 'OK', cabezalesFalla: 1 }).ok, false);
  assert.equal(validar({ estado: 'OK', tipos: ['EST'] }).ok, false);
});
test('rechazado requiere cabezales, tipo y cantidad por cada tipo', () => {
  assert.equal(validar({ estado: 'RECHAZADO', cabezalesFalla: 0, tipos: ['EST'], cantidadesTipos: {EST: 1} }).ok, false);
  assert.equal(validar({ estado: 'RECHAZADO', cabezalesFalla: 2, tipos: ['EST'] }).ok, false);
  assert.equal(validar({ estado: 'RECHAZADO', cabezalesFalla: 2, tipos: ['EST'], cantidadesTipos: {EST: 2} }).ok, true);
});
test('rechaza negativos, fracciones, fuera de rango y cantidades no enteras', () => {
  for (const n of [-1, 21, 1.5, NaN]) assert.equal(validar({ estado: 'RECHAZADO', cabezalesFalla: n, tipos: ['EST'], cantidadesTipos: {EST: 1} }).ok, false);
  for (const val of [0, 3, 1.5, '', null]) assert.equal(validar({ estado: 'RECHAZADO', cabezalesFalla: 2, tipos: ['EST'], cantidadesTipos: {EST: val} }).ok, false);
});
test('no admite tipos duplicados o cantidades de tipos no seleccionados', () => {
  assert.equal(validar({ estado: 'RECHAZADO', cabezalesFalla: 2, tipos: ['EST','EST'], cantidadesTipos: {EST: 2} }).ok, false);
  assert.equal(validar({ estado: 'RECHAZADO', cabezalesFalla: 2, tipos: ['EST'], cantidadesTipos: {EST: 2,CLV: 1} }).ok, false);
});
test('admite un cabezal con varios tipos, sin sumar dos cabezales únicos', () => {
  assert.equal(validar({ estado: 'RECHAZADO', cabezalesFalla: 1, tipos: ['EST','CLV'], cantidadesTipos: {EST: 1,CLV: 1} }).ok, true);
});
test('la suma de cantidades de tipos debe cubrir a todos los afectados', () => {
  assert.equal(validar({ estado: 'RECHAZADO', cabezalesFalla: 6, tipos: ['EST','CLV'], cantidadesTipos: {EST: 2,CLV: 1} }).ok, false);
  assert.equal(validar({ estado: 'RECHAZADO', cabezalesFalla: 6, tipos: ['EST','CLV'], cantidadesTipos: {EST: 4,CLV: 3} }).ok, true);
});
test('pendiente automático no cuenta como ensayo', () => {
  assert.equal(validar({ estado: 'PENDIENTE', autoPendiente: true }).ok, true);
  assert.equal(validar({ estado: 'PENDIENTE', autoPendiente: false }).ok, false);
  assert.equal(validar({ estado: 'PENDIENTE', autoPendiente: true, cabezalesFalla: 2 }).ok, false);
});
test('KPI por pruebas excluye pendientes del denominador', () => {
  assert.deepEqual(resumirPruebasConFalla([
    { estado: 'OK', estadoFinal: 'OK' },
    { estado: 'RECHAZADO', estadoFinal: 'PENDIENTE_APROBACION' },
    { estado: 'PENDIENTE', estadoFinal: 'PENDIENTE' },
  ]), { evaluables: 2, conFalla: 1, ok: 1, porcentajeConFalla: 50 });
});
test('si no hay pruebas evaluables no se publica cero falso', () => {
  assert.equal(resumirPruebasConFalla([{ estado: 'PENDIENTE', estadoFinal: 'PENDIENTE' }]).porcentajeConFalla, null);
});

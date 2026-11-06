import test from 'node:test';
import assert from 'node:assert/strict';
import { construirPayloadPruebaEstanqueidad, registrarPruebaEstanqueidad } from '../src/api/estanqueidad.js';

const base = {
  requestId: '84e625d1-2c1b-4f8a-a643-7e98b437c99f',
  maquina: 'MAQ-010', fechaSenal: '2026-11-05T09:38:21.024Z',
  codigoProducto: 'RCL-300C-RO', caja: 'CAJA-01', lote: 'LOTE-01',
  estado: 'RECHAZADO', autoPendiente: false, cabezalesFalla: 2,
  tipos: ['EST', 'CLV'], cantidadesTipos: { EST: 2, CLV: 1 },
  observaciones: 'Prueba sintética',
};

test('contrato RPC: envía nombres exactos, cantidades e idempotencia', async () => {
  const calls = [];
  const fake = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: { prueba_id: 'test', numero_secuencial: 42, duplicado: false }, error: null };
  } };
  const x = await registrarPruebaEstanqueidad(fake, base);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'registrar_prueba_estanqueidad_spc');
  assert.deepEqual(calls[0].args, { p: construirPayloadPruebaEstanqueidad(base) });
  assert.equal(x.data.numero_secuencial, 42);
  assert.equal(x.payload.cabezales_afectados, 2);
  assert.deepEqual(x.payload.cantidades_por_tipo, { EST: 2, CLV: 1 });
});

test('dos reintentos usan exactamente el mismo payload', async () => {
  const seen = [];
  const fake = { rpc: async (_name, args) => { seen.push(args.p); return { data: { prueba_id: 'same' }, error: null }; } };
  await registrarPruebaEstanqueidad(fake, base);
  await registrarPruebaEstanqueidad(fake, base);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], seen[1]);
});

test('los datos inválidos se rechazan antes de consultar Supabase', async () => {
  let calls = 0;
  const fake = { rpc: async () => { calls++; return { error: null }; } };
  await assert.rejects(registrarPruebaEstanqueidad(fake, { ...base, cantidadesTipos: {} }), /cantidad/i);
  await assert.rejects(registrarPruebaEstanqueidad(fake, { ...base, requestId: '' }), /UUID/i);
  assert.equal(calls, 0);
});

test('pendiente local no crea resultado físico y conserva el identificador', async () => {
  const pendiente = construirPayloadPruebaEstanqueidad({
    ...base, estado: 'PENDIENTE', autoPendiente: true, codigoProducto: null,
    caja: null, lote: null, tipos: [], cantidadesTipos: {}, cabezalesFalla: 0,
  });
  assert.equal(pendiente.request_id, base.requestId);
  assert.equal(pendiente.resultado, 'PENDIENTE');
  assert.equal(pendiente.auto_pendiente, true);
  assert.equal(pendiente.cabezales_afectados, 0);
  assert.deepEqual(pendiente.tipos, []);
});

test('el error de la RPC llega al llamador para conservar señal local', async () => {
  const result = await registrarPruebaEstanqueidad({
    rpc: async () => ({ data: null, error: { message: 'red desconectada' } }),
  }, base);
  assert.equal(result.data, null);
  assert.equal(result.error.message, 'red desconectada');
});

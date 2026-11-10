// Esta prueba solo verifica el contrato del archivo SQL: NO ejecuta PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../sql/spc_001_registrar_prueba_atomica_BORRADOR_NO_APLICAR.sql', import.meta.url), 'utf8');

test('migración SQL preserva históricos y no actualiza filas anteriores', () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS spc_request_id uuid/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS spc_uso_estadistico text/i);
  assert.match(sql, /'NO_VALIDADO'/);
  assert.doesNotMatch(sql, /^\s*UPDATE\s+public\.pruebas\b/im);
  assert.doesNotMatch(sql, /^\s*DELETE\s+FROM\s+public\.pruebas\b/im);
});

test('RPC usa RLS y restringe su ejecución', () => {
  assert.match(sql, /SECURITY INVOKER/i);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.registrar_prueba_estanqueidad_spc\(jsonb\) FROM PUBLIC/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.registrar_prueba_estanqueidad_spc\(jsonb\) TO authenticated/i);
});

test('RPC contiene transacción, idempotencia y registro de detalle', () => {
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_pruebas_spc_request/i);
  assert.match(sql, /ON CONFLICT \(spc_request_id\) DO NOTHING/i);
  assert.match(sql, /INSERT INTO public\.pruebas_fallas/i);
  assert.match(sql, /spc_origen_evento/i);
  assert.doesNotMatch(sql, /INSERT INTO public\.no_conformidades/i);
});

test('RPC pública es invoker y función privilegiada no está expuesta por Data API', () => {
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS spc_private/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION spc_private\.registrar_prueba_estanqueidad_internal\(p jsonb\)/);
  assert.match(sql, /SECURITY DEFINER/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.registrar_prueba_estanqueidad_spc\(p jsonb\)/);
  assert.match(sql, /SELECT spc_private\.registrar_prueba_estanqueidad_internal\(p\)/);
  assert.match(sql, /REVOKE INSERT ON TABLE public\.pruebas, public\.pruebas_fallas FROM authenticated/i);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /u\.activo = true/);
  assert.match(sql, /v_actor_maquina IS DISTINCT FROM v_maquina/);
  assert.match(sql, /extensions\.digest\(p::text,'sha256'\)/);
});

test('un rol nulo y un pendiente automático con datos de ensayo se rechazan', () => {
  assert.match(sql, /IF NOT FOUND OR v_actor_rol IS NULL OR v_actor_rol NOT IN/);
  assert.match(sql, /IF v_estado IS DISTINCT FROM 'PENDIENTE'[\s\S]+?OR v_producto IS NOT NULL OR v_caja IS NOT NULL OR v_lote IS NOT NULL THEN\s+RAISE EXCEPTION/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { asegurarAsignacionTurnoEnServidor } from '../src/api/asignacionVerificaciones.js';

const inicio='2026-11-06T09:00:00+00:00';
const ok=(estado='CREADA',datos={})=>({
  estado,cantidad:2,asignada_a_mi:true,turno_inicio_utc:inicio,...datos,
});
const db=(response)=>({rpc: async (...args)=> {
  db.llamada = args;
  return response;
}});

test('una RPC sin parametros: reloj, actor, pruebas y cantidad elegidos en servidor',async()=>{
  const llamadas=[];
  const supabase={rpc:async(...args)=>{
    llamadas.push(args);
    return {data:ok(),error:null};
  }};
  const r=await asegurarAsignacionTurnoEnServidor(supabase);
  assert.deepEqual(llamadas,[['vf_asegurar_verificaciones_turno_anterior']]);
  assert.deepEqual(r,{
    estado:'CREADA',cantidad:2,asignadaAMi:true,turnoInicioUtc:inicio,
  });
});

test('reintento de la misma identidad no crea una nueva asignacion',async()=>{
  const r=await asegurarAsignacionTurnoEnServidor({
    rpc:async()=>({data:ok('YA_ASIGNADA'),error:null}),
  });
  assert.equal(r.estado,'YA_ASIGNADA');
  assert.equal(r.asignadaAMi,true);
});

test('otra sesion/encargado: no puede reclamar seleccion ajena',async()=>{
  const r=await asegurarAsignacionTurnoEnServidor({
    rpc:async()=>({data:ok('ASIGNADA_A_OTRO',{asignada_a_mi:false}),error:null}),
  });
  assert.equal(r.estado,'ASIGNADA_A_OTRO');
  assert.equal(r.asignadaAMi,false);
});

test('turno sin pruebas o controles legados se informa sin asignar falsamente',async()=>{
  const sinPruebas=await asegurarAsignacionTurnoEnServidor({
    rpc:async()=>({data:ok('SIN_PRUEBAS',{cantidad:0,asignada_a_mi:false}),error:null}),
  });
  assert.equal(sinPruebas.cantidad,0);
  const legado=await asegurarAsignacionTurnoEnServidor({
    rpc:async()=>({data:ok('LEGADO_EXISTENTE',{asignada_a_mi:false}),error:null}),
  });
  assert.equal(legado.asignadaAMi,false);
});

test('fallo de SQL, RPC inexistente, red o respuesta invalida fallan cerrado',async()=>{
  const casos=[
    null,{},{rpc:async()=>{throw Error('Interno')}} ,
    {rpc:async()=>({data:null,error:{code:'PGRST202'}})},
    {rpc:async()=>({data:null,error:null})},
    {rpc:async()=>({data:ok('CREADA',{cantidad:'2'}),error:null})},
    {rpc:async()=>({data:ok('CREADA',{asignada_a_mi:false}),error:null})},
    {rpc:async()=>({data:ok('CREADA',{cantidad:0}),error:null})},
    {rpc:async()=>({data:ok('ASIGNADA_A_OTRO'),error:null})},
    {rpc:async()=>({data:ok('SIN_PRUEBAS'),error:null})},
    {rpc:async()=>({data:ok('LEGADO_EXISTENTE'),error:null})},
    {rpc:async()=>({data:ok('APROBADA'),error:null})},
    {rpc:async()=>({data:ok('CREADA',{turno_inicio_utc:'nunca'}),error:null})},
    {rpc:async()=>({data:[ok()],error:null})},
  ];
  for(const uno of casos){
    await assert.rejects(()=>asegurarAsignacionTurnoEnServidor(uno));
  }
});

test('contrato SQL: ledger de turno, bloqueo transaccional y unicidad doble',()=>{
  const sql=readFileSync(new URL('../sql/VF_002_ASIGNACION_ATOMICA_NO_APLICAR.sql',import.meta.url),'utf8');
  assert.match(sql,/turno_entrante_inicio_utc\s+timestamptz PRIMARY KEY/i);
  assert.match(sql,/pg_advisory_xact_lock\(/i);
  assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS ux_vf_prueba_id_una_seleccion/i);
  assert.match(sql,/FOR UPDATE/i);
  assert.match(sql,/REVOKE INSERT ON TABLE public\.verificaciones_fisicas/i);
  assert.match(sql,/auth\.uid\(\)/i);
  assert.match(sql,/SECURITY DEFINER/i);
  assert.match(sql,/SET search_path = pg_catalog/i);
  assert.match(sql,/AT TIME ZONE 'America\/Argentina\/Buenos_Aires'/i);
  assert.match(sql,/AT TIME ZONE 'UTC'/i);
  assert.match(sql,/ORDER BY pg_catalog\.random\(\)\s+LIMIT 2/i);
  assert.match(sql,/LEGADO_EXISTENTE/i);
  assert.match(sql,/SIN_PRUEBAS/i);
  assert.match(sql,/ALTER TABLE public\.vf_asignaciones_turno ENABLE ROW LEVEL SECURITY/i);
});

test('el frontend no vuelve a insertar asignaciones directamente',()=>{
  const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  assert.match(app,/asegurarAsignacionTurnoEnServidor\(supabase\)/);
  assert.doesNotMatch(app,/\.from\(['"]verificaciones_fisicas['"]\)\s*\.insert\(/);
  assert.doesNotMatch(app,/seleccionarVerificacionesAleatorias\(pruebasTurno/);
});

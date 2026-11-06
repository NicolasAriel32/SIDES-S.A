import test from 'node:test';
import assert from 'node:assert/strict';
import { completarContramuestraEnServidor } from '../src/api/cierreContramuestra.js';
const ID = 'vf-ejemplo-1';
const hallazgo = {
  muestrasPresentes: 'si_todas',
  cantidadEncontrada: 20,
  defectuososEncontrados: 3,
  coincideEtiquetaLote: true,
  coincideCaja: true,
  observaciones: '',
  resultado: 'OK',
  cabezalesDefectuosos: 0, // Este valor NO debe enviarse, siempre lo lee servidor.
};

test('RPC recibe exclusivamente datos físicos, nunca resultado ni cantidad digital cliente', async () => {
  let llamada;
  const db={rpc:async(name,args)=>{
    llamada={name,args};
    return {data:{
      verificacion_id:ID,resultado:'DISCREPANCIA',duplicado:false,
      cantidad_encontrada:20,defectuosos_encontrados:3,
    },error:null};
  }};
  const r=await completarContramuestraEnServidor(db,ID,hallazgo);
  assert.equal(llamada.name,'vf_completar_contramuestra_segura');
  assert.equal(r.resultado,'DISCREPANCIA');
  assert.deepEqual(Object.keys(llamada.args).sort(),[
    'p_verificacion_id','p_muestras_presentes','p_cantidad_encontrada',
    'p_defectuosos_encontrados','p_coincide_etiqueta_lote',
    'p_coincide_caja','p_observaciones',
  ].sort());
  assert.equal(JSON.stringify(llamada.args).includes('cabezalesDefectuosos'),false);
  assert.equal(JSON.stringify(llamada.args).includes('"resultado"'),false);
});

test('error SQL o servicio no disponible nunca se convierte en OK', async () => {
  assert.equal(await completarContramuestraEnServidor(null,ID,hallazgo),null);
  assert.equal(await completarContramuestraEnServidor({rpc:async()=>({data:null,error:{code:'42501'}})},ID,hallazgo),null);
  assert.equal(await completarContramuestraEnServidor({rpc:async()=>{throw Error('privado')}},ID,hallazgo),null);
});

test('respuesta de otra verificación o con cantidad distinta se rechaza', async () => {
  for(const data of [
    {verificacion_id:'otro',resultado:'OK',cantidad_encontrada:20,defectuosos_encontrados:3},
    {verificacion_id:ID,resultado:'OK',cantidad_encontrada:19,defectuosos_encontrados:3},
    {verificacion_id:ID,resultado:'OK',cantidad_encontrada:20,defectuosos_encontrados:2},
    {verificacion_id:ID,resultado:'APROBADA',cantidad_encontrada:20,defectuosos_encontrados:3},
    {verificacion_id:ID,resultado:null,cantidad_encontrada:20,defectuosos_encontrados:3},
  ]){
    const r=await completarContramuestraEnServidor({rpc:async()=>({data,error:null})},ID,hallazgo);
    assert.equal(r,null);
  }
});

test('reintento idéntico reconocido como duplicado sin generar doble cierre cliente', async () => {
  const db={rpc:async()=>({data:{
    verificacion_id:ID,resultado:'OK',duplicado:true,
    cantidad_encontrada:20,defectuosos_encontrados:3,
  },error:null})};
  assert.deepEqual(await completarContramuestraEnServidor(db,ID,hallazgo),{
    id:ID,resultado:'OK',duplicado:true,
  });
});

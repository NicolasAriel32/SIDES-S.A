import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluarPreflight, reportePreflightSeguro, verificarEscrituraStorage } from '../src/domain/preflightPuesto.js';
const base={estadoLocal:'LIBRE',tieneLock:true,authVerificada:true,storageDisponible:true,navegadorSeguro:true,online:true};
test('puesto listo sólo para prueba nueva si está libre',()=>{
 const p=evaluarPreflight(base);
 assert.equal(p.habilitado,true);assert.equal(p.puedeCrearNueva,true);
 assert.equal(p.modo,'NORMAL');
});
test('un intento previo impide iniciar nueva prueba pero permite recuperar',()=>{
 const p=evaluarPreflight({...base,estadoLocal:'ENVIO_PREVIO'});
 assert.equal(p.puedeCrearNueva,false);assert.equal(p.puedeRecuperar,true);
});
test('datos huérfanos o inciertos requieren intervención',()=>{
 for(const estadoLocal of ['HUERFANO','INTERVENCION','INCIERTO','CONFIRMADA_CON_RESIDUOS']){
  const p=evaluarPreflight({...base,estadoLocal});
  assert.equal(p.habilitado,false);assert.ok(p.bloqueantes.includes('EVIDENCIA_LOCAL'));
 }
});
test('sin autenticación, lock o storage no se habilita edición',()=>{
 for(const key of ['authVerificada','tieneLock','storageDisponible','navegadorSeguro']){
  const p=evaluarPreflight({...base,[key]:false});
  assert.equal(p.habilitado,false);assert.equal(p.puedeCrearNueva,false);
 }
});
test('offline conserva diagnóstico sin atribuir confirmación de servidor',()=>{
 const p=evaluarPreflight({...base,online:false});
 assert.equal(p.modo,'SIN_RED');assert.equal(p.checks.find(c=>c.codigo==='RED').ok,false);
});
test('estado desconocido falla cerrado',()=>{
 const p=evaluarPreflight({...base,estadoLocal:'ALGO_NUEVO'});
 assert.equal(p.habilitado,false);assert.equal(p.estado,'NO_VERIFICADO');
 assert.ok(p.bloqueantes.includes('EVIDENCIA_NO_VERIFICADA'));
});
test('reporte no filtra payloads, legajos, tokens ni UUIDs incluso si se inyectan',()=>{
 const p=evaluarPreflight(base);
 const secreto='TOKEN-SECRETO-LEGAJO-UUID';
 const rep=reportePreflightSeguro({...p,token:secreto,payload:{request_id:secreto},checks:[...p.checks,{codigo:'TOKEN',ok:true,valor:secreto}]});
 assert.equal(JSON.stringify(rep).includes(secreto),false);
 assert.equal(rep.checks.some(x=>x.codigo==='TOKEN'),false);
});
test('el reporte sanitiza modo, estado y códigos inesperados',()=>{
 const rep=reportePreflightSeguro({version:1,estado:'dato-personal',modo:'token',checks:[{codigo:'RED',ok:1}],bloqueantes:['AUTH','SECRETO']});
 assert.equal(rep.estado,'NO_VERIFICADO');assert.equal(rep.modo,'BLOQUEADO');
 assert.deepEqual(rep.bloqueantes,['AUTH']);assert.deepEqual(rep.checks,[{codigo:'RED',ok:false}]);
});

test('sin diagnóstico local realizado jamás se anuncia SIN_EVIDENCIA',()=>{
 const p=evaluarPreflight({ ...base, estadoLocal:undefined });
 assert.equal(p.estado,'NO_VERIFICADO');
 assert.equal(p.puedeCrearNueva,false);
 assert.equal(p.habilitado,false);
});
test('una confirmación limpia permite iniciar un nuevo registro',()=>{
 const p=evaluarPreflight({...base,estadoLocal:'CONFIRMADA_LIMPIA'});
 assert.equal(p.puedeCrearNueva,true);
 assert.equal(p.puedeRecuperar,false);
});
test('si el navegador reporta offline, recuperación local no equivale a RPC',()=>{
 const p=evaluarPreflight({...base,estadoLocal:'ENVIO_PREVIO',online:false});
 assert.equal(p.puedeRecuperar,true);
 assert.equal(p.puedeConsultarRemoto,false);
});
function fakeStorage() {
 const datos=new Map();
 return {
  datos,
  getItem(k){return datos.has(k)?datos.get(k):null},
  setItem(k,v){datos.set(k,v)},
  removeItem(k){datos.delete(k)},
 };
}
test('la prueba de escritura conserva evidencia preexistente y elimina sólo su marcador',()=>{
 const s=fakeStorage();s.setItem('senal_plc_OP1_MAQ-010','no borrar');
 assert.equal(verificarEscrituraStorage(s,()=> 'prueba1234'),true);
 assert.equal(s.getItem('senal_plc_OP1_MAQ-010'),'no borrar');
 assert.equal(s.getItem('__spc_preflight_write_prueba1234'),null);
});
test('la prueba falla cerrada ante errores de escritura, lectura y borrado',()=>{
 const s=fakeStorage(),create=()=> 'prueba1234';
 const sinEscritura={...s,setItem(){throw Error('cuota')}};
 assert.equal(verificarEscrituraStorage(sinEscritura,create),false);
 const sinLectura={...s,getItem(){throw Error('bloqueado')}};
 assert.equal(verificarEscrituraStorage(sinLectura,create),false);
 const sinBorrado={...s,removeItem(){throw Error('bloqueado')}};
 assert.equal(verificarEscrituraStorage(sinBorrado,create),false);
});
test('la prueba de escritura no sobrescribe marcadores de otra ventana',()=>{
 const s=fakeStorage();s.setItem('__spc_preflight_write_prueba1234','otra ventana');
 assert.equal(verificarEscrituraStorage(s,()=> 'prueba1234'),false);
 assert.equal(s.getItem('__spc_preflight_write_prueba1234'),'otra ventana');
});
test('no se copian excepciones o payloads inesperados en checks del diagnóstico',()=>{
 const s='USUARIO-123-TOKEN-CREDENCIAL';
 const p=reportePreflightSeguro({
  version:1,estado:'SIN_EVIDENCIA',modo:'NORMAL',
  checks:[null,'abc',{codigo:'AUTH',ok:true,error:s,meta:{legajo:s}}],
  bloqueantes:[null,'EVIDENCIA_NO_VERIFICADA',s],
  payload:s,
 });
 assert.equal(JSON.stringify(p).includes(s),false);
 assert.equal(p.checks.length,1);
 assert.deepEqual(p.bloqueantes,['EVIDENCIA_NO_VERIFICADA']);
});

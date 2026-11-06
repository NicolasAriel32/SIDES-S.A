import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluarPreflight, reportePreflightSeguro } from '../src/domain/preflightPuesto.js';
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
 assert.equal(p.habilitado,false);assert.equal(p.estado,'REVISION_MANUAL');
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
 assert.equal(rep.estado,'REVISION_MANUAL');assert.equal(rep.modo,'BLOQUEADO');
 assert.deepEqual(rep.bloqueantes,['AUTH']);assert.deepEqual(rep.checks,[{codigo:'RED',ok:false}]);
});

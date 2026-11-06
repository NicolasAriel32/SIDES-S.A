import test from 'node:test';
import assert from 'node:assert/strict';
import { verificarSesionLocal, verificarPerfilAutenticado, inventariarEvidenciaLocal, limpiarPerfilLocal } from '../src/domain/seguridadPuesto.js';

function memoria() {
 const m=new Map();
 return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v),
  removeItem:k=>m.delete(k),key:i=>[...m.keys()][i]??null,
  get length(){return m.size},m};
}
const clave='sides_current_user';
test('sesión ligada al UID de Supabase y no solo al legajo',()=>{
 const s=memoria();s.setItem(clave,JSON.stringify({legajo:'OP1',authUserId:'auth-1'}));
 assert.equal(verificarSesionLocal({storage:s,claveUsuario:clave,authUser:{id:'auth-1'}}).ok,true);
 assert.equal(verificarSesionLocal({storage:s,claveUsuario:clave,authUser:{id:'auth-2'}}).motivo,'IDENTIDAD_NO_COINCIDE');
});
test('perfil legado sin UID no se acepta en puesto compartido',()=>{
 const s=memoria();s.setItem(clave,JSON.stringify({legajo:'OP1'}));
 assert.equal(verificarSesionLocal({storage:s,claveUsuario:clave,authUser:{id:'auth-1'}}).ok,false);
});
test('perfil corrupto y ausencia de Auth no dan acceso',()=>{
 const s=memoria();s.setItem(clave,'{');
 assert.equal(verificarSesionLocal({storage:s,claveUsuario:clave,authUser:{id:'auth-1'}}).motivo,'PERFIL_CORRUPTO');
 assert.equal(verificarSesionLocal({storage:s,claveUsuario:clave,authUser:null}).motivo,'SIN_AUTH');
});
test('logout borra sólo perfil de sesión, conserva evidencia de ambos operarios',()=>{
 const s=memoria();s.setItem(clave,'{}');
 s.setItem('senal_plc_OP1_MAQ-010','{}');
 s.setItem('spc_borrador_v1_OP1_MAQ-010','{}');
 s.setItem('spc_intento_v1_OP2_MAQ-011','{}');
 assert.deepEqual(inventariarEvidenciaLocal(s,'OP1'),{estado:'OK',total:2});
 assert.equal(limpiarPerfilLocal(s,clave),true);
 assert.equal(s.getItem(clave),null);
 assert.ok(s.getItem('senal_plc_OP1_MAQ-010'));
 assert.ok(s.getItem('spc_intento_v1_OP2_MAQ-011'));
});
test('inventario no confunde legajos con prefijo común',()=>{
 const s=memoria();s.setItem('senal_plc_OP1_MAQ-010','{}');s.setItem('senal_plc_OP10_MAQ-010','{}');
 assert.equal(inventariarEvidenciaLocal(s,'OP1').total,1);
});
test('si storage no está disponible se declara incierto y no se afirma ausencia de evidencia',()=>{
 const s={get length(){throw Error('storage bloqueado')}};
 assert.equal(inventariarEvidenciaLocal(s,'OP1').estado,'INCIERTO');
});

test('un supervisor autenticado no puede asumir el perfil de otro legajo',()=>{
 const authUser={id:'uid-supervisor'}, perfil={id:'uid-operario',legajo:'OP2',activo:true,rol:'operario'};
 assert.equal(verificarPerfilAutenticado({perfil,authUser,legajoSolicitado:'OP2'}).motivo,'PERFIL_NO_COINCIDE_CON_AUTH');
});
test('el legajo debe corresponder al mismo UID sin admitir perfiles cruzados',()=>{
 const perfil={id:'uid-1',legajo:'OP1',activo:true,rol:'operario'};
 assert.equal(verificarPerfilAutenticado({perfil,authUser:{id:'uid-1'},legajoSolicitado:'OP2'}).motivo,'LEGAJO_NO_COINCIDE');
 assert.equal(verificarPerfilAutenticado({perfil,authUser:{id:'uid-1'},legajoSolicitado:'OP1'}).ok,true);
});
test('perfil inactivo, estado nulo y rol desconocido niegan acceso',()=>{
 const base={id:'uid-1',legajo:'OP1',activo:true,rol:'operario'},authUser={id:'uid-1'};
 for(const activo of [null,false,undefined]) {
  assert.equal(verificarPerfilAutenticado({perfil:{...base,activo},authUser}).motivo,'PERFIL_INACTIVO');
 }
 assert.equal(verificarPerfilAutenticado({perfil:{...base,rol:'administrador-super'},authUser}).motivo,'ROL_INVALIDO');
});
test('perfiles vacíos o no objetos no autorizan recuperar sesión',()=>{
 for(const perfil of [null,undefined,[],{},'OP1']) {
  assert.equal(verificarPerfilAutenticado({perfil,authUser:{id:'uid-1'}}).ok,false);
 }
});

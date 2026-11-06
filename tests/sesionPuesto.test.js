import test from 'node:test';
import assert from 'node:assert/strict';
import {
  iniciarSesionPuesto, restaurarSesionPuesto, cambiarPasswordPuesto, cerrarSesionPuesto,
} from '../src/api/sesionPuesto.js';

const KEY='tz_current_user';
const AUTH_KEY='spc001-auth-session-v1';
const UID='11111111-1111-4111-8111-111111111111';
const perfilInicial={
  id:UID,legajo:'OP1',nombre:'Operario',apellido:'Prueba',
  rol:'operario',activo:true,maquina_asignada:'MAQ-010',fuerza_cambio:true,
};
const mapUser=p=>({
  legajo:p.legajo,rol:p.rol,maquinaAsignada:p.maquina_asignada,
  forceChange:p.fuerza_cambio===true,activo:p.activo,
});
function storage() {
 const db=new Map();
 return {getItem:k=>db.has(k)?db.get(k):null,
   setItem:(k,v)=>db.set(k,v),removeItem:k=>db.delete(k),
   db};
}
function fake({profile=perfilInicial,authed=true,loginError=null,authError=null,rpcError=null,signOutError=null}={}) {
 const calls={queries:[],rpc:[],signOut:[],updated:[]};
 let current=profile;
 const supabase={
   auth:{
     signInWithPassword:async({email})=>{
       calls.email=email;
       return {data:{user:authed?{id:UID}:null},error:loginError};
     },
     getUser:async()=>({data:{user:authed?{id:UID}:null},error:authError}),
     updateUser:async value=>{calls.updated.push(value);return {error:null}},
     signOut:async x=>{calls.signOut.push(x);return {error:signOutError}},
   },
   from:tabla=>{
     assert.equal(tabla,'usuarios');
     const filters={};
     return {select(){return this},eq(k,v){filters[k]=v;return this},
       async maybeSingle(){
         calls.queries.push(filters);
         if(!current || Object.entries(filters).some(([k,v])=>current[k]!==v)){
           return {data:null,error:null};
         }
         return {data:current,error:null};
       }};
   },
   rpc:async(name)=>{calls.rpc.push(name);return {error:rpcError}},
 };
 return {supabase,calls,setProfile:x=>{current=x}};
}
const params=(f,s)=>({supabase:f.supabase,storage:s,evidenciaStorage:s,key:KEY,authKey:AUTH_KEY,mapUser});
test('login exige ID Auth y legajo, no concede un perfil visible de supervisor',async()=>{
 const s=storage(),f=fake();
 const u=await iniciarSesionPuesto({...params(f,s),legajo:' OP1 ',password:'correcta'});
 assert.equal(u.authUserId,UID);assert.equal(u.legajo,'OP1');
 assert.equal(f.calls.email,'OP1@sides.internal');
 assert.deepEqual(f.calls.queries[0],{id:UID,legajo:'OP1'});
 assert.equal(JSON.parse(s.getItem(KEY)).authUserId,UID);
});
test('rechaza perfiles de otro UID aun cuando el legajo sea correcto',async()=>{
 const s=storage(),f=fake({profile:{...perfilInicial,id:'otro-uid'}});
 assert.equal(await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'x'}),null);
 assert.equal(s.getItem(KEY),null);
 assert.deepEqual(f.calls.signOut,[{scope:'local'}]);
});
test('rechaza perfil inactivo, rol inesperado o contraseña inválida',async()=>{
 for(const profile of [{...perfilInicial,activo:false},{...perfilInicial,rol:'root'}]){
   const s=storage(),f=fake({profile});
   assert.equal(await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'x'}),null);
 }
 const s=storage(),f=fake({authed:false,loginError:{message:'auth'}}); 
 assert.equal(await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'incorrecta'}),null);
});
test('si falla almacenamiento de perfil no se habilita acceso',async()=>{
 const f=fake(),s={getItem:()=>null,setItem(){throw Error('quota')},removeItem(){}};
 assert.equal(await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'x'}),null);
 assert.deepEqual(f.calls.signOut,[{scope:'local'}]);
});
test('restauración refresca rol y estado desde DB, no desde sessionStorage',async()=>{
 const s=storage(),f=fake();
 await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'x'});
 f.setProfile({...perfilInicial,rol:'supervisor',maquina_asignada:'MAQ-011'});
 const u=await restaurarSesionPuesto(params(f,s));
 assert.equal(u.rol,'supervisor');assert.equal(u.maquinaAsignada,'MAQ-011');
 assert.equal(JSON.parse(s.getItem(KEY)).rol,'supervisor');
 f.setProfile({...perfilInicial,activo:false});
 assert.equal(await restaurarSesionPuesto(params(f,s)),null);
 assert.equal(s.getItem(KEY),null);
});
test('cambiar de identidad Auth en la misma pestaña niega el perfil anterior',async()=>{
 const s=storage(),f=fake();
 await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'x'});
 f.supabase.auth.getUser=async()=>({data:{user:{id:'uid-distinto'}},error:null});
 assert.equal(await restaurarSesionPuesto(params(f,s)),null);
 assert.equal(s.getItem(KEY),null);
});
test('una caída de Auth no reutiliza sesión almacenada ni elimina evidencia de producción',async()=>{
 const s=storage(),f=fake();
 await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'x'});
 s.setItem('spc_borrador_v1_OP1_MAQ-010','{}');
 f.supabase.auth.getUser=async()=>{throw Error('offline')};
 assert.equal(await restaurarSesionPuesto(params(f,s)),null);
 assert.equal(s.getItem(KEY),null);
 assert.ok(s.getItem('spc_borrador_v1_OP1_MAQ-010'));
});
test('cambio de contraseña mantiene UID y no reabre cambio obligatorio en recarga',async()=>{
 const s=storage(),f=fake();
 await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'anterior'});
 f.setProfile({...perfilInicial,fuerza_cambio:false});
 const u=await cambiarPasswordPuesto({...params(f,s),legajo:'OP1',newPass:'contraseña-nueva-2026'});
 assert.equal(u.authUserId,UID);assert.equal(u.forceChange,false);
 assert.equal(JSON.parse(s.getItem(KEY)).authUserId,UID);
 assert.deepEqual(f.calls.updated,[{password:'contraseña-nueva-2026'}]);
 assert.deepEqual(f.calls.rpc,['marcar_password_cambiada']);
 assert.equal((await restaurarSesionPuesto(params(f,s))).authUserId,UID);
});
test('cambio de contraseña para otro legajo se rechaza antes de updateUser',async()=>{
 const s=storage(),f=fake();
 await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'x'});
 assert.equal(await cambiarPasswordPuesto({...params(f,s),legajo:'OP2',newPass:'pass'}),null);
 assert.equal(f.calls.updated.length,0);
});
test('un error al marcar metadata no anuncia cambio completo',async()=>{
 const s=storage(),f=fake({rpcError:{message:'RPC denegada'}});
 await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'x'});
 assert.equal(await cambiarPasswordPuesto({...params(f,s),legajo:'OP1',newPass:'pass'}),null);
 assert.equal(f.calls.updated.length,1);
});
test('logout limpia perfil aunque signOut devuelva error, sin borrar trazabilidad',async()=>{
 const s=storage(),f=fake({signOutError:{message:'sin red'}});
 s.setItem(KEY,'{}');s.setItem(AUTH_KEY,'auth-token-sintetico');s.setItem('spc_intento_v1_OP1_MAQ-010','{}');
 await assert.rejects(cerrarSesionPuesto({...params(f,s)}),err=>err?.message==='sin red');
 assert.equal(s.getItem(KEY),null);
 assert.equal(s.getItem(AUTH_KEY),null);
 assert.ok(s.getItem('spc_intento_v1_OP1_MAQ-010'));
 assert.deepEqual(f.calls.signOut,[{scope:'local'}]);
});

test('un perfil rechazado elimina token Auth persistido sin tocar pruebas',async()=>{
 const s=storage(),f=fake({profile:{...perfilInicial,activo:false}});
 s.setItem(AUTH_KEY,'token-fake');
 s.setItem('spc_borrador_v1_OP1_MAQ-010','evidencia');
 const u=await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'x'});
 assert.equal(u,null);
 assert.equal(s.getItem(AUTH_KEY),null);
 assert.equal(s.getItem('spc_borrador_v1_OP1_MAQ-010'),'evidencia');
});
test('fallo de red al verificar sesión descarta solo token y perfil',async()=>{
 const s=storage(),f=fake();
 await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'x'});
 s.setItem(AUTH_KEY,'token-fake');
 s.setItem('senal_plc_OP1_MAQ-010','senal');
 f.supabase.auth.getUser=async()=>{throw Error('offline')};
 assert.equal(await restaurarSesionPuesto(params(f,s)),null);
 assert.equal(s.getItem(AUTH_KEY),null);
 assert.equal(s.getItem(KEY),null);
 assert.equal(s.getItem('senal_plc_OP1_MAQ-010'),'senal');
});

test('un segundo legajo no abre sesión en un perfil con borradores de otro operario',async()=>{
 const s=storage(),f=fake();
 s.setItem('spc_borrador_v1_OP2_MAQ-010','evidencia');
 const u=await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'x'});
 assert.equal(u,null);
 assert.equal(s.getItem(KEY),null);
 assert.equal(s.getItem('spc_borrador_v1_OP2_MAQ-010'),'evidencia');
 assert.deepEqual(f.calls.signOut,[{scope:'local'}]);
});
test('una evidencia de otro legajo impide restauración aunque Auth siga válido',async()=>{
 const s=storage(),f=fake();
 await iniciarSesionPuesto({...params(f,s),legajo:'OP1',password:'x'});
 s.setItem('spc_intento_v1_OP2_MAQ-010','intento');
 assert.equal(await restaurarSesionPuesto(params(f,s)),null);
 assert.equal(s.getItem(KEY),null);
 assert.equal(s.getItem('spc_intento_v1_OP2_MAQ-010'),'intento');
});

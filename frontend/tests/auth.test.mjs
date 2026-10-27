import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionController } from '../src/auth/session.ts';
import { fallbackApiMessage } from '../src/api/error-message.ts';
import { roleHome, loginDestination, mayAccess } from '../src/auth/routes.ts';
const hr={user:{id:'hr-id',username:'fixture.hr',role:'hr',employee_id:null},employee:null,csrf_token:'hr-test-csrf'};
const employee={user:{id:'employee-id',username:'fixture.employee',role:'employee',employee_id:'own-employee'},employee:{id:'own-employee',first_name:'Fixture'},csrf_token:'employee-test-csrf'};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const loginReply=profile=>({user:profile.user,csrf_token:profile.csrf_token});
const invalid=()=>Object.assign(new Error('Invalid credentials'),{status:401,code:'INVALID_CREDENTIALS'});

test('role homes, protected areas and login return targets stay separated',()=>{
 assert.equal(roleHome('hr'),'/hr');assert.equal(roleHome('employee'),'/dashboard');
 assert.equal(loginDestination('employee','/hr'),'/dashboard');
 assert.equal(loginDestination('hr','/dashboard/tasks'),'/hr');
 assert.equal(loginDestination('employee','/dashboard/tasks'),'/dashboard/tasks');
 for(const target of ['//evil.invalid','/dashboard-evil','/hr','/dashboard/../hr','/dashboard/%2e%2e/hr','/dashboard/\\hr']){
  assert.equal(loginDestination('employee',target),'/dashboard');
 }
 assert.equal(mayAccess('employee','hr'),false);assert.equal(mayAccess('hr','employee'),false);
 assert.equal(mayAccess('employee','employee'),true);
});
test('late HR initialization cannot overwrite a confirmed employee identity or CSRF',async()=>{
 const old=deferred();let calls=0,csrf;
 const c=new SessionController({me:()=>++calls===1?old.promise:Promise.resolve(employee),login:async()=>loginReply(employee),logout:async()=>({logged_out:true})},v=>{csrf=v;});
 const initial=c.refresh();await c.signIn('fixture.employee','synthetic-test-input');old.resolve(hr);await initial;
 assert.equal(c.getSnapshot().user.role,'employee');assert.equal(csrf,employee.csrf_token);
});
test('late guest 401 cannot clear a newly accepted employee session',async()=>{
 const old=deferred();let calls=0,csrf;
 const c=new SessionController({me:()=>++calls===1?old.promise:Promise.resolve(employee),login:async()=>loginReply(employee),logout:async()=>({logged_out:true})},v=>{csrf=v;});
 const initial=c.refresh();await c.signIn('fixture.employee','synthetic-test-input');old.reject(Object.assign(new Error(),{status:401}));await initial;
 assert.equal(c.getSnapshot().status,'authenticated');assert.equal(csrf,employee.csrf_token);
});
test('login rejects a restored HR profile when the employee login response named another account',async()=>{
 const c=new SessionController({me:async()=>hr,login:async()=>loginReply(employee),logout:async()=>({logged_out:true})},()=>{});
 await assert.rejects(()=>c.signIn('fixture.employee','synthetic-test-input'),{code:'SESSION_MISMATCH'});
 assert.equal(c.getSnapshot().user,null);assert.equal(c.getSnapshot().status,'unavailable');
});
test('activation-to-login can explicitly switch an existing HR browser profile to employee',async()=>{
 let profile=hr;
 const c=new SessionController({me:async()=>profile,login:async()=>{profile=employee;return loginReply(employee);},logout:async()=>({logged_out:true})},()=>{});
 await c.refresh();const user=await c.signIn('fixture.employee','synthetic-test-input');
 assert.equal(loginDestination(user.role,'/hr'),'/dashboard');assert.equal(c.getSnapshot().employee.id,'own-employee');
});
test('failed employee login never claims an employee identity or redirects an existing HR session',async()=>{
 const c=new SessionController({me:async()=>hr,login:async()=>{throw invalid();},logout:async()=>({logged_out:true})},()=>{});
 await c.refresh();await assert.rejects(()=>c.signIn('missing.employee','synthetic-test-input'),{code:'INVALID_CREDENTIALS'});
 assert.equal(c.getSnapshot().user.id,hr.user.id);
});
test('logout clears the accepted identity and prevents a late refresh from restoring HR',async()=>{
 let csrf;const old=deferred();
 const c=new SessionController({me:()=>old.promise,login:async()=>loginReply(hr),logout:async()=>({logged_out:true})},v=>{csrf=v;});
 const pending=c.refresh();await c.signOut();old.resolve(hr);await pending;
 assert.equal(c.getSnapshot().status,'guest');assert.equal(c.getSnapshot().user,null);assert.equal(csrf,null);
});
test('failed logout does not falsely claim success',async()=>{
 const c=new SessionController({me:async()=>employee,login:async()=>loginReply(employee),logout:async()=>{throw new Error('offline');}},()=>{});
 await c.refresh();await assert.rejects(()=>c.signOut());assert.equal(c.getSnapshot().user.role,'employee');
});
test('session refresh after another tab changes cookie removes the old identity while checking',async()=>{
 let profile=hr;const pending=deferred();let count=0;
 const c=new SessionController({me:()=>++count===1?Promise.resolve(profile):pending.promise,login:async()=>loginReply(employee),logout:async()=>({logged_out:true})},()=>{});
 await c.refresh();const refresh=c.refresh();assert.equal(c.getSnapshot().user,null);
 profile=employee;pending.resolve(profile);await refresh;assert.equal(c.getSnapshot().user.role,'employee');
});
test('employee profile cannot be bound to another employee id',async()=>{
 const c=new SessionController({me:async()=>({...employee,employee:{id:'other-employee',first_name:'Other'}}),login:async()=>loginReply(employee),logout:async()=>({logged_out:true})},()=>{});
 await assert.rejects(()=>c.refresh());assert.equal(c.getSnapshot().status,'unavailable');
});

test('invalid login credentials are not described as an expired session',()=>{
 assert.equal(fallbackApiMessage(401,'INVALID_CREDENTIALS'),'Benutzername oder Passwort ist falsch.');
 assert.notEqual(fallbackApiMessage(401,'UNAUTHENTICATED'),fallbackApiMessage(401,'INVALID_CREDENTIALS'));
});

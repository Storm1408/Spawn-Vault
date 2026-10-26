const assert=require('node:assert/strict');
(async()=>{
 const {createAccountHandler}=await import('./supabase/functions/_shared/accounts.mjs');
 const calls=[],state={admin:true,blocked:false,limit:true,exists:false,createFail:false};
 const fetch=async(url,options)=>{const body=options.body?JSON.parse(options.body):null;calls.push({url,options,body});
  let data,status=200;
  if(url.endsWith('/auth/v1/user')){if(options.headers.Authorization!=='Bearer valid-session'){status=401;data={}}else data={id:'admin-id'}}
  else if(url.endsWith('/rpc/is_spawnvault_admin'))data=state.admin&&!state.blocked;
  else if(url.endsWith('/rpc/spawnvault_take_login_limit'))data=state.limit;
  else if(url.endsWith('/rpc/spawnvault_resolve_login'))data=(body.login_username.toLowerCase()==='storm'||state.exists)?[{user_id:'user-id',email:'private@example.invalid'}]:[];
  else if(url.includes('/auth/v1/token')){if(body.email==='private@example.invalid'&&body.password==='correct-password')data={access_token:'user-access',refresh_token:'user-refresh',user:{email:'private@example.invalid'}};else{data={error:'invalid_grant'};status=400}}
  else if(url.endsWith('/auth/v1/admin/users')){if(state.createFail){data={code:'email_exists'};status=422}else{data={id:'created-id',email:body.email}}}
  else throw Error('Unexpected URL '+url);
  return Response.json(data,{status});
 };
 const handler=createAccountHandler({url:'https://project.invalid',serviceKey:'SERVER-SECRET',publicKey:'PUBLIC',fetch,crypto:globalThis.crypto});
 const invoke=async(body,token)=>{const response=await handler(new Request('https://edge.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),'x-forwarded-for':'127.0.0.1'},body:JSON.stringify(body)}));return {status:response.status,body:await response.json(),headers:response.headers}};
 const payload={action:'create',username:'New_User',email:'new@example.invalid',password:'new-password',role:'moderator'};
 for(const token of [undefined,'invalid-session']){const result=await invoke(payload,token);assert.equal(result.status,401)}
 state.admin=false;assert.equal((await invoke(payload,'valid-session')).status,403);state.admin=true;state.blocked=true;assert.equal((await invoke(payload,'valid-session')).status,403);state.blocked=false;
 assert(!calls.some(c=>c.url.endsWith('/admin/users')));console.log('Server: sessão inválida, utilizador, moderador e administrador bloqueado não criam contas');
 let result=await invoke(payload,'valid-session');assert.equal(result.status,201);assert.deepEqual(result.body,{user:{id:'created-id',username:'New_User',role:'moderator'}});
 const create=calls.find(c=>c.url.endsWith('/admin/users'));assert.equal(create.options.headers.Authorization,'Bearer SERVER-SECRET');assert.equal(create.body.app_metadata.spawnvault_created_by,'admin-id');assert.equal(create.body.app_metadata.spawnvault_role,'moderator');assert.equal(create.body.email_confirm,true);
 assert(!JSON.stringify(result.body).includes('password'));assert(!JSON.stringify(result.body).includes('SERVER-SECRET'));assert.equal(result.headers.get('Cache-Control'),'no-store');
 state.exists=true;assert.equal((await invoke(payload,'valid-session')).status,409);state.exists=false;state.createFail=true;assert.equal((await invoke(payload,'valid-session')).status,409);state.createFail=false;
 assert.equal((await invoke({...payload,username:'bad name'},'valid-session')).status,400);assert.equal((await invoke({...payload,password:'short'},'valid-session')).status,400);assert.equal((await invoke({...payload,role:'owner'},'valid-session')).status,400);
 console.log('Server: criação administrativa usa Auth Admin API e marcador privado; valida dados e duplicações sem devolver credenciais');
 result=await invoke({action:'login',username:' Storm ',password:'correct-password'});assert.equal(result.status,200);assert.deepEqual(result.body,{session:{access_token:'user-access',refresh_token:'user-refresh'}});
 assert(!JSON.stringify(result.body).includes('private@example.invalid'));assert(!JSON.stringify(result.body).includes('SERVER-SECRET'));
 const wrong=await invoke({action:'login',username:'storm',password:'wrong'});const unknown=await invoke({action:'login',username:'unknown',password:'wrong'});assert.equal(wrong.status,401);assert.deepEqual(wrong.body,unknown.body);
 state.limit=false;const before=calls.filter(c=>c.url.includes('/auth/v1/token')).length;assert.equal((await invoke({action:'login',username:'storm',password:'correct-password'})).status,429);assert.equal(calls.filter(c=>c.url.includes('/auth/v1/token')).length,before);
 console.log('Server: login por username só devolve tokens, erros uniformes e limite persistente antes de autenticar');
 assert.equal((await handler(new Request('https://edge.invalid',{method:'OPTIONS'}))).status,204);assert.equal((await handler(new Request('https://edge.invalid'))).status,405);
 assert.equal((await handler(new Request('https://edge.invalid',{method:'POST',body:'invalid-json'}))).status,400);
 console.log('Account server tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1});

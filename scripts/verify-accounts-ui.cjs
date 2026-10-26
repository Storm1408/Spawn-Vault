const {chromium}=require('playwright');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
function mockAccounts(){
 const state=window.__accounts={role:'admin',active:null,calls:[],failCreate:false,failLogin:false,users:[{user_id:'admin',username:'storm',email:'admin@example.invalid',role:'admin'}]};let listener;
 const session={access_token:'admin-token',user:{id:'admin',email:'admin@example.invalid'}};
 const ok=data=>({data,error:null});
 class Query{constructor(table){this.table=table}select(){return this}eq(){return this}is(){return this}not(){return this}order(){return this}limit(){return this}maybeSingle(){this.single=true;return this}then(resolve,reject){let data=this.table==='user_roles'?{role:state.role}:this.table==='spawnvault_accounts'?{username:state.users[0].username}:[];if(this.table==='groups')data=[{id:'root',name:'Grupo',parent_id:null},{id:'sub',name:'Subgrupo',parent_id:'root'}];return Promise.resolve(ok(this.single?data:Array.isArray(data)?data:[data])).then(resolve,reject)}}
 const channel={on(){return this},subscribe(){return this}};
 window.supabase={createClient:()=>({auth:{getSession:async()=>ok({session:state.active}),onAuthStateChange(cb){listener=cb},setSession:async tokens=>{state.active=session;state.calls.push({action:'setSession',token:tokens.access_token});listener('SIGNED_IN',session);return ok({session})},signOut:async()=>{state.active=null;return ok({})}},from:table=>new Query(table),channel:()=>channel,removeChannel:async()=>{},storage:{from:()=>({createSignedUrl:async()=>ok(null)})},rpc:async(name,args)=>{
  if(name==='spawnvault_access_status')return ok({blocked:false});
  if(name==='spawnvault_list_accounts'||name==='spawnvault_list_user_access')return ok(state.users);
  if(name==='spawnvault_set_username'){state.users.find(u=>u.user_id===args.target_user).username=args.new_username;return ok(null)}
  return ok([]);
 },functions:{invoke:async(name,{body})=>{
  state.calls.push({action:body.action,name,username:body.username});
  if(body.action==='login'){
   if(state.failLogin)return {data:null,error:{context:new Response(JSON.stringify({error:'Username ou palavra-passe incorretos.'}),{status:401})}};
   return ok({session:{access_token:'admin-token',refresh_token:'admin-refresh'}});
  }
  if(state.failCreate)return {data:null,error:{context:new Response(JSON.stringify({error:'Já existe um utilizador com esse username.'}),{status:409})}};
  const user={user_id:'created',username:body.username,email:body.email,role:body.role};state.users.push(user);return ok({user:{id:user.user_id,username:user.username,role:user.role}});
 }}})};
 window.spawnVault={copyText:async()=>{},checkUpdates:async()=>({ok:true,message:'Sem atualizações'})};
}
(async()=>{const browser=await chromium.launch({executablePath:process.env.SPAWNVAULT_BROWSER,headless:true});const errors=[],checks=[];try{
 const p=await browser.newPage({viewport:{width:1280,height:900}});p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
 await p.route('https://**/*',r=>r.request().url().includes('cdn.jsdelivr.net')?r.fulfill({contentType:'application/javascript',body:'('+mockAccounts.toString()+')()'}):r.abort());
 await p.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await p.locator('#authDialog').waitFor({state:'visible'});assert.equal(await p.locator('#authUsername').getAttribute('type'),'text');assert.equal(await p.locator('#authEmail').count(),0);
 await p.locator('#authUsername').fill('storm');await p.locator('#authPassword').fill('test-password');await p.evaluate(()=>window.__accounts.failLogin=true);await p.locator('#authForm button[type=submit]').click();await p.locator('#authMessage').getByText('Username ou palavra-passe incorretos.').waitFor();assert(await p.locator('#authDialog').isVisible());
 await p.evaluate(()=>window.__accounts.failLogin=false);await p.locator('#authForm button[type=submit]').click();await p.locator('#appShell').waitFor({state:'visible'});assert((await p.locator('#userText').textContent()).startsWith('storm'));assert.equal(await p.locator('#authPassword').inputValue(),'');
 checks.push('Login pede username, apresenta erro do servidor e estabelece sessão sem resolver emails no cliente');
 await p.locator('#manageUsersBtn').click();await p.locator('#userManagerList').getByText('storm',{exact:true}).waitFor();await p.locator('#newUserBtn').click();await p.locator('#createUserUsername').fill('Nova.Conta');await p.locator('#createUserEmail').fill('new@example.invalid');await p.locator('#createUserPassword').fill('new-password');await p.locator('#createUserRole').selectOption('moderator');await p.locator('#createUserSubmit').click();await p.locator('#createUserDialog').waitFor({state:'hidden'});await p.locator('#userManagerList').getByText('Nova.Conta',{exact:true}).waitFor();assert.equal(await p.locator('#createUserPassword').inputValue(),'');assert.equal(await p.evaluate(()=>window.__accounts.active.user.id),'admin');assert.equal(await p.locator('#toast').getAttribute('data-type'),'success');
 checks.push('Administrador cria conta e cargo, mantém a própria sessão, limpa a palavra-passe e atualiza a lista');
 await p.locator('[data-username-input=created]').fill('Outro.Username');await p.locator('[data-save-username=created]').click();await p.locator('#userManagerList').getByText('Outro.Username',{exact:true}).waitFor();checks.push('Administração altera o username de uma conta existente');
 await p.locator('#newUserBtn').click();await p.locator('#createUserUsername').fill('storm');await p.locator('#createUserEmail').fill('other@example.invalid');await p.locator('#createUserPassword').fill('other-password');await p.evaluate(()=>window.__accounts.failCreate=true);await p.locator('#createUserSubmit').click();await p.locator('#createUserMessage').getByText(/Já existe/).waitFor();assert(await p.locator('#createUserDialog').isVisible());assert.equal(await p.locator('#toast').getAttribute('data-type'),'error');
 const out=process.env.SPAWNVAULT_TEST_OUTPUT||path.resolve(__dirname,'../../outputs');await p.screenshot({path:path.join(out,'v241-contas.png')});await p.locator('#closeCreateUser').click();await p.locator('#closeAdmin').click();
 await p.evaluate(()=>{window.__accounts.role='moderator';return loadOnline()});assert(await p.locator('#manageUsersBtn').isHidden());const count=await p.evaluate(()=>window.__accounts.calls.filter(c=>c.action==='create').length);await p.evaluate(()=>document.getElementById('createUserForm').dispatchEvent(new Event('submit',{cancelable:true})));assert.equal(await p.evaluate(()=>window.__accounts.calls.filter(c=>c.action==='create').length),count);checks.push('Erros de criação visíveis sobre o diálogo; moderador sem acesso ao formulário ou envio de criação');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'v241-ui-validation.json'),JSON.stringify({status:'PASS',checks,backend:'Fixtures only'},null,2));console.log(checks.join('\n'));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

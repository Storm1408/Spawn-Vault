// Optional UI check: install playwright and set SPAWNVAULT_BROWSER to a Chromium executable.
// Uses fixtures only: never signs in to or modifies the live Supabase project.
const {chromium}=require('playwright');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
function mockSupabase(){
 const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220"><rect width="320" height="220" fill="#222"/><text x="95" y="120" fill="white" font-size="30">Martelo</text></svg>');
 const role=window.__fixtureRole||'moderator',userId=role==='user'?'user':'mod';
 const s=window.__backend={role,missing:false,failReview:false,session:{access_token:'fixture',user:{id:userId,email:userId+'@example.invalid'}},groups:[{id:'root',name:'Equipamento',parent_id:null},{id:'sub',name:'Ferramentas',parent_id:'root'}],items:[{id:'item',name:'Martelo',spawn_name:'hammer',group_id:'sub',image_path:'hammer.png',deleted_at:null}],requests:[{id:'pending',name:'Alicate',spawn_name:'pliers',reason:'Ferramenta',requested_by:'user',requester_username:'Autor <teste>',status:'pending'},{id:'own',name:'Próprio',spawn_name:'own',requested_by:userId,requester_username:'O meu username',status:'pending'},{id:'done',name:'Anterior',spawn_name:'old',requested_by:'user',requester_username:'Autor <teste>',reviewed_by:'admin',reviewer_username:'Admin Storm',status:'rejected'}],archives:[],calls:[]};
 const response=(data=null,error=null)=>({data:structuredClone(data),error});
 class Query{
  constructor(table){this.table=table;this.action='select';this.filters=[]}
  select(){return this}order(){return this}limit(){return this}maybeSingle(){this.single=true;return this}
  eq(k,v){this.filters.push(r=>r[k]===v);return this}is(k,v){this.filters.push(r=>(r[k]??null)===v);return this}not(k,_,v){this.filters.push(r=>(r[k]??null)!==v);return this}
  insert(value){this.action='insert';this.value=value;return this}update(value){this.action='update';this.value=value;return this}delete(){this.action='delete';return this}
  then(ok,bad){return Promise.resolve().then(()=>{
   const key={items:'items',groups:'groups',item_requests:'requests',item_request_archives:'archives'}[this.table];let all=key?s[key]:this.table==='user_roles'?[{user_id:userId,role:s.role}]:[];
   let rows=all.filter(r=>this.filters.every(f=>f(r)));
   if(this.action==='insert'&&key){const row={id:'new-'+all.length,...this.value};all.push(row);rows=[row]}
   if(this.action==='update')rows.forEach(r=>Object.assign(r,this.value));
   if(this.action==='delete'&&key)s[key]=all.filter(r=>!rows.includes(r));
   return response(this.single?rows[0]||null:rows);
  }).then(ok,bad)}
 }
 const channel={on(){return this},subscribe(){return this}};
 window.supabase={createClient:()=>({auth:{getSession:async()=>response({session:s.session}),onAuthStateChange(){},signOut:async()=>response()},from:t=>new Query(t),channel:()=>channel,removeChannel:async()=>{},storage:{from:()=>({createSignedUrl:async()=>response({signedUrl:image}),upload:async()=>response(),remove:async()=>response()})},rpc:async(name,args)=>{
  s.calls.push({name,args});if(name==='spawnvault_access_status')return response({blocked:false});
  if(name==='spawnvault_list_requests'){
   if(s.missing)return response(null,{code:'PGRST202',message:'Function missing'});
   return response(s.requests.filter(r=>s.role!=='user'||r.requested_by===userId).map(r=>({...r,is_archived:s.archives.some(a=>a.user_id===userId&&a.request_id===r.id)})));
  }
  if(name==='spawnvault_review_request'){
   if(s.failReview)return response(null,{message:'O pedido foi eliminado ou já foi analisado'});
   const r=s.requests.find(r=>r.id===args.request_id);r.status=args.decision;r.reviewed_by=userId;r.reviewer_username='Mod Storm';
   if(args.decision==='approved'){const id='approved-'+r.id;s.items.push({id,...args.item_data,deleted_at:null});return response(id)}return response();
  }
  return response([]);
 }})};
 window.spawnVault={copyText:async()=>{},checkUpdates:async()=>({ok:true,message:'Sem atualizações'})};
}
(async()=>{const out=process.env.SPAWNVAULT_TEST_OUTPUT||path.resolve(__dirname,'../../outputs');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.SPAWNVAULT_BROWSER,headless:true});const errors=[],checks=[];
 try{
  async function pageFor(role){const p=await browser.newPage({viewport:{width:1180,height:820}});p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.addInitScript(r=>window.__fixtureRole=r,role);
   await p.route('https://**/*',r=>r.request().url().includes('cdn.jsdelivr.net')?r.fulfill({contentType:'application/javascript',body:'('+mockSupabase.toString()+')()'}):r.abort());
   await p.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await p.locator('#appShell').waitFor({state:'visible'});return p;
  }
  const p=await pageFor('moderator');assert(await p.locator('#addBtn').isVisible());assert(await p.locator('#manageUsersBtn').isHidden());assert(await p.locator('#navTrash').isHidden());assert(await p.locator('#importLabel').isHidden());
  await p.locator('[data-category="sub"]').click();await p.locator('#addBtn').click();assert(await p.locator('input[name=itemGroup][value=sub]').isChecked());
  await p.locator('#itemName').fill('Duplicado');await p.locator('#itemSpawn').fill('hammer');await p.locator('#itemForm button[type=submit]').click();await p.locator('#toast').getByText(/Já existe/).waitFor();
  assert(await p.locator('#itemDialog').isVisible());assert.equal(await p.locator('#toast').getAttribute('data-type'),'error');assert(await p.evaluate(()=>document.getElementById('toast').matches(':popover-open')));
  await p.waitForTimeout(250);assert(await p.evaluate(()=>{const e=document.getElementById('toast');e.style.pointerEvents='auto';const r=e.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);e.style.pointerEvents='';return top===e}));
  await p.screenshot({path:path.join(out,'v24-erro-em-frente.png')});checks.push('Moderador: criação visível, administração/CSV/reciclagem ocultos; subgrupo pré-selecionado; erro vermelho visível acima do diálogo');
  await p.locator('#itemSpawn').fill('new_spawn');await p.locator('#itemForm button[type=submit]').click();await p.locator('#itemDialog').waitFor({state:'hidden'});assert.equal(await p.locator('#toast').getAttribute('data-type'),'success');
  assert.equal(await p.evaluate(()=>window.__backend.items.filter(i=>i.spawn_name==='new_spawn').length),1);checks.push('Moderador cria item no grupo existente e recebe confirmação verde');
  await p.locator('#itemsBody [data-image="item"]').click();await p.locator('#imageViewerDialog').waitFor({state:'visible'});assert.equal(await p.locator('#imageViewerTitle').textContent(),'Martelo');assert(await p.locator('#imageViewerImage').evaluate(i=>i.complete&&i.naturalWidth>0));await p.screenshot({path:path.join(out,'v24-imagem-ampliada.png')});await p.keyboard.press('Escape');await p.locator('#imageViewerDialog').waitFor({state:'hidden'});
  await p.locator('#viewToggle').click();await p.locator('#itemsCards [data-image="item"]').click();await p.locator('#imageViewerDialog').waitFor({state:'visible'});await p.locator('#closeImageViewer').click();checks.push('Imagem amplia nas vistas tabela e cartões; fecha pelo botão e Escape');
  await p.locator('#navRequests').click();assert((await p.locator('#requestsList').textContent()).includes('Autor <teste>'));assert((await p.locator('#requestsList').textContent()).includes('Admin Storm'));assert.equal(await p.locator('#requestsList script').count(),0);
  await p.locator('[data-approve=pending]').click();await p.locator('#itemDialog').waitFor({state:'visible'});await p.locator('#itemForm button[type=submit]').click();await p.locator('#itemDialog').waitFor({state:'hidden'});await p.locator('#navRequests').click();await p.locator('#requestsList').getByText(/Aceite por: Mod Storm/).waitFor();assert.equal(await p.evaluate(()=>window.__backend.items.filter(i=>i.spawn_name==='pliers').length),1);
  await p.locator('[data-reject=own]').click();await p.locator('#requestsList').getByText(/Rejeitado por: Mod Storm/).waitFor();checks.push('Nomes de autor e revisor escapados; aprovação usa operação única; rejeição identifica moderador');
  await p.locator('[data-archive=done]').click();assert.equal(await p.locator('[data-archive=done]').count(),0);await p.locator('#requestArchiveBtn').click();await p.locator('[data-unarchive=done]').click();assert.equal(await p.locator('[data-unarchive=done]').count(),0);await p.locator('#requestArchiveBtn').click();assert(await p.locator('[data-archive=done]').isVisible());await p.screenshot({path:path.join(out,'v24-pedidos.png')});checks.push('Botão Arquivo, arquivar e retirar do arquivo funcionam');
  await p.evaluate(()=>{window.__backend.requests.push({id:'race',name:'Corrida',spawn_name:'race',status:'pending',requested_by:'user'});return loadRequests().then(renderRequests)});await p.locator('[data-approve=race]').click();await p.evaluate(()=>window.__backend.failReview=true);await p.locator('#itemForm button[type=submit]').click();await p.locator('#toast').getByText(/já foi analisado/).waitFor();assert(await p.locator('#itemDialog').isVisible());assert.equal(await p.evaluate(()=>window.__backend.items.filter(i=>i.spawn_name==='race').length),0);await p.locator('#cancelDialog').click();checks.push('Erro de decisão concorrente mantém formulário aberto e não afirma sucesso');
  const u=await pageFor('user');assert(await u.locator('#addBtn').isHidden());await u.locator('#navRequests').click();assert.equal(await u.locator('[data-approve]').count(),0);assert.equal(await u.locator('[data-reject]').count(),0);await u.locator('[data-cancel-request=own]').click();assert.equal(await u.locator('[data-cancel-request=own]').count(),0);assert.equal(await u.locator('[data-cancel-request=done]').count(),0);checks.push('Utilizador elimina pedido próprio pendente; pedidos concluídos não têm eliminação; sem ações de moderação');
  await u.evaluate(()=>{window.__backend.missing=true;return loadRequests().then(renderRequests)});assert(await u.locator('#requestMigrationHint').isVisible());assert(await u.locator('#requestArchiveBtn').isDisabled());assert(await u.locator('#appShell').isVisible());checks.push('Migração em falta mantém acesso ao catálogo e explica novas opções indisponíveis');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'v24-ui-validation.json'),JSON.stringify({status:'PASS',checks,backend:'Fixtures only; live Supabase not accessed'},null,2));console.log(checks.join('\n'));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

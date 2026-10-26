// SpawnVault v2 — Supabase online, grupos e permissões.
// Preenche a chave PÚBLICA abaixo. Nunca uses uma service_role/secret key.
const SUPABASE_URL = 'https://hlsbsmewlqtonxsrpnue.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5d-mtW0hyjdg35JAWLsV5g_5N2fgQwv';
const $ = id => document.getElementById(id);
const LOCAL_KEY = 'spawnvault.items.v1';
const GROUP_KEY = 'spawnvault.groups.v1';
const IMAGE_BUCKET = 'item-images';
let sessionUsername='',savingAccount=false,signingIn=false;
const usernamePattern=/^[A-Za-z0-9_$][A-Za-z0-9._$-]{2,39}$/;
let imageUrls = new Map(), pendingImage = null, removeImage = false, busySaving = false;
const sessionStore = { getItem: k => sessionStorage.getItem(k), setItem: (k,v) => sessionStorage.setItem(k,v), removeItem: k => sessionStorage.removeItem(k) };

let items=[], groups=[], client=null, session=null, role='user', toastTimer=null, view='dashboard', cardMode=false, favorites=new Set(), requests=[], trash=[], realtimeChannel=null, refreshPending=false, collapsedGroups=new Set();
const onlineConfigured=()=>Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('COLOCA_'));
const isAdmin=()=>role==='admin' && Boolean(session);
const canEdit=()=>isAdmin();
const canCreate=()=>Boolean(session)&&['admin','moderator'].includes(role);
const canReview=canCreate;
let requestsReady=false,showRequestArchive=false;
const roleName=value=>({admin:'Administrador',moderator:'Moderador',user:'Utilizador'}[value]||'Utilizador');
const escapeHtml=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalizeRow=r=>({id:r.id??crypto.randomUUID(),name:String(r.name??r.item_name??'').trim(),spawn:String(r.spawn??r.spawn_name??'').trim(),group_id:r.group_id??null,created_at:r.created_at??null,category:String(r.category??'').trim(),description:String(r.description??'').trim(),image_path:r.image_path??null});
function notify(s,type='error'){
 const el=$('toast');el.textContent=s;el.dataset.type=type;el.setAttribute('role',type==='error'?'alert':'status');
 clearTimeout(toastTimer);if(el.matches(':popover-open'))el.hidePopover();
 // A toast dentro do diálogo ativo também continua acessível durante a modalidade.
 ([...document.querySelectorAll('dialog[open]')].at(-1)||document.body).append(el);
 el.classList.add('show');el.showPopover();
 toastTimer=setTimeout(()=>{el.classList.remove('show');if(el.matches(':popover-open'))el.hidePopover()},5000);
}
function readLocal(){try{return JSON.parse(localStorage.getItem(LOCAL_KEY))||[]}catch{return []}}
function saveLocal(){localStorage.setItem(LOCAL_KEY,JSON.stringify(items));localStorage.setItem(GROUP_KEY,JSON.stringify(groups));}
function readGroups(){try{return JSON.parse(localStorage.getItem(GROUP_KEY))||[]}catch{return []}}
const roots=()=>groups.filter(g=>!g.parent_id).sort((a,b)=>a.name.localeCompare(b.name,'pt'));
const children=id=>groups.filter(g=>g.parent_id===id).sort((a,b)=>a.name.localeCompare(b.name,'pt'));
function groupName(item){const g=groups.find(g=>g.id===item.group_id);if(!g)return item.category||'Sem subgrupo';const parent=groups.find(x=>x.id===g.parent_id);return parent?`${parent.name} / ${g.name}`:g.name;}
function groupMatches(item,id){return item.group_id===id || groups.find(g=>g.id===item.group_id)?.parent_id===id;}
function renderCategories(){const selected=$('categoryFilter').value;
 $('categoryList').innerHTML='<button class="nav-item" data-category="">◈ <span>Todos</span></button>'+roots().map(g=>`<div class="tree-root"><button class="nav-item tree-toggle" data-toggle="${escapeHtml(g.id)}">${collapsedGroups.has(g.id)?'▸':'▾'} <span>${escapeHtml(g.name)}</span></button>${collapsedGroups.has(g.id)?'':`<div class="tree-children">${children(g.id).map(c=>`<button class="nav-item" data-category="${escapeHtml(c.id)}">◇ <span>${escapeHtml(c.name)}</span></button>`).join('')}</div>`}</div>`).join('');
 $('categoryFilter').innerHTML='<option value="">Todos os grupos</option>'+roots().map(g=>`<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)} (todos)</option>`+children(g.id).map(c=>`<option value="${escapeHtml(c.id)}">↳ ${escapeHtml(c.name)}</option>`).join('')).join('');$('categoryFilter').value=groups.some(g=>g.id===selected)?selected:'';$('categoryCount').textContent=groups.length;}
function getFiltered(){const q=$('searchInput').value.trim().toLocaleLowerCase('pt'),g=$('categoryFilter').value;return items.filter(x=>(view!=='favorites'||favorites.has(x.id))&&(!g||groupMatches(x,g))&&(!q||[x.name,x.spawn,groupName(x),x.description].some(s=>String(s||'').toLocaleLowerCase('pt').includes(q)))).sort((a,b)=>a.name.localeCompare(b.name,'pt'));}
function itemButtons(x){return `<button class="copy-btn" data-copy="${escapeHtml(x.id)}">▢ Copiar</button><button class="icon-btn small ${favorites.has(x.id)?'is-favorite':''}" data-favorite="${escapeHtml(x.id)}" title="Favorito">${favorites.has(x.id)?'★':'☆'}</button>${canEdit()?`<button class="icon-btn small" data-edit="${escapeHtml(x.id)}" title="Editar">✎</button><button class="icon-btn small danger" data-delete="${escapeHtml(x.id)}" title="Reciclagem">×</button>`:''}`;}
function renderDashboard(){const latest=[...items].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,6);$('dashboardGrid').innerHTML=[['Itens',items.length],['Grupos principais',roots().length],['Subgrupos',groups.filter(g=>g.parent_id).length],['Favoritos',favorites.size],['Pedidos pendentes',requests.filter(r=>r.status==='pending').length]].map(([k,v])=>`<div class="stat-card"><span>${escapeHtml(k)}</span><strong>${v}</strong></div>`).join('');$('dashboardRecent').innerHTML=latest.map(x=>`<div class="feature-row"><strong>${escapeHtml(x.name)}</strong><code>${escapeHtml(x.spawn)}</code><span>${escapeHtml(groupName(x))}</span></div>`).join('')||'<p class="muted">Sem itens.</p>';}
function render(){if(!isAdmin()){if($('adminDialog').open)$('adminDialog').close();if($('blockUserDialog').open)$('blockUserDialog').close();if($('createUserDialog').open)$('createUserDialog').close();}renderCategories();const filtered=getFiltered();$('totalCount').textContent=items.length;$('resultCount').textContent=filtered.length;$('footerCount').textContent=`${filtered.length} ${filtered.length===1?'item':'itens'}`;$('emptyState').style.display=filtered.length?'none':'block';
 $('itemsBody').innerHTML=filtered.map(x=>`<tr><td><div class="item-identity">${imageUrls.has(x.id)?`<button class="image-zoom" data-image="${escapeHtml(x.id)}" aria-label="Ampliar imagem de ${escapeHtml(x.name)}"><img class="item-thumb" src="${escapeHtml(imageUrls.get(x.id))}" alt=""></button>`:'<span class="item-thumb item-placeholder">SV</span>'}<strong>${escapeHtml(x.name)}</strong></div></td><td><code class="spawn-code">${escapeHtml(x.spawn)}</code></td><td><span class="category-chip">${escapeHtml(groupName(x))}</span></td><td class="description-cell">${escapeHtml(x.description||'—')}</td><td class="row-actions">${itemButtons(x)}</td></tr>`).join('');
 $('itemsCards').innerHTML=filtered.map(x=>`<article class="item-card">${imageUrls.has(x.id)?`<button class="image-zoom card-zoom" data-image="${escapeHtml(x.id)}" aria-label="Ampliar imagem de ${escapeHtml(x.name)}"><img class="card-image" src="${escapeHtml(imageUrls.get(x.id))}" alt=""></button>`:'<div class="card-image card-placeholder">SV</div>'}<h3>${escapeHtml(x.name)}</h3><code>${escapeHtml(x.spawn)}</code><p>${escapeHtml(groupName(x))}</p><div class="card-actions">${itemButtons(x)}</div></article>`).join('');
 $('addBtn').hidden=!canCreate();$('emptyAddBtn').hidden=!canCreate();$('importLabel').hidden=!canEdit();$('exportBtn').hidden=!isAdmin();$('manageUsersBtn').hidden=!isAdmin();$('navTrash').hidden=!isAdmin();
 $('dashboardPanel').hidden=view!=='dashboard';$('catalogToolbar').hidden=!['catalog','favorites'].includes(view);$('catalogStats').hidden=!['catalog','favorites'].includes(view);$('catalogPanel').hidden=!['catalog','favorites'].includes(view);$('requestsPanel').hidden=view!=='requests';$('trashPanel').hidden=view!=='trash';$('itemsCards').hidden=!cardMode;$('itemsTable').hidden=cardMode;
 $('viewToggle').textContent=cardMode?'☷ Vista em tabela':'▦ Vista em cartões';document.querySelectorAll('.sidebar .nav-item[id^="nav"]').forEach(el=>el.classList.toggle('active',({dashboard:'navDashboard',catalog:'navAll',favorites:'navFavorites',requests:'navRequests',trash:'navTrash'}[view]===el.id)));
 renderDashboard();renderRequests();renderTrash();}
function renderGroupOptions(selected=null){$('itemGroupOptions').innerHTML=roots().map(g=>`<div class="option-root"><strong>▾ ${escapeHtml(g.name)}</strong>${children(g.id).map(c=>`<label class="group-option"><input type="checkbox" name="itemGroup" value="${escapeHtml(c.id)}" ${c.id===selected?'checked':''}><span>${escapeHtml(c.name)}</span></label>`).join('')||'<p class="muted">Sem subgrupos</p>'}</div>`).join('')||'<div class="group-empty">Cria primeiro um grupo principal e um subgrupo.</div>';}
function renderGroupManager(){const counts=new Map(groups.map(g=>[g.id,items.filter(x=>groupMatches(x,g.id)).length]));$('newGroupParent').innerHTML='<option value="">Grupo principal</option>'+roots().map(g=>`<option value="${escapeHtml(g.id)}">Subgrupo de ${escapeHtml(g.name)}</option>`).join('');$('groupManagerList').innerHTML=roots().map(g=>`<div class="manager-root"><div class="group-manager-row"><span class="group-name">▣ <strong>${escapeHtml(g.name)}</strong> <small>(${counts.get(g.id)} itens)</small></span><button class="btn btn-secondary" data-rename="${escapeHtml(g.id)}">Editar</button><button class="btn btn-secondary" data-remove="${escapeHtml(g.id)}" ${children(g.id).length?'disabled':''}>Eliminar</button></div>${children(g.id).map(c=>`<div class="group-manager-row manager-child"><span class="group-name">↳ ${escapeHtml(c.name)} <small>(${counts.get(c.id)} itens)</small></span><button class="btn btn-secondary" data-rename="${escapeHtml(c.id)}">Editar</button><button class="btn btn-secondary" data-remove="${escapeHtml(c.id)}" ${counts.get(c.id)?'disabled':''}>Eliminar</button></div>`).join('')}</div>`).join('')||'<p class="muted">Sem grupos.</p>';}
async function loadOnline(){if(!client||!session)return;await ensureSpawnVaultAccess();if(!session)return;const [g,i,r]=await Promise.all([client.from('groups').select('id,name,parent_id').order('name'),client.from('items').select('*').is('deleted_at',null).order('name'),client.from('user_roles').select('role').eq('user_id',session.user.id).maybeSingle()]);for(const x of [g,i,r])if(x.error)throw x.error;groups=g.data||[];items=(i.data||[]).map(x=>normalizeRow({...x,spawn:x.spawn_name}));role=r.data?.role||'user';const account=await client.from('spawnvault_accounts').select('username').eq('user_id',session.user.id).maybeSingle();if(account.error&&!['42P01','PGRST205'].includes(account.error.code))throw account.error;sessionUsername=account.data?.username||session.user.user_metadata?.username||session.user.email?.split('@')[0]||'';await Promise.all([loadFavorites(),loadRequests(),isAdmin()?loadTrash():Promise.resolve()]);await refreshImageUrls();render();updateConnection();}
async function refreshImageUrls(){
 imageUrls=new Map(); if(!client||!session)return;
 const withImages=items.filter(x=>x.image_path);
 await Promise.all(withImages.map(async x=>{
   const {data,error}=await client.storage.from(IMAGE_BUCKET).createSignedUrl(x.image_path,3600);
   if(!error&&data?.signedUrl)imageUrls.set(x.id,data.signedUrl);
 }));
}
async function uploadImage(file){
 if(!file)return null;
 const allowed=['image/png','image/jpeg','image/webp','image/gif'];
 if(!allowed.includes(file.type))throw Error('Formato não suportado. Usa PNG, JPG, WebP ou GIF.');
 if(file.size>3*1024*1024)throw Error('A imagem deve ter no máximo 3 MB.');
 const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[file.type];
 const path=`${crypto.randomUUID()}.${ext}`;
 const {error}=await client.storage.from(IMAGE_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
 if(error)throw error;
 return path;
}
async function saveItem(item){
 if(!canCreate()||!client||!session)throw Error('É necessário iniciar sessão como moderador ou administrador.');
 if(!groups.some(g=>g.id===item.group_id&&g.parent_id))throw Error('Seleciona um subgrupo existente.');
 const previous=items.find(x=>x.id===item.id);
 if(previous&&!isAdmin())throw Error('Apenas administradores podem editar itens.');
 const oldPath=previous?.image_path||null;
 let newPath=null,committed=false;
 try{
   if(pendingImage)newPath=await uploadImage(pendingImage);
   const path=newPath||(removeImage?null:oldPath);
   const payload={name:item.name,spawn_name:item.spawn,category:groupName(item),group_id:item.group_id,description:item.description,image_path:path};
   const query=pendingRequestId?client.rpc('spawnvault_review_request',{request_id:pendingRequestId,decision:'approved',item_data:payload}):previous?client.from('items').update(payload).eq('id',item.id).select('id'):client.from('items').insert({...payload,created_by:session.user.id}).select('id');
   const {data,error}=await query;
   if(error)throw error;
   if(!data||Array.isArray(data)&&!data.length)throw Error('Não foi possível guardar. Verifica as permissões da base de dados.');
   committed=true;pendingRequestId=null;
   try{await loadOnline()}catch(e){notify('Item guardado. Não foi possível atualizar o catálogo: '+e.message);}
   if(oldPath&&oldPath!==path)await client.storage.from(IMAGE_BUCKET).remove([oldPath]);
 }catch(e){if(newPath&&!committed)await client.storage.from(IMAGE_BUCKET).remove([newPath]);throw e;}
}
async function deleteItem(id){if(!isAdmin())return;if(!confirm('Mover este item para a reciclagem?'))return;try{const {data,error}=await client.from('items').update({deleted_at:new Date().toISOString()}).eq('id',id).select('id');if(error)throw error;if(!data?.length)throw Error('Sem permissão.');await loadOnline();notify('Item movido para a reciclagem.','success')}catch(e){notify(`Erro: ${e.message}`)}}
function openItem(item=null){if(!canCreate()||(item&&!isAdmin()))return;pendingRequestId=null; if(!groups.some(g=>g.parent_id)){notify('Cria primeiro um subgrupo em «Gerir grupos».');return;}$('itemForm').reset();pendingImage=null;removeImage=false;$('itemImagePreview').src=item?.id&&imageUrls.has(item.id)?imageUrls.get(item.id):'';$('itemImagePreview').hidden=!Boolean(item?.id&&imageUrls.has(item.id));$('removeImageBtn').hidden=!Boolean(item?.image_path);$('itemImage').value='';$('itemId').value=item?.id||'';$('itemName').value=item?.name||'';$('itemSpawn').value=item?.spawn||'';$('itemDescription').value=item?.description||'';$('dialogTitle').textContent=item?'Editar item':'Adicionar item';renderGroupOptions(item?.group_id||groups.find(g=>g.id===$('categoryFilter').value&&g.parent_id)?.id||null);$('dialogNote').textContent='Cada item pertence a um único grupo existente.';$('itemDialog').showModal();}
async function createGroup(name,parent_id=null){if(!isAdmin())throw Error('Sem permissão.');name=name.trim();if(!name||name.length>60)throw Error('Nome inválido.');if(parent_id&&!roots().some(g=>g.id===parent_id))throw Error('Grupo principal inválido.');if(groups.some(g=>g.name.toLocaleLowerCase('pt')===name.toLocaleLowerCase('pt')))throw Error('Já existe um grupo com esse nome.');const {error}=await client.from('groups').insert({name,parent_id,created_by:session.user.id});if(error)throw error;await loadOnline();renderGroupManager();}
async function renameGroup(id,name){if(!isAdmin())throw Error('Sem permissão.');name=name.trim();if(!name||name.length>60)throw Error('Nome inválido.');if(groups.some(g=>g.id!==id&&g.name.toLocaleLowerCase('pt')===name.toLocaleLowerCase('pt')))throw Error('Já existe um grupo com esse nome.');const {data,error}=await client.from('groups').update({name}).eq('id',id).select('id');if(error)throw error;if(!data?.length)throw Error('Não foi possível alterar o grupo.');await loadOnline();renderGroupManager();}
async function removeGroup(id){if(!isAdmin())return;if(items.some(x=>groupMatches(x,id))||children(id).length)return notify('Grupo com itens ou subgrupos associados.');if(!confirm('Eliminar este grupo?'))return;try{const {error}=await client.from('groups').delete().eq('id',id);if(error)throw error;await loadOnline();renderGroupManager();notify('Grupo eliminado.','success')}catch(e){notify(`Erro: ${e.message}`)}}
function csvEscape(v){return `"${String(v??'').replace(/"/g,'""')}"`}
function exportCsv(){if(!isAdmin())return notify('Apenas administradores podem exportar CSV.');const data=[['name','spawn','category','description'],...items.map(x=>[x.name,x.spawn,groupName(x),x.description])].map(row=>row.map(csvEscape).join(';')).join('\r\n');const blob=new Blob(['\ufeff'+data],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='spawnvault-items.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function parseCsv(text){const sep=(text.split(/\r?\n/,1)[0].match(/;/g)||[]).length>=(text.split(/\r?\n/,1)[0].match(/,/g)||[]).length?';':',';const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'&&quoted&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=!quoted;else if(c===sep&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}else field+=c;}if(field||row.length){row.push(field);rows.push(row)}const headers=(rows.shift()||[]).map(s=>s.replace(/^\ufeff/,'').trim().toLowerCase());return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]||'').trim()]))).map(r=>({name:r.name||r.item||r.item_name,spawn:r.spawn||r.spawn_name,category:r.category||'',description:r.description||''})).filter(x=>x.name&&x.spawn);}
async function importCsv(file){if(!file||!canEdit())return;try{const rows=parseCsv(await file.text());if(!rows.length)throw Error('CSV sem itens válidos.');const unknown=[...new Set(rows.map(r=>r.category).filter(n=>!groups.some(g=>g.parent_id&&g.name.toLocaleLowerCase('pt')===n.toLocaleLowerCase('pt'))))];if(unknown.length)throw Error(`Cria primeiro estes grupos: ${unknown.join(', ')||'(sem grupo)'}`);let n=0;for(const row of rows){const g=groups.find(g=>g.parent_id&&g.name.toLocaleLowerCase('pt')===row.category.toLocaleLowerCase('pt'));await saveItem(normalizeRow({...row,group_id:g.id}));n++;}notify(`${n} itens importados.`,'success')}catch(e){notify(`Erro na importação: ${e.message}`)}finally{$('importFile').value='';}}
function showLogin(){$('appShell').hidden=true;if(!$('authDialog').open)$('authDialog').showModal();}
function updateConnection(){const online=Boolean(client&&session);$('connectionDot').classList.toggle('online',online);$('connectionText').textContent=online?'Ligado à nuvem':(onlineConfigured()?'Sessão não iniciada':'Modo local');$('userText').textContent=session?.user?.email?`${sessionUsername||session.user.email} · ${roleName(role)}`:(onlineConfigured()?'Clica para iniciar sessão':'Dados neste computador');$('syncPill').textContent=online?'Sincronizado':(onlineConfigured()?'Sem sessão':'Local');$('syncPill').classList.toggle('online-pill',online);}
async function onSession(s){session=s;role='user';sessionUsername='';items=[];groups=[];favorites=new Set();requests=[];requestsReady=false;showRequestArchive=false;trash=[];imageUrls=new Map();if(realtimeChannel&&client){await client.removeChannel(realtimeChannel);realtimeChannel=null;}if(session){try{await loadOnline();subscribeRealtime();$('appShell').hidden=false;if($('authDialog').open)$('authDialog').close();}catch(e){$('appShell').hidden=true;showLogin();$('authMessage').textContent=e.code==='SPAWNVAULT_BLOCKED'?e.message:`Erro de sincronização: ${e.message}`;}}else{render();showLogin()}updateConnection();}
async function setupSupabase(){if(!onlineConfigured()){showLogin();$('authMessage').textContent='Configura o URL e a chave pública do Supabase no renderer.js.';return;}if(!window.supabase){notify('Não foi possível carregar o Supabase. Verifica a internet.');showLogin();updateConnection();return;}client=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{storage:sessionStore,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});const {data,error}=await client.auth.getSession();if(error)throw error;client.auth.onAuthStateChange((_event,s)=>{if(s?.access_token===session?.access_token)return;setTimeout(()=>onSession(s),0)});await onSession(data.session);}
async function loadFavorites(){favorites=new Set();if(!session)return;const {data,error}=await client.from('item_favorites').select('item_id').eq('user_id',session.user.id);if(error)throw error;favorites=new Set((data||[]).map(x=>x.item_id));}
async function toggleFavorite(id){if(!session)return;const had=favorites.has(id);const {error}=had?await client.from('item_favorites').delete().eq('user_id',session.user.id).eq('item_id',id):await client.from('item_favorites').insert({user_id:session.user.id,item_id:id});if(error)return notify(`Erro: ${error.message}`);had?favorites.delete(id):favorites.add(id);render();}
async function loadRequests(){
 if(!session)return;const {data,error}=await client.rpc('spawnvault_list_requests');
 if(error){
  if(!['PGRST202','42883'].includes(error.code))throw error;
  requestsReady=false;const old=await client.from('item_requests').select('*').order('created_at',{ascending:false}).limit(200);
  if(old.error)throw old.error;requests=old.data||[];return;
 }
 requestsReady=true;requests=data||[];
}
async function loadTrash(){const {data,error}=await client.from('items').select('*').not('deleted_at','is',null).order('deleted_at',{ascending:false}).limit(200);if(error)throw error;trash=data||[];}
function renderRequests(){
 $('requestMigrationHint').hidden=requestsReady;
 $('requestArchiveBtn').disabled=!requestsReady;
 $('requestArchiveBtn').textContent=showRequestArchive?'← Voltar aos pedidos':'Arquivo ('+requests.filter(r=>r.is_archived).length+')';
 $('requestArchiveBtn').setAttribute('aria-pressed',String(showRequestArchive));
 const visible=requests.filter(r=>Boolean(r.is_archived)===showRequestArchive);
 const status={pending:'Pendente',approved:'Aceite',rejected:'Rejeitado'};
 $('requestsList').innerHTML=visible.map(r=>{
  const id=escapeHtml(r.id),pending=r.status==='pending';
  const actions=requestsReady?(pending?
   (canReview()?'<button class="btn btn-primary" data-approve="'+id+'">Aprovar</button><button class="btn btn-secondary" data-reject="'+id+'">Rejeitar</button>':'')+
   (r.requested_by===session?.user.id?'<button class="btn btn-secondary" data-cancel-request="'+id+'">Eliminar pedido</button>':''):
   '<button class="btn btn-secondary" '+(r.is_archived?'data-unarchive':'data-archive')+'="'+id+'">'+(r.is_archived?'Retirar do arquivo':'Arquivar')+'</button>'):'';
  return '<div class="feature-row request-row"><div><strong>'+escapeHtml(r.name)+'</strong> <code>'+escapeHtml(r.spawn_name)+'</code><p class="muted">'+escapeHtml(r.reason||'Sem observações')+'</p><p>Pedido por: <strong>'+escapeHtml(r.requester_username||r.requested_by||'Conta removida')+'</strong></p><small>'+escapeHtml(status[r.status]||r.status)+(pending?'':' · '+(r.status==='approved'?'Aceite':'Rejeitado')+' por: '+escapeHtml(r.reviewer_username||'Conta removida'))+'</small></div><div class="request-actions">'+actions+'</div></div>';
 }).join('')||'<p class="muted panel-padding">'+(showRequestArchive?'O teu arquivo está vazio.':'Sem pedidos nesta lista.')+'</p>';
}
function renderTrash(){$('trashList').innerHTML=trash.map(x=>`<div class="feature-row"><strong>${escapeHtml(x.name)}</strong><code>${escapeHtml(x.spawn_name)}</code><button class="btn btn-secondary" data-restore="${escapeHtml(x.id)}">Restaurar</button></div>`).join('')||'<p class="muted panel-padding">Reciclagem vazia.</p>';}
async function reloadFeatures(){await Promise.all([loadFavorites(),loadRequests(),isAdmin()?loadTrash():Promise.resolve()]);render();}
function subscribeRealtime(){if(!client||!session)return;realtimeChannel=client.channel('spawnvault-v22').on('postgres_changes',{event:'*',schema:'public',table:'items'},scheduleRefresh).on('postgres_changes',{event:'*',schema:'public',table:'groups'},scheduleRefresh).on('postgres_changes',{event:'*',schema:'public',table:'item_requests'},scheduleRefresh).subscribe();}
function scheduleRefresh(){if(refreshPending)return;refreshPending=true;setTimeout(async()=>{refreshPending=false;if(!session)return;try{await loadOnline()}catch(e){notify(`Sincronização: ${e.message}`)}},650);}
$('addBtn').addEventListener('click',()=>openItem());$('emptyAddBtn').addEventListener('click',()=>openItem());$('closeDialog').addEventListener('click',()=>{pendingRequestId=null;$('itemDialog').close()});$('cancelDialog').addEventListener('click',()=>{pendingRequestId=null;$('itemDialog').close()});$('searchInput').addEventListener('input',render);$('categoryFilter').addEventListener('change',render);$('refreshBtn').addEventListener('click',async()=>{try{if(client&&session)await loadOnline();else if(!onlineConfigured()){items=readLocal();groups=readGroups();render()}notify('Catálogo atualizado.','success')}catch(e){notify(`Erro: ${e.message}`)}});$('exportBtn').addEventListener('click',exportCsv);$('importFile').addEventListener('change',e=>importCsv(e.target.files[0]));$('navAll').addEventListener('click',()=>{view='catalog';$('categoryFilter').value='';render()});$('categoryList').addEventListener('click',e=>{const b=e.target.closest('[data-category]');if(b){view='catalog';$('categoryFilter').value=b.dataset.category;render()}const t=e.target.closest('[data-toggle]');if(t){const id=t.dataset.toggle;collapsedGroups.has(id)?collapsedGroups.delete(id):collapsedGroups.add(id);renderCategories()}});
$('itemGroupOptions').addEventListener('change',e=>{if(e.target.matches('input[type="checkbox"]')&&e.target.checked)$('itemGroupOptions').querySelectorAll('input').forEach(c=>{if(c!==e.target)c.checked=false})});
$('itemsBody').addEventListener('click',handleItemAction);$('itemsCards').addEventListener('click',handleItemAction);async function handleItemAction(e){const image=e.target.closest('[data-image]');if(image){await openImage(image.dataset.image);return;}const copy=e.target.closest('[data-copy]'),edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(copy){const item=items.find(x=>x.id===copy.dataset.copy);if(item){try{await window.spawnVault.copyText(item.spawn);notify(`Spawn "${item.spawn}" copiado.`,'success')}catch(err){notify(`Erro ao copiar: ${err.message}`)}}}if(edit){const item=items.find(x=>x.id===edit.dataset.edit);if(item)openItem(item)}if(del)await deleteItem(del.dataset.delete);const fav=e.target.closest('[data-favorite]');if(fav)await toggleFavorite(fav.dataset.favorite);}
$('itemImage').addEventListener('change',e=>{const file=e.target.files[0];if(!file)return;if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>3*1024*1024){notify('Imagem inválida: PNG, JPG, WebP ou GIF, até 3 MB.');e.target.value='';return;}pendingImage=file;removeImage=false;const reader=new FileReader();reader.onload=()=>{$('itemImagePreview').src=reader.result;$('itemImagePreview').hidden=false};reader.readAsDataURL(file);$('removeImageBtn').hidden=false;});
$('removeImageBtn').addEventListener('click',()=>{pendingImage=null;removeImage=true;$('itemImage').value='';$('itemImagePreview').hidden=true;$('itemImagePreview').removeAttribute('src');$('removeImageBtn').hidden=true;});
$('itemForm').addEventListener('submit',async e=>{e.preventDefault();const selected=$('itemGroupOptions').querySelector('input:checked');if(!selected)return notify('Seleciona um subgrupo.');const item=normalizeRow({id:$('itemId').value||crypto.randomUUID(),name:$('itemName').value,spawn:$('itemSpawn').value,group_id:selected.value,description:$('itemDescription').value});if(!item.name||!item.spawn)return notify('Preenche o nome e o spawn.');if(items.some(x=>x.id!==item.id&&x.spawn.toLowerCase()===item.spawn.toLowerCase()))return notify('Já existe um item com este nome de spawn.');if(busySaving)return;busySaving=true;try{await saveItem(item); $('itemDialog').close();notify('Item guardado.','success')}catch(err){notify(`Erro ao guardar: ${err.message}`)}finally{busySaving=false}});
$('groupForm').addEventListener('submit',async e=>{e.preventDefault();try{await createGroup($('newGroupName').value,$('newGroupParent').value||null);$('newGroupName').value='';notify('Grupo criado.','success')}catch(err){notify(`Erro: ${err.message}`)}});$('groupManagerList').addEventListener('click',async e=>{const rename=e.target.closest('[data-rename]'),remove=e.target.closest('[data-remove]');if(rename){const g=groups.find(g=>g.id===rename.dataset.rename);if(!g)return;const row=rename.closest('.group-manager-row');row.innerHTML=`<form class="rename-group-form" data-group="${escapeHtml(g.id)}"><input maxlength="60" required aria-label="Novo nome do grupo" value="${escapeHtml(g.name)}"><button class="btn btn-primary" type="submit">Guardar</button><button class="btn btn-secondary" type="button" data-cancel-rename>Cancelar</button></form>`;row.querySelector('input').focus();}if(remove)await removeGroup(remove.dataset.remove);if(e.target.closest('[data-cancel-rename]'))renderGroupManager();});
$('groupManagerList').addEventListener('submit',async e=>{const form=e.target.closest('.rename-group-form');if(!form)return;e.preventDefault();try{await renameGroup(form.dataset.group,form.querySelector('input').value);notify('Grupo atualizado.','success')}catch(err){notify(`Erro: ${err.message}`)}});
$('authDialog').addEventListener('cancel',e=>e.preventDefault());$('authDialog').addEventListener('close',()=>{if(!session)showLogin();else $('authMessage').textContent='';});$('userText').addEventListener('click',()=>{if(!session)showLogin()});async function accountService(body){
 const {data,error}=await client.functions.invoke('spawnvault-accounts',{body});
 if(error){let detail;try{detail=await error.context?.json()}catch{}throw Error(detail?.error||'Serviço de contas indisponível. Verifica a ligação ou contacta um administrador.');}
 if(data?.error)throw Error(data.error);if(!data)throw Error('Resposta inválida do serviço de contas.');return data;
}
$('authForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!client||signingIn)return;
 const username=$('authUsername').value.trim(),password=$('authPassword').value;
 if(!usernamePattern.test(username)){$('authMessage').textContent='Indica o username atribuído pela administração.';return;}
 signingIn=true;const button=$('authForm').querySelector('button[type=submit]');button.disabled=true;$('authMessage').textContent='A iniciar sessão…';
 try{const data=await accountService({action:'login',username,password});
  if(!data.session?.access_token||!data.session?.refresh_token)throw Error('Não foi possível confirmar a sessão.');
  const {error}=await client.auth.setSession(data.session);if(error)throw error;
  $('authPassword').value='';$('authMessage').textContent='';
 }catch(error){$('authMessage').textContent=error.message;}
 finally{signingIn=false;button.disabled=false;}
});$('signOutBtn').addEventListener('click',async()=>{if(client)await client.auth.signOut();await onSession(null);notify('Sessão terminada.','success')});
showLogin();setupSupabase().catch(e=>{items=[];groups=[];role='user';render();updateConnection();showLogin();$('authMessage').textContent=`Erro de ligação: ${e.message}`;});

// Encerramento normal: revogar sessão antes de fechar a janela.
if(window.spawnVault?.onBeforeClose){window.spawnVault.onBeforeClose(async()=>{
 try{if(client)await Promise.race([client.auth.signOut(),new Promise(resolve=>setTimeout(resolve,1200))]);}catch(_){}
 sessionStorage.clear();window.spawnVault.closeReady();
});}

async function loadAdminPanel(){
 if(!isAdmin())return;
 const [{data:users,error:ue},{data:audit,error:ae}]=await Promise.all([
   client.rpc('spawnvault_list_accounts'),
   client.from('item_audit').select('created_at,action,item_name,actor_email').order('created_at',{ascending:false}).limit(60)
 ]);
 if(ue)throw ue;if(ae)throw ae;
 $('userManagerList').innerHTML=(users||[]).map(u=>`<div class="group-manager-row"><span class="group-name"><strong>${escapeHtml(u.username||'Username por configurar')}</strong><small>${escapeHtml(u.email||u.user_id)} · ${escapeHtml(roleName(u.role))}</small></span><div class="account-controls"><input aria-label="Username de ${escapeHtml(u.email||u.user_id)}" data-username-input="${escapeHtml(u.user_id)}" value="${escapeHtml(u.username||'')}" minlength="3" maxlength="40" autocomplete="off"><button type="button" class="btn btn-secondary" data-save-username="${escapeHtml(u.user_id)}">Guardar username</button><select aria-label="Cargo de ${escapeHtml(u.username||u.email||u.user_id)}" data-user-role="${escapeHtml(u.user_id)}"><option value="user" ${u.role==='user'?'selected':''}>Utilizador</option><option value="moderator" ${u.role==='moderator'?'selected':''}>Moderador</option><option value="admin" ${u.role==='admin'?'selected':''}>Administrador</option></select></div></div>`).join('')||'<p>Sem utilizadores.</p>';
 $('auditList').innerHTML=(audit||[]).map(a=>`<div class="audit-row"><strong>${escapeHtml(a.action)}</strong> · ${escapeHtml(a.item_name||'—')}<br><small>${escapeHtml(a.actor_email||'Sistema')} · ${escapeHtml(new Date(a.created_at).toLocaleString('pt-PT'))}</small></div>`).join('')||'<p>Sem alterações registadas.</p>';
}
$('manageUsersBtn').addEventListener('click',async()=>{if(!isAdmin())return;renderGroupManager();$('adminDialog').showModal();try{await loadAdminPanel()}catch(e){notify(`Erro no painel: ${e.message}`)}});
$('closeAdmin').addEventListener('click',()=>$('adminDialog').close());
$('userManagerList').addEventListener('change',async e=>{const el=e.target.closest('[data-user-role]');if(!el)return;if(!confirm('Alterar as permissões deste utilizador?')){await loadAdminPanel();return;}try{const {error}=await client.rpc('spawnvault_set_user_role',{target_user:el.dataset.userRole,new_role:el.value});if(error)throw error;await loadAdminPanel();notify('Permissões atualizadas.','success')}catch(err){notify(`Erro: ${err.message}`);await loadAdminPanel();}});

// Navegação, pedidos, reciclagem e atualização.
$('navDashboard').addEventListener('click',()=>{view='dashboard';render()});
$('navFavorites').addEventListener('click',()=>{view='favorites';render()});
$('navRequests').addEventListener('click',()=>{view='requests';render()});
$('navTrash').addEventListener('click',async()=>{if(!isAdmin())return;await loadTrash();view='trash';render()});
$('viewToggle').addEventListener('click',()=>{cardMode=!cardMode;render()});
$('newRequestBtn').addEventListener('click',()=>{$('requestForm').reset();$('requestDialog').showModal()});
$('closeRequest').addEventListener('click',()=>$('requestDialog').close());
$('requestForm').addEventListener('submit',async e=>{e.preventDefault();const payload={name:$('requestName').value.trim(),spawn_name:$('requestSpawn').value.trim(),reason:$('requestReason').value.trim(),requested_by:session.user.id};if(!payload.name||!payload.spawn_name)return;const {error}=await client.from('item_requests').insert(payload);if(error)return notify(`Erro: ${error.message}`);$('requestDialog').close();await loadRequests();render();notify('Pedido enviado.','success')});
$('requestArchiveBtn').addEventListener('click',async()=>{showRequestArchive=!showRequestArchive;try{await loadRequests();renderRequests()}catch(e){notify(e.message)}});
const requestActionsBusy=new Set();
$('requestsList').addEventListener('click',async e=>{
 const b=e.target.closest('[data-approve],[data-reject],[data-cancel-request],[data-archive],[data-unarchive]');
 if(!b||!requestsReady)return;
 const id=b.dataset.approve||b.dataset.reject||b.dataset.cancelRequest||b.dataset.archive||b.dataset.unarchive;
 const req=requests.find(x=>x.id===id);if(!req||requestActionsBusy.has(id))return;
 try{
  if(b.dataset.approve){
   if(!canReview()||req.status!=='pending')return;
   if(items.some(x=>x.spawn.toLowerCase()===req.spawn_name.toLowerCase()))throw Error('Já existe um item com esse spawn.');
   if(!groups.some(g=>g.parent_id))throw Error('Pede a um administrador que crie primeiro um subgrupo.');
   view='catalog';render();openItem();$('itemName').value=req.name;$('itemSpawn').value=req.spawn_name;pendingRequestId=id;
   notify('Escolhe o subgrupo e guarda o item para concluir o pedido.','info');return;
  }
  if(b.dataset.cancelRequest){
   if(req.requested_by!==session.user.id||req.status!=='pending')return;
   if(!confirm('Eliminar este pedido pendente?'))return;
  }
  requestActionsBusy.add(id);b.disabled=true;let result;
  if(b.dataset.reject){if(!canReview()||req.status!=='pending')return;result=await client.rpc('spawnvault_review_request',{request_id:id,decision:'rejected'});}
  else if(b.dataset.cancelRequest){result=await client.from('item_requests').delete().eq('id',id).eq('requested_by',session.user.id).eq('status','pending').select('id');if(!result.error&&!result.data?.length)throw Error('O pedido já foi analisado ou eliminado.');}
  else if(b.dataset.archive){if(req.status==='pending')return;result=await client.from('item_request_archives').insert({user_id:session.user.id,request_id:id});}
  else result=await client.from('item_request_archives').delete().eq('user_id',session.user.id).eq('request_id',id);
  if(result.error)throw result.error;await loadRequests();render();notify(b.dataset.reject?'Pedido rejeitado.':b.dataset.cancelRequest?'Pedido eliminado.':b.dataset.archive?'Pedido arquivado.':'Pedido retirado do arquivo.','success');
 }catch(err){notify(err.message);try{await loadRequests();renderRequests()}catch{}}
 finally{requestActionsBusy.delete(id);b.disabled=false;}
});
async function openImage(id){
 const item=items.find(x=>x.id===id);if(!item?.image_path)return;
 try{const {data,error}=await client.storage.from(IMAGE_BUCKET).createSignedUrl(item.image_path,3600);if(error||!data?.signedUrl)throw error||Error('Imagem indisponível.');
 $('imageViewerTitle').textContent=item.name;$('imageViewerImage').alt=item.name;$('imageViewerImage').src=data.signedUrl;$('imageViewerDialog').showModal();
 }catch(e){notify('Não foi possível abrir a imagem: '+e.message)}
}
$('closeImageViewer').addEventListener('click',()=>$('imageViewerDialog').close());
$('imageViewerDialog').addEventListener('close',()=>$('imageViewerImage').removeAttribute('src'));
$('imageViewerImage').addEventListener('error',()=>notify('Não foi possível carregar a imagem. Tenta novamente.'));

let pendingRequestId=null;
$('trashList').addEventListener('click',async e=>{if(!isAdmin())return;const b=e.target.closest('[data-restore]');if(!b)return;const {error}=await client.from('items').update({deleted_at:null}).eq('id',b.dataset.restore);if(error)return notify(error.message);await loadOnline();notify('Item restaurado.','success');});
$('checkUpdatesBtn').addEventListener('click',async()=>{const result=await window.spawnVault.checkUpdates();notify(result?.message||'Verificação iniciada.',result?.ok===false?'error':'info');});

// Contas e usernames: só os administradores acedem a estas ações; o servidor volta a validar.
$('newUserBtn').addEventListener('click',()=>{if(!isAdmin())return;$('createUserForm').reset();$('createUserMessage').textContent='';$('createUserDialog').showModal()});
$('closeCreateUser').addEventListener('click',()=>{if(!savingAccount)$('createUserDialog').close()});
$('createUserDialog').addEventListener('cancel',e=>{if(savingAccount)e.preventDefault()});
$('createUserDialog').addEventListener('close',()=>{$('createUserPassword').value=''});
$('createUserForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!isAdmin()||savingAccount)return;
 const username=$('createUserUsername').value.trim();if(!usernamePattern.test(username))return notify('Username inválido: usa 3 a 40 letras, números, ponto, _, $ ou -.');
 savingAccount=true;$('createUserSubmit').disabled=true;$('createUserMessage').textContent='A criar utilizador…';
 try{const data=await accountService({action:'create',username,email:$('createUserEmail').value.trim(),password:$('createUserPassword').value,role:$('createUserRole').value});
  if(!data.user?.id)throw Error('Não foi possível confirmar a criação da conta. Atualiza a lista antes de tentar novamente.');
  $('createUserDialog').close();notify('Utilizador '+data.user.username+' criado.','success');
  try{await loadAdminPanel()}catch{notify('Utilizador criado. Atualiza a lista para o visualizar.','info')}
 }catch(error){$('createUserMessage').textContent=error.message;notify(error.message)}
 finally{savingAccount=false;$('createUserSubmit').disabled=false;}
});
$('userManagerList').addEventListener('click',async e=>{
 const b=e.target.closest('[data-save-username]');if(!b||!isAdmin()||b.disabled)return;
 const target=b.dataset.saveUsername,input=[...$('userManagerList').querySelectorAll('[data-username-input]')].find(i=>i.dataset.usernameInput===target),username=input?.value.trim();
 if(!username||!usernamePattern.test(username))return notify('Username inválido: usa 3 a 40 letras, números, ponto, _, $ ou -.');
 b.disabled=true;try{const {error}=await client.rpc('spawnvault_set_username',{target_user:target,new_username:username});if(error)throw error;
  if(target===session.user.id){sessionUsername=username;updateConnection()}await loadAdminPanel();notify('Username atualizado.','success');
 }catch(error){notify(error.code==='23505'?'Já existe um utilizador com esse username.':error.message)}finally{b.disabled=false}
});

// App access is enforced by migration_v23_access.sql, never by local flags alone.
let blockUsers = [], blockTarget = null, savingBlock = false, accessCheckBusy = false;
const accessMigrationMissing = error => ['PGRST202','42883'].includes(error?.code);
async function ensureSpawnVaultAccess() {
  if (!client || !session) return;
  const account = session.user.id;
  const {data,error} = await client.rpc('spawnvault_access_status');
  if (session?.user.id !== account) return;
  // The existing v2.2 catalogue stays usable before the additive migration is applied.
  // Blocking remains unavailable and clearly labelled until its RPCs exist.
  if (error) { if (accessMigrationMissing(error)) return; throw error; }
  if (!data || typeof data.blocked !== 'boolean') throw Error('Não foi possível verificar o acesso.');
  if (!data.blocked) return;
  const reason = typeof data.reason === 'string' && data.reason.trim() ? data.reason.trim() : 'Motivo não indicado pelo administrador.';
  const blockedMessage = `O teu acesso ao SpawnVault está bloqueado.\nMotivo: ${reason}\nContacta um administrador se precisares de esclarecimentos.`;
  for (const dialog of document.querySelectorAll('dialog[open]')) if (dialog.id !== 'authDialog') dialog.close();
  const activeClient = client;
  // Clear the UI and local session even if the sign-out endpoint is unavailable.
  await onSession(null);
  document.getElementById('authPassword').value = '';
  document.getElementById('authMessage').textContent = blockedMessage;
  activeClient.auth.signOut().catch(()=>{});
  const denied = Error(blockedMessage);
  denied.code = 'SPAWNVAULT_BLOCKED';
  throw denied;
}
async function refreshAccessStatus() {
  if (accessCheckBusy || !client || !session) return;
  accessCheckBusy = true;
  try { await ensureSpawnVaultAccess(); }
  catch(error) { if(error.code !== 'SPAWNVAULT_BLOCKED') console.warn('Não foi possível verificar o acesso.'); }
  finally { accessCheckBusy = false; }
}
setInterval(refreshAccessStatus,15000);
window.addEventListener('focus',refreshAccessStatus);

function renderBlockUsers() {
  const q = document.getElementById('blockSearch').value.trim().toLocaleLowerCase('pt');
  const filter = document.getElementById('blockFilter').value;
  const selected = blockUsers.filter(u => (!q || String(u.email||u.user_id).toLocaleLowerCase('pt').includes(q)) && (!filter || u.blocked === (filter === 'blocked')));
  document.getElementById('blockUserList').innerHTML = selected.map(u => `<div class="block-user-row"><div class="block-user-info"><strong>${escapeHtml(u.email||u.user_id)}</strong><small>${u.role==='admin'?'Administrador':'Utilizador'}${u.user_id===session?.user.id?' · A tua conta':''}</small>${u.blocked&&u.reason?`<p>${escapeHtml(u.reason)}</p>`:''}</div><span class="access-badge ${u.blocked?'blocked':'active'}">${u.blocked?'Bloqueado':'Ativo'}</span><button type="button" class="btn ${u.blocked?'btn-secondary':'btn-block'}" data-block-user="${escapeHtml(u.user_id)}" ${u.user_id===session?.user.id?'disabled title="Não podes bloquear a tua própria conta"':''}>${u.blocked?'Desbloquear':'Bloquear'}</button></div>`).join('') || '<p class="muted">Sem utilizadores para os filtros selecionados.</p>';
}
async function loadBlockUsers() {
  if (!isAdmin() || !client) return;
  const account = session.user.id;
  const message = document.getElementById('blockMessage');
  message.textContent = 'A carregar utilizadores…';
  const {data,error} = await client.rpc('spawnvault_list_user_access');
  if (!isAdmin() || session?.user.id !== account) return;
  if (error) {
    blockUsers=[]; document.getElementById('blockUserList').textContent='';
    message.textContent = accessMigrationMissing(error) ? 'Bloqueios ainda não ativados. Aplica o ficheiro supabase/migration_v23_access.sql no Supabase.' : `Não foi possível carregar os utilizadores: ${error.message}`;
    return;
  }
  blockUsers=data||[];message.textContent='';renderBlockUsers();
}
document.addEventListener('admin-tab-selected',event=>{
  if(event.target.id==='adminBlocksTab') loadBlockUsers().catch(error=>{document.getElementById('blockMessage').textContent=error.message;});
});
document.getElementById('blockSearch').addEventListener('input',renderBlockUsers);
document.getElementById('blockFilter').addEventListener('change',renderBlockUsers);
document.getElementById('blockUserList').addEventListener('click',event=>{
  const button=event.target.closest('[data-block-user]');if(!button||!isAdmin())return;
  const user=blockUsers.find(u=>u.user_id===button.dataset.blockUser);if(!user||user.user_id===session.user.id)return;
  blockTarget={id:user.user_id,blocked:!user.blocked};
  const label=blockTarget.blocked?'Bloquear utilizador':'Desbloquear utilizador';
  document.getElementById('blockUserForm').reset();
  document.getElementById('blockDialogTitle').textContent=label;
  document.getElementById('confirmBlockUser').textContent=label;
  document.getElementById('blockTargetEmail').textContent=user.email||user.user_id;
  document.getElementById('blockReasonLabel').hidden=!blockTarget.blocked;
  document.getElementById('blockExplanation').textContent=blockTarget.blocked?'O acesso à aplicação será suspenso. A conta, os dados e as permissões serão mantidos.':'O utilizador voltará a poder aceder à aplicação com as mesmas permissões.';
  document.getElementById('blockActionMessage').textContent='';
  document.getElementById('blockUserDialog').showModal();
});
for (const id of ['closeBlockUser','cancelBlockUser']) document.getElementById(id).addEventListener('click',()=>{if(!savingBlock)document.getElementById('blockUserDialog').close();});
document.getElementById('blockUserDialog').addEventListener('cancel',event=>{if(savingBlock)event.preventDefault();});
document.getElementById('blockUserForm').addEventListener('submit',async event=>{
  event.preventDefault();if(savingBlock||!blockTarget||!isAdmin()||!client)return;
  savingBlock=true;document.getElementById('confirmBlockUser').disabled=true;
  const target={...blockTarget};
  try {
    const {error}=await client.rpc('spawnvault_set_user_block',{target_user:target.id,blocked_value:target.blocked,block_reason:document.getElementById('blockReason').value.trim()});
    if(error)throw error;
    document.getElementById('blockUserDialog').close();
    notify(target.blocked?'Utilizador bloqueado.':'Utilizador desbloqueado.');
    await loadBlockUsers();await loadAdminPanel();
  } catch(error) {document.getElementById('blockActionMessage').textContent=error.message;}
  finally {savingBlock=false;document.getElementById('confirmBlockUser').disabled=false;}
});
document.getElementById('adminDialog').addEventListener('close',()=>{
  blockUsers=[];document.getElementById('blockUserList').textContent='';
  document.getElementById('blockSearch').value='';document.getElementById('blockFilter').value='';
});

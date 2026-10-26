// Server only. No secrets, passwords, JWTs or request bodies are logged.
const usernamePattern=/^[A-Za-z0-9_$][A-Za-z0-9._$-]{2,39}$/;
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
export function createAccountHandler(env){
 const respond=(status,value)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json'}});
 async function api(path,body,{token=env.serviceKey,key=env.serviceKey,method='POST'}={}){
  const response=await env.fetch(env.url+path,{method,headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data;try{data=await response.json()}catch{data=null}return {ok:response.ok,status:response.status,data};
 }
 const hash=async text=>Array.from(new Uint8Array(await env.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
 return async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return respond(405,{error:'Método não permitido.'});
  if(!env.url||!env.serviceKey||!env.publicKey)return respond(503,{error:'Serviço de contas ainda não configurado. Contacta um administrador.'});
  try{
   if(Number(request.headers.get('content-length')||0)>8192)return respond(413,{error:'Pedido demasiado grande.'});
   const text=await request.text();if(text.length>8192)return respond(413,{error:'Pedido demasiado grande.'});
   let body;try{body=JSON.parse(text)}catch{return respond(400,{error:'Pedido inválido.'})}
   if(!body||typeof body!=='object')return respond(400,{error:'Pedido inválido.'});
   if(body.action==='login'){
    const username=typeof body.username==='string'?body.username.trim():'';
    const password=typeof body.password==='string'?body.password:'';
    if(!usernamePattern.test(username)||!password||password.length>1024)return respond(401,{error:'Username ou palavra-passe incorretos.'});
    const ip=(request.headers.get('x-forwarded-for')||request.headers.get('x-real-ip')||'unknown').split(',')[0].trim();
    const ipLimit=await api('/rest/v1/rpc/spawnvault_take_login_limit',{bucket_key:'ip:'+await hash(ip),max_hits:60});
    const nameLimit=await api('/rest/v1/rpc/spawnvault_take_login_limit',{bucket_key:'name:'+await hash(username.toLowerCase()),max_hits:20});
    if(!ipLimit.ok||!nameLimit.ok)return respond(503,{error:'Serviço de login indisponível. Contacta um administrador.'});
    if(ipLimit.data!==true||nameLimit.data!==true)return respond(429,{error:'Demasiadas tentativas. Aguarda 15 minutos e tenta novamente.'});
    const lookup=await api('/rest/v1/rpc/spawnvault_resolve_login',{login_username:username});
    if(!lookup.ok)return respond(503,{error:'Serviço de login indisponível. Contacta um administrador.'});
    const account=lookup.data?.[0];
    // Mesmo pedido ao Auth para usernames inexistentes, sem revelar o email associado.
    const auth=await api('/auth/v1/token?grant_type=password',{email:account?.email||'invalid-login@spawnvault.invalid',password},{key:env.publicKey,token:env.publicKey});
    if(!account||!auth.ok||!auth.data?.access_token||!auth.data?.refresh_token)return respond(401,{error:'Username ou palavra-passe incorretos.'});
    return respond(200,{session:{access_token:auth.data.access_token,refresh_token:auth.data.refresh_token}});
   }
   if(body.action==='create'){
    const token=request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if(!token)return respond(401,{error:'Inicia sessão como administrador.'});
    const caller=await api('/auth/v1/user',undefined,{method:'GET',key:env.publicKey,token});
    if(!caller.ok||!caller.data?.id)return respond(401,{error:'Sessão inválida. Inicia sessão novamente.'});
    const allowed=await api('/rest/v1/rpc/is_spawnvault_admin',{}, {key:env.publicKey,token});
    if(!allowed.ok)return respond(503,{error:'Não foi possível verificar as permissões.'});
    if(allowed.data!==true)return respond(403,{error:'Apenas administradores ativos podem criar utilizadores.'});
    const username=typeof body.username==='string'?body.username.trim():'';
    const email=typeof body.email==='string'?body.email.trim():'';
    const password=body.password,role=body.role||'user';
    if(!usernamePattern.test(username))return respond(400,{error:'Username inválido: usa 3 a 40 letras, números, ponto, _, $ ou -.'});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return respond(400,{error:'Indica um email válido.'});
    if(typeof password!=='string'||password.length<8||password.length>128)return respond(400,{error:'A palavra-passe deve ter entre 8 e 128 caracteres.'});
    if(!['user','moderator','admin'].includes(role))return respond(400,{error:'Cargo inválido.'});
    const existing=await api('/rest/v1/rpc/spawnvault_resolve_login',{login_username:username});
    if(!existing.ok)return respond(503,{error:'Aplica primeiro a migração v2.4.1 no Supabase.'});
    if(existing.data?.length)return respond(409,{error:'Já existe um utilizador com esse username.'});
    const created=await api('/auth/v1/admin/users',{email,password,email_confirm:true,user_metadata:{username},app_metadata:{spawnvault_created_by:caller.data.id,spawnvault_username:username,spawnvault_role:role}});
    if(!created.ok){
     if(['email_exists','user_already_exists'].includes(created.data?.code))return respond(409,{error:'Já existe uma conta com esse email.'});
     // O trigger faz rollback da conta se houver uma colisão simultânea ou se o administrador perder acesso.
     const conflict=await api('/rest/v1/rpc/spawnvault_resolve_login',{login_username:username});
     if(conflict.ok&&conflict.data?.length)return respond(409,{error:'Já existe um utilizador com esse username.'});
     return respond(400,{error:'Não foi possível criar a conta. Verifica as permissões, o email e a política de palavras-passe do Supabase.'});
    }
    if(!created.data?.id)return respond(502,{error:'Não foi possível confirmar a criação da conta. Atualiza a lista antes de tentar novamente.'});
    return respond(201,{user:{id:created.data.id,username,role}});
   }
   return respond(400,{error:'Operação inválida.'});
  }catch{return respond(503,{error:'Serviço de contas temporariamente indisponível. Tenta novamente.'})}
 };
}

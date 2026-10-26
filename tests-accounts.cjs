const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const db=new PGlite(),ids={admin:'10000000-0000-4000-8000-000000000001',mod:'10000000-0000-4000-8000-000000000002',user:'10000000-0000-4000-8000-000000000003',same:'10000000-0000-4000-8000-000000000004'};
async function as(who,sql,params=[]){await db.exec('SET ROLE authenticated');try{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[ids[who]]);return (await db.query(sql,params)).rows}finally{await db.exec('RESET ROLE')}}
async function denied(who,sql,params=[]){await assert.rejects(()=>as(who,sql,params))}
async function migrate(file){await db.exec(fs.readFileSync(path.join(__dirname,'supabase',file),'utf8').replace(/create extension if not exists pgcrypto;/ig,'').split('-- Publicação Realtime')[0])}
(async()=>{try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE SCHEMA storage;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',raw_app_meta_data jsonb DEFAULT '{}',encrypted_password text DEFAULT 'existing-hash');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon,service_role;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;`);
 for(const file of ['schema.sql','migration_v2.sql','migration_v21.sql','migration_v22.sql','migration_v23_access.sql','migration_v23_block_reason.sql','migration_v24.sql'])await migrate(file);
 for(const [who,id]of Object.entries(ids))await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)',[id,(who==='same'?'user':who)+'@example.invalid',who==='admin'?{username:'$torm'}:who==='mod'?{username:'Mod Storm'}:{}]);
 await db.query("INSERT INTO public.user_roles VALUES($1,'admin'),($2,'moderator')",[ids.admin,ids.mod]);
 const original=(await db.query('SELECT * FROM auth.users ORDER BY id')).rows;
 await migrate('migration_v241.sql');await migrate('migration_v241.sql');
 assert.deepEqual((await db.query('SELECT * FROM auth.users ORDER BY id')).rows,original);
 let rows=await as('admin','SELECT * FROM public.spawnvault_list_accounts()');assert.equal(rows.length,4);assert.equal(rows.find(r=>r.user_id===ids.admin).username,'$torm');assert.equal(rows.find(r=>r.user_id===ids.mod).username,'Mod_Storm');assert.notEqual(rows.find(r=>r.user_id===ids.user).username.toLowerCase(),rows.find(r=>r.user_id===ids.same).username.toLowerCase());
 console.log('Accounts DB: migração repetível preserva todas as contas/credenciais e resolve usernames inválidos ou duplicados');
 await denied('mod','SELECT * FROM public.spawnvault_list_accounts()');await denied('user','SELECT * FROM public.spawnvault_list_accounts()');
 assert.equal((await as('user','SELECT * FROM public.spawnvault_accounts')).length,1);
 await denied('user',"UPDATE public.spawnvault_accounts SET username='admin'");await denied('user','SELECT * FROM public.spawnvault_resolve_login($1)',['$torm']);
 await denied('user','SELECT public.spawnvault_take_login_limit($1,20)',['key']);
 await as('admin','SELECT public.spawnvault_set_username($1,$2)',[ids.user,'New.User']);await denied('admin','SELECT public.spawnvault_set_username($1,$2)',[ids.same,'new.user']);await denied('mod','SELECT public.spawnvault_set_username($1,$2)',[ids.user,'Other']);
 console.log('Accounts DB: usernames únicos sem distinção de maiúsculas; só admin lista/renomeia; emails de login não são públicos');
 await db.exec('SET ROLE service_role');assert.equal((await db.query("SELECT * FROM public.spawnvault_resolve_login('NEW.USER')")).rows[0].user_id,ids.user);
 for(let i=0;i<21;i++)assert.equal((await db.query("SELECT public.spawnvault_take_login_limit('test',20) AS allowed")).rows[0].allowed,i<20);
 await db.exec('RESET ROLE');await db.exec("UPDATE public.spawnvault_login_limits SET window_start=now()-interval '16 minutes'");await db.exec('SET ROLE service_role');assert.equal((await db.query("SELECT public.spawnvault_take_login_limit('test',20) AS allowed")).rows[0].allowed,true);await db.exec('RESET ROLE');
 const fresh='10000000-0000-4000-8000-000000000005';
 await assert.rejects(()=>db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)',[fresh,'new@example.invalid',{username:'New_User',spawnvault_created_by:ids.admin}]));
 const metadata={spawnvault_created_by:ids.admin,spawnvault_username:'New_User',spawnvault_role:'moderator'};
 await assert.rejects(()=>db.query('INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,$2,$3)',[fresh,'new@example.invalid',{...metadata,spawnvault_created_by:ids.mod}]));
 await db.query('INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,$2,$3)',[fresh,'new@example.invalid',metadata]);
 assert.equal((await db.query('SELECT role FROM public.user_roles WHERE user_id=$1',[fresh])).rows[0].role,'moderator');assert.equal((await db.query('SELECT username FROM public.spawnvault_accounts WHERE user_id=$1',[fresh])).rows[0].username,'New_User');
 const conflict='10000000-0000-4000-8000-000000000006';await assert.rejects(()=>db.query('INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,$2,$3)',[conflict,'other@example.invalid',{...metadata,spawnvault_username:'new_user'}]));assert.equal((await db.query('SELECT * FROM auth.users WHERE id=$1',[conflict])).rows.length,0);
 assert.equal((await db.query("SELECT * FROM public.item_audit WHERE action='users:CREATE'")).rows.length,1);
 console.log('Accounts DB: signup público e marcadores forjados no perfil recusados; criação, cargo e audit atómicos; colisão reverte nova conta');
 await as('admin','SELECT public.spawnvault_set_user_block($1,true)',[ids.mod]);await denied('mod','SELECT public.spawnvault_set_username($1,$2)',[ids.user,'Denied']);
 await db.query('INSERT INTO public.spawnvault_user_access(user_id,blocked) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET blocked=true',[ids.admin]);
 await assert.rejects(()=>db.query('INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,$2,$3)',[conflict,'blocked@example.invalid',{...metadata,spawnvault_username:'Another'}]));
 await denied('admin','SELECT * FROM public.spawnvault_list_accounts()');
 await db.exec('SET ROLE anon');await assert.rejects(()=>db.query("SELECT * FROM public.spawnvault_resolve_login('$torm')"));await db.exec('RESET ROLE');
 console.log('Accounts DB: limites expiram corretamente; contas bloqueadas sem novas permissões; acesso anónimo recusado');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

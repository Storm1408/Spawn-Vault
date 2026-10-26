const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json')));
assert.equal(pkg.version,lock.version);assert.equal(pkg.version,lock.packages[''].version);
for(const file of ['main.js','preload.js','renderer.js','branding.js','access.js','updates.js'])new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
const config=JSON.parse(fs.readFileSync(path.join(root,'update-config.json')));
assert.equal(config.owner,'Storm1408');assert.equal(config.repo,'Spawn-Vault');assert.equal(config.provider,'github');
assert.equal(config.owner,pkg.build.publish[0].owner);assert.equal(config.repo,pkg.build.publish[0].repo);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'Duplicate HTML IDs');
for(const id of ['adminUsersTab','adminGroupsTab','adminBlocksTab','adminLogsTab','blockUserForm','authMessage','requestArchiveBtn','requestMigrationHint','imageViewerDialog','imageViewerImage','authUsername','createUserDialog','createUserForm','newUserBtn'])assert(ids.includes(id),id);
assert(!ids.includes('manageGroupsBtn'),'Groups must stay inside Administration');
console.log(`Source checks passed for SpawnVault ${pkg.version}`);

assert(!ids.includes('authEmail'),'Login must use username');

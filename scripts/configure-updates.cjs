const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
try {
 const url=new URL(process.argv[2]);
 const parts=url.pathname.replace(/\/$/,'').replace(/\.git$/,'').split('/').filter(Boolean);
 if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.search||url.hash||parts.length!==2||!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(parts[0])||!/^[a-zA-Z0-9_.-]+$/.test(parts[1])||['.','..'].includes(parts[1]))throw Error('Indica o URL HTTPS de um repositório GitHub público.');
 const config={provider:'github',owner:parts[0],repo:parts[1]};
 const file=path.join(root,'package.json');const pkg=JSON.parse(fs.readFileSync(file,'utf8'));
 pkg.build.publish=[{...config,releaseType:'release'}];
 fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');
 fs.writeFileSync(path.join(root,'update-config.json'),JSON.stringify(config,null,2)+'\n');
 console.log(`Distribuição configurada para ${config.owner}/${config.repo}. Compila um novo instalador para distribuir esta configuração.`);
}catch(error){console.error(error.message);process.exitCode=1;}

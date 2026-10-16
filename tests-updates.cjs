const assert=require('assert/strict'),fs=require('fs');const {EventEmitter}=require('events');
const {createUpdateService}=require('./updates');
function harness(options={}){
 const updater=new EventEmitter(),calls={checks:0,downloads:0,dialogs:[],install:[],prepared:0,timers:[],progress:[]},answers=[];
 updater.checkForUpdates=async()=>{calls.checks++;return {isUpdateAvailable:true,updateInfo:{version:'2.4.0'}}};
 updater.downloadUpdate=async()=>{calls.downloads++;updater.emit('download-progress',{percent:55});return ['fixture.exe']};
 updater.quitAndInstall=(...args)=>calls.install.push(args);
 const service=createUpdateService({app:{isPackaged:true,getVersion:()=> '2.3.0'},autoUpdater:updater,publish:{provider:'github',owner:'fixture-owner',repo:'fixture-repo'},dialog:{showMessageBox:async dialog=>{calls.dialogs.push(dialog);return {response:answers.shift()??0}}},beforeInstall:async()=>{calls.prepared++;},setProgress:n=>calls.progress.push(n),schedule:(f,ms)=>calls.timers.push({f,ms}),repeat:(f,ms)=>calls.timers.push({f,ms}),...options});
 return {updater,calls,answers,service};
}
(async()=>{const checks=[];
 const h=harness();assert.equal(h.updater.autoDownload,false);assert.equal(h.updater.autoInstallOnAppQuit,false);assert.equal(h.updater.allowPrerelease,false);assert.equal(h.updater.allowDowngrade,false);
 h.service.start();assert.deepEqual(h.calls.timers.map(t=>t.ms),[15000,14400000]);checks.push('Checks scheduled after launch and every four hours; stable channel, no downgrade or silent install');
 await h.service.check();assert.equal(h.calls.dialogs.length,1);assert.equal(h.calls.downloads,0);await h.service.check();assert.equal(h.calls.dialogs.length,1);checks.push('Available version prompts every user; deferral does not repeatedly prompt in the same session');
 h.answers.push(1,0);await h.service.check({manual:true});assert.equal(h.calls.downloads,1);assert.equal(h.calls.install.length,0);assert(h.calls.progress.includes(.55));checks.push('Manual retry downloads with progress and lets user defer installation');
 h.answers.push(1);await h.service.check({manual:true});assert.equal(h.calls.downloads,1);assert.equal(h.calls.prepared,1);assert.deepEqual(h.calls.install,[[false,true]]);checks.push('Downloaded update can be installed later; logout preparation runs before restart');
 const empty=harness();empty.updater.checkForUpdates=async()=>({isUpdateAvailable:false,updateInfo:{version:'2.2.0'}});await empty.service.check();assert.equal(empty.calls.dialogs.length,0);checks.push('Same/older/unavailable version does not prompt');
 const off=harness();off.updater.checkForUpdates=async()=>{throw Error('Offline')};const result=await off.service.check();assert(result.message.includes('Offline'));assert.equal(off.calls.dialogs.length,0);off.updater.emit('error',Error('Network event'));checks.push('Network and updater error events do not crash or interrupt users with background errors');
 const unreleased=harness();unreleased.updater.checkForUpdates=async()=>{const error=Error('Not found');error.code='ERR_UPDATER_NO_PUBLISHED_VERSIONS';throw error};assert((await unreleased.service.check({manual:true})).message.includes('Ainda não existe uma versão estável'));checks.push('Repository with no stable releases gets a clear message');
 const concurrent=harness();let resolve;concurrent.updater.checkForUpdates=()=>{concurrent.calls.checks++;return new Promise(r=>resolve=r)};const first=concurrent.service.check();assert((await concurrent.service.check({manual:true})).message.includes('em curso'));assert.equal(concurrent.calls.checks,1);resolve({isUpdateAvailable:false});await first;checks.push('Concurrent checks are coalesced; no duplicate download');
 const absent=harness({publish:{provider:'github',owner:'CONFIGURAR_OWNER',repo:'CONFIGURAR_REPO'}});assert.equal(absent.service.ready(),false);absent.service.start();await absent.service.check();assert.equal(absent.calls.checks,0);checks.push('Missing repository never pretends updates are active or contacts a placeholder');
 console.log(checks.join('\n'));
})().catch(e=>{console.error(e);process.exitCode=1});

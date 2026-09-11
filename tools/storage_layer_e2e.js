'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');let pass=0,fail=0;const tests=[];
const add=(name,ok,detail='')=>{tests.push({name,ok:!!ok,detail:String(detail||'')});ok?pass++:fail++;console[ok?'log':'error'](`${ok?'PASS':'FAIL'} ${name}`,detail)};
const code=fs.readFileSync(path.join(root,'public/user-data-store.js'),'utf8');
function makeStorage(){const m=new Map();return{get length(){return m.size},key(i){return [...m.keys()][i]??null},getItem(k){return m.has(String(k))?m.get(String(k)):null},setItem(k,v){m.set(String(k),String(v))},removeItem(k){m.delete(String(k))},_m:m}}
const native=makeStorage(),window={localStorage:native};const ctx=vm.createContext({window,Date,Object,Map,JSON,String,Error});vm.runInContext(code,ctx);
const api=window.CoinNachimpanStorage;add('storage API exported',!!api&&api.apiVersion===1);const ds=api.createLocalUserDataStore({namespace:'crypto_analyzer_mobile',legacyNamespaces:['legacy']});
add('local driver capability',ds.capabilities().driver==='local'&&ds.capabilities().offlineFirst===true&&ds.capabilities().cloudSync===false);
add('native storage available',ds.nativeAvailable()===true);
add('raw roundtrip',ds.setItem('crypto_analyzer_mobile:a','1')===true&&ds.getItem('crypto_analyzer_mobile:a')==='1');
add('JSON roundtrip',ds.setJson('crypto_analyzer_mobile:j',{x:3})===true&&ds.getJson('crypto_analyzer_mobile:j',{}).x===3);
add('remove works',(()=>{ds.setItem('crypto_analyzer_mobile:r','x');ds.removeItem('crypto_analyzer_mobile:r');return ds.getItem('crypto_analyzer_mobile:r')===null})());
native.setItem('foreign:key','keep');ds.setItem('crypto_analyzer_mobile:n','yes');const ns=ds.dumpNamespace();add('namespace dump filters foreign keys',ns['crypto_analyzer_mobile:n']==='yes'&&!('foreign:key' in ns));
const snap=ds.exportSnapshot();add('snapshot export scoped',snap.schemaVersion===1&&snap.namespace==='crypto_analyzer_mobile'&&Object.keys(snap.items).every(k=>k.startsWith('crypto_analyzer_mobile:')));
const ds2=api.createLocalUserDataStore({namespace:'crypto_analyzer_mobile'});add('snapshot import',ds2.importSnapshot(snap,{merge:false})>=1&&ds2.getItem('crypto_analyzer_mobile:n')==='yes');
let bad=false;try{ds2.importSnapshot({...snap,namespace:'other'})}catch{bad=true}add('cross-namespace snapshot rejected',bad);
// Mirror should keep the latest value if native storage becomes unavailable mid-session.
ds.setItem('crypto_analyzer_mobile:mirror','persisted');Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new Error('blocked')}});add('memory mirror survives native failure',ds.getItem('crypto_analyzer_mobile:mirror')==='persisted');add('native failure reported',ds.nativeAvailable()===false);
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8'),html=fs.readFileSync(path.join(root,'public/index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'public/sw.js'),'utf8');
add('app has no direct localStorage access',!/window\.localStorage|\blocalStorage\s*\./.test(app));
add('storage module loaded before app',html.indexOf('user-data-store.js')>=0&&html.indexOf('user-data-store.js')<html.indexOf('app.js'));
add('storage module precached',sw.includes("'./user-data-store.js'"));
add('no login UI added',!/type=["']password["']|로그인|회원가입/.test(html));
add('no auth endpoint added',!/\/api\/(login|auth|session|signup)/i.test(fs.readFileSync(path.join(root,'src/worker.mjs'),'utf8')));
add('storage layer has no network dependency',!/(fetch\s*\(|XMLHttpRequest|WebSocket)/.test(code));
fs.mkdirSync(path.join(root,'docs'),{recursive:true});fs.writeFileSync(path.join(root,'docs','V15_31_29_STORAGE_LAYER_E2E.json'),JSON.stringify({version:'15.31.29',pass,total:pass+fail,failed:tests.filter(x=>!x.ok),tests,generatedAt:new Date().toISOString()},null,2));
console.log(`RESULT ${pass}/${pass+fail} PASS`);process.exit(fail?1:0);

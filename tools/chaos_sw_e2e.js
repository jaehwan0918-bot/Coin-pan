'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..'),code=fs.readFileSync(path.join(root,'public','sw.js'),'utf8');
const tests=[];const add=(n,c,d='')=>tests.push({name:n,ok:!!c,detail:String(d||'')});
function response(ok=true,text='ok'){return{ok,status:ok?200:503,clone(){return response(ok,text)},text:async()=>text}}
function makeEnv(opts={}){
 const handlers={};let skipped=false,claimed=false,deleted=[],puts=[],added=[];const stores=new Map();
 const caches={
   async open(name){if(opts.openThrows)throw new Error('CHAOS_CACHE_OPEN');if(!stores.has(name))stores.set(name,new Map());const m=stores.get(name);return{
     async addAll(a){if(opts.addAllThrows)throw new Error('CHAOS_ADDALL');added.push(...a);for(const x of a)m.set(x,response(true,x))},
     async put(req,res){if(opts.putThrows)throw new Error('CHAOS_PUT');puts.push(String(req.url||req));m.set(String(req.url||req),res)}
   }},
   async keys(){if(opts.keysThrows)throw new Error('CHAOS_KEYS');return ['old-cache','coin-nachimpan-v15-31-29-static-v16']},
   async delete(k){if(opts.deleteThrows)throw new Error('CHAOS_DELETE');deleted.push(k);return true},
   async match(req){if(opts.matchThrows)throw new Error('CHAOS_MATCH');const k=String(req.url||req);for(const m of stores.values())if(m.has(k))return m.get(k);for(const m of stores.values())if(m.has('./index.html'))return m.get('./index.html');return undefined}
 };
 let fetchMode=opts.fetchMode||'ok';const context={URL,Promise,console,caches,fetch:async req=>{if(fetchMode==='throw')throw new Error('CHAOS_OFFLINE');if(fetchMode==='bad')return response(false,'bad');if(fetchMode==='delay'){await new Promise(r=>setTimeout(r,50));return response(true,'slow')}return response(true,'network')},self:{addEventListener(n,fn){handlers[n]=fn},skipWaiting(){skipped=true},clients:{claim(){claimed=true}}}};
 vm.createContext(context);vm.runInContext(code,context);return{handlers,caches,stores,state:()=>({skipped,claimed,deleted,puts,added}),setFetch:m=>fetchMode=m};
}
(async()=>{
 // Baseline registration.
 let e=makeEnv();add('handlers register under chaos harness',typeof e.handlers.install==='function'&&typeof e.handlers.activate==='function'&&typeof e.handlers.fetch==='function');
 // Install cache failure should fail install rather than activate half-cached new SW.
 e=makeEnv({addAllThrows:true});let p,rejected=false;e.handlers.install({waitUntil(x){p=x}});try{await p}catch{rejected=true}add('precache failure rejects install safely',rejected);add('failed install does not skipWaiting',e.state().skipped===false);
 // Cache open failure also fails install.
 e=makeEnv({openThrows:true});rejected=false;e.handlers.install({waitUntil(x){p=x}});try{await p}catch{rejected=true}add('cache-open failure rejects install safely',rejected);
 // Activation cache enumeration failure rejects activation (old active worker remains browser responsibility).
 e=makeEnv({keysThrows:true});rejected=false;e.handlers.activate({waitUntil(x){p=x}});try{await p}catch{rejected=true}add('cache-keys failure rejects activation',rejected);add('failed activation does not claim clients',e.state().claimed===false);
 // One cache deletion failure rejects activation rather than pretending success.
 e=makeEnv({deleteThrows:true});rejected=false;e.handlers.activate({waitUntil(x){p=x}});try{await p}catch{rejected=true}add('cache delete failure rejects activation',rejected);
 // Successful network must still return even if cache put fails.
 e=makeEnv({putThrows:true});let rp;e.handlers.fetch({request:{method:'GET',url:'https://app.test/styles.css'},respondWith(x){rp=x}});let r=await rp;await new Promise(x=>setTimeout(x,0));add('cache-put failure does not break network response',r.ok===true);
 // Successful network must still return if cache open fails after fetch.
 e=makeEnv({openThrows:true});e.handlers.fetch({request:{method:'GET',url:'https://app.test/app.js'},respondWith(x){rp=x}});r=await rp;await new Promise(x=>setTimeout(x,0));add('cache-open failure after network does not break response',r.ok===true);
 // Non-ok network response returned but not cached.
 e=makeEnv({fetchMode:'bad'});e.handlers.fetch({request:{method:'GET',url:'https://app.test/x.css'},respondWith(x){rp=x}});r=await rp;await new Promise(x=>setTimeout(x,0));add('HTTP non-ok response passes through',r.ok===false);add('HTTP non-ok not cached',e.state().puts.length===0);
 // Offline with precached index fallback.
 e=makeEnv();e.handlers.install({waitUntil(x){p=x}});await p;e.setFetch('throw');e.handlers.fetch({request:{method:'GET',url:'https://app.test/unknown-route'},respondWith(x){rp=x}});r=await rp;add('offline route falls back to cached app shell',!!r&&r.ok===true);
 // Offline exact static cached resource.
 e.handlers.fetch({request:{method:'GET',url:'https://app.test/styles.css'},respondWith(x){rp=x}});r=await rp;add('offline cached static available',!!r);
 // If both network and Cache API fail, request fails explicitly rather than false-success.
 e=makeEnv({fetchMode:'throw',matchThrows:true});rejected=false;e.handlers.fetch({request:{method:'GET',url:'https://app.test/offline'},respondWith(x){rp=x}});try{await rp}catch{rejected=true}add('network+cache total failure is explicit rejection',rejected);
 // API and mutating requests must bypass SW even offline.
 e=makeEnv({fetchMode:'throw'});let responded=false;e.handlers.fetch({request:{method:'GET',url:'https://app.test/api/candles'},respondWith(){responded=true}});add('API bypasses service worker under outage',responded===false);
 responded=false;e.handlers.fetch({request:{method:'POST',url:'https://app.test/x'},respondWith(){responded=true}});add('POST bypasses service worker under outage',responded===false);
 // Slow network eventually returns and is cacheable.
 e=makeEnv({fetchMode:'delay'});e.handlers.fetch({request:{method:'GET',url:'https://app.test/slow.css'},respondWith(x){rp=x}});r=await rp;await new Promise(x=>setTimeout(x,60));add('slow static network response succeeds',r.ok===true);add('slow successful response cached',e.state().puts.some(x=>x.includes('slow.css')));
 const pass=tests.filter(x=>x.ok).length,total=tests.length,result={version:'15.31.29',scope:'Service Worker Chaos E2E',pass,total,failed:tests.filter(x=>!x.ok),tests,generatedAt:new Date().toISOString()};fs.writeFileSync(path.join(root,'docs','V15_31_29_CHAOS_SW_E2E_RESULT.json'),JSON.stringify(result,null,2));console.log(`RESULT ${pass}/${total} PASS`);for(const x of result.failed)console.error('FAIL',x.name,x.detail);if(pass!==total)process.exit(1)
})().catch(e=>{console.error(e);process.exit(1)});

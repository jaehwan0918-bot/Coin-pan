'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'..');
const PORT=9550+(process.pid%200),profile=`/tmp/coin_nachimpan_v153127_chaos_${process.pid}`;
fs.rmSync(profile,{recursive:true,force:true});
const chrome=cp.spawn('/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-gpu',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','ignore']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getJson(url){return await (await fetch(url)).json()}
class CDP{
 constructor(url){this.ws=new WebSocket(url);this.id=0;this.pending=new Map();this.ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}}}}
 async ready(){if(this.ws.readyState===1)return;await new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j})}
 call(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}))})}
 close(){this.ws.close()}
}
(async()=>{
 let c;const tests=[];const add=(n,o,d='')=>tests.push({name:n,ok:!!o,detail:String(d||'')});
 try{
  for(let i=0;i<60;i++){try{const pages=await getJson(`http://127.0.0.1:${PORT}/json`);if(pages[0]){c=new CDP(pages[0].webSocketDebuggerUrl);await c.ready();break}}catch{}await sleep(100)}
  if(!c)throw new Error('Chromium CDP unavailable');
  await c.call('Page.enable');await c.call('Runtime.enable');
  const tree=await c.call('Page.getFrameTree'),frameId=tree.frameTree.frame.id;
  const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8').replace(/<link rel="stylesheet" href="\.\/styles\.css">/,'').replace(/<script src="\.\/user-data-store\.js"><\/script>/,'').replace(/<script src="\.\/user-data-store\.js"><\/script>/,'').replace(/<script src="\.\/app\.js"><\/script>/,'');
  const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8'),storage=fs.readFileSync(path.join(root,'public','user-data-store.js'),'utf8'),app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
  await c.call('Page.setDocumentContent',{frameId,html:html.replace('</head>',`<style>${css}</style></head>`)});
  await c.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2.75,mobile:true,screenWidth:390,screenHeight:844});
  await c.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  // App is loaded without forced demo. Tests control fetch explicitly.
  await c.call('Runtime.evaluate',{expression:'window.__CA_FORCE_DEMO__=false;window.__chaosFetchCalls=0;window.fetch=async()=>{window.__chaosFetchCalls++;throw new Error("CHAOS_OFFLINE")};'});
  let preload=await c.call('Runtime.evaluate',{expression:storage,awaitPromise:true,returnByValue:true});if(preload.exceptionDetails)throw new Error(preload.exceptionDetails.text);
  const run=await c.call('Runtime.evaluate',{expression:app,awaitPromise:true,returnByValue:true});if(run.exceptionDetails)throw new Error(run.exceptionDetails.text);
  async function ev(expr){const x=await c.call('Runtime.evaluate',{expression:`(async()=>{${expr}})()`,returnByValue:true,awaitPromise:true});if(x.exceptionDetails)throw new Error(x.exceptionDetails.exception?.description||x.exceptionDetails.text);return x.result.value}
  async function resetStorage(){return ev(`for(const k of Object.keys(window.__CA_TEST__.storageDump()))window.__CA_TEST__.storageRemove(k);return true`)}
  async function setBaseProfile(){return ev(`window.__CA_TEST__.storageSet('crypto_analyzer_mobile:ui_profile',JSON.stringify({onboardingDone:true,favorites:['KRW-BTC','KRW-ETH','KRW-SOL'],lastMarket:'KRW-BTC',lastTf:'240',lastTab:'home',fontScale:'normal',lastSeenVersion:'15.31.29'}));window.__CA_TEST__.storageSet('crypto_analyzer_mobile:settings',JSON.stringify({conservatism:'high',count:200,demoFallback:true,decisionAlerts:false}));return true`)}
  async function setFetchReject(){return ev(`window.__chaosFetchCalls=0;window.fetch=async()=>{window.__chaosFetchCalls++;throw new Error('CHAOS_OFFLINE')};return true`)}
  async function setFetchStatus(code=503){return ev(`window.__chaosFetchCalls=0;window.fetch=async()=>{window.__chaosFetchCalls++;return {ok:false,status:${code},text:async()=>''}};return true`)}
  async function setFetchJson(objExpr){return ev(`window.__chaosFetchCalls=0;const payload=${objExpr};window.fetch=async()=>{window.__chaosFetchCalls++;return {ok:true,status:200,text:async()=>JSON.stringify(payload)}};return true`)}

  add('version correct',await ev(`return window.__CA_TEST__.version==='15.31.29'`));
  await resetStorage();await setBaseProfile();

  // -------- A. Data integrity chaos --------
  const integrityCases=await ev(`
    const T=window.__CA_TEST__,base=T.demoCandles('KRW-BTC','240',200),out={};
    let d=base.map(x=>({...x})); d[80].t=d[79].t; out.dup=T.dataIntegrityGate(d,'240');
    d=base.map(x=>({...x})); d[80].t=d[79].t-1; out.reverse=T.dataIntegrityGate(d,'240');
    d=base.map(x=>({...x})); d[20].v=-1; out.negVol=T.dataIntegrityGate(d,'240');
    d=base.map(x=>({...x})); d[20].c=NaN; out.nanClose=T.dataIntegrityGate(d,'240');
    d=base.map(x=>({...x})); d[20].h=Math.min(d[20].o,d[20].c)-1; out.badHigh=T.dataIntegrityGate(d,'240');
    d=base.map(x=>({...x})); d[20].l=Math.max(d[20].o,d[20].c)+1; out.badLow=T.dataIntegrityGate(d,'240');
    d=base.filter((_,i)=>i%5!==0); out.manyGaps=T.dataIntegrityGate(d,'240');
    d=base.filter((_,i)=>i%25!==0); out.fewGaps=T.dataIntegrityGate(d,'240');
    d=base.map(x=>({...x})); for(let i=1;i<d.length;i++)d[i].t=d[i-1].t+240*60000*(i%2?1.25:.75); out.jitter=T.dataIntegrityGate(d,'240');
    d=base.map(x=>({...x})); for(const i of [60,100,140]){const f=1.35;d[i]={...d[i],o:d[i-1].c*f,c:d[i-1].c*f,h:d[i-1].c*f*1.01,l:d[i-1].c*f*.99}} out.outliers3=T.dataIntegrityGate(d,'240');
    d=base.map(x=>({...x})); {const i=100,f=1.35;d[i]={...d[i],o:d[i-1].c*f,c:d[i-1].c*f,h:d[i-1].c*f*1.01,l:d[i-1].c*f*.99}} out.outlier1=T.dataIntegrityGate(d,'240');
    d=base.slice(-59); out.short=T.dataIntegrityGate(d,'240');
    d=base.map(x=>({...x})); d[d.length-1].t=Date.now()-5*60*1000; out.partial=T.dataIntegrityGate(d,'240');
    return out`);
  add('duplicate timestamp -> BLOCKED',integrityCases.dup.level==='BLOCKED'&&integrityCases.dup.duplicates>0,JSON.stringify(integrityCases.dup));
  add('reversed timestamp -> BLOCKED',integrityCases.reverse.level==='BLOCKED'&&integrityCases.reverse.nonMonotonic>0);
  add('negative volume -> BLOCKED',integrityCases.negVol.level==='BLOCKED'&&integrityCases.negVol.invalid>0);
  add('NaN close -> BLOCKED',integrityCases.nanClose.level==='BLOCKED'&&integrityCases.nanClose.invalid>0);
  add('invalid high -> BLOCKED',integrityCases.badHigh.level==='BLOCKED'&&integrityCases.badHigh.invalid>0);
  add('invalid low -> BLOCKED',integrityCases.badLow.level==='BLOCKED'&&integrityCases.badLow.invalid>0);
  add('many missing candles -> BLOCKED',integrityCases.manyGaps.level==='BLOCKED');
  add('few missing candles not silently READY',integrityCases.fewGaps.level!=='READY',integrityCases.fewGaps.level);
  add('systematic interval jitter -> BLOCKED',integrityCases.jitter.level==='BLOCKED');
  add('three extreme jumps -> BLOCKED',integrityCases.outliers3.level==='BLOCKED',JSON.stringify(integrityCases.outliers3));
  add('single extreme jump -> warning or blocked',integrityCases.outlier1.level!=='READY',integrityCases.outlier1.level);
  add('59 candles -> BLOCKED',integrityCases.short.level==='BLOCKED');
  add('unfinished last candle removed',integrityCases.partial.partialLast===true&&integrityCases.partial.rows.length===199,JSON.stringify(integrityCases.partial));

  // -------- B. Safety validation chaos --------
  const safety=await ev(`
    const T=window.__CA_TEST__,d=T.demoCandles('KRW-BTC','240',200),s=T.computeSignal(d),ig=T.dataIntegrityGate(d,'240'),q=T.qualityAssessment(d,ig),bt=T.backtest(d),states={};
    for(const st of ['demo','stale','snapshot','error','cached','live']){const v=T.finalValidation(d,s,q,bt,[],{sourceMeta:{state:st},integrity:ig,tf:'240'});states[st]={decision:v.decision,level:v.safetyLevel,reliability:v.reliability}}
    const badIg={...ig,level:'BLOCKED',issues:['chaos']};const vb=T.finalValidation(d,s,q,bt,[],{sourceMeta:{state:'live'},integrity:badIg,tf:'240'});states.integrity={decision:vb.decision,level:vb.safetyLevel};
    const badQ={...q,status:'UNHEALTHY',score:20};const vq=T.finalValidation(d,s,badQ,bt,[],{sourceMeta:{state:'live'},integrity:ig,tf:'240'});states.quality={decision:vq.decision,level:vq.safetyLevel};
    return states`);
  for(const st of ['demo','stale','snapshot','error'])add(`${st} source hard-blocked`,safety[st].decision==='NO TRADE'&&safety[st].level==='BLOCKED',JSON.stringify(safety[st]));
  add('cached source reliability capped',safety.cached.reliability<=.620001,JSON.stringify(safety.cached));
  add('integrity block forces NO TRADE',safety.integrity.decision==='NO TRADE'&&safety.integrity.level==='BLOCKED');
  add('unhealthy quality forces NO TRADE',safety.quality.decision==='NO TRADE'&&safety.quality.level==='BLOCKED');

  // -------- C. Local data corruption --------
  const corrupt=await ev(`
    const T=window.__CA_TEST__,r={};
    T.storageSet('crypto_analyzer_mobile:settings','{broken'); r.settings=(()=>{document.querySelector('#conservatismSelect').value='high';return true})();
    T.storageSet('crypto_analyzer_mobile:ui_profile','not-json'); r.ui=T.loadUiProfile();
    T.storageSet('crypto_analyzer_mobile:forward_learning','bad-json'); r.forward=T.forwardStats([]);
    T.storageSet('crypto_analyzer_mobile:safe_snapshots','bad-json'); r.snapshot=T.getSafeSnapshot('KRW-BTC','240');
    const b=T.makeBackup(); b.integrity.hash='deadbeef'; r.badBackup=T.verifyBackup(b);
    const b2=T.makeBackup(); b2.schemaVersion=99; r.badSchema=T.verifyBackup(b2);
    T.storageSet('crypto_analyzer_mobile:ui_profile',JSON.stringify({onboardingDone:true,favorites:['BAD','KRW-BTC','KRW-BTC','KRW-ETH','KRW-SOL','KRW-XRP','KRW-DOGE','KRW-AAA'],lastTf:'999',lastTab:'status',fontScale:'x'}));r.sanitized=T.loadUiProfile();
    return r`);
  add('corrupt UI JSON falls back safely',corrupt.ui.lastMarket==='KRW-BTC'&&corrupt.ui.lastTf==='240');
  add('corrupt Forward data does not crash',corrupt.forward.resolved===0&&corrupt.forward.maturity==='EARLY');
  add('corrupt snapshot ignored',corrupt.snapshot===null);
  add('tampered backup rejected',corrupt.badBackup===false);
  add('unsupported backup schema rejected',corrupt.badSchema===false);
  add('favorites sanitized/deduplicated/max5',corrupt.sanitized.favorites.length===5&&new Set(corrupt.sanitized.favorites).size===5,JSON.stringify(corrupt.sanitized));
  add('invalid timeframe falls back 4H',corrupt.sanitized.lastTf==='240');
  add('legacy removed status tab -> settings',corrupt.sanitized.lastTab==='settings');
  add('invalid font scale -> normal',corrupt.sanitized.fontScale==='normal');

  // Restore profile/settings.
  await resetStorage();await setBaseProfile();

  // -------- D. Network chaos: fast failure, 5xx, invalid JSON, malformed payload --------
  await setFetchReject();
  await ev(`window.__CA_TEST__.boot();return true`);await sleep(1100);
  const offlineDemo=await ev(`const s=window.__CA_TEST__.getState();return {meta:s.sourceMeta,decision:s.analysis?.validation?.decision,level:s.analysis?.validation?.safetyLevel,calls:window.__chaosFetchCalls}`);
  add('offline with demoFallback -> DEMO',offlineDemo.meta?.state==='demo',JSON.stringify(offlineDemo));
  add('offline demo decision blocked',offlineDemo.decision==='NO TRADE'&&offlineDemo.level==='BLOCKED',JSON.stringify(offlineDemo));
  add('frontend retries failed fetch',offlineDemo.calls>=3,offlineDemo.calls);

  await setFetchStatus(503);await ev(`return window.__CA_TEST__.refresh()`);await sleep(900);
  const status503=await ev(`const s=window.__CA_TEST__.getState();return {state:s.sourceMeta?.state,decision:s.analysis?.validation?.decision,calls:window.__chaosFetchCalls}`);
  add('HTTP 503 falls back safely',status503.state==='demo'&&status503.decision==='NO TRADE',JSON.stringify(status503));

  await ev(`window.__chaosFetchCalls=0;window.fetch=async()=>{window.__chaosFetchCalls++;return {ok:true,status:200,text:async()=>'{not json'}};return true`);
  await ev(`return window.__CA_TEST__.refresh()`);await sleep(900);
  const badJson=await ev(`const s=window.__CA_TEST__.getState();return {state:s.sourceMeta?.state,decision:s.analysis?.validation?.decision,calls:window.__chaosFetchCalls}`);
  add('invalid JSON falls back safely',badJson.state==='demo'&&badJson.decision==='NO TRADE',JSON.stringify(badJson));

  await setFetchJson(`({source:'CHAOS',candles:[{t:1,o:1,h:1,l:1,c:1,v:1}]})`);
  await ev(`return window.__CA_TEST__.refresh()`);await sleep(250);
  const shortPayload=await ev(`const s=window.__CA_TEST__.getState();return {state:s.sourceMeta?.state,decision:s.analysis?.validation?.decision}`);
  add('too-short API payload never treated live',shortPayload.state==='demo'&&shortPayload.decision==='NO TRADE',JSON.stringify(shortPayload));

  // -------- E. Cache chaos --------
  await resetStorage();await setBaseProfile();
  await ev(`const d=window.__CA_TEST__.demoCandles('KRW-BTC','240',200);window.__CA_TEST__.storageSet('crypto_analyzer_mobile:candle_cache',JSON.stringify({'KRW-BTC:240:200':{at:Date.now(),rows:d}}));return true`);
  await setFetchReject();await ev(`return window.__CA_TEST__.refresh()`);await sleep(900);
  const cacheOk=await ev(`const s=window.__CA_TEST__.getState();return {state:s.sourceMeta?.state,decision:s.analysis?.validation?.decision,level:s.analysis?.validation?.safetyLevel,reliability:s.analysis?.validation?.reliability}`);
  add('network failure uses valid local cache',cacheOk.state==='cached',JSON.stringify(cacheOk));
  add('cached result is caution/capped',cacheOk.level==='CAUTION'&&cacheOk.reliability<=.620001,JSON.stringify(cacheOk));

  // Corrupt cache is blocked by integrity then demo fallback is not used after cache selection; refresh catches.
  await ev(`const d=window.__CA_TEST__.demoCandles('KRW-BTC','240',200);d[50].t=d[49].t;window.__CA_TEST__.storageSet('crypto_analyzer_mobile:candle_cache',JSON.stringify({'KRW-BTC:240:200':{at:Date.now(),rows:d}}));window.__CA_TEST__.storageRemove('crypto_analyzer_mobile:safe_snapshots');return true`);
  await setFetchReject();await ev(`return window.__CA_TEST__.refresh()`);await sleep(900);
  const corruptCache=await ev(`const s=window.__CA_TEST__.getState();return {state:s.sourceMeta?.state||null,ui:document.querySelector('#dataStateCard').dataset.state,badge:document.querySelector('#dataStateBadge').textContent,safety:document.querySelector('#decisionSafetyBadge').textContent,decision:document.querySelector('#decisionValue').textContent}`);
  add('corrupt cached candles surface safe error state',corruptCache.ui==='error'&&corruptCache.badge==='확인 필요',JSON.stringify(corruptCache));
  // Strict chaos safety expectation: stale prior decision must be visibly blocked if no snapshot exists.
  add('ERROR without snapshot visibly blocks old decision',corruptCache.safety==='사용 금지'&&corruptCache.decision==='NO TRADE',JSON.stringify(corruptCache));

  // -------- F. Safe snapshot chaos --------
  await resetStorage();await setBaseProfile();
  const snapPrep=await ev(`const T=window.__CA_TEST__,d=T.demoCandles('KRW-BTC','240',200),ig=T.dataIntegrityGate(d,'240'),s=T.computeSignal(d),q=T.qualityAssessment(d,ig),bt=T.backtest(d),v=T.finalValidation(d,s,q,bt,[],{sourceMeta:{state:'live'},integrity:ig,tf:'240'}),a={...s,quality:q,validation:v,market:'KRW-BTC',tf:'240'};return T.saveSafeSnapshot('KRW-BTC','240',d,{state:'live'},a,bt)`);
  add('safe snapshot can be prepared',snapPrep===true);
  await ev(`window.__CA_TEST__.storageSet('crypto_analyzer_mobile:settings',JSON.stringify({conservatism:'high',count:200,demoFallback:false,decisionAlerts:false}));return true`);
  await setFetchReject();await ev(`return window.__CA_TEST__.refresh()`);await sleep(900);
  const snapFallback=await ev(`const s=window.__CA_TEST__.getState();return {state:s.sourceMeta?.state,decision:s.analysis?.validation?.decision,level:s.analysis?.validation?.safetyLevel,source:document.querySelector('#dataSource').textContent}`);
  add('offline strict mode uses safe snapshot',snapFallback.state==='snapshot',JSON.stringify(snapFallback));
  add('snapshot always reference-only',snapFallback.decision==='NO TRADE'&&snapFallback.level==='BLOCKED',JSON.stringify(snapFallback));

  // Expired snapshot rejected.
  const expired=await ev(`const T=window.__CA_TEST__,all=JSON.parse(T.storageGet('crypto_analyzer_mobile:safe_snapshots'));const k='KRW-BTC:240';all[k].savedAt=Date.now()-240*60000*9;T.storageSet('crypto_analyzer_mobile:safe_snapshots',JSON.stringify(all));return T.getSafeSnapshot('KRW-BTC','240')===null`);
  add('expired snapshot rejected',expired);

  // -------- G. Concurrency / rapid interaction chaos --------
  await resetStorage();await setBaseProfile();
  await ev(`window.__CA_FORCE_DEMO__=false;const d=window.__CA_TEST__.demoCandles('KRW-BTC','240',200);window.__chaosFetchCalls=0;window.fetch=async()=>{window.__chaosFetchCalls++;await new Promise(r=>setTimeout(r,250));return {ok:true,status:200,text:async()=>JSON.stringify({source:'CHAOS LIVE',candles:d})}};return true`);
  const concurrent=await ev(`const T=window.__CA_TEST__;await Promise.all([T.refresh(),T.refresh(),T.refresh()]);const s=T.getState();return {calls:window.__chaosFetchCalls,loading:s.loading,disabled:document.querySelector('#refreshBtn').disabled,state:s.sourceMeta?.state,hasAnalysis:!!s.analysis}`);
  add('triple refresh collapses to one request',concurrent.calls===1,JSON.stringify(concurrent));
  add('refresh recovers UI controls',concurrent.loading===false&&concurrent.disabled===false&&concurrent.hasAnalysis,JSON.stringify(concurrent));

  const summaryConcurrent=await ev(`window.__chaosFetchCalls=0;const T=window.__CA_TEST__;await Promise.all([T.refreshHomeSummary(),T.refreshHomeSummary(),T.refreshHomeSummary()]);return {loading:T.getState().summaryLoading,calls:window.__chaosFetchCalls,cards:document.querySelectorAll('#summaryList .summaryCard').length,disabled:document.querySelector('#summaryRefreshBtn').disabled}`);
  add('triple summary refresh guard recovers',summaryConcurrent.loading===false&&summaryConcurrent.disabled===false&&summaryConcurrent.cards===3,JSON.stringify(summaryConcurrent));

  const tabs=await ev(`const T=window.__CA_TEST__,seq=['home','analysis','research','settings'];for(let i=0;i<200;i++)T.setTab(seq[i%4],false);T.setTab('home',false);return {activeTabs:document.querySelectorAll('.tab.active').length,activePanes:document.querySelectorAll('.pane.active').length,tab:document.querySelector('.tab.active')?.dataset.tab,pane:document.querySelector('.pane.active')?.id}`);
  add('200 rapid tab switches leave one active tab/pane',tabs.activeTabs===1&&tabs.activePanes===1&&tabs.tab==='home'&&tabs.pane==='pane-home',JSON.stringify(tabs));

  // 25 random mobile widths + portrait/landscape toggles.
  let resizePass=true,maxOv=-999;
  for(let i=0;i<25;i++){
    const w=320+((i*37)%111),land=i%7===0,h=land?390:844,width=land?844:w;
    await c.call('Emulation.setDeviceMetricsOverride',{width,height:h,deviceScaleFactor:2.75,mobile:true,screenWidth:width,screenHeight:h});await sleep(20);
    const ov=await ev(`return document.documentElement.scrollWidth-window.innerWidth`);maxOv=Math.max(maxOv,ov);if(ov>2)resizePass=false;
  }
  add('25 viewport chaos cycles no fatal horizontal overflow',resizePass,`maxOverflow=${maxOv}`);
  await c.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2.75,mobile:true,screenWidth:390,screenHeight:844});

  // -------- H. Storage unavailable / memory fallback --------
  // about:blank is commonly opaque for localStorage in this environment; verify app still persists via internal fallback.
  const storageFallback=await ev(`const T=window.__CA_TEST__,native=(()=>{try{localStorage.setItem('__x','1');localStorage.removeItem('__x');return true}catch{return false}})();T.storageSet('crypto_analyzer_mobile:chaos_probe','abc');return {native,value:T.storageGet('crypto_analyzer_mobile:chaos_probe'),health:T.healthCheck()}`);
  add('storage wrapper persists even if native storage unavailable',storageFallback.value==='abc',JSON.stringify(storageFallback));
  add('health check never treats storage limitation as fatal',storageFallback.health.fail===0,JSON.stringify(storageFallback.health));

  // -------- I. Learning / backup chaos --------
  const learningCap=await ev(`const T=window.__CA_TEST__,arr=[];for(let i=0;i<500;i++)arr.push({at:new Date(Date.now()-13*60*60*1000-i*1000).toISOString(),market:'KRW-BTC',tf:'240',price:100,score:70,resolved:false});T.storageSet('crypto_analyzer_mobile:forward_learning',JSON.stringify(arr)); // direct corruption-sized payload
    // Trigger normal save via outcome updater -> saveLearning slices to 300
    T.updateForwardOutcomes({market:'KRW-BTC',tf:'240',price:100});const x=JSON.parse(T.storageGet('crypto_analyzer_mobile:forward_learning'));return x.length`);
  add('Forward Learning bounded to 300 on normal write',learningCap<=300,learningCap);

  const backupRoundtrip=await ev(`const T=window.__CA_TEST__,b=T.makeBackup(),ok=T.verifyBackup(b),txt=JSON.stringify(b),obj=JSON.parse(txt);return {ok,schema:obj.schemaVersion,format:obj.format,learning:obj.forwardLearning.length}`);
  add('large-state backup remains valid',backupRoundtrip.ok&&backupRoundtrip.schema===2&&backupRoundtrip.format==='crypto-analyzer-local',JSON.stringify(backupRoundtrip));

  // -------- J. Summary all-failure chaos --------
  await ev(`window.__CA_TEST__.storageSet('crypto_analyzer_mobile:settings',JSON.stringify({conservatism:'high',count:200,demoFallback:false,decisionAlerts:false}));window.__CA_TEST__.storageRemove('crypto_analyzer_mobile:candle_cache');window.__CA_TEST__.storageRemove('crypto_analyzer_mobile:safe_snapshots');if(window.__CA_TEST__.getState().sourceMeta)window.__CA_TEST__.getState().sourceMeta.fetchedAt=Date.now()-60000;return true`);
  await setFetchReject();await ev(`return window.__CA_TEST__.refreshHomeSummary()`);await sleep(2200);
  const allFail=await ev(`const T=window.__CA_TEST__,s=T.getState();return {errors:s.summary.filter(x=>x.error).length,total:s.summary.length,alertHidden:document.querySelector('#homeAlertBanner').hidden,dotHidden:document.querySelector('#settingsAlertDot').hidden,cards:document.querySelectorAll('#summaryList .summaryCard').length}`);
  add('all favorite API failures isolated per card',allFail.errors===allFail.total&&allFail.total===3,JSON.stringify(allFail));
  add('all favorite failures show home warning',allFail.alertHidden===false&&allFail.dotHidden===false,JSON.stringify(allFail));
  add('all favorite failures still render cards',allFail.cards===3,JSON.stringify(allFail));

  const pass=tests.filter(x=>x.ok).length,total=tests.length,result={version:'15.31.29',scope:'mobile Chaos E2E',pass,total,failed:tests.filter(x=>!x.ok),tests,generatedAt:new Date().toISOString()};
  fs.mkdirSync(path.join(root,'docs'),{recursive:true});fs.writeFileSync(path.join(root,'docs','V15_31_29_CHAOS_E2E_RESULT.json'),JSON.stringify(result,null,2));
  console.log(`RESULT ${pass}/${total} PASS`);for(const x of result.failed)console.error('FAIL',x.name,x.detail);if(pass!==total)process.exitCode=1;
 }catch(e){console.error(e);process.exitCode=1}
 finally{try{c?.close()}catch{};chrome.kill('SIGKILL')}
})();

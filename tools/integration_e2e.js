'use strict';
const fs=require('fs'), path=require('path'), cp=require('child_process');
const root=path.resolve(__dirname,'..');
const PORT=9640+(process.pid%200), profile=`/tmp/coin_nachimpan_integration_${process.pid}`;
fs.rmSync(profile,{recursive:true,force:true});
const chrome=cp.spawn('/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-gpu',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','ignore']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getJson(url){return await (await fetch(url)).json()}
class CDP{
 constructor(url){this.ws=new WebSocket(url);this.id=0;this.pending=new Map();this.ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}}};}
 async ready(){if(this.ws.readyState===1)return;await new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j});}
 call(method,params={}){return new Promise((resolve,reject)=>{if(this.ws.readyState!==1)return reject(new Error('CDP socket not connected'));const id=++this.id;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
 close(){try{this.ws.close()}catch{}}
}
(async()=>{
 let c; const tests=[]; const add=(name,ok,detail='')=>tests.push({name,ok:!!ok,detail:String(detail??'')});
 try{
  for(let i=0;i<80;i++){try{const pages=await getJson(`http://127.0.0.1:${PORT}/json`);if(pages[0]){c=new CDP(pages[0].webSocketDebuggerUrl);await c.ready();break}}catch{}await sleep(100)}
  if(!c)throw new Error('Chromium CDP unavailable');
  await c.call('Page.enable'); await c.call('Runtime.enable'); await c.call('DOM.enable');
  const tree=await c.call('Page.getFrameTree'), frameId=tree.frameTree.frame.id;
  const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8').replace(/<link rel="stylesheet" href="\.\/styles\.css">/,'').replace(/<script src="\.\/user-data-store\.js"><\/script>/,'').replace(/<script src="\.\/user-data-store\.js"><\/script>/,'').replace(/<script src="\.\/app\.js"><\/script>/,'');
  const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8'), storage=fs.readFileSync(path.join(root,'public','user-data-store.js'),'utf8'), app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
  await c.call('Page.setDocumentContent',{frameId,html:html.replace('</head>',`<style>${css}</style></head>`)});
  await c.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2.75,mobile:true,screenWidth:390,screenHeight:844});
  await c.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  let preload=await c.call('Runtime.evaluate',{expression:storage,awaitPromise:true,returnByValue:true}); if(preload.exceptionDetails)throw new Error(preload.exceptionDetails.text);
  let run=await c.call('Runtime.evaluate',{expression:app,awaitPromise:true,returnByValue:true}); if(run.exceptionDetails)throw new Error(run.exceptionDetails.text);
  async function ev(code){const x=await c.call('Runtime.evaluate',{expression:`(async()=>{${code}})()`,returnByValue:true,awaitPromise:true});if(x.exceptionDetails)throw new Error(x.exceptionDetails.exception?.description||x.exceptionDetails.text);return x.result.value;}
  async function touch(sel){const r=await ev(`const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2};`);if(!r)return false;await c.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x,y:r.y,id:1,radiusX:2,radiusY:2,force:1}]});await c.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(120);return true;}

  // Install deterministic LIVE API mock after app code is loaded.
  await ev(`
    window.__fetchMode='live'; window.__fetchLog=[]; window.__alerts=[]; window.alert=(m)=>window.__alerts.push(String(m));
    window.fetch=async (url,opts={})=>{
      const s=String(url); window.__fetchLog.push({url:s,mode:window.__fetchMode,at:Date.now()});
      if(window.__fetchMode==='fail') return new Response(JSON.stringify({error:'upstream_unavailable'}),{status:503,headers:{'content-type':'application/json'}});
      if(window.__fetchMode==='invalid-json') return new Response('{broken',{status:200,headers:{'content-type':'application/json'}});
      const u=new URL(s,'https://coin.local'); const market=u.searchParams.get('market')||'KRW-BTC', tf=u.searchParams.get('tf')||'240', count=Number(u.searchParams.get('count')||200);
      let rows=window.__CA_TEST__.demoCandles(market,tf,count);
      if(window.__fetchMode==='corrupt'){ rows=rows.slice(); rows[20]={...rows[20],t:rows[19].t}; }
      return new Response(JSON.stringify({source:'UPBIT PUBLIC API',candles:rows}),{status:200,headers:{'content-type':'application/json'}});
    };
    return true;
  `);

  // Fresh installation and onboarding -> first analysis -> home summary.
  await ev(`for(const k of Object.keys(window.__CA_TEST__.storageDump()))window.__CA_TEST__.storageRemove(k); return window.__CA_TEST__.boot();`);
  add('fresh install opens onboarding',await ev(`return !document.querySelector('#onboardingOverlay').hidden`));
  add('onboarding defaults are safe',await ev(`return document.querySelector('#onboardingTfSelect').value==='240'&&document.querySelectorAll('.onboardingFavorites input:checked').length===3`));
  await ev(`return window.__CA_TEST__.completeOnboarding()`); await sleep(250);
  let state=await ev(`const s=window.__CA_TEST__.getState();return {market:s.analysis?.market,tf:s.analysis?.tf,source:s.sourceMeta?.state,safety:s.analysis?.validation?.safetyLevel,summary:s.summary.map(x=>x.meta?.state||'error')}`);
  add('onboarding flows into LIVE analysis',state.market==='KRW-BTC'&&state.tf==='240'&&state.source==='live',JSON.stringify(state));
  add('home summary integrates 3 favorite markets',state.summary.length===3&&state.summary.every(x=>x==='live'),JSON.stringify(state.summary));
  add('safe snapshot created from LIVE analysis',await ev(`return !!window.__CA_TEST__.getSafeSnapshot('KRW-BTC','240')`));
  add('headline and easy labels render after live flow',await ev(`return document.querySelector('#homeHeadline').textContent.trim().length>5&&['진입 양호','기다림','추격 위험'].includes(document.querySelector('#homeEntry').textContent)&&['상승 우세','중립','하락 우세'].includes(document.querySelector('#homeScenario').textContent)`));

  // Integrated Forward Learning record -> later outcome resolution.
  await ev(`window.__CA_TEST__.setTab('analysis'); return true`);
  await touch('#recordSignalBtn'); await sleep(100);
  add('analysis can record Forward Learning when not blocked',await ev(`return JSON.parse(window.__CA_TEST__.storageGet('crypto_analyzer_mobile:forward_learning')||'[]').length===1`));
  await ev(`const a=window.__CA_TEST__.getState().analysis; const learn=[{at:new Date(Date.now()-13*60*60*1000).toISOString(),market:'KRW-BTC',tf:'240',price:a.price*0.98,score:70,decision:'매수 관찰',confidence:.70,resolved:false}];window.__CA_TEST__.storageSet('crypto_analyzer_mobile:forward_learning',JSON.stringify(learn)); return true;`);
  await ev(`window.__fetchMode='live'; return window.__CA_TEST__.refresh()`); await sleep(100);
  add('live refresh resolves matured Forward outcome',await ev(`const x=JSON.parse(window.__CA_TEST__.storageGet('crypto_analyzer_mobile:forward_learning')||'[]')[0];return x.resolved===true&&typeof x.hit==='boolean'`));

  // Backup create -> destroy preferences/learning -> file import -> restore.
  const backup=await ev(`const b=window.__CA_TEST__.makeBackup(); return {b,ok:window.__CA_TEST__.verifyBackup(b)}`);
  add('integrated backup checksum valid',backup.ok===true);
  const backupPath=path.join(root,'docs','__integration_backup_test.json'); fs.writeFileSync(backupPath,JSON.stringify(backup.b,null,2));
  await ev(`window.__CA_TEST__.storageSet('crypto_analyzer_mobile:forward_learning','[]');window.__CA_TEST__.saveUiProfile({favorites:['KRW-DOGE'],lastMarket:'KRW-DOGE'});return true;`);
  const obj=await c.call('Runtime.evaluate',{expression:`document.querySelector('#importInput')`});
  await c.call('DOM.setFileInputFiles',{files:[backupPath],objectId:obj.result.objectId});
  await ev(`document.querySelector('#importInput').dispatchEvent(new Event('change',{bubbles:true}));return true;`); await sleep(250);
  add('backup import restores learning',await ev(`return JSON.parse(window.__CA_TEST__.storageGet('crypto_analyzer_mobile:forward_learning')||'[]').length===1`));
  add('backup import restores UI profile',await ev(`const p=window.__CA_TEST__.loadUiProfile();return p.favorites.includes('KRW-BTC')&&p.lastMarket==='KRW-BTC'`));
  add('backup import updates backup metadata',await ev(`return !!window.__CA_TEST__.loadBackupMeta().lastImportAt`));

  // LIVE -> outage -> same-market Safe Snapshot failover.
  await ev(`window.__CA_TEST__.storageSet('crypto_analyzer_mobile:settings',JSON.stringify({conservatism:'high',count:200,demoFallback:false,decisionAlerts:false}));window.__CA_TEST__.storageSet('crypto_analyzer_mobile:candle_cache','{}');window.__fetchMode='fail';document.querySelector('#marketSelect').value='KRW-BTC';document.querySelector('#tfSelect').value='240';return window.__CA_TEST__.refresh();`); await sleep(150);
  state=await ev(`const s=window.__CA_TEST__.getState();return {source:s.sourceMeta?.state,decision:s.analysis?.validation?.decision,safety:s.analysis?.validation?.safetyLevel,market:s.analysis?.market}`);
  add('API outage falls back to same-market safe snapshot',state.source==='snapshot'&&state.market==='KRW-BTC',JSON.stringify(state));
  add('snapshot failover blocks new trade decision',state.decision==='NO TRADE'&&state.safety==='BLOCKED',JSON.stringify(state));

  // Recover LIVE after outage.
  await ev(`window.__fetchMode='live';return window.__CA_TEST__.refresh()`); await sleep(120);
  state=await ev(`const s=window.__CA_TEST__.getState();return {source:s.sourceMeta?.state,market:s.analysis?.market}`);
  add('network recovery returns to LIVE',state.source==='live'&&state.market==='KRW-BTC',JSON.stringify(state));

  // Data corruption from API should never become usable analysis. Clear cache and snapshot so no fallback masks it.
  await ev(`window.__CA_TEST__.storageSet('crypto_analyzer_mobile:candle_cache','{}');window.__CA_TEST__.storageSet('crypto_analyzer_mobile:safe_snapshots','{}');window.__fetchMode='corrupt';return window.__CA_TEST__.refresh()`); await sleep(150);
  state=await ev(`const s=window.__CA_TEST__.getState();return {source:s.sourceMeta?.state,decision:s.analysis?.validation?.decision,safety:s.analysis?.validation?.safetyLevel,dataBadge:document.querySelector('#dataStateBadge').textContent}`);
  add('corrupt API data is not accepted as LIVE',state.source!=='live',JSON.stringify(state));
  add('corrupt API path cannot leave actionable decision',!state.decision||state.decision==='NO TRADE'||state.safety==='BLOCKED',JSON.stringify(state));

  // Return LIVE, then switch market during full outage with no cache/snapshot: must not relabel old BTC data as XRP.
  await ev(`window.__fetchMode='live';document.querySelector('#marketSelect').value='KRW-BTC';document.querySelector('#tfSelect').value='240';return window.__CA_TEST__.refresh()`); await sleep(120);
  const btc=await ev(`const s=window.__CA_TEST__.getState();return {price:s.analysis.price,market:s.analysis.market}`);
  await ev(`window.__CA_TEST__.storageSet('crypto_analyzer_mobile:candle_cache','{}');window.__CA_TEST__.storageSet('crypto_analyzer_mobile:safe_snapshots','{}');window.__fetchMode='fail';document.querySelector('#marketSelect').value='KRW-XRP';return window.__CA_TEST__.refresh()`); await sleep(150);
  const switched=await ev(`const s=window.__CA_TEST__.getState();return {selected:document.querySelector('#marketSelect').value,market:s.analysis?.market||null,price:s.analysis?.price||null,source:s.sourceMeta?.state,displayPrice:document.querySelector('#priceValue').textContent,decision:s.analysis?.validation?.decision||null}`);
  const contaminated=switched.selected==='KRW-XRP' && switched.market==='KRW-XRP' && switched.price===btc.price;
  add('market-switch outage never relabels prior-market analysis',!contaminated,JSON.stringify({btc,switched}));
  add('market-switch outage clears stale analysis state',switched.market===null&&switched.price===null&&switched.source==='error',JSON.stringify(switched));
  add('market-switch outage clears stale price UI',switched.displayPrice==='-'&&switched.decision===null,JSON.stringify(switched));
  add('market-switch outage clears stale research state',await ev(`const s=window.__CA_TEST__.getState();return s.research===null&&document.querySelector('#btPF').textContent==='-'&&document.querySelector('#btEdgeOverall').textContent==='확인 필요'`));

  // Same idea for timeframe change.
  await ev(`window.__fetchMode='live';document.querySelector('#marketSelect').value='KRW-BTC';document.querySelector('#tfSelect').value='240';return window.__CA_TEST__.refresh()`); await sleep(100);
  const tfBase=await ev(`const s=window.__CA_TEST__.getState();return {price:s.analysis.price,tf:s.analysis.tf}`);
  await ev(`window.__CA_TEST__.storageSet('crypto_analyzer_mobile:candle_cache','{}');window.__CA_TEST__.storageSet('crypto_analyzer_mobile:safe_snapshots','{}');window.__fetchMode='fail';document.querySelector('#tfSelect').value='60';return window.__CA_TEST__.refresh()`); await sleep(150);
  const tfSwitch=await ev(`const s=window.__CA_TEST__.getState();return {selected:document.querySelector('#tfSelect').value,tf:s.analysis?.tf||null,price:s.analysis?.price||null,source:s.sourceMeta?.state}`);
  const tfContaminated=tfSwitch.selected==='60' && tfSwitch.tf==='60' && tfSwitch.price===tfBase.price;
  add('timeframe-switch outage never relabels prior-timeframe analysis',!tfContaminated,JSON.stringify({tfBase,tfSwitch}));
  add('timeframe-switch outage clears stale analysis state',tfSwitch.tf===null&&tfSwitch.price===null&&tfSwitch.source==='error',JSON.stringify(tfSwitch));
  add('timeframe-switch outage clears stale price UI',await ev(`return document.querySelector('#priceValue').textContent==='-'&&document.querySelector('#decisionValue').textContent==='NO TRADE'&&document.querySelector('#decisionSafetyBadge').textContent==='사용 금지'`));

  // UI management functions stay available after all failure/recovery transitions.
  await ev(`window.__CA_TEST__.setTab('settings');return true;`);
  const health=await ev(`return window.__CA_TEST__.healthCheck()`);
  add('health check still executes after integrated failures',health.total===8&&health.fail<=1,JSON.stringify(health));
  add('no automatic order capability introduced',await ev(`return typeof window.placeOrder==='undefined'`));
  add('navigation remains four-tab after integrated flows',await ev(`return document.querySelectorAll('.bottomNav .tab').length===4`));
  add('mobile layout remains within 390px viewport',await ev(`return document.documentElement.scrollWidth<=window.innerWidth+2`),await ev(`return document.documentElement.scrollWidth+'/'+window.innerWidth`));

  try{fs.unlinkSync(backupPath)}catch{}
  const pass=tests.filter(x=>x.ok).length,total=tests.length;
  const result={version:'15.31.29',scope:'cross-module integrated mobile E2E',pass,total,failed:tests.filter(x=>!x.ok),tests,generatedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(root,'docs','MOBILE_INTEGRATION_E2E.json'),JSON.stringify(result,null,2));
  console.log(`RESULT ${pass}/${total} PASS`); for(const x of result.failed)console.log('FAIL',x.name,x.detail);
  if(pass!==total)process.exitCode=2;
 }catch(e){console.error(e);process.exitCode=1}
 finally{try{c?.close()}catch{};chrome.kill('SIGKILL')}
})();

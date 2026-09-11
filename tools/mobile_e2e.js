'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'..');
const PORT=9338+(process.pid%200),profile=`/tmp/coin_nachimpan_v153127_mobile_e2e_${process.pid}`;
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
  for(let i=0;i<50;i++){try{const pages=await getJson(`http://127.0.0.1:${PORT}/json`);if(pages[0]){c=new CDP(pages[0].webSocketDebuggerUrl);await c.ready();break}}catch{}await sleep(100)}
  if(!c)throw new Error('Chromium CDP unavailable');
  await c.call('Page.enable');await c.call('Runtime.enable');
  const tree=await c.call('Page.getFrameTree'),frameId=tree.frameTree.frame.id;
  const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8').replace(/<link rel="stylesheet" href="\.\/styles\.css">/,'').replace(/<script src="\.\/user-data-store\.js"><\/script>/,'').replace(/<script src="\.\/user-data-store\.js"><\/script>/,'').replace(/<script src="\.\/app\.js"><\/script>/,'');
  const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8'),storage=fs.readFileSync(path.join(root,'public','user-data-store.js'),'utf8'),app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
  await c.call('Page.setDocumentContent',{frameId,html:html.replace('</head>',`<style>${css}</style></head>`)});
  await c.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2.75,mobile:true,screenWidth:390,screenHeight:844});
  await c.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await c.call('Runtime.evaluate',{expression:'window.__CA_FORCE_DEMO__=true;'});
  let preload=await c.call('Runtime.evaluate',{expression:storage,awaitPromise:true,returnByValue:true});if(preload.exceptionDetails)throw new Error(preload.exceptionDetails.text);
  const run=await c.call('Runtime.evaluate',{expression:app,awaitPromise:true,returnByValue:true});if(run.exceptionDetails)throw new Error(run.exceptionDetails.text);
  async function ev(expr){const x=await c.call('Runtime.evaluate',{expression:`(()=>{${expr}})()`,returnByValue:true,awaitPromise:true});if(x.exceptionDetails)throw new Error(x.exceptionDetails.exception?.description||x.exceptionDetails.text);return x.result.value}
  async function touch(sel){const r=await ev(`const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2,w:b.width,h:b.height}`);if(!r)return false;await c.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x,y:r.y,radiusX:3,radiusY:3,force:1,id:1}]});await c.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(120);return true}
  add('version 15.31.29',await ev(`return window.__CA_TEST__.version==='15.31.29'`));

  // Fresh install -> onboarding.
  await ev(`window.__CA_TEST__.storageRemove('crypto_analyzer_mobile:ui_profile');window.__CA_TEST__.storageRemove('crypto_analyzer_mobile:settings');window.__CA_TEST__.storageRemove('crypto_analyzer_mobile:forward_learning');window.__CA_TEST__.storageRemove('crypto_analyzer_mobile:candle_cache');return true`);
  await ev(`return window.__CA_TEST__.boot()`);
  add('fresh install onboarding visible',await ev(`return !document.querySelector('#onboardingOverlay').hidden`));
  add('onboarding defaults 3 favorites',await ev(`return document.querySelectorAll('.onboardingFavorites input:checked').length===3`));
  add('onboarding default 4H',await ev(`return document.querySelector('#onboardingTfSelect').value==='240'`));
  await touch('#onboardingStartBtn');await sleep(700);
  add('onboarding completes',await ev(`return document.querySelector('#onboardingOverlay').hidden===true&&window.__CA_TEST__.loadUiProfile().onboardingDone===true`));
  add('home default active',await ev(`return document.querySelector('#pane-home').classList.contains('active')`));
  add('4 bottom tabs only',await ev(`return document.querySelectorAll('.bottomNav .tab').length===4&&!document.querySelector('.bottomNav [data-tab=\"status\"]')`));
  add('status pane removed',await ev(`return !document.querySelector('#pane-status')`));
  add('home management rows removed',await ev(`return ![...document.querySelectorAll('#pane-home .homeQuickRow b')].some(x=>['앱 상태 검사','백업 상태'].includes(x.textContent.trim()))`));
  add('Forward Learning removed from initial home',await ev(`return !document.querySelector('#pane-home .homeQuickRow')&&!document.querySelector('#pane-home #homeForwardText')&&!document.querySelector('#pane-home').textContent.includes('Forward Learning')`));
  add('headline-first home structure',await ev(`return !!document.querySelector('#homeHeadline')&&!!document.querySelector('#homeDeck')&&!!document.querySelector('.homeReasonDetails')`));
  add('reason detail collapsed by default',await ev(`return document.querySelector('.homeReasonDetails').open===false`));
  add('settings contains health and backup',await ev(`return !!document.querySelector('#pane-settings #healthCheckBtn')&&!!document.querySelector('#pane-settings #lastBackupText')`));
  add('home favorites 3 cards',await ev(`return document.querySelectorAll('#summaryList .summaryCard').length===3`));
  add('home hero decision/confidence/state',await ev(`const d=document.querySelector('#homeDecision').textContent,c=document.querySelector('#homeConfidence').textContent,s=document.querySelector('#homeDataState').textContent;return d.length>0&&c.includes('/')&&(['예시 데이터','실시간','최근 저장값','데이터 오래됨'].includes(s))`));
  add('headline populated from decision context',await ev(`const h=document.querySelector('#homeHeadline').textContent.trim(),d=document.querySelector('#homeDeck').textContent.trim();return h.length>=8&&d.length>=8`));
  add('important learning retained in records',await ev(`return !!document.querySelector('#pane-research #flTotal')&&!!document.querySelector('#pane-research #flCalibration')&&!!document.querySelector('#pane-research #regimeEdgeList')`));

  // Layout widths.
  for(const width of [320,360,375,390,393,412,414,430]){
    await c.call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:2.75,mobile:true,screenWidth:width,screenHeight:844});await sleep(60);
    const x=await ev(`return {ov:document.documentElement.scrollWidth-window.innerWidth,app:document.querySelector('#appRoot').getBoundingClientRect().width,sum:document.querySelector('#summaryList').getBoundingClientRect().width}`);
    add(`width ${width} no overflow`,x.ov<=2,String(x.ov));add(`width ${width} summary fits`,x.sum<=x.app+1,`${x.sum}/${x.app}`);
  }
  await c.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2.75,mobile:true,screenWidth:390,screenHeight:844});

  const targets=await ev(`return [...document.querySelectorAll('button,select,.fileButton,summary,.favoriteGrid label')].map(e=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return{id:e.id||e.textContent.trim().slice(0,20),h:r.height,w:r.width,display:cs.display,vis:cs.visibility}}).filter(x=>x.display!=='none'&&x.vis!=='hidden'&&x.h>0)`);
  const small=targets.filter(x=>x.h<43.5);add('touch targets >=44px',small.length===0,JSON.stringify(small.slice(0,8)));

  // Summary card -> analysis.
  await touch('#summaryList .summaryCard');await sleep(400);
  add('summary card opens analysis',await ev(`return document.querySelector('#pane-analysis').classList.contains('active')`));
  add('analysis present',await ev(`return !!window.__CA_TEST__.getState().analysis`));
  add('entry quality populated',await ev(`return ['진입 양호','기다림','추격 위험'].includes(document.querySelector('#entryQualityValue').textContent)`));
  add('scenario populated',await ev(`return ['상승 우세','중립','하락 우세'].includes(document.querySelector('#scenarioValue').textContent)`));
  add('strategy edge populated',await ev(`return ['전략 우위 있음','방어력 우위','뚜렷한 우위 없음','표본 부족'].includes(document.querySelector('#strategyEdgeValue').textContent)`));
  add('scenario planner has 3 cases',await ev(`return document.querySelectorAll('#scenarioPlanner .scenarioRow').length===3`));
  add('research benchmark/cost visible',await ev(`return document.querySelector('#btCost').textContent.includes('0.15%')&&document.querySelector('#btBuyHold').textContent!=='-'&&document.querySelector('#btEdgeOverall').textContent!=='-'`));
  add('regime edge UI populated',await ev(`return document.querySelectorAll('#regimeEdgeList .regimeEdgeRow').length===5`));
  add('confidence calibration UI present',await ev(`return !!document.querySelector('#flCalibration')&&!!document.querySelector('#flCalibrationSample')&&!!document.querySelector('#calibrationBands')`));
  add('data integrity visible',await ev(`return document.querySelector('#qualityValue').textContent.includes('READY')||document.querySelector('#qualityValue').textContent.includes('CAUTION')||document.querySelector('#qualityValue').textContent.includes('BLOCKED')`));
  const chase=await ev(`const T=window.__CA_TEST__,d=T.demoCandles('KRW-BTC','240',200);for(let i=d.length-6;i<d.length;i++){const f=1+(i-(d.length-6)+1)*.035;d[i]={...d[i],o:d[i].o*f,c:d[i].c*f,h:Math.max(d[i].o*f,d[i].c*f)*1.01,l:Math.min(d[i].o*f,d[i].c*f)*.995,v:d[i].v*3};}const sig=T.computeSignal(d),eq=T.entryQuality(d,sig);return {label:eq.label,score:sig.score,rsi:sig.rsi,ext:eq.metrics.extensionATR}`);add('chase-risk detector stress fixture',chase.label==='CHASE RISK',JSON.stringify(chase));
  add('data demo explicit',await ev(`return document.querySelector('#dataStateBadge').textContent==='예시 데이터'`));
  add('decision summary 3 lines',await ev(`return document.querySelectorAll('#decisionSummary .summaryLine').length===3`));
  add('DEMO safety gate blocks actionable decision',await ev(`const a=window.__CA_TEST__.getState().analysis;return a.validation.safetyLevel==='BLOCKED'&&a.validation.decision==='NO TRADE'&&document.querySelector('#decisionSafetyBadge').textContent==='사용 금지'`));
  add('readiness panel present',await ev(`return !!document.querySelector('#readinessOverall')&&!!document.querySelector('#readinessData')&&!!document.querySelector('#readinessBackup')`));
  add('home warning appears on DEMO issue',await ev(`const a=document.querySelector('#homeAlertBanner'),d=document.querySelector('#settingsAlertDot');return !!a&&!a.hidden&&!!d&&!d.hidden`));
  add('home warning hidden when readiness normal',await ev(`const T=window.__CA_TEST__,st=T.getState(),old=st.summary;st.summary=[{meta:{state:'live'}}];T.storageRemove('crypto_analyzer_mobile:backup_meta');T.storageRemove('crypto_analyzer_mobile:forward_learning');T.renderReadiness();const a=document.querySelector('#homeAlertBanner'),d=document.querySelector('#settingsAlertDot'),ok=a.hidden&&d.hidden;st.summary=old;T.renderReadiness();return ok`));
  const fsEarly=await ev(`return window.__CA_TEST__.forwardStats([])`);add('forward sample maturity early',fsEarly.maturity==='EARLY',JSON.stringify(fsEarly));
  const temporal=await ev(`const d=window.__CA_TEST__.demoCandles('KRW-BTC','240',200);return window.__CA_TEST__.temporalStability(d)`);add('temporal stability finite',Number.isFinite(temporal)&&temporal>=0&&temporal<=1,String(temporal));
  const cacheGate=await ev(`const d=window.__CA_TEST__.demoCandles('KRW-BTC','240',200),s=window.__CA_TEST__.computeSignal(d),q=window.__CA_TEST__.qualityAssessment(d),bt=window.__CA_TEST__.backtest(d),v=window.__CA_TEST__.finalValidation(d,s,q,bt,[],{sourceMeta:{state:'cached'}});return {level:v.safetyLevel,reliability:v.reliability,decision:v.decision}`);add('cached data confidence capped',cacheGate.level==='CAUTION'&&cacheGate.reliability<=.620001,JSON.stringify(cacheGate));
  const snapOk=await ev(`const d=window.__CA_TEST__.demoCandles('KRW-BTC','240',200),s=window.__CA_TEST__.computeSignal(d),q=window.__CA_TEST__.qualityAssessment(d),bt=window.__CA_TEST__.backtest(d),v=window.__CA_TEST__.finalValidation(d,s,q,bt,[],{sourceMeta:{state:'live'}}),a={...s,quality:q,validation:v,market:'KRW-BTC',tf:'240'};window.__CA_TEST__.saveSafeSnapshot('KRW-BTC','240',d,{state:'live'},a,bt);const x=window.__CA_TEST__.getSafeSnapshot('KRW-BTC','240');return !!x&&x.rows.length===90&&x.analysis.market==='KRW-BTC'`);add('safe snapshot stored/recovered',snapOk);
  const snapshotGate=await ev(`const d=window.__CA_TEST__.demoCandles('KRW-BTC','240',200),s=window.__CA_TEST__.computeSignal(d),q=window.__CA_TEST__.qualityAssessment(d),bt=window.__CA_TEST__.backtest(d),v=window.__CA_TEST__.finalValidation(d,s,q,bt,[],{sourceMeta:{state:'snapshot'}});return {decision:v.decision,level:v.safetyLevel}`);add('snapshot is reference-only',snapshotGate.decision==='NO TRADE'&&snapshotGate.level==='BLOCKED',JSON.stringify(snapshotGate));
  const backupNeed=await ev(`const old=window.__CA_TEST__.storageGet('crypto_analyzer_mobile:forward_learning');const bm=window.__CA_TEST__.storageGet('crypto_analyzer_mobile:backup_meta');window.__CA_TEST__.storageSet('crypto_analyzer_mobile:forward_learning',JSON.stringify(Array.from({length:10},(_,i)=>({at:new Date(Date.now()-i*1000).toISOString(),market:'KRW-BTC',tf:'240',price:100,score:70,resolved:false}))));window.__CA_TEST__.storageRemove('crypto_analyzer_mobile:backup_meta');const due=window.__CA_TEST__.backupDue();if(old===null)window.__CA_TEST__.storageRemove('crypto_analyzer_mobile:forward_learning');else window.__CA_TEST__.storageSet('crypto_analyzer_mobile:forward_learning',old);if(bm===null)window.__CA_TEST__.storageRemove('crypto_analyzer_mobile:backup_meta');else window.__CA_TEST__.storageSet('crypto_analyzer_mobile:backup_meta',bm);return due`);add('backup reminder after 10 records',backupNeed===true);

  // V15.31.29 Headline-first / progressive disclosure gates.

  add('easy-language home labels',await ev(`return document.querySelector('.homeActionGrid').textContent.includes('진입 위치')&&document.querySelector('.homeActionGrid').textContent.includes('시장 흐름')&&document.querySelector('.homeActionGrid').textContent.includes('전략 우위')`));
  add('easy-language home values',await ev(`const e=document.querySelector('#homeEntry').textContent,s=document.querySelector('#homeScenario').textContent,g=document.querySelector('#homeEdge').textContent;return ['진입 양호','기다림','추격 위험'].includes(e)&&['상승 우세','중립','하락 우세'].includes(s)&&['전략 우위 있음','방어력 우위','뚜렷한 우위 없음','표본 부족'].includes(g)`));

  const integrityReady=await ev(`const T=window.__CA_TEST__,d=T.demoCandles('KRW-BTC','240',200),g=T.dataIntegrityGate(d,'240');return {level:g.level,rows:g.rows.length,partial:g.partialLast,score:g.score}`);add('data integrity normal fixture ready',integrityReady.level==='READY'&&integrityReady.rows===200,JSON.stringify(integrityReady));
  const integrityBlocked=await ev(`const T=window.__CA_TEST__,d=T.demoCandles('KRW-BTC','240',200);d[70]={...d[70],t:d[69].t};const g=T.dataIntegrityGate(d,'240');return {level:g.level,duplicates:g.duplicates,issues:g.issues}`);add('duplicate candle blocked by integrity gate',integrityBlocked.level==='BLOCKED'&&integrityBlocked.duplicates>0,JSON.stringify(integrityBlocked));
  const partialTrim=await ev(`const T=window.__CA_TEST__,d=T.demoCandles('KRW-BTC','60',200);d[d.length-1]={...d[d.length-1],t:Date.now()-5*60*1000};const g=T.dataIntegrityGate(d,'60');return {partial:g.partialLast,before:d.length,after:g.rows.length,level:g.level}`);add('unfinished last candle excluded',partialTrim.partial===true&&partialTrim.after===partialTrim.before-1,JSON.stringify(partialTrim));

  const calGood=await ev(`const T=window.__CA_TEST__,a=[];for(let i=0;i<10;i++)a.push({resolved:true,excluded:false,confidence:.58,hit:i<5});for(let i=0;i<10;i++)a.push({resolved:true,excluded:false,confidence:.70,hit:i<6});for(let i=0;i<10;i++)a.push({resolved:true,excluded:false,confidence:.84,hit:i<8});return T.confidenceCalibration(a)`);add('confidence calibration recognizes monotonic bands',calGood.status==='CALIBRATED'&&calGood.samples===30,JSON.stringify(calGood));
  const calBad=await ev(`const T=window.__CA_TEST__,a=[];for(let i=0;i<12;i++)a.push({resolved:true,excluded:false,confidence:.82,hit:i<4});for(let i=0;i<12;i++)a.push({resolved:true,excluded:false,confidence:.68,hit:i<8});return T.confidenceCalibration(a)`);add('confidence overconfidence detected',calBad.status==='OVERCONFIDENT',JSON.stringify(calBad));

  const regimeEdge=await ev(`const T=window.__CA_TEST__,d=T.demoCandles('KRW-BTC','240',200),bt=T.backtest(d);return {keys:Object.keys(bt.regimeEdges||{}),labels:Object.values(bt.regimeEdges||{}).map(x=>x.label),counts:Object.values(bt.regimeEdges||{}).map(x=>x.count)}`);add('regime edge 5 buckets generated',regimeEdge.keys.length===5&&regimeEdge.keys.includes('BULL')&&regimeEdge.keys.includes('HIGH_VOL'),JSON.stringify(regimeEdge));

  // Recent selection memory.
  await ev(`document.querySelector('#marketSelect').value='KRW-SOL';document.querySelector('#marketSelect').dispatchEvent(new Event('change'));document.querySelector('#tfSelect').value='60';document.querySelector('#tfSelect').dispatchEvent(new Event('change'));return true`);
  add('last market/timeframe remembered',await ev(`const p=window.__CA_TEST__.loadUiProfile();return p.lastMarket==='KRW-SOL'&&p.lastTf==='60'`));

  // Settings favorites / font.
  await touch('.tab[data-tab="settings"]');
  await ev(`document.querySelectorAll('#favoriteGrid input').forEach(x=>x.checked=['KRW-BTC','KRW-XRP'].includes(x.value));document.querySelector('#fontScaleSelect').value='large';return true`);
  await touch('#saveUiPrefsBtn');await sleep(300);
  add('favorites saved',await ev(`const p=window.__CA_TEST__.loadUiProfile();return p.favorites.length===2&&p.favorites.includes('KRW-XRP')`));
  add('large font applied',await ev(`return document.body.classList.contains('font-large')`));
  add('quick state favorite count',await ev(`return document.querySelector('#favoriteCountText').textContent==='2'`));
  add('health check UI present',await ev(`return !!document.querySelector('#healthCheckBtn')&&!!document.querySelector('#healthCheckStatus')&&!!document.querySelector('#healthCheckList')`));
  await touch('#healthCheckBtn');await sleep(120);
  const health=await ev(`return window.__CA_TEST__.healthCheck()`);add('one-tap health check completes',health.total===8&&health.fail===0,JSON.stringify(health));
  add('health check renders 8 rows',await ev(`return document.querySelectorAll('#healthCheckList .healthCheckItem').length===8`));
  await touch('.tab[data-tab="home"]');await sleep(500);
  add('home summary updates to 2 favorites',await ev(`return document.querySelectorAll('#summaryList .summaryCard').length===2`));

  // Backup v2 and old v1 compatibility.
  const backup=await ev(`const b=window.__CA_TEST__.makeBackup();return {ok:window.__CA_TEST__.verifyBackup(b),schema:b.schemaVersion,hasUi:!!b.uiProfile,favs:b.uiProfile.favorites.length}`);
  add('backup v2 valid',backup.ok&&backup.schema===2&&backup.hasUi&&backup.favs===2,JSON.stringify(backup));
  await touch('.tab[data-tab="settings"]');await touch('#exportBtn');await sleep(150);
  add('backup status timestamp visible',await ev(`return document.querySelector('#lastBackupText').textContent!=='아직 없음'&&!!JSON.parse(window.__CA_TEST__.storageGet('crypto_analyzer_mobile:backup_meta')).lastExportAt`));
  const legacyBackup=await ev(`const b=window.__CA_TEST__.makeBackup();b.schemaVersion=1;delete b.uiProfile;delete b.integrity;const raw=JSON.stringify(b);let h=2166136261;for(let i=0;i<raw.length;i++){h^=raw.charCodeAt(i);h=Math.imul(h,16777619)}b.integrity={algo:'fnv1a32',hash:(h>>>0).toString(16).padStart(8,'0')};return window.__CA_TEST__.verifyBackup(b)`);
  add('v15.31.17-style schema1 backup accepted',legacyBackup);

  // Simulate existing V23 user migration without losing saved UI data.
  const migrated=await ev(`window.__CA_TEST__.storageSet('crypto_analyzer_mobile:ui_profile',JSON.stringify({onboardingDone:true,favorites:['KRW-BTC','KRW-ETH'],lastMarket:'KRW-BTC',lastTf:'240',lastTab:'home',fontScale:'normal',lastSeenVersion:'15.31.27',updatedFrom:'15.31.26'}));const p=window.__CA_TEST__.initUiProfile();return p.onboardingDone===true&&p.updatedFrom==='15.31.27'&&p.lastSeenVersion==='15.31.29'&&p.favorites.length===2&&p.lastTab==='home'`);
  add('existing V26 user migrates without onboarding/data loss',migrated);
  await ev(`window.__CA_TEST__.renderUpdateStatus();return true`);
  add('update status shows V27 to V28',await ev(`return document.querySelector('#updateStatusTitle').textContent.includes('15.31.27')&&document.querySelector('#updateStatusTitle').textContent.includes('15.31.29')`));

  // Self test.
  const self=await ev(`return window.__CA_TEST__.selfTest()`);add('self test all pass',self.pass===self.total,`${self.pass}/${self.total}`);

  // Landscape.
  await c.call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:2.75,mobile:true,screenWidth:844,screenHeight:390});await sleep(100);
  add('landscape no fatal overflow',await ev(`return document.documentElement.scrollWidth<=window.innerWidth+2`),await ev(`return document.documentElement.scrollWidth+'/'+window.innerWidth`));

  const pass=tests.filter(x=>x.ok).length,total=tests.length,result={version:'15.31.29',scope:'mobile-only usability Chromium E2E',pass,total,failed:tests.filter(x=>!x.ok),tests,generatedAt:new Date().toISOString()};
  fs.mkdirSync(path.join(root,'docs'),{recursive:true});fs.writeFileSync(path.join(root,'docs','MOBILE_ONLY_CHROMIUM_E2E.json'),JSON.stringify(result,null,2));
  console.log(`RESULT ${pass}/${total} PASS`);if(pass!==total){for(const x of result.failed)console.error('FAIL',x.name,x.detail);process.exitCode=1}
 }catch(e){console.error(e);process.exitCode=1}
 finally{try{c?.close()}catch{};chrome.kill('SIGKILL')}
})();
(()=>{
'use strict';
const APP_VERSION='15.31.29';
const SIM_ROUNDTRIP_COST=0.0015; // 보수적 백테스트 가정: 수수료+슬리피지 왕복 0.15%
const STORAGE_NS='crypto_analyzer_mobile';
const LEGACY_NAMESPACES=['crypto_analyzer_v15_31_16'];
const SETTINGS_KEY=`${STORAGE_NS}:settings`;
const LEARNING_KEY=`${STORAGE_NS}:forward_learning`;
const CACHE_KEY=`${STORAGE_NS}:candle_cache`;
const DECISION_STATE_KEY=`${STORAGE_NS}:decision_state`;
const UI_KEY=`${STORAGE_NS}:ui_profile`;
const BACKUP_META_KEY=`${STORAGE_NS}:backup_meta`;
const SNAPSHOT_KEY=`${STORAGE_NS}:safe_snapshots`;
const $=id=>document.getElementById(id);
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const fmt=(x,d=2)=>Number.isFinite(x)?Number(x).toLocaleString('ko-KR',{maximumFractionDigits:d}):'-';
const pct=(x,d=1)=>Number.isFinite(x)?`${x.toFixed(d)}%`:'-';
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const sum=a=>a.reduce((s,x)=>s+x,0);
const stdev=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1))};
const median=a=>{const x=a.filter(Number.isFinite).slice().sort((m,n)=>m-n);if(!x.length)return NaN;const i=Math.floor(x.length/2);return x.length%2?x[i]:(x[i-1]+x[i])/2};
const safeJson=(s,fallback=null)=>{try{return JSON.parse(s)}catch{return fallback}};
const userDataStore=window.CoinNachimpanStorage?.createLocalUserDataStore({namespace:STORAGE_NS,legacyNamespaces:LEGACY_NAMESPACES});
if(!userDataStore)throw new Error('UserDataStore initialization failed');
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const nowIso=()=>new Date().toISOString();
let state={candles:[],analysis:null,research:null,loading:false,source:'-',sourceMeta:null,scanner:[],summary:[],summaryLoading:false};

function migrateLegacyStorage(){
  for(const ns of LEGACY_NAMESPACES){for(const suffix of ['settings','forward_learning','candle_cache']){const target=`${STORAGE_NS}:${suffix}`,legacy=`${ns}:${suffix}`;if(userDataStore.getItem(target)===null&&userDataStore.getItem(legacy)!==null)userDataStore.setItem(target,userDataStore.getItem(legacy))}}
}
function loadSettings(){
  const d={conservatism:'high',count:200,demoFallback:true,decisionAlerts:false};
  const v=safeJson(userDataStore.getItem(SETTINGS_KEY),{});return {...d,...(v&&typeof v==='object'?v:{})};
}
function saveSettings(s){userDataStore.setItem(SETTINGS_KEY,JSON.stringify(s))}
function loadLearning(){const v=safeJson(userDataStore.getItem(LEARNING_KEY),[]);return Array.isArray(v)?v:[]}
function saveLearning(v){userDataStore.setItem(LEARNING_KEY,JSON.stringify(v.slice(-300)))}
function loadCache(){const v=safeJson(userDataStore.getItem(CACHE_KEY),{});return v&&typeof v==='object'?v:{}}
function saveCache(v){try{userDataStore.setItem(CACHE_KEY,JSON.stringify(v))}catch{}}

function defaultUiProfile(){return{onboardingDone:false,favorites:['KRW-BTC','KRW-ETH','KRW-SOL'],lastMarket:'KRW-BTC',lastTf:'240',lastTab:'home',fontScale:'normal',lastSeenVersion:null,updatedFrom:null,firstRunAt:null}}
function sanitizeFavorites(v){const allowed=['KRW-BTC','KRW-ETH','KRW-XRP','KRW-SOL','KRW-DOGE'],arr=Array.isArray(v)?v.filter(x=>allowed.includes(x)):[];return [...new Set(arr)].slice(0,5)}
function loadUiProfile(){const d=defaultUiProfile(),v=safeJson(userDataStore.getItem(UI_KEY),{}),x={...d,...(v&&typeof v==='object'?v:{})};x.favorites=sanitizeFavorites(x.favorites);if(!x.favorites.length)x.favorites=[...d.favorites];if(!['60','240','day'].includes(String(x.lastTf)))x.lastTf='240';if(x.lastTab==='status')x.lastTab='settings';if(!['home','analysis','research','settings'].includes(x.lastTab))x.lastTab='home';if(!['normal','large'].includes(x.fontScale))x.fontScale='normal';return x}
function saveUiProfile(v){const x={...loadUiProfile(),...v};x.favorites=sanitizeFavorites(x.favorites);if(!x.favorites.length)x.favorites=['KRW-BTC'];userDataStore.setItem(UI_KEY,JSON.stringify(x));return x}
function initUiProfile(){
  if(userDataStore.getItem(UI_KEY)!==null){
    const p=loadUiProfile();
    if(p.lastSeenVersion!==APP_VERSION){const from=p.lastSeenVersion||'15.31.28';p.updatedFrom=from;p.lastSeenVersion=APP_VERSION;saveUiProfile(p)}
    return loadUiProfile();
  }
  const hasExisting=[SETTINGS_KEY,LEARNING_KEY,CACHE_KEY,DECISION_STATE_KEY].some(k=>userDataStore.getItem(k)!==null);
  const p=defaultUiProfile();
  if(hasExisting){p.onboardingDone=true;p.lastSeenVersion=APP_VERSION;p.updatedFrom='15.31.28';p.firstRunAt=nowIso()}
  saveUiProfile(p);return p
}
function loadBackupMeta(){const v=safeJson(userDataStore.getItem(BACKUP_META_KEY),{});return v&&typeof v==='object'?v:{}}
function saveBackupMeta(v){userDataStore.setItem(BACKUP_META_KEY,JSON.stringify({...loadBackupMeta(),...v}))}
function loadSnapshots(){const v=safeJson(userDataStore.getItem(SNAPSHOT_KEY),{});return v&&typeof v==='object'?v:{}}
function snapshotKey(market,tf){return `${market}:${tf}`}
function saveSafeSnapshot(market,tf,rows,sourceMeta,analysis,research){
  if(sourceMeta?.state!=='live'||analysis?.quality?.status!=='HEALTHY')return false;
  const all=loadSnapshots(),key=snapshotKey(market,tf);all[key]={savedAt:Date.now(),market,tf,rows:rows.slice(-90),sourceMeta:{...sourceMeta,state:'snapshot'},analysis,research:{...research,returns:undefined}};
  const keys=Object.keys(all).sort((a,b)=>(all[b]?.savedAt||0)-(all[a]?.savedAt||0));for(const k of keys.slice(15))delete all[k];
  try{userDataStore.setItem(SNAPSHOT_KEY,JSON.stringify(all));return true}catch{return false}
}
function getSafeSnapshot(market,tf){const x=loadSnapshots()[snapshotKey(market,tf)];if(!x||!Array.isArray(x.rows)||x.rows.length<60)return null;const maxAge=tfMs(tf)*8;return Date.now()-(x.savedAt||0)<=maxAge?x:null}
function backupDue(){const learn=loadLearning(),m=loadBackupMeta(),t=m.lastExportAt||m.lastImportAt;if(learn.length<10)return false;if(!t)return true;const d=Date.parse(t);return !Number.isFinite(d)||Date.now()-d>7*24*60*60*1000}
function renderBackupMeta(){const m=loadBackupMeta(),el=$('lastBackupText');if(!el)return;const t=m.lastExportAt||m.lastImportAt;if(!t){el.textContent='아직 없음';return}const d=new Date(t);el.textContent=Number.isNaN(d.getTime())?'기록 있음':`${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
function renderUpdateStatus(){const p=loadUiProfile(),title=$('updateStatusTitle'),detail=$('updateStatusDetail');if(!title||!detail)return;$('currentVersionText').textContent=`V${APP_VERSION}`;if(p.updatedFrom){title.textContent=`V${p.updatedFrom} → V${APP_VERSION} 업데이트 완료`;detail.textContent='설정 · 즐겨찾기 · Forward Learning · 로컬 캐시를 유지하는 저장소 구조를 사용합니다.'}else{title.textContent=`V${APP_VERSION} 사용 중`;detail.textContent='신규 설치 또는 현재 버전입니다. 다음 업데이트에서도 동일한 로컬 저장소를 유지합니다.'}}
function applyFontScale(){const p=loadUiProfile();document.body.classList.toggle('font-large',p.fontScale==='large')}

function xorshift(seed){let x=seed|0||123456789;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return((x>>>0)%1000000)/1000000}}
function demoCandles(market,tf,count=200){
  let seed=2166136261;for(const ch of `${market}:${tf}`){seed^=ch.charCodeAt(0);seed=Math.imul(seed,16777619)}
  const rnd=xorshift(seed);let base=market==='KRW-BTC'?95000000:market==='KRW-ETH'?5200000:market==='KRW-XRP'?4200:market==='KRW-SOL'?245000:310;
  const ms=tf==='day'?86400000:Number(tf)*60000;const out=[];let c=base*(.92+rnd()*.16);let t=Date.now()-count*ms;
  for(let i=0;i<count;i++,t+=ms){
    const drift=Math.sin(i/19)*.0012+Math.cos(i/41)*.0008;const shock=(rnd()-.5)*.018;const o=c;c=Math.max(1,o*(1+drift+shock));const spread=Math.abs((rnd()-.5)*.012);const h=Math.max(o,c)*(1+spread);const l=Math.min(o,c)*(1-spread);const v=(50+rnd()*180)*(1+Math.abs(shock)*20);out.push({t,o,h,l,c,v});
  }return out;
}

async function fetchJson(url,{timeout=8000,retries=2}={}){
  let lastErr;
  for(let i=0;i<=retries;i++){
    const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),timeout);
    try{
      const r=await fetch(url,{signal:ctl.signal,headers:{'accept':'application/json'}});clearTimeout(timer);
      if(!r.ok){const e=new Error(`HTTP ${r.status}`);e.status=r.status;throw e}
      const txt=await r.text();const j=safeJson(txt,null);if(j===null)throw new Error('Invalid JSON');return j;
    }catch(e){clearTimeout(timer);lastErr=e;if(i<retries)await new Promise(r=>setTimeout(r,250*(2**i)))}
  }throw lastErr;
}

function normalizeCandleRows(rows){
  if(!Array.isArray(rows))return [];
  const out=rows.map(r=>({
    t:Number(r.t ?? r.timestamp ?? (r.candle_date_time_kst ? Date.parse(r.candle_date_time_kst) : 0)),
    o:Number(r.o??r.opening_price),h:Number(r.h??r.high_price),l:Number(r.l??r.low_price),c:Number(r.c??r.trade_price),v:Number(r.v??r.candle_acc_trade_volume)
  })).filter(r=>[r.t,r.o,r.h,r.l,r.c,r.v].every(Number.isFinite)&&r.t>0&&r.o>0&&r.h>0&&r.l>0&&r.c>0&&r.v>=0&&r.h>=Math.max(r.o,r.c)&&r.l<=Math.min(r.o,r.c)&&r.h>=r.l);
  out.sort((a,b)=>a.t-b.t);return out;
}
async function getCandles(market,tf,count){
  const key=`${market}:${tf}:${count}`;const cache=loadCache();
  if(location.protocol!=='file:' && !window.__CA_FORCE_DEMO__){
    try{
      const j=await fetchJson(`/api/candles?market=${encodeURIComponent(market)}&tf=${encodeURIComponent(tf)}&count=${count}`,{timeout:7000,retries:2});
      const rows=normalizeCandleRows(j.candles||j);if(rows.length>=50){cache[key]={at:Date.now(),rows};saveCache(cache);const source=j.source||'UPBIT API';return{rows,source,mode:'LIVE',fetchedAt:Date.now()}}
    }catch(e){
      const c=cache[key];if(c&&Array.isArray(c.rows)&&c.rows.length>=50)return{rows:c.rows,source:'CACHE FALLBACK',mode:'CACHED',fetchedAt:c.at||0};
      if(!loadSettings().demoFallback)throw e;
    }
  }
  return{rows:demoCandles(market,tf,count),source:window.__CA_FORCE_DEMO__?'LOCAL E2E DEMO':location.protocol==='file:'?'LOCAL DEMO (file://)':'LOCAL DEMO FALLBACK',mode:'DEMO',fetchedAt:Date.now()};
}

function ema(values,n){if(!values.length)return[];const k=2/(n+1),out=[values[0]];for(let i=1;i<values.length;i++)out.push(values[i]*k+out[i-1]*(1-k));return out}
function rsi(values,n=14){if(values.length<n+1)return NaN;let g=0,l=0;for(let i=values.length-n;i<values.length;i++){const d=values[i]-values[i-1];if(d>=0)g+=d;else l-=d}g/=n;l/=n;if(l===0)return 100;const rs=g/l;return 100-100/(1+rs)}
function atr(rows,n=14){if(rows.length<n+1)return NaN;const trs=[];for(let i=rows.length-n;i<rows.length;i++){const p=rows[i-1],x=rows[i];trs.push(Math.max(x.h-x.l,Math.abs(x.h-p.c),Math.abs(x.l-p.c)))}return mean(trs)}
function sma(values,n){return values.length<n?NaN:mean(values.slice(-n))}
function wilson95(hits,total){if(!total)return{low:0,high:1};const z=1.959963984540054,p=hits/total,d=1+z*z/total,c=(p+z*z/(2*total))/d,m=z*Math.sqrt((p*(1-p)+z*z/(4*total))/total)/d;return{low:Math.max(0,c-m),high:Math.min(1,c+m)}}

function dataIntegrityGate(rows,tf,now=Date.now()){
  const src=Array.isArray(rows)?rows:[],expected=tfMs(tf),issues=[],warnings=[];let blocked=false,invalid=0,duplicates=0,nonMonotonic=0,gaps=0,intervalMismatch=0,outliers=0;
  if(src.length<60){issues.push('캔들 표본 부족');blocked=true}
  const seen=new Set(),diffs=[],absReturns=[];
  for(let i=0;i<src.length;i++){
    const x=src[i],valid=x&&[x.t,x.o,x.h,x.l,x.c,x.v].every(Number.isFinite)&&x.t>0&&x.o>0&&x.h>0&&x.l>0&&x.c>0&&x.v>=0&&x.h>=Math.max(x.o,x.c)&&x.l<=Math.min(x.o,x.c)&&x.h>=x.l;
    if(!valid)invalid++;
    if(x&&Number.isFinite(x.t)){if(seen.has(x.t))duplicates++;seen.add(x.t)}
    if(i>0&&x&&src[i-1]&&Number.isFinite(x.t)&&Number.isFinite(src[i-1].t)){
      const d=x.t-src[i-1].t;diffs.push(d);if(d<=0)nonMonotonic++;else{if(d>expected*1.8)gaps++;if(Math.abs(d-expected)>expected*.20)intervalMismatch++}
      const pr=src[i-1].c;if(Number.isFinite(pr)&&pr>0&&Number.isFinite(x.c)&&x.c>0)absReturns.push(Math.abs(x.c/pr-1))
    }
  }
  const medRet=median(absReturns),outlierThreshold=Math.max(.18,Number.isFinite(medRet)?medRet*8:.18);
  for(const r of absReturns)if(r>outlierThreshold)outliers++;
  const gapRatio=diffs.length?gaps/diffs.length:0,mismatchRatio=diffs.length?intervalMismatch/diffs.length:0;
  if(invalid){issues.push(`OHLCV 무결성 오류 ${invalid}건`);blocked=true}
  if(duplicates){issues.push(`중복 timestamp ${duplicates}건`);blocked=true}
  if(nonMonotonic){issues.push(`timestamp 역전 ${nonMonotonic}건`);blocked=true}
  if(gapRatio>.10){issues.push(`캔들 누락 비율 ${(gapRatio*100).toFixed(1)}%`);blocked=true}else if(gaps)warnings.push(`캔들 간격 공백 ${gaps}건`)
  if(mismatchRatio>.15){issues.push(`시간 간격 불일치 ${(mismatchRatio*100).toFixed(1)}%`);blocked=true}else if(mismatchRatio>.03)warnings.push(`시간 간격 불일치 ${(mismatchRatio*100).toFixed(1)}%`)
  if(outliers>=3){issues.push(`극단 가격변동 ${outliers}건`);blocked=true}else if(outliers)warnings.push(`극단 가격변동 ${outliers}건 확인 필요`)
  const last=src.at(-1),partial=!!(last&&Number.isFinite(last.t)&&expected>0&&now-last.t>=0&&now-last.t<expected*.98&&src.length>60);
  const analysisRows=partial?src.slice(0,-1):src.slice();
  if(partial)warnings.push('진행 중 마지막 봉 제외');
  if(analysisRows.length<60){issues.push('완료 봉 기준 표본 부족');blocked=true}
  let score=100-invalid*20-duplicates*20-nonMonotonic*25-Math.min(25,gaps*3)-Math.min(15,outliers*5)-Math.min(15,intervalMismatch);
  score=clamp(score,0,100);const level=blocked?'BLOCKED':warnings.length?'CAUTION':'READY';
  return{level,score,issues,warnings,rows:analysisRows,partialLast:partial,invalid,duplicates,nonMonotonic,gaps,intervalMismatch,outliers,gapRatio,mismatchRatio,expectedIntervalMs:expected};
}

function inferTfFromRows(rows){const ds=[];for(let i=1;i<(rows?.length||0);i++){const d=rows[i].t-rows[i-1].t;if(Number.isFinite(d)&&d>0)ds.push(d)}const m=median(ds);if(!Number.isFinite(m))return'240';if(m>12*60*60*1000)return'day';return Math.abs(m-60*60*1000)<=Math.abs(m-240*60*1000)?'60':'240'}

function computeSignal(rows){
  const closes=rows.map(x=>x.c),vols=rows.map(x=>x.v),e20=ema(closes,20),e50=ema(closes,50);const c=closes.at(-1),p=closes.at(-2),rv=rsi(closes,14),av=atr(rows,14),mom=(c/closes.at(-7)-1)*100;
  const volNow=mean(vols.slice(-5)),volBase=mean(vols.slice(-25));let score=50;const reasons=[];
  if(c>e20.at(-1)){score+=9;reasons.push(['+',`현재가가 EMA20 위에 있어 단기 추세가 우호적입니다.`])}else{score-=9;reasons.push(['-',`현재가가 EMA20 아래에 있어 단기 추세가 약합니다.`])}
  if(e20.at(-1)>e50.at(-1)){score+=11;reasons.push(['+',`EMA20이 EMA50 위에 있어 중기 방향이 상승 쪽입니다.`])}else{score-=11;reasons.push(['-',`EMA20이 EMA50 아래에 있어 중기 방향이 하락 쪽입니다.`])}
  if(rv>=52&&rv<=70){score+=7;reasons.push(['+',`RSI ${rv.toFixed(1)}로 상승 모멘텀이 있으나 극단적 과열은 아닙니다.`])}else if(rv>75){score-=8;reasons.push(['!',`RSI ${rv.toFixed(1)}로 과열 위험을 반영했습니다.`])}else if(rv<35){score-=5;reasons.push(['!',`RSI ${rv.toFixed(1)}로 약세가 강합니다.`])}
  score+=clamp(mom*1.2,-10,10);if(mom>1)reasons.push(['+',`최근 모멘텀 ${mom.toFixed(1)}%로 양(+)입니다.`]);else if(mom<-1)reasons.push(['-',`최근 모멘텀 ${mom.toFixed(1)}%로 음(-)입니다.`]);
  const volRatio=volBase?volNow/volBase:1;if(volRatio>1.15){score+=5;reasons.push(['+',`최근 거래량이 기준 대비 ${(volRatio*100).toFixed(0)}% 수준입니다.`])}else if(volRatio<.7){score-=4;reasons.push(['!',`거래량이 기준 대비 낮아 신호 신뢰도를 낮춥니다.`])}
  const atrPct=av/c*100;if(atrPct>6){score-=7;reasons.push(['!',`ATR ${atrPct.toFixed(1)}%로 변동성이 높습니다.`])}else if(atrPct<3)score+=2;
  score=clamp(score,0,100);
  const regime=e20.at(-1)>e50.at(-1)&&c>e20.at(-1)?'상승 추세':e20.at(-1)<e50.at(-1)&&c<e20.at(-1)?'하락 추세':'혼조/횡보';
  const decision=score>=72?'매수 우위':score>=60?'매수 관찰':score<=28?'매도 우위':score<=40?'매도 관찰':'관망';
  const change=(c/p-1)*100;
  return{score,decision,regime,price:c,change,rsi:rv,ema20:e20.at(-1),ema50:e50.at(-1),momentum:mom,atrPct,volRatio,reasons};
}


function entryQuality(rows,signal){
  if(!Array.isArray(rows)||rows.length<25||!signal||!Number.isFinite(signal.price))return{label:'WAIT',score:50,reason:'진입 품질을 계산할 데이터가 부족합니다.',metrics:{}};
  const c=signal.price,av=atr(rows,14),ema20v=signal.ema20||ema(rows.map(x=>x.c),20).at(-1),recent3=(c/rows.at(-4).c-1)*100;
  const extensionATR=av>0?(c-ema20v)/av:0,prevHigh=Math.max(...rows.slice(-21,-1).map(x=>x.h)),nearHigh=Number.isFinite(prevHigh)&&c>=prevHigh*.995;
  let risk=0;const reasons=[];
  if(signal.score<60)return{label:'WAIT',score:35,reason:'상승 방향성이 충분하지 않아 신규매수 진입 품질을 높게 평가하지 않습니다.',metrics:{recent3,extensionATR,nearHigh}};
  if(extensionATR>1.8){risk+=30;reasons.push(`EMA20 대비 ${extensionATR.toFixed(1)} ATR 위로 이격`)}else if(extensionATR>1.2){risk+=15;reasons.push(`EMA20 대비 ${extensionATR.toFixed(1)} ATR 이격`)}
  if(recent3>Math.max(3,signal.atrPct*1.5)){risk+=25;reasons.push(`최근 3봉 +${recent3.toFixed(1)}% 급등`)}else if(recent3>signal.atrPct){risk+=12;reasons.push(`최근 3봉 상승폭이 ATR보다 큼`)}
  if(signal.rsi>72){risk+=20;reasons.push(`RSI ${signal.rsi.toFixed(1)} 과열`)}else if(signal.rsi>66){risk+=10;reasons.push(`RSI ${signal.rsi.toFixed(1)} 높은 구간`)}
  if(signal.volRatio>1.8&&recent3>0){risk+=15;reasons.push(`거래량 급증 ${Math.round(signal.volRatio*100)}%`)}
  if(nearHigh&&recent3>signal.atrPct){risk+=10;reasons.push('직전 20봉 고점 부근에서 급등')}
  risk=clamp(risk,0,100);
  const label=risk>=45?'CHASE RISK':risk>=25?'WAIT':'GOOD';
  const reason=label==='GOOD'?'상승 신호 대비 가격 이격과 과열이 크지 않아 추격 위험이 낮습니다.':label==='WAIT'?'방향은 우호적이지만 이격·과열 일부가 있어 눌림이나 재확인을 기다리는 편이 낫습니다.':`방향 신호가 좋아도 현재 위치는 추격매수 위험이 큽니다.${reasons.length?' '+reasons.slice(0,2).join(' · '):''}`;
  return{label,score:100-risk,reason,metrics:{recent3,extensionATR,nearHigh,rsi:signal.rsi,volRatio:signal.volRatio}};
}
function scenarioPlanner(rows,signal,entry,validation=null){
  const c=signal.price,ema20v=signal.ema20,ema50v=signal.ema50,prevHigh=Math.max(...rows.slice(-21,-1).map(x=>x.h)),prevLow=Math.min(...rows.slice(-21,-1).map(x=>x.l)),av=atr(rows,14);
  const bullTrigger=Math.max(prevHigh,ema20v+Math.max(av*.25,0)),bearTrigger=Math.min(prevLow,ema50v-Math.max(av*.25,0));
  const current=signal.score>=60&&c>=ema20v?'BULL':signal.score<=40||c<ema50v?'BEAR':'NEUTRAL';
  const blocked=validation?.safetyLevel==='BLOCKED',chase=entry?.label==='CHASE RISK';
  return{
    current,
    currentKo:current==='BULL'?'Bull':current==='BEAR'?'Bear':'Neutral',
    bull:{trigger:bullTrigger,condition:`직전 20봉 고점 ₩${fmt(bullTrigger,0)} 이상을 종가 기준으로 확인`,action:blocked?'안전 Gate 회복 전까지 신규 진입 금지':chase?'돌파 직후 추격하지 말고 재확인/눌림 대기':'Entry Quality가 GOOD/WAIT이고 거래량이 유지되면 BUY WATCH'},
    neutral:{condition:`EMA20 ₩${fmt(ema20v,0)} ~ 직전 고점 ₩${fmt(prevHigh,0)} 사이`,action:'방향 확인 전 관망. 중간 구간에서 억지 진입하지 않음'},
    bear:{trigger:bearTrigger,condition:`EMA50 또는 직전 저점 ₩${fmt(bearTrigger,0)} 하향 이탈`,action:'신규매수 중단 · NO TRADE / Risk-off 우선'}
  };
}
function benchmarkMetrics(rows,start=60){
  if(!Array.isArray(rows)||rows.length<=start+2)return{total:NaN,mdd:NaN,sharpe:NaN,returns:[]};
  const base=rows[start].c,rets=[],eq=[1];for(let i=start;i<rows.length-1;i++){const r=rows[i+1].c/rows[i].c-1;rets.push(r);eq.push(eq.at(-1)*(1+r))}
  let peak=1,mdd=0;for(const e of eq){peak=Math.max(peak,e);mdd=Math.min(mdd,e/peak-1)}
  const m=mean(rets),sd=stdev(rets),sharpe=sd?m/sd*Math.sqrt(Math.max(1,rets.length)):0;
  const gross=rows.at(-1).c/base-1,total=(1+gross)*(1-SIM_ROUNDTRIP_COST)-1;
  return{total,mdd,sharpe,returns:rets};
}
function strategyEdge(bt){
  const bh=bt.benchmark||{},returnEdge=Number.isFinite(bh.total)?bt.total-bh.total:NaN,mddEdge=Number.isFinite(bh.mdd)?Math.abs(bh.mdd)-Math.abs(bt.mdd):NaN,sharpeEdge=Number.isFinite(bh.sharpe)?bt.sharpe-bh.sharpe:NaN;
  let label='NO CLEAR EDGE',score=0;if(bt.trades<20)label='INSUFFICIENT';else{if(Number.isFinite(returnEdge)&&returnEdge>0)score++;if(Number.isFinite(mddEdge)&&mddEdge>.03)score++;if(Number.isFinite(sharpeEdge)&&sharpeEdge>0)score++;if(score>=2&&returnEdge>0)label='POSITIVE EDGE';else if(mddEdge>.06&&returnEdge>-.10)label='DEFENSIVE EDGE'}
  return{label,score,returnEdge,mddEdge,sharpeEdge,buyHoldTotal:bh.total,buyHoldMdd:bh.mdd,buyHoldSharpe:bh.sharpe,costAssumption:SIM_ROUNDTRIP_COST};
}

function qualityAssessment(rows,integrity=null){
  let score=100;const flags=[];if(rows.length<120){score-=25;flags.push('표본 부족')}if(rows.some(x=>!Number.isFinite(x.c)||x.c<=0)){score-=50;flags.push('가격 오류')}
  let gaps=0;for(let i=1;i<rows.length;i++){if(rows[i].t<=rows[i-1].t)gaps++}if(gaps){score-=20;flags.push('시간축 이상')}
  const duplicate=new Set(rows.map(x=>x.t)).size!==rows.length;if(duplicate){score-=20;flags.push('중복 캔들')}
  if(integrity?.level==='CAUTION'){score=Math.min(score,85);flags.push(...integrity.warnings.slice(0,2))}
  if(integrity?.level==='BLOCKED'){score=Math.min(score,40);flags.push(...integrity.issues.slice(0,2))}
  return{score:clamp(score,0,100),flags,status:score>=90?'HEALTHY':score>=70?'DEGRADED':'UNHEALTHY'};
}

function scoreAt(rows,i){if(i<55)return 50;return computeSignal(rows.slice(0,i+1)).score}
function temporalStability(rows){
  const start=60,end=rows.length-1,span=end-start;if(span<45)return .5;const hitRates=[];
  for(let b=0;b<3;b++){const a=Math.floor(start+span*b/3),z=Math.floor(start+span*(b+1)/3);let hits=0,trades=0;for(let i=a;i<z&&i<rows.length-1;i++){const s=scoreAt(rows,i);if(s>=65||s<=35){const dir=s>=65?1:-1,r=(rows[i+1].c/rows[i].c-1)*dir;trades++;if(r>0)hits++}}if(trades>=3)hitRates.push(hits/trades)}
  if(hitRates.length<2)return .5;const consistency=clamp(1-stdev(hitRates)/.25,0,1),healthy=hitRates.filter(x=>x>=.45).length/hitRates.length;return clamp(.55*consistency+.45*healthy,0,1)
}
function trendRegimeKey(signal){return signal?.regime==='상승 추세'?'BULL':signal?.regime==='하락 추세'?'BEAR':'SIDEWAYS'}
function regimeEdgeAnalysis(trades){
  const out={},atrMed=median(trades.map(x=>x.atrPct));
  for(const x of trades)x.volRegime=Number.isFinite(atrMed)&&x.atrPct>=atrMed?'HIGH_VOL':'LOW_VOL';
  const defs={BULL:x=>x.regime==='BULL',BEAR:x=>x.regime==='BEAR',SIDEWAYS:x=>x.regime==='SIDEWAYS',HIGH_VOL:x=>x.volRegime==='HIGH_VOL',LOW_VOL:x=>x.volRegime==='LOW_VOL'};
  for(const [key,fn] of Object.entries(defs)){
    const xs=trades.filter(fn),avgStrategy=xs.length?mean(xs.map(x=>x.r)):NaN,avgBuyHold=xs.length?mean(xs.map(x=>x.bhReturn)):NaN,winRate=xs.length?xs.filter(x=>x.r>0).length/xs.length:NaN,edge=Number.isFinite(avgStrategy)&&Number.isFinite(avgBuyHold)?avgStrategy-avgBuyHold:NaN;
    let label='INSUFFICIENT';if(xs.length>=8){if(avgStrategy>0&&edge>.001)label='POSITIVE EDGE';else if(avgBuyHold<0&&avgStrategy>avgBuyHold+.001)label='DEFENSIVE EDGE';else label='NO CLEAR EDGE'}
    out[key]={count:xs.length,avgStrategy,avgBuyHold,winRate,edge,label};
  }
  return out;
}
function backtest(rows){
  const returns=[],tradeDetails=[];let wins=0,lossGross=0,winGross=0;const equity=[1];
  for(let i=60;i<rows.length-1;i++){
    const sig=computeSignal(rows.slice(0,i+1)),s=sig.score;if(s>=65||s<=35){const dir=s>=65?1:-1,bhReturn=rows[i+1].c/rows[i].c-1,raw=bhReturn*dir,r=raw-SIM_ROUNDTRIP_COST;returns.push(r);tradeDetails.push({i,r,raw,dir,bhReturn,regime:trendRegimeKey(sig),atrPct:sig.atrPct});if(r>0){wins++;winGross+=r}else lossGross+=-r;equity.push(equity.at(-1)*(1+r))}
  }
  const trades=returns.length,wr=trades?wins/trades:0,pf=lossGross?winGross/lossGross:(winGross?99:0),m=mean(returns),sd=stdev(returns),down=stdev(returns.filter(x=>x<0));const sharpe=sd?m/sd*Math.sqrt(Math.max(1,trades)):0;const sortino=down?m/down*Math.sqrt(Math.max(1,trades)):0;
  let peak=equity[0],mdd=0;for(const e of equity){peak=Math.max(peak,e);mdd=Math.min(mdd,e/peak-1)}const total=equity.at(-1)-1;const calmar=Math.abs(mdd)>1e-9?total/Math.abs(mdd):0;
  const split=Math.floor(rows.length*.7),oos=[];for(let i=Math.max(split,60);i<rows.length-1;i++){const s=scoreAt(rows,i);if(s>=65||s<=35){const dir=s>=65?1:-1;oos.push((((rows[i+1].c/rows[i].c-1)*dir)-SIM_ROUNDTRIP_COST)>0?1:0)}}
  const benchmark=benchmarkMetrics(rows,60),regimeEdges=regimeEdgeAnalysis(tradeDetails);
  const bt={trades,winRate:wr,pf,sharpe,sortino,mdd,total,calmar,expectancy:m,oosHit:oos.length?mean(oos):NaN,temporal:temporalStability(rows),returns,benchmark,costAssumption:SIM_ROUNDTRIP_COST,tradeDetails,regimeEdges};
  bt.edge=strategyEdge(bt);return bt;
}
function blockBootstrap95(values,iterations=400,seed=153116){
  if(values.length<5)return{low:NaN,high:NaN,mean:mean(values)};const rnd=xorshift(seed),block=Math.max(2,Math.round(Math.sqrt(values.length))),means=[];
  for(let k=0;k<iterations;k++){const s=[];while(s.length<values.length){const start=Math.floor(rnd()*Math.max(1,values.length-block));for(let j=0;j<block&&s.length<values.length;j++)s.push(values[start+j])}means.push(mean(s))}means.sort((a,b)=>a-b);return{low:means[Math.floor(iterations*.025)],high:means[Math.floor(iterations*.975)],mean:mean(values)};
}
function decisionRobustness(rows){
  const base=computeSignal(rows),weights=[-.06,-.04,-.02,0,.02,.04,.06];let same=0;const baseClass=base.score>=60?'UP':base.score<=40?'DOWN':'FLAT';
  for(const shift of weights){const copy=rows.map((x,i)=>({...x,c:x.c*(1+shift*Math.sin(i/13)/10),h:x.h*(1+shift*Math.sin(i/13)/10),l:x.l*(1+shift*Math.sin(i/13)/10)}));const s=computeSignal(copy).score,cls=s>=60?'UP':s<=40?'DOWN':'FLAT';if(cls===baseClass)same++}
  return same/weights.length;
}
function learningHorizonMs(tf){return tf==='day'?3*24*60*60*1000:Math.max(1,Number(tf)||60)*60*1000*3}
function updateForwardOutcomes(current){
  const learn=loadLearning();const now=Date.now();let changed=false;
  for(const r of learn){if(r.resolved||r.market!==current.market||r.tf!==current.tf)continue;const age=now-Date.parse(r.at);if(age>=learningHorizonMs(r.tf)){const actual=current.price/r.price-1,dir=r.score>=60?1:r.score<=40?-1:0;r.resolved=true;r.actualReturn=actual;if(dir){r.return=actual*dir;r.hit=r.return>0}else{r.excluded=true;r.return=0;r.hit=null}changed=true}}
  if(changed)saveLearning(learn);return learn;
}
function confidenceCalibration(learn){
  const r=learn.filter(x=>x.resolved&&!x.excluded&&Number.isFinite(Number(x.confidence))),defs=[['LOW',0,.64],['MEDIUM',.64,.78],['HIGH',.78,1.01]];
  const buckets={};for(const [name,a,b] of defs){const xs=r.filter(x=>Number(x.confidence)>=a&&Number(x.confidence)<b),hits=xs.filter(x=>x.hit===true).length,w=wilson95(hits,xs.length);buckets[name]={count:xs.length,hits,rate:xs.length?hits/xs.length:NaN,wilson:w}}
  const usable=defs.map(x=>x[0]).map(k=>({k,...buckets[k]})).filter(x=>x.count>=5),monotonic=usable.length<2||usable.every((x,i)=>i===0||x.rate+0.05>=usable[i-1].rate);
  let status='INSUFFICIENT',score=.5;if(r.length>=20){const h=buckets.HIGH;if(h.count>=8&&Number.isFinite(h.rate)&&h.rate<.50){status='OVERCONFIDENT';score=.35}else if(!monotonic){status='MISCALIBRATED';score=.55}else{status='CALIBRATED';score=.9}}else if(r.length>=10){status='BUILDING';score=.6}
  return{samples:r.length,status,score,monotonic,buckets};
}
function forwardStats(learn){const r=learn.filter(x=>x.resolved&&!x.excluded),hits=r.filter(x=>x.hit).length,w=wilson95(hits,r.length),avg=r.length?mean(r.map(x=>Number(x.return)||0)):NaN;const maturity=r.length>=50?'MATURE':r.length>=20?'USABLE':r.length>=8?'BUILDING':'EARLY';return{total:learn.length,resolved:r.length,hits,rate:r.length?hits/r.length:NaN,avgReturn:avg,wilson:w,maturity,calibration:confidenceCalibration(learn)}}
function statisticalRobustness(bt,boot){
  let score=0;if(bt.trades>=30)score+=20;if(bt.pf>=1.05)score+=15;if(bt.sharpe>0)score+=10;if(Number.isFinite(bt.oosHit)&&bt.oosHit>=.5)score+=20;if(Number.isFinite(boot.low)&&boot.low>-0.002)score+=20;if(Number.isFinite(bt.temporal)&&bt.temporal>=.6)score+=15;return score/100;
}
function finalValidation(rows,signal,quality,bt,learn,context={}){
  const robust=decisionRobustness(rows),boot=blockBootstrap95(bt.returns),stat=statisticalRobustness(bt,boot),fs=forwardStats(learn),sourceState=context?.sourceMeta?.state||'live',entry=entryQuality(rows,signal),edge=bt.edge||strategyEdge(bt),integrity=context?.integrity||dataIntegrityGate(rows,context?.tf||inferTfFromRows(rows)),calibration=fs.calibration||confidenceCalibration(learn);
  const currentRegime=bt.regimeEdges?.[trendRegimeKey(signal)]||null;
  let fc=quality.score;fc-=signal.atrPct>6?12:0;fc-=bt.trades<20?15:0;fc-=Number.isFinite(bt.oosHit)&&bt.oosHit<.45?12:0;fc-=Number.isFinite(bt.temporal)&&bt.temporal<.5?8:0;fc=clamp(fc,0,100);
  let forward=fs.resolved>=50?clamp(fs.wilson.low/.6,0,1):fs.resolved>=20?clamp(fs.wilson.low/.6,0,1)*.9:fs.resolved>=8?clamp((fs.rate||0)/.6,0,1)*.65:.50;
  let reliability=.36*(fc/100)+.20*forward+.22*robust+.22*stat;const high=loadSettings().conservatism==='high';
  const blockedSource=['demo','stale','snapshot','error'].includes(sourceState),cached=sourceState==='cached',degraded=quality.status==='DEGRADED',integrityBlocked=integrity.level==='BLOCKED',integrityCaution=integrity.level==='CAUTION';
  if(cached)reliability=Math.min(reliability,.62);if(degraded)reliability=Math.min(reliability,.58);if(integrityCaution)reliability=Math.min(reliability,.60);if(fs.maturity==='EARLY')reliability=Math.min(reliability,.72);if(entry.label==='CHASE RISK'&&signal.score>=60)reliability=Math.min(reliability,.68);if(edge.label==='NO CLEAR EDGE'&&bt.trades>=20)reliability=Math.min(reliability,.72);
  if(calibration.status==='OVERCONFIDENT')reliability=Math.min(reliability,.62);else if(calibration.status==='MISCALIBRATED')reliability=Math.min(reliability,.68);
  if(currentRegime?.count>=8&&currentRegime.label==='NO CLEAR EDGE')reliability=Math.min(reliability,.70);
  const hardNoTrade=blockedSource||integrityBlocked||quality.status==='UNHEALTHY'||(bt.trades>=20&&Number.isFinite(bt.oosHit)&&bt.oosHit<(high?.40:.38))||robust<(high?.62:.55)||(bt.trades>=20&&Number.isFinite(bt.temporal)&&bt.temporal<(high?.40:.34));
  let decision=signal.decision,txt='';
  if(hardNoTrade){decision='NO TRADE';txt=integrityBlocked?'입력 캔들의 무결성 기준을 통과하지 못해 분석 결과 사용을 차단했습니다.':blockedSource?'실시간 판단에 사용할 수 없는 데이터 상태입니다. 마지막 결과는 참고만 하고 새 진입 판단은 보류합니다.':'기초 신호가 있더라도 데이터 건전성 또는 강건성 기준을 통과하지 못해 거래 판단을 보류합니다.'}
  else if(entry.label==='CHASE RISK'&&signal.score>=60){decision='관망';txt='방향성은 상승 쪽이지만 현재 가격은 이격·과열 기준상 추격매수 위험이 큽니다. 눌림 또는 재확인을 기다립니다.'}
  else if(reliability<(high?.64:.58)&&(signal.score>=60||signal.score<=40)){decision='관망';txt='방향성 신호는 있으나 내부 검증 신뢰도가 충분하지 않아 보수적으로 관망합니다.'}
  else if(signal.score>=72){txt='추세·모멘텀은 매수 쪽이 우세합니다. 다만 자동매수 신호가 아니라 리스크 관리와 추가 확인을 전제로 한 보조 판단입니다.'}
  else if(signal.score<=28){txt='하락 방향 신호가 강합니다. 신규 진입보다 리스크 축소와 관망을 우선하는 구간으로 판단합니다.'}
  else if(signal.score>=60){txt='상승 우위가 관찰되지만 확정적 추세로 보기에는 여유가 부족합니다. 추격보다 확인을 우선합니다.'}
  else if(signal.score<=40){txt='약세 우위가 관찰됩니다. 반등 기대만으로 진입하기보다 하락 위험을 우선 반영합니다.'}
  else txt='상승·하락 근거가 충분히 한쪽으로 모이지 않아 관망이 합리적입니다.';
  const calibrationCaution=['OVERCONFIDENT','MISCALIBRATED'].includes(calibration.status),regimeCaution=currentRegime?.count>=8&&currentRegime.label==='NO CLEAR EDGE';
  const safetyLevel=hardNoTrade?'BLOCKED':cached||degraded||integrityCaution||fs.maturity==='EARLY'||bt.trades<20||entry.label==='CHASE RISK'||edge.label==='NO CLEAR EDGE'||calibrationCaution||regimeCaution?'CAUTION':'READY';
  const safetyReason=hardNoTrade?(integrityBlocked?'데이터 무결성 Gate가 분석 사용을 차단했습니다.':blockedSource?'실시간/신선 데이터가 아니므로 판정을 차단했습니다.':'건전성·OOS·시간 안정성 중 하나가 기준 미달입니다.'):integrityCaution?'캔들 간격·이상치 등 데이터 무결성 경고가 있어 신뢰도를 낮췄습니다.':calibration.status==='OVERCONFIDENT'?'HIGH Confidence 구간의 실제 Forward 적중이 낮아 과신 방지 상한을 적용했습니다.':calibration.status==='MISCALIBRATED'?'Confidence 밴드와 실제 Forward 결과의 순서가 안정적이지 않아 보수적으로 해석합니다.':regimeCaution?'현재 시장 Regime에서 Strategy Edge가 명확하지 않아 보수적으로 해석합니다.':entry.label==='CHASE RISK'?'방향 신호와 별개로 현재 가격 이격·과열이 커 추격매수 위험이 있습니다.':edge.label==='NO CLEAR EDGE'&&bt.trades>=20?'같은 기간 Buy & Hold 대비 명확한 전략 Edge가 확인되지 않아 보수적으로 해석합니다.':safetyLevel==='CAUTION'?'표본 또는 데이터 조건이 충분히 성숙하지 않아 보수적으로 해석합니다.':'데이터·표본·강건성·전략 Edge 기준을 통과했습니다.';
  return{decision,text:txt,reliability,finalConfidence:fc,forward,robust,stat,boot,forwardStats:fs,hardNoTrade,safetyLevel,safetyReason,sourceState,entry,edge,integrity,calibration,currentRegimeEdge:currentRegime};
}

function tfMs(tf){return tf==='day'?86400000:Math.max(1,Number(tf)||60)*60000}
function freshnessMeta(rows,tf,mode){
  const latest=rows.length?rows.at(-1).t:0,age=Math.max(0,Date.now()-latest),stale=mode!=='DEMO'&&age>tfMs(tf)*2.2;
  return{latest,age,stale,state:mode==='DEMO'?'demo':stale?'stale':mode==='CACHED'?'cached':'live'};
}
function ageText(ms){if(ms<60000)return '1분 이내';if(ms<3600000)return `${Math.max(1,Math.round(ms/60000))}분 전`;if(ms<86400000)return `${(ms/3600000).toFixed(ms<6*3600000?1:0)}시간 전`;return `${(ms/86400000).toFixed(1)}일 전`}
function renderDataState(meta,source){
  const card=$('dataStateCard'),badge=$('dataStateBadge'),fresh=$('dataFreshness');card.dataset.state=meta.state;
  badge.textContent=easyDataLabel(meta.state);
  if(meta.state==='demo')fresh.textContent='실제 시장데이터가 아닌 로컬 데모 데이터입니다. 투자 판단에 사용하지 마세요.';
  else if(meta.state==='snapshot')fresh.textContent='연결 오류로 마지막 정상 분석을 표시합니다. 신규 판단에는 사용하지 마세요.';
  else fresh.textContent=`최근 캔들 ${ageText(meta.age)} · ${source}${meta.stale?' · 오래된 데이터이므로 판단 신뢰도를 낮추세요.':''}`;
}
function confidenceBand(r){return r>=.78?'HIGH':r>=.64?'MEDIUM':'LOW'}
function buildDecisionSummary(signal,quality,v){
  const direction=signal.score>=60?`상승 우위 · ${signal.regime}`:signal.score<=40?`하락 우위 · ${signal.regime}`:`방향성 약함 · ${signal.regime}`;
  const validation=v.hardNoTrade?`안전 Gate 차단 · ${v.safetyReason}`:`내부 신뢰도 ${confidenceBand(v.reliability)} · ${v.safetyLevel==='READY'?'판정 사용 가능':'보수적 참고'}`;
  let next='추가 확인 전까지 관망';
  if(v.entry?.label==='CHASE RISK')next='추격하지 말고 가격 이격 완화 또는 눌림 확인';
  else if(v.decision.includes('매수'))next='EMA20 유지와 내부 신뢰도 HIGH 지속 여부 확인';
  else if(v.decision.includes('매도'))next='하락 추세 지속과 변동성 확대 여부 확인';
  else if(v.decision==='NO TRADE')next='데이터 건전성·강건성이 회복될 때까지 대기';
  return[['방향',direction],['검증',validation],['다음 확인',next]];
}
function renderDecisionSummary(signal,quality,v){
  $('decisionSummary').innerHTML=buildDecisionSummary(signal,quality,v).map(([k,t])=>`<div class="summaryLine"><b>${esc(k)}</b><span>${esc(t)}</span></div>`).join('');
  const band=confidenceBand(v.reliability),el=$('confidenceLabel');el.textContent=band;el.className=band==='HIGH'?'good':band==='MEDIUM'?'warn':'bad';
}
function formatTf(tf){return tf==='day'?'1D':`${Number(tf)/60}H`}
function renderSignalHistory(learn=loadLearning()){
  const list=[...learn].slice(-8).reverse();
  if(!list.length){$('signalHistory').innerHTML='<p class="muted">아직 기록된 신호가 없습니다.</p>';return}
  $('signalHistory').innerHTML=list.map(x=>{const t=new Date(x.at),when=Number.isNaN(t.getTime())?'-':`${t.getMonth()+1}/${t.getDate()} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`,name=`${x.market.replace('KRW-','')} ${formatTf(x.tf)}`;let result='<span class="warn">평가 대기</span>',sub='';if(x.resolved&&x.excluded){result='<span class="warn">평가 제외</span>';sub=Number.isFinite(x.actualReturn)?`실제 ${pct(x.actualReturn*100)}`:''}else if(x.resolved){result=`<span class="${x.hit?'good':'bad'}">${x.hit?'HIT':'MISS'} ${pct((Number(x.return)||0)*100)}</span>`;sub=Number.isFinite(x.actualReturn)?`실제 ${pct(x.actualReturn*100)}`:''}return `<div class="historyRow"><div class="historyMain"><b>${esc(name)} · ${esc(x.decision||'-')}</b><span>${esc(when)} · 점수 ${Number(x.score).toFixed(0)}</span></div><div class="historyResult">${result}<small>${esc(sub)}</small></div></div>`}).join('');
}
function friendlyError(e){const st=Number(e?.status||0),msg=String(e?.message||'');if(msg.startsWith('DATA_INTEGRITY_BLOCKED'))return '시장 데이터 무결성 검사에서 이상이 확인되어 분석을 차단했습니다.';if(st===429)return '요청이 잠시 많습니다. 잠시 후 다시 시도하세요.';if(st===502)return '시장 데이터 연결이 불안정합니다. 잠시 후 다시 시도하세요.';if(e?.name==='AbortError')return '시장 데이터 응답이 지연되고 있습니다.';return '시장 데이터를 불러오지 못했습니다. 네트워크 상태를 확인하세요.'}
function decisionGroup(d){return d.includes('매수')?'BUY':d.includes('매도')?'SELL':'WAIT'}
function loadDecisionState(){const x=safeJson(userDataStore.getItem(DECISION_STATE_KEY),{});return x&&typeof x==='object'?x:{}}
async function showDecisionNotification(title,options){
  try{if(navigator.serviceWorker?.ready){const reg=await navigator.serviceWorker.ready;if(reg?.showNotification){await reg.showNotification(title,options);return true}}}catch{}
  try{if(typeof Notification!=='undefined'&&Notification.permission==='granted'){new Notification(title,options);return true}}catch{}
  return false;
}
function maybeNotifyDecisionChange(a,meta){
  if(meta?.state!=='live')return;
  const settings=loadSettings(),key=`${a.market}:${a.tf}`,ds=loadDecisionState(),group=decisionGroup(a.validation.decision),prev=ds[key],now=Date.now();
  const next={group,decision:a.validation.decision,at:now,lastNotified:prev?.lastNotified||0};
  if(settings.decisionAlerts&&meta?.state==='live'&&a.validation.reliability>=.70&&prev&&prev.group!==group&&now-(prev.lastNotified||0)>=4*60*60*1000&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
    showDecisionNotification(`코인나침반 · ${a.market.replace('KRW-','')} ${formatTf(a.tf)}`,{body:`${prev.group} → ${group} · ${a.validation.decision} · Confidence ${Math.round(a.validation.reliability*100)}/100`,icon:'./icons/icon-192.png'});next.lastNotified=now
  }
  ds[key]=next;userDataStore.setItem(DECISION_STATE_KEY,JSON.stringify(ds));
}
async function requestNotificationPermission(){
  if(typeof Notification==='undefined'){$('notificationStatus').textContent='이 브라우저에서는 알림 API를 지원하지 않습니다.';return}
  if(Notification.permission==='granted'){$('notificationStatus').textContent='알림 권한이 허용되어 있습니다. 설정을 ON하면 최소 빈도 판정 변경 알림을 사용합니다.';return}
  if(Notification.permission==='denied'){$('notificationStatus').textContent='알림 권한이 차단되어 있습니다. Android Chrome 사이트 설정에서 변경해야 합니다.';return}
  try{const r=await Notification.requestPermission();$('notificationStatus').textContent=r==='granted'?'알림 권한을 허용했습니다. 설정을 ON해야 실제 알림이 동작합니다.':'알림 권한을 허용하지 않았습니다.'}catch{$('notificationStatus').textContent='알림 권한 요청을 완료하지 못했습니다.'}
}

function renderChart(rows){
  const c=$('priceChart'),ctx=c.getContext('2d'),dpr=Math.min(devicePixelRatio||1,2),w=Math.max(280,c.clientWidth),h=220;c.width=w*dpr;c.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
  const slice=rows.slice(-90),vals=slice.map(x=>x.c),mn=Math.min(...vals),mx=Math.max(...vals),pad=(mx-mn)*.12||1;const lo=mn-pad,hi=mx+pad;
  ctx.strokeStyle='#263649';ctx.lineWidth=1;for(let i=1;i<4;i++){const y=h*i/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  ctx.strokeStyle='#66adff';ctx.lineWidth=2;ctx.beginPath();slice.forEach((x,i)=>{const px=i/(slice.length-1)*(w-8)+4,py=h-((x.c-lo)/(hi-lo))*(h-12)-6;i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.stroke();
}
function classForDecision(d){return d.includes('매수')?'good':d.includes('매도')||d==='NO TRADE'?'bad':'warn'}


function easyEntryLabel(label){return ({'GOOD':'진입 양호','WAIT':'기다림','CHASE RISK':'추격 위험'})[label]||'확인 필요'}
function easyScenarioLabel(label){return ({'BULL':'상승 우세','NEUTRAL':'중립','BEAR':'하락 우세'})[label]||'확인 필요'}
function easyEdgeLabel(label){return ({'POSITIVE EDGE':'전략 우위 있음','DEFENSIVE EDGE':'방어력 우위','NO CLEAR EDGE':'뚜렷한 우위 없음','INSUFFICIENT':'표본 부족'})[label]||'확인 필요'}
function easyDataLabel(state){return ({live:'실시간',cached:'최근 저장값',stale:'데이터 오래됨',demo:'예시 데이터',snapshot:'마지막 저장결과',error:'확인 필요',loading:'확인 중'})[state]||'확인 필요'}
function easyDecisionWatch(d){return d&&d.includes('매수')?'매수 관심':d&&d.includes('매도')?'매도 관심':d==='NO TRADE'?'관망':'기다림'}
function easyRegimeLabel(k){return ({BULL:'상승장',BEAR:'하락장',SIDEWAYS:'횡보장',HIGH_VOL:'고변동',LOW_VOL:'저변동'})[k]||k}

function edgeClass(label){return label==='POSITIVE EDGE'?'good':label==='DEFENSIVE EDGE'?'warn':'bad'}
function entryClass(label){return label==='GOOD'?'good':label==='WAIT'?'warn':'bad'}
function scenarioClass(label){return label==='BULL'?'good':label==='BEAR'?'bad':'warn'}
function renderActionContext(rows,signal,validation,bt){
  const entry=validation.entry||entryQuality(rows,signal),scenario=scenarioPlanner(rows,signal,entry,validation),edge=bt.edge||strategyEdge(bt);
  $('entryQualityValue').textContent=easyEntryLabel(entry.label);$('entryQualityValue').className=entryClass(entry.label);
  $('scenarioValue').textContent=easyScenarioLabel(scenario.current);$('scenarioValue').className=scenarioClass(scenario.current);
  $('strategyEdgeValue').textContent=easyEdgeLabel(edge.label);$('strategyEdgeValue').className=edgeClass(edge.label);
  $('actionContextHint').textContent=validation.safetyLevel==='BLOCKED'?'안전 Gate가 차단되어 진입·시나리오는 참고용입니다.':entry.label==='CHASE RISK'?'방향이 좋아도 추격매수는 보류합니다.':'방향과 진입 위치를 분리해 판단합니다.';
  $('scenarioPlanner').innerHTML=[
    ['상승 우세 (Bull)',scenario.bull.condition,scenario.bull.action],
    ['중립 (Neutral)',scenario.neutral.condition,scenario.neutral.action],
    ['하락 우세 (Bear)',scenario.bear.condition,scenario.bear.action]
  ].map(([k,c,a])=>`<div class="scenarioRow"><b class="${scenarioClass(k.includes('Bull')?'BULL':k.includes('Bear')?'BEAR':'NEUTRAL')}">${esc(k)}</b><span>${esc(c)}</span><small>${esc(a)}</small></div>`).join('');
  $('entryDetail').textContent=`전문 분류: ${entry.label} · ${entry.reason}`;
  return{entry,scenario,edge};
}
function renderAnalysis(signal,quality,validation){
  $('priceValue').textContent=`₩${fmt(signal.price,0)}`;$('priceChange').textContent=`직전 캔들 ${pct(signal.change)}`;$('priceChange').className=signal.change>=0?'good':'bad';
  $('scoreValue').textContent=signal.score.toFixed(0);$('regimeValue').textContent=signal.regime;$('volValue').textContent=`ATR ${pct(signal.atrPct)}`;
  $('decisionValue').textContent=validation.decision;$('decisionValue').className=classForDecision(validation.decision);$('confidenceValue').textContent=`${Math.round(validation.reliability*100)}`;$('finalOpinionText').textContent=validation.text;renderDecisionSummary(signal,quality,validation);if($('decisionSafetyCard')){$('decisionSafetyCard').dataset.level=validation.safetyLevel.toLowerCase();$('decisionSafetyBadge').textContent=validation.safetyLevel==='READY'?'사용 가능':validation.safetyLevel==='CAUTION'?'주의':'사용 금지';$('decisionSafetyText').textContent=validation.safetyReason}
  $('axisFinalConfidence').textContent=`${Math.round(validation.finalConfidence)} / 100`;$('axisForwardLearning').textContent=validation.forwardStats.resolved?`${Math.round(validation.forward*100)} / 100`:'중립(표본 부족)';$('axisDecisionRobustness').textContent=`${Math.round(validation.robust*100)} / 100`;$('axisStatRobustness').textContent=`${Math.round(validation.stat*100)} / 100`;
  $('reasonList').innerHTML=signal.reasons.slice(0,6).map(([i,t])=>`<div class="reasonItem"><i>${esc(i)}</i><span>${esc(t)}</span></div>`).join('');
  $('rsiValue').textContent=fmt(signal.rsi,1);$('emaState').textContent=signal.ema20>signal.ema50?'20 > 50':'20 ≤ 50';$('momentumValue').textContent=pct(signal.momentum);$('atrValue').textContent=pct(signal.atrPct);$('volumeState').textContent=`${Math.round(signal.volRatio*100)}%`;const ig=validation.integrity||{level:'CAUTION',score:0};$('qualityValue').textContent=`${ig.level} · ${Math.round(ig.score)}`;$('qualityValue').className=ig.level==='READY'?'good':ig.level==='BLOCKED'?'bad':'warn';
  $('chartCaption').textContent=`최근 ${Math.min(90,state.candles.length)}개 캔들`;
  renderChart(state.candles);renderForward(validation.forwardStats);
}
function renderRegimeEdges(edges){
  const host=$('regimeEdgeList');if(!host)return;const labels={BULL:'상승장',BEAR:'하락장',SIDEWAYS:'횡보장',HIGH_VOL:'고변동',LOW_VOL:'저변동'};
  host.innerHTML=Object.entries(labels).map(([k,n])=>{const x=edges?.[k]||{count:0,label:'INSUFFICIENT',edge:NaN};return `<div class="regimeEdgeRow"><b>${esc(n)}</b><span>${esc(easyEdgeLabel(x.label))}</span><small>표본 ${x.count}${Number.isFinite(x.edge)?` · 우위 ${pct(x.edge*100,2)}`:''}</small></div>`}).join('');
}
function renderCalibration(cal){
  if($('flCalibration')){$('flCalibration').textContent={CALIBRATED:'안정',BUILDING:'축적중',OVERCONFIDENT:'과신 주의',MISCALIBRATED:'재보정 필요',INSUFFICIENT:'표본 부족'}[cal?.status]||'-';$('flCalibration').className=cal?.status==='CALIBRATED'?'good':['OVERCONFIDENT','MISCALIBRATED'].includes(cal?.status)?'bad':'warn'}
  if($('flCalibrationSample'))$('flCalibrationSample').textContent=String(cal?.samples||0);
  if($('calibrationBands')){const names=['LOW','MEDIUM','HIGH'],ko={LOW:'낮음',MEDIUM:'보통',HIGH:'높음'};$('calibrationBands').innerHTML=names.map(k=>{const x=cal?.buckets?.[k]||{count:0,rate:NaN};return `<div class="calibrationRow"><b>${ko[k]} <small>(${k})</small></b><span>${x.count?`${pct(x.rate*100)} · 표본 ${x.count}`:'표본 부족'}</span></div>`}).join('')}
}
function renderResearch(bt,validation){
  $('btTrades').textContent=bt.trades;$('btWinRate').textContent=pct(bt.winRate*100);$('btPF').textContent=fmt(bt.pf,2);$('btSharpe').textContent=fmt(bt.sharpe,2);$('btSortino').textContent=fmt(bt.sortino,2);$('btMDD').textContent=pct(bt.mdd*100);$('btCalmar').textContent=fmt(bt.calmar,2);$('btExpectancy').textContent=pct(bt.expectancy*100,2);$('btOOS').textContent=Number.isFinite(bt.oosHit)?pct(bt.oosHit*100):'-';$('btTemporal').textContent=Number.isFinite(bt.temporal)?pct(bt.temporal*100):'-';$('btBootstrap').textContent=Number.isFinite(validation.boot.low)?`${pct(validation.boot.low*100,2)} ~ ${pct(validation.boot.high*100,2)}`:'-';
  const e=bt.edge||strategyEdge(bt);$('btCost').textContent=`${pct((bt.costAssumption||SIM_ROUNDTRIP_COST)*100,2)} / 왕복`;$('btBuyHold').textContent=Number.isFinite(e.buyHoldTotal)?pct(e.buyHoldTotal*100,1):'-';$('btReturnEdge').textContent=Number.isFinite(e.returnEdge)?pct(e.returnEdge*100,1):'-';$('btMddEdge').textContent=Number.isFinite(e.mddEdge)?`${e.mddEdge>=0?'+':''}${pct(e.mddEdge*100,1)}p`:'-';$('btRiskEdge').textContent=Number.isFinite(e.sharpeEdge)?`${e.sharpeEdge>=0?'+':''}${fmt(e.sharpeEdge,2)}`:'-';$('btEdgeOverall').textContent=easyEdgeLabel(e.label);$('btEdgeOverall').className=edgeClass(e.label);
  renderRegimeEdges(bt.regimeEdges);renderCalibration(validation.calibration||validation.forwardStats?.calibration);
}
function renderForward(fs){if($('homeForwardText'))$('homeForwardText').textContent=`${({EARLY:'초기 표본',BUILDING:'표본 축적중',USABLE:'사용 가능',MATURE:'표본 충분'}[fs.maturity]||'표본 확인')} · 기록 ${fs.total}`;if($('statusForward'))$('statusForward').textContent=({EARLY:'초기 표본',BUILDING:'축적중',USABLE:'사용 가능',MATURE:'충분'}[fs.maturity]||'확인');$('flTotal').textContent=fs.total;$('flResolved').textContent=fs.resolved;$('flHitRate').textContent=fs.resolved?pct(fs.rate*100):'-';$('flAvgReturn').textContent=fs.resolved?pct(fs.avgReturn*100,2):'-';$('flAvgReturn').className=fs.resolved?(fs.avgReturn>=0?'good':'bad'):'';$('flWilson').textContent=fs.resolved?pct(fs.wilson.low*100):'-';if($('flMaturity'))$('flMaturity').textContent={EARLY:'초기',BUILDING:'축적중',USABLE:'사용 가능',MATURE:'충분'}[fs.maturity]||'-';renderCalibration(fs.calibration||confidenceCalibration(loadLearning()));renderSignalHistory()}

function renderReadiness(){
  if(!$('readinessOverall'))return;const fs=forwardStats(loadLearning()),meta=loadBackupMeta(),summary=state.summary||[],offline=typeof navigator!=='undefined'&&navigator.onLine===false;
  let data='확인 전',dataLevel='caution';if(offline){data='오프라인';dataLevel='blocked'}else if(summary.length){const states=summary.map(x=>x.meta?.state||'error');if(states.every(x=>x==='live')){data='정상';dataLevel='ready'}else if(states.some(x=>['demo','stale','error','snapshot'].includes(x))){data='확인 필요';dataLevel='blocked'}else{data='캐시 사용';dataLevel='caution'}}
  const cal=fs.calibration||confidenceCalibration(loadLearning()),calWarn=['OVERCONFIDENT','MISCALIBRATED'].includes(cal.status),maturity=calWarn?'보정 주의':({EARLY:'초기 표본',BUILDING:'축적중',USABLE:'사용 가능',MATURE:'충분'}[fs.maturity]||'초기 표본'),due=backupDue();
  $('readinessData').textContent=data;$('readinessLearning').textContent=maturity;$('readinessBackup').textContent=due?'백업 권장':(loadLearning().length?'정상':'아직 불필요');
  const overall=dataLevel==='blocked'?'확인 필요':due||dataLevel==='caution'||calWarn?'주의':'정상';$('readinessOverall').textContent=overall;$('readinessOverall').className=`srOnly ${overall==='정상'?'good':overall==='주의'?'warn':'bad'}`;
  $('readinessHint').textContent=dataLevel==='blocked'?'시장 데이터 상태를 먼저 확인하세요. 안전 기준이 강한 판정을 자동 차단합니다.':calWarn?'판단 신뢰도 구간과 실제 결과가 안정적으로 정렬되지 않아 보수적 상한을 적용합니다.':due?'실전 결과 학습 기록이 쌓였습니다. 설정에서 백업 JSON을 한 번 저장하세요.':dataLevel==='caution'?'캐시 데이터 사용 상태입니다. 필요하면 설정에서 앱 상태 검사를 실행하세요.':fs.maturity==='EARLY'?'분석은 가능하지만 Forward Learning 표본은 아직 초기 단계입니다.':'현재 사용에 필요한 기본 조건이 충족되어 있습니다.';
  const alert=$('homeAlertBanner'),alertTitle=$('homeAlertTitle'),alertText=$('homeAlertText'),dot=$('settingsAlertDot'),show=overall!=='정상';
  if(alert){alert.hidden=!show;if(show){if(dataLevel==='blocked'){alert.dataset.level='bad';alertTitle.textContent='시장 데이터 확인 필요';alertText.textContent='신규 판단이 제한될 수 있습니다. 설정에서 앱 상태를 확인하세요.'}else if(calWarn){alert.dataset.level='warn';alertTitle.textContent='Confidence 보정 주의';alertText.textContent='Forward 결과와 Confidence 정렬 상태를 설정에서 확인하세요.'}else if(due){alert.dataset.level='warn';alertTitle.textContent='백업 권장';alertText.textContent='실전 결과 학습 기록 보호를 위해 설정에서 백업하세요.'}else{alert.dataset.level='warn';alertTitle.textContent='앱 상태 확인 권장';alertText.textContent='캐시 또는 상태 경고가 있습니다. 설정에서 확인하세요.'}}}
  if(dot)dot.hidden=!show;
}
function renderQuickState(){
  const p=loadUiProfile();if($('lastMarketText'))$('lastMarketText').textContent=p.lastMarket.replace('KRW-','');if($('lastTfText'))$('lastTfText').textContent=formatTf(p.lastTf);if($('favoriteCountText'))$('favoriteCountText').textContent=String(p.favorites.length);if($('summaryTimeframe'))$('summaryTimeframe').textContent=`기준 ${formatTf(p.lastTf)}`
}
function renderFavoriteControls(){
  const p=loadUiProfile();document.querySelectorAll('#favoriteGrid input[type="checkbox"]').forEach(x=>x.checked=p.favorites.includes(x.value));if($('fontScaleSelect'))$('fontScaleSelect').value=p.fontScale
}
function applyUiProfile(){
  const p=loadUiProfile();if($('marketSelect'))$('marketSelect').value=[...$('marketSelect').options].some(o=>o.value===p.lastMarket)?p.lastMarket:'KRW-BTC';if($('tfSelect'))$('tfSelect').value=p.lastTf;applyFontScale();renderFavoriteControls();renderQuickState();renderUpdateStatus();renderBackupMeta();renderReadiness()
}
function setTab(tab,persist=true){
  const allowed=['home','analysis','research','settings'];if(!allowed.includes(tab))tab='home';
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('active',p.id===`pane-${tab}`));
  if(persist)saveUiProfile({lastTab:tab})
}
function homeDecisionDisplay(d){return d==='NO TRADE'?'관망':d||'-'}
function homeDecisionEnglish(d){return easyDecisionWatch(d)}
function shortHomeLines(x){
  if(x?.error)return ['시장 데이터 확인 필요','안전 Gate가 신규 판단을 차단합니다.','네트워크 또는 데이터 상태를 먼저 확인하세요.'];
  const v=x.validation||{},entry=x.entry||v.entry||{label:'WAIT'},meta=x.meta||{},s=x.signal||{};
  const a=entry.label==='CHASE RISK'?'추격 금지, 눌림 확인 우선':entry.label==='GOOD'?'진입 위치 양호, 조건 확인 후 대응':'진입 서두르지 말고 조건 확인';
  const b=meta.state==='live'?`데이터 정상, ${v.decision||'관망'} 유지`:`${easyDataLabel(meta.state||'error')} 상태, 보수적으로 참고`;
  const c=Number(s.atrPct)>=2.5?'변동성 높아 신규 진입 불리':v.safetyLevel==='READY'?'안전 Gate 통과, 계획된 대응만':'조건 충족 전 신규 진입 보류';
  return [a,b,c];
}
function renderHomeSummary(list){
  const host=$('summaryList');if(!host)return;
  if(!list.length){host.innerHTML='<p class="muted">표시할 즐겨찾기 결과가 없습니다.</p>';return}
  const p=loadUiProfile(),primary=list.find(x=>x.market===p.lastMarket&&!x.error)||list.find(x=>!x.error)||list[0];
  if(primary&&!primary.error){
    const v=primary.validation||{},sig=primary.signal||{},entry=primary.entry||v.entry||{label:'WAIT'},scenario=primary.scenario||{current:'NEUTRAL'},edge=v.edge||{label:'INSUFFICIENT'},meta=primary.meta||{state:'error'};
    if($('homeMarket'))$('homeMarket').textContent=`${primary.market.replace('KRW-','')} / KRW`;
    if($('homeTf'))$('homeTf').textContent=formatTf(primary.tf);
    if($('homePrice'))$('homePrice').textContent=Number.isFinite(sig.price)?`₩${fmt(sig.price,0)}`:'-';
    if($('homeChange')){$('homeChange').textContent=Number.isFinite(sig.change)?`직전 봉 ${pct(sig.change)}`:'-';$('homeChange').className=sig.change>=0?'good':'bad'}
    if($('homeDecision')){$('homeDecision').textContent=homeDecisionDisplay(v.decision||'');$('homeDecision').className=classForDecision(v.decision||'')}
    if($('homeDecisionEn'))$('homeDecisionEn').textContent=homeDecisionEnglish(v.decision||'');
    if($('homeConfidence'))$('homeConfidence').textContent=`${Math.round((v.reliability||0)*100)} / 100`;
    if($('homeDataState')){$('homeDataState').textContent=easyDataLabel(meta.state||'error');$('homeDataState').dataset.state=meta.state||'error'}
    if($('homeEntry')){$('homeEntry').textContent=easyEntryLabel(entry.label);$('homeEntry').className=entryClass(entry.label)}
    if($('homeScenario')){$('homeScenario').textContent=easyScenarioLabel(scenario.current);$('homeScenario').className=scenarioClass(scenario.current)}
    if($('homeEdge')){$('homeEdge').textContent=easyEdgeLabel(edge.label);$('homeEdge').className=edgeClass(edge.label)}
    const homeLines=shortHomeLines(primary);
    if($('homeHeadline'))$('homeHeadline').textContent=homeLines[0]||'조건을 확인하세요.';
    if($('homeDeck'))$('homeDeck').textContent=homeLines[1]||'데이터와 안전 Gate를 확인합니다.';
    if($('homeSummaryLines'))$('homeSummaryLines').innerHTML=homeLines.map((t,i)=>`<div><i>${i+1}</i><span>${esc(t)}</span></div>`).join('');
  }
  host.innerHTML=list.slice(0,3).map(x=>{
    if(x.error)return `<button class="summaryCard favoriteCoinCard" data-market="${esc(x.market)}"><div class="coinHead"><b>${esc(x.market.replace('KRW-',''))}</b><span class="bad">확인 필요</span></div><small>${esc(friendlyError(x.error))}</small></button>`;
    const sig=x.signal||{},meta=x.meta||{state:'error'},decision=x.validation?.decision||'-';
    return `<button class="summaryCard favoriteCoinCard" data-market="${esc(x.market)}"><div class="coinHead"><b>${esc(x.market.replace('KRW-',''))}</b><span class="summaryState ${esc(meta.state)}">${esc(easyDataLabel(meta.state||'error'))}</span></div><strong>${Number.isFinite(sig.price)?`₩${fmt(sig.price,0)}`:'-'}</strong><small class="${sig.change>=0?'good':'bad'}">${Number.isFinite(sig.change)?pct(sig.change):'-'}</small><em class="${classForDecision(decision)}">${esc(homeDecisionEnglish(decision))}</em></button>`
  }).join('')
}
async function refreshHomeSummary(){
  if(state.summaryLoading)return;state.summaryLoading=true;const btn=$('summaryRefreshBtn');if(btn)btn.disabled=true;
  const p=loadUiProfile(),tf=p.lastTf,favorites=p.favorites.slice(0,5),settings=loadSettings(),out=[];if($('summaryList'))$('summaryList').innerHTML='<p class="muted">즐겨찾기 요약을 계산하고 있습니다.</p>';
  for(const market of favorites){
    try{
      let rows,source,mode,fetchedAt,sig,quality,bt,validation,meta;
      const canReuseCurrent=state.analysis&&state.analysis.market===market&&state.analysis.tf===tf&&state.candles.length>=60&&state.sourceMeta?.state==='live'&&Date.now()-(state.sourceMeta?.fetchedAt||0)<=30000;
      if(canReuseCurrent){
        rows=state.candles;sig=state.analysis;quality=state.analysis.quality;validation=state.analysis.validation;meta=state.sourceMeta||freshnessMeta(rows,tf,'LIVE')
      }else{
        const got=await getCandles(market,tf,Math.min(settings.count,160)),integrity=dataIntegrityGate(got.rows,tf);if(integrity.level==='BLOCKED')throw new Error(`DATA_INTEGRITY_BLOCKED:${integrity.issues.join('|')}`);rows=integrity.rows;source=got.source;mode=got.mode||'LIVE';fetchedAt=got.fetchedAt;if(rows.length<60)throw new Error('분석에 필요한 완료 캔들이 부족합니다.');sig=computeSignal(rows);quality=qualityAssessment(rows,integrity);bt=backtest(rows);meta={...freshnessMeta(rows,tf,mode),fetchedAt};validation=finalValidation(rows,sig,quality,bt,loadLearning(),{sourceMeta:meta,integrity,tf})
      }
      const entry=validation.entry||entryQuality(rows,sig),scenario=scenarioPlanner(rows,sig,entry,validation);out.push({market,tf,signal:sig,quality,validation,meta,entry,scenario})
    }catch(error){out.push({market,tf,error})}
  }
  state.summary=out;renderHomeSummary(out);renderQuickState();renderReadiness();if($('summaryUpdated'))$('summaryUpdated').textContent=`요약 갱신 ${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`;state.summaryLoading=false;if(btn)btn.disabled=false;return out
}
function saveUiPreferences(){
  const favorites=[...document.querySelectorAll('#favoriteGrid input:checked')].map(x=>x.value);if(!favorites.length){$('backupStatus').textContent='즐겨찾기는 최소 1개를 선택해야 합니다.';$('backupStatus').className='hint bad';return false}
  const p=saveUiProfile({favorites,fontScale:$('fontScaleSelect').value});applyFontScale();renderQuickState();$('backupStatus').className='hint';$('backupStatus').textContent='즐겨찾기와 표시 설정을 저장했습니다.';refreshHomeSummary();return p
}
function showOnboardingIfNeeded(){const p=loadUiProfile(),o=$('onboardingOverlay');if(o)o.hidden=!!p.onboardingDone;return !p.onboardingDone}
async function completeOnboarding(){
  const fav=[...document.querySelectorAll('.onboardingFavorites input:checked')].map(x=>x.value);if(!fav.length)return false;const tf=$('onboardingTfSelect').value;
  saveUiProfile({onboardingDone:true,favorites:fav,lastMarket:fav[0],lastTf:tf,lastTab:'home',fontScale:'normal',lastSeenVersion:APP_VERSION,firstRunAt:nowIso(),updatedFrom:null});saveSettings({...loadSettings(),decisionAlerts:false});applyUiProfile();if($('onboardingOverlay'))$('onboardingOverlay').hidden=true;setTab('home');await refresh();await refreshHomeSummary();return true
}

function renderUnavailableAnalysis(market,tf,error){
  state.candles=[];state.analysis=null;state.research=null;state.source='ERROR';
  const msg=friendlyError(error),set=(id,text,cls='')=>{const e=$(id);if(!e)return;e.textContent=text;if(cls!==null)e.className=cls};
  set('priceValue','-');set('priceChange','-','');set('scoreValue','-');set('regimeValue','-');set('volValue','-');
  set('decisionValue','NO TRADE','bad');set('confidenceValue','0');
  set('finalOpinionText',`선택한 ${market.replace('KRW-','')} · ${formatTf(tf)} 데이터를 가져오지 못했습니다. 이전 다른 코인·시간대 결과는 표시하지 않습니다.`);
  if($('decisionSummary'))$('decisionSummary').innerHTML=`<div class="summaryLine"><b>상태</b><span>${esc(msg)}</span></div><div class="summaryLine"><b>조치</b><span>데이터가 정상화될 때까지 관망</span></div>`;
  set('confidenceLabel','LOW','bad');
  if($('decisionSafetyCard'))$('decisionSafetyCard').dataset.level='blocked';set('decisionSafetyBadge','사용 금지','bad');set('decisionSafetyText','선택한 코인·시간대의 유효한 데이터가 없어 신규 판단을 차단했습니다.');
  set('entryQualityValue','확인 필요','bad');set('scenarioValue','확인 필요','bad');set('strategyEdgeValue','확인 필요','bad');
  set('actionContextHint','유효한 시장 데이터를 다시 불러온 뒤 확인하세요.');set('entryDetail','현재 분석 데이터 없음');
  if($('scenarioPlanner'))$('scenarioPlanner').innerHTML='<p class="muted">시장 데이터 복구 후 시나리오를 계산합니다.</p>';
  if($('reasonList'))$('reasonList').innerHTML='<div class="reasonItem"><i>!</i><span>다른 코인·시간대의 이전 분석 결과를 재사용하지 않았습니다.</span></div>';
  for(const id of ['axisFinalConfidence','axisForwardLearning','axisDecisionRobustness','axisStatRobustness','rsiValue','emaState','momentumValue','atrValue','volumeState'])set(id,'-');
  set('qualityValue','BLOCKED · 0','bad');set('chartCaption','표시할 최신 데이터 없음');
  const canvas=$('priceChart');if(canvas){const ctx=canvas.getContext('2d');if(ctx)ctx.clearRect(0,0,canvas.width,canvas.height)}
  for(const id of ['btTrades','btWinRate','btPF','btSharpe','btSortino','btMDD','btCalmar','btExpectancy','btOOS','btTemporal','btBootstrap','btBuyHold','btReturnEdge','btMddEdge','btRiskEdge'])set(id,'-');
  set('btEdgeOverall','확인 필요','bad');if($('regimeEdgeList'))$('regimeEdgeList').innerHTML='<p class="muted">현재 분석 데이터 없음</p>';
}

async function refresh(){
  if(state.loading)return;state.loading=true;$('refreshBtn').disabled=true;$('healthText').textContent='분석 중';$('healthDot').className='';
  const market=$('marketSelect').value,tf=$('tfSelect').value,settings=loadSettings();saveUiProfile({lastMarket:market,lastTf:tf,lastSeenVersion:APP_VERSION});renderQuickState();
  try{
    const got=await getCandles(market,tf,settings.count),source=got.source,mode=got.mode||'LIVE',fetchedAt=got.fetchedAt||Date.now(),integrity=dataIntegrityGate(got.rows,tf);if(integrity.level==='BLOCKED'){const err=new Error(`DATA_INTEGRITY_BLOCKED:${integrity.issues.join('|')}`);err.integrity=integrity;throw err}const rows=integrity.rows;if(rows.length<60)throw new Error('분석에 필요한 완료 캔들이 부족합니다.');state.candles=rows;state.source=source;const sourceMeta={...freshnessMeta(rows,tf,mode),fetchedAt};state.sourceMeta=sourceMeta;
    const sig=computeSignal(rows),quality=qualityAssessment(rows,integrity),bt=backtest(rows);let learn=updateForwardOutcomes({market,tf,price:sig.price});const validation=finalValidation(rows,sig,quality,bt,learn,{sourceMeta,integrity,tf});state.analysis={...sig,quality,validation,market,tf};state.research=bt;saveSafeSnapshot(market,tf,rows,sourceMeta,state.analysis,bt);
    renderAnalysis(sig,quality,validation);renderResearch(bt,validation);renderActionContext(rows,sig,validation,bt);renderDataState(sourceMeta,source);$('dataSource').textContent=`데이터: ${source}`;$('lastUpdated').textContent=`화면 갱신 ${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`;$('healthText').textContent=sourceMeta.state==='demo'?'DEMO':sourceMeta.stale?'STALE':'정상';$('healthDot').className=sourceMeta.state==='live'?'ok':sourceMeta.state==='demo'||sourceMeta.stale?'bad':'';maybeNotifyDecisionChange(state.analysis,sourceMeta);runHealthCheck();
  }catch(e){const snap=getSafeSnapshot(market,tf);if(snap){state.candles=snap.rows;const q=snap.analysis.quality,bt=backtest(snap.rows),sig={...snap.analysis};delete sig.validation;delete sig.quality;const sourceMeta={...freshnessMeta(snap.rows,tf,'LIVE'),state:'snapshot',fetchedAt:snap.savedAt};const integrity=dataIntegrityGate(snap.rows,tf),validation=finalValidation(integrity.rows,sig,q,bt,loadLearning(),{sourceMeta,integrity,tf});state.analysis={...sig,quality:q,validation,market,tf};state.research=bt;state.sourceMeta=sourceMeta;renderAnalysis(sig,q,validation);renderResearch(bt,validation);renderActionContext(snap.rows,sig,validation,bt);renderDataState(sourceMeta,'LAST SAFE SNAPSHOT');$('dataSource').textContent='데이터: 마지막 정상 분석';$('lastUpdated').textContent=`저장 시각 ${new Date(snap.savedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`;$('healthText').textContent='참고만';$('healthDot').className='bad'}else{const priorAnalysis=state.analysis,priorCandles=state.candles,priorResearch=state.research;const sameContext=!!(priorAnalysis&&priorAnalysis.market===market&&priorAnalysis.tf===tf&&priorCandles.length>=60);const sourceMeta={state:'error',stale:true,fetchedAt:Date.now(),latest:sameContext?(priorCandles.at(-1)?.t||0):0,age:Infinity};state.sourceMeta=sourceMeta;if(sameContext){const sig={...priorAnalysis};delete sig.validation;delete sig.quality;const integrity=dataIntegrityGate(priorCandles,tf),q=priorAnalysis.quality||qualityAssessment(priorCandles,integrity),bt=priorResearch&&Array.isArray(priorResearch.returns)?priorResearch:backtest(priorCandles),validation=finalValidation(priorCandles,sig,q,bt,loadLearning(),{sourceMeta,integrity,tf});state.analysis={...sig,quality:q,validation,market,tf};state.research=bt;renderAnalysis(sig,q,validation);renderResearch(bt,validation);renderActionContext(priorCandles,sig,validation,bt)}else renderUnavailableAnalysis(market,tf,e);$('healthText').textContent='연결 오류';$('healthDot').className='bad';$('dataSource').textContent='데이터: 연결 실패';$('dataStateCard').dataset.state='error';$('dataStateBadge').textContent='확인 필요';$('dataFreshness').textContent=friendlyError(e)}renderReadiness();console.error(e)}finally{state.loading=false;$('refreshBtn').disabled=false}
}

async function scanMarkets(){
  const btn=$('scannerBtn');btn.disabled=true;$('scannerList').innerHTML='<p class="muted">스캔 중...</p>';const tf=$('tfSelect').value,settings=loadSettings(),markets=['KRW-BTC','KRW-ETH','KRW-XRP','KRW-SOL','KRW-DOGE'];const out=[];
  for(const m of markets){try{const got=await getCandles(m,tf,Math.min(settings.count,160)),integrity=dataIntegrityGate(got.rows,tf);if(integrity.level==='BLOCKED')throw new Error(`DATA_INTEGRITY_BLOCKED:${integrity.issues.join('|')}`);const rows=integrity.rows,meta={...freshnessMeta(rows,tf,got.mode||'LIVE'),fetchedAt:got.fetchedAt};const s=computeSignal(rows),q=qualityAssessment(rows,integrity),bt=backtest(rows),v=finalValidation(rows,s,q,bt,loadLearning(),{sourceMeta:meta,integrity,tf});out.push({market:m,score:s.score,decision:v.decision,reliability:v.reliability,entry:v.entry?.label||'WAIT'})}catch(e){out.push({market:m,error:e.message})}}
  out.sort((a,b)=>(b.score??-1)-(a.score??-1));state.scanner=out;$('scannerList').innerHTML=out.map(x=>x.error?`<div class="scanRow"><b>${esc(x.market.replace('KRW-',''))}</b><b>-</b><span class="bad">오류</span></div>`:`<div class="scanRow"><b>${esc(x.market.replace('KRW-',''))}</b><b>${x.score.toFixed(0)}</b><span class="${classForDecision(x.decision)}">${esc(x.decision)} · ${esc(x.entry)}</span></div>`).join('');btn.disabled=false;
}
function recordSignal(){if(!state.analysis)return;const a=state.analysis;if(a.validation?.safetyLevel==='BLOCKED')return alert('현재 데이터 상태에서는 Forward Learning 신호를 기록하지 않습니다. LIVE/정상 상태에서 다시 시도하세요.');const learn=loadLearning();const last=[...learn].reverse().find(x=>x.market===a.market&&x.tf===a.tf);if(last&&Date.now()-Date.parse(last.at)<30*60*1000)return alert('같은 마켓·시간대 신호는 30분 이내 중복 기록하지 않습니다.');learn.push({at:nowIso(),market:a.market,tf:a.tf,price:a.price,score:a.score,decision:a.validation.decision,confidence:a.validation.reliability,confidenceBand:confidenceBand(a.validation.reliability),regime:a.regime,entry:a.validation.entry?.label||'WAIT',sourceState:a.validation.sourceState,resolved:false});saveLearning(learn);renderForward(forwardStats(learn));$('backupStatus').textContent='현재 신호를 로컬 Forward Learning 기록에 저장했습니다.'}

function makeBackup(){const payload={format:'crypto-analyzer-local',schemaVersion:2,version:APP_VERSION,exportedAt:nowIso(),settings:loadSettings(),uiProfile:loadUiProfile(),forwardLearning:loadLearning()};const raw=JSON.stringify(payload);let h=2166136261;for(let i=0;i<raw.length;i++){h^=raw.charCodeAt(i);h=Math.imul(h,16777619)}const wrapper={...payload,integrity:{algo:'fnv1a32',hash:(h>>>0).toString(16).padStart(8,'0')}};return wrapper}
function downloadBackup(){const b=makeBackup(),blob=new Blob([JSON.stringify(b,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`coin-nachimpan-v15.31.29-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();saveBackupMeta({lastExportAt:b.exportedAt});renderBackupMeta();$('backupStatus').className='hint';$('backupStatus').textContent='백업 JSON을 생성했습니다. 파일을 안전한 위치에 보관하세요.';setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function verifyBackup(obj){if(!obj||obj.format!=='crypto-analyzer-local'||![1,2].includes(obj.schemaVersion)||!obj.integrity)return false;const base={...obj};delete base.integrity;const raw=JSON.stringify(base);let h=2166136261;for(let i=0;i<raw.length;i++){h^=raw.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')===obj.integrity.hash}
async function importBackup(file){const txt=await file.text(),obj=safeJson(txt,null);if(!verifyBackup(obj))throw new Error('백업 형식 또는 체크섬이 올바르지 않습니다.');if(obj.settings&&typeof obj.settings==='object')saveSettings({...loadSettings(),...obj.settings});if(obj.uiProfile&&typeof obj.uiProfile==='object')saveUiProfile({...obj.uiProfile,onboardingDone:true,lastSeenVersion:APP_VERSION});if(Array.isArray(obj.forwardLearning))saveLearning(obj.forwardLearning);saveBackupMeta({lastImportAt:nowIso()});applySettingsToUI();applyUiProfile();renderForward(forwardStats(loadLearning()));renderBackupMeta();$('backupStatus').className='hint';$('backupStatus').textContent='백업을 안전하게 복원했습니다.'}

function selfTest(){
  const checks=[];const ok=(name,cond,detail='')=>checks.push({name,ok:!!cond,detail});
  try{ok('APP_VERSION',APP_VERSION==='15.31.29');ok('stable storage namespace',STORAGE_NS==='crypto_analyzer_mobile');ok('safeJson invalid',safeJson('{x',123)===123);ok('escape XSS',esc('<img>')==='&lt;img&gt;');const d=demoCandles('KRW-BTC','240',200);ok('demo candle count',d.length===200);ok('demo monotonic time',d.every((x,i)=>i===0||x.t>d[i-1].t));const apiNorm=normalizeCandleRows([{t:d[0].t,o:d[0].o,h:d[0].h,l:d[0].l,c:d[0].c,v:d[0].v}]);ok('API transformed candle normalization',apiNorm.length===1&&apiNorm[0].t===d[0].t);const q=qualityAssessment(d);ok('data quality',q.status==='HEALTHY',q.status);const ig=dataIntegrityGate(d,'240');ok('data integrity ready',ig.level==='READY'&&ig.rows.length===d.length,`${ig.level}/${ig.rows.length}`);const badD=d.slice();badD[80]={...badD[80],t:badD[79].t};const badIg=dataIntegrityGate(badD,'240');ok('data integrity duplicate blocks',badIg.level==='BLOCKED');const s=computeSignal(d);ok('signal finite',Number.isFinite(s.score)&&s.score>=0&&s.score<=100,String(s.score));ok('RSI finite',Number.isFinite(s.rsi));ok('ATR finite',Number.isFinite(s.atrPct));const bt=backtest(d);ok('backtest executes',Number.isFinite(bt.pf)&&Number.isFinite(bt.sharpe),`trades=${bt.trades}`);ok('conservative trade cost applied',bt.costAssumption===SIM_ROUNDTRIP_COST,String(bt.costAssumption));ok('buy hold benchmark finite',Number.isFinite(bt.benchmark.total)&&Number.isFinite(bt.benchmark.mdd));ok('strategy edge object',bt.edge&&['POSITIVE EDGE','DEFENSIVE EDGE','NO CLEAR EDGE','INSUFFICIENT'].includes(bt.edge.label));ok('regime edge object',bt.regimeEdges&&['BULL','BEAR','SIDEWAYS','HIGH_VOL','LOW_VOL'].every(k=>bt.regimeEdges[k]));const eq=entryQuality(d,s);ok('entry quality finite',eq&&['GOOD','WAIT','CHASE RISK'].includes(eq.label)&&Number.isFinite(eq.score));const sp=scenarioPlanner(d,s,eq,null);ok('scenario planner',sp&&['BULL','NEUTRAL','BEAR'].includes(sp.current)&&sp.bull.condition&&sp.bear.condition);ok('temporal stability range',Number.isFinite(bt.temporal)&&bt.temporal>=0&&bt.temporal<=1,String(bt.temporal));const bb=blockBootstrap95(bt.returns);ok('bootstrap ordering',!Number.isFinite(bb.low)||bb.low<=bb.high);const w=wilson95(65,100);ok('Wilson 95%',w.low>.55&&w.low<.56&&w.high>.73&&w.high<.75,`${w.low.toFixed(3)}~${w.high.toFixed(3)}`);const dr=decisionRobustness(d);ok('decision robustness range',dr>=0&&dr<=1,String(dr));const v=finalValidation(d,s,q,bt,[]);ok('validation reliability',v.reliability>=0&&v.reliability<=1,String(v.reliability));ok('validation axes internal',Number.isFinite(v.finalConfidence)&&Number.isFinite(v.forward)&&Number.isFinite(v.robust)&&Number.isFinite(v.stat));const blocked=finalValidation(d,s,q,bt,[],{sourceMeta:{state:'demo'}});ok('DEMO safety gate blocks decision',blocked.decision==='NO TRADE'&&blocked.safetyLevel==='BLOCKED');ok('Forward maturity early',forwardStats([]).maturity==='EARLY');const cal=confidenceCalibration([{resolved:true,excluded:false,confidence:.82,hit:true},{resolved:true,excluded:false,confidence:.60,hit:false}]);ok('confidence calibration object',cal.samples===2&&cal.status==='INSUFFICIENT');const oldLearnRaw=userDataStore.getItem(LEARNING_KEY);try{saveLearning([{at:new Date(Date.now()-4*60*60*1000).toISOString(),market:'KRW-BTC',tf:'240',price:100,score:70,decision:'매수 관찰',resolved:false}]);let early=updateForwardOutcomes({market:'KRW-BTC',tf:'240',price:110});ok('Forward Learning 4H horizon guard',early.length===1&&!early[0].resolved);saveLearning([{at:new Date(Date.now()-13*60*60*1000).toISOString(),market:'KRW-BTC',tf:'240',price:100,score:70,decision:'매수 관찰',resolved:false}]);let lx=updateForwardOutcomes({market:'KRW-BTC',tf:'60',price:110});ok('Forward Learning timeframe isolation',lx.length===1&&!lx[0].resolved);lx=updateForwardOutcomes({market:'KRW-BTC',tf:'240',price:110});ok('Forward Learning matching timeframe resolve',lx.length===1&&lx[0].resolved&&lx[0].hit===true)}finally{if(oldLearnRaw===null)userDataStore.removeItem(LEARNING_KEY);else userDataStore.setItem(LEARNING_KEY,oldLearnRaw)}const b=makeBackup();ok('backup checksum',verifyBackup(b));ok('no order function',typeof window.placeOrder==='undefined');ok('4-tab UI',document.querySelectorAll('.tab').length===4&&!document.querySelector('#pane-status'));ok('management moved to settings',!!$('healthCheckBtn')&&!!$('lastBackupText')&&!document.querySelector('#pane-home [data-target-tab="status"]'));ok('home warning is conditional',!!$('homeAlertBanner')&&!!$('settingsAlertDot'));ok('home summary UI',!!$('summaryList')&&!!$('summaryRefreshBtn'));ok('headline-first home',!!$('homeHeadline')&&!!$('homeDeck')&&!!document.querySelector('.homeReasonDetails'));ok('Forward Learning removed from home',!document.querySelector('#pane-home .homeQuickRow')&&!document.querySelector('#pane-home #homeForwardText'));ok('important learning retained in records',!!$('flTotal')&&!!$('flCalibration')&&!!$('regimeEdgeList'));ok('readiness UI hidden plus warning',!!$('readinessOverall')&&!!$('readinessData')&&!!$('readinessBackup')&&!!$('homeAlertBanner'));ok('onboarding UI',!!$('onboardingOverlay')&&!!$('onboardingStartBtn'));ok('UI profile stable',loadUiProfile().favorites.length>=1&&['60','240','day'].includes(loadUiProfile().lastTf));const oldUiRaw=userDataStore.getItem(UI_KEY);try{userDataStore.setItem(UI_KEY,JSON.stringify({...defaultUiProfile(),onboardingDone:true,lastTab:'status'}));ok('legacy status tab migrates settings',loadUiProfile().lastTab==='settings')}finally{if(oldUiRaw===null)userDataStore.removeItem(UI_KEY);else userDataStore.setItem(UI_KEY,oldUiRaw)}ok('decision summary UI',!!$('decisionSummary')&&!!$('confidenceLabel'));ok('decision safety UI',!!$('decisionSafetyCard')&&!!$('decisionSafetyBadge'));ok('entry/scenario/edge UI',!!$('entryQualityValue')&&!!$('scenarioValue')&&!!$('strategyEdgeValue')&&!!$('scenarioPlanner'));ok('calibration/regime UI',!!$('flCalibration')&&!!$('calibrationBands')&&!!$('regimeEdgeList'));ok('health check UI',!!$('healthCheckBtn')&&!!$('healthCheckStatus')&&!!$('healthCheckList'));ok('freshness UI',!!$('dataStateCard')&&!!$('dataFreshness'));ok('signal history UI',!!$('signalHistory')&&!!$('flAvgReturn'));ok('minimal alert UI',!!$('decisionAlertsCheck')&&!!$('notificationPermissionBtn'));ok('canvas present',!!$('priceChart'));ok('scanner markets',document.querySelectorAll('#marketSelect option').length===5);ok('mobile width sane',document.documentElement.scrollWidth<=window.innerWidth+2,`${document.documentElement.scrollWidth}/${window.innerWidth}`);ok('no fatal state',!!state.analysis||state.candles.length===0)}catch(e){checks.push({name:'self-test exception',ok:false,detail:e.message})}
  const pass=checks.filter(x=>x.ok).length;return{pass,total:checks.length,checks};
}
function runSelfTest(){const r=selfTest();$('selfTestOutput').textContent=`${r.pass}/${r.total} PASS\n`+r.checks.map(x=>`${x.ok?'PASS':'FAIL'}  ${x.name}${x.detail?' · '+x.detail:''}`).join('\n');return r}

function nativeStorageAvailable(){return userDataStore.nativeAvailable()}
function healthCheck(){
  const checks=[],add=(name,level,detail)=>checks.push({name,level,detail}),tf=state.analysis?.tf||loadUiProfile().lastTf;
  add('앱 버전',APP_VERSION==='15.31.29'?'OK':'FAIL',`V${APP_VERSION}`);
  const storageOk=nativeStorageAvailable();add('모바일 저장소',storageOk?'OK':'WARN',storageOk?'정상':'현재 origin에서는 native localStorage 확인 불가');
  add('PWA 구성',document.querySelector('link[rel="manifest"]')&&'serviceWorker'in navigator?'OK':'WARN','manifest / Service Worker 지원');
  if(state.candles.length){const ig=dataIntegrityGate(state.candles,tf);add('데이터 무결성',ig.level==='READY'?'OK':ig.level==='CAUTION'?'WARN':'FAIL',`${ig.level} · ${ig.score}`)}else add('데이터 무결성','WARN','분석 후 확인 가능');
  const cal=confidenceCalibration(loadLearning());add('판단 신뢰도 검증',['OVERCONFIDENT','MISCALIBRATED'].includes(cal.status)?'WARN':cal.status==='CALIBRATED'?'OK':'WARN',`${cal.status} · n=${cal.samples}`);
  add('실전 결과 저장소',Array.isArray(loadLearning())?'OK':'FAIL',`${loadLearning().length}개 기록`);
  add('백업 상태',backupDue()?'WARN':'OK',backupDue()?'백업 권장':'정상');
  add('자동주문 차단',typeof window.placeOrder==='undefined'?'OK':'FAIL','주문 함수 없음');
  const fail=checks.filter(x=>x.level==='FAIL').length,warn=checks.filter(x=>x.level==='WARN').length,ok=checks.length-fail-warn,status=fail?'CHECK':warn?'CAUTION':'NORMAL';
  return{status,ok,warn,fail,total:checks.length,checks};
}
function runHealthCheck(){
  const r=healthCheck(),status=$('healthCheckStatus'),score=$('healthCheckScore'),list=$('healthCheckList');if(status){status.textContent=r.status==='NORMAL'?'정상':r.status==='CAUTION'?'주의':'확인 필요';status.className=r.status==='NORMAL'?'good':r.status==='CAUTION'?'warn':'bad'}if(score)score.textContent=`정상 ${r.ok} · 주의 ${r.warn} · 문제 ${r.fail}`;if(list)list.innerHTML=r.checks.map(x=>`<div class="healthCheckItem" data-level="${x.level.toLowerCase()}"><b>${esc(x.name)}</b><span>${esc(x.detail)}</span></div>`).join('');if($('statusPwa'))$('statusPwa').textContent=r.fail?'확인 필요':r.warn?'주의':'정상';return r
}

function bindTabs(){document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)))}
function applySettingsToUI(){const s=loadSettings();$('conservatismSelect').value=s.conservatism;$('countSelect').value=String(s.count);$('demoFallbackCheck').checked=!!s.demoFallback;$('decisionAlertsCheck').checked=!!s.decisionAlerts;if(typeof Notification!=='undefined')$('notificationStatus').textContent=`알림 권한: ${Notification.permission} · 알림은 설정 ON + LIVE 데이터 + 신뢰도 70% 이상에서만 동작합니다.`}
function bind(){
  bindTabs();
  document.querySelectorAll('[data-target-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.targetTab)));
  if($('statusHealthRunBtn'))$('statusHealthRunBtn').addEventListener('click',runHealthCheck);
  $('refreshBtn').addEventListener('click',refresh);
  $('summaryRefreshBtn').addEventListener('click',refreshHomeSummary);
  $('openLastAnalysisBtn').addEventListener('click',async()=>{const p=loadUiProfile();$('marketSelect').value=p.lastMarket;$('tfSelect').value=p.lastTf;setTab('analysis');await refresh()});
  $('summaryList').addEventListener('click',async e=>{const card=e.target.closest('.summaryCard');if(!card)return;const p=loadUiProfile();$('marketSelect').value=card.dataset.market;$('tfSelect').value=p.lastTf;saveUiProfile({lastMarket:card.dataset.market});setTab('analysis');await refresh()});
  $('marketSelect').addEventListener('change',()=>{saveUiProfile({lastMarket:$('marketSelect').value});renderQuickState()});
  $('tfSelect').addEventListener('change',()=>{saveUiProfile({lastTf:$('tfSelect').value});renderQuickState()});
  $('scannerBtn').addEventListener('click',scanMarkets);
  $('backtestBtn').addEventListener('click',()=>{if(state.research&&state.analysis){renderResearch(state.research,state.analysis.validation);$('healthText').textContent='검증 갱신'}});
  $('recordSignalBtn').addEventListener('click',recordSignal);
  $('clearLearningBtn').addEventListener('click',()=>{if(confirm('Forward Learning 로컬 기록을 초기화하시겠습니까?')){saveLearning([]);renderForward(forwardStats([]))}});
  $('saveSettingsBtn').addEventListener('click',()=>{saveSettings({conservatism:$('conservatismSelect').value,count:Number($('countSelect').value),demoFallback:$('demoFallbackCheck').checked,decisionAlerts:$('decisionAlertsCheck').checked});$('backupStatus').className='hint';$('backupStatus').textContent='운용 설정을 저장했습니다.'});
  $('saveUiPrefsBtn').addEventListener('click',saveUiPreferences);
  $('exportBtn').addEventListener('click',downloadBackup);
  $('importInput').addEventListener('change',async e=>{try{if(e.target.files[0])await importBackup(e.target.files[0])}catch(err){$('backupStatus').textContent=`복원 실패: ${err.message}`;$('backupStatus').className='hint bad'}finally{e.target.value=''}});
  $('healthCheckBtn').addEventListener('click',runHealthCheck);
  $('selfTestBtn').addEventListener('click',runSelfTest);
  $('notificationPermissionBtn').addEventListener('click',requestNotificationPermission);
  $('onboardingStartBtn').addEventListener('click',completeOnboarding);
  window.addEventListener('resize',()=>{if(state.candles.length)renderChart(state.candles)});window.addEventListener('online',renderReadiness);window.addEventListener('offline',renderReadiness);
}
async function boot(){
  migrateLegacyStorage();const profile=initUiProfile();applySettingsToUI();applyUiProfile();bind();renderForward(forwardStats(loadLearning()));runHealthCheck();
  if('serviceWorker'in navigator&&location.protocol!=='file:'&&!window.__CA_FORCE_DEMO__){navigator.serviceWorker.register('./sw.js').catch(()=>{})}
  if(showOnboardingIfNeeded()){setTab('home',false);renderHomeSummary([]);return}
  setTab(profile.lastTab||'home',false);await refresh();await refreshHomeSummary()
}
window.__CA_TEST__={version:APP_VERSION,selfTest,refresh,refreshHomeSummary,scanMarkets,boot,getState:()=>state,demoCandles,normalizeCandleRows,computeSignal,backtest,qualityAssessment,finalValidation,verifyBackup,makeBackup,learningHorizonMs,updateForwardOutcomes,storageGet:k=>userDataStore.getItem(k),storageSet:(k,v)=>userDataStore.setItem(k,v),storageRemove:k=>userDataStore.removeItem(k),storageDump:()=>userDataStore.dump(),storageDumpNamespace:()=>userDataStore.dumpNamespace(),storageSnapshot:()=>userDataStore.exportSnapshot(),storageCapabilities:()=>userDataStore.capabilities(),freshnessMeta,buildDecisionSummary,confidenceBand,decisionGroup,migrateLegacyStorage,maybeNotifyDecisionChange,friendlyError,showDecisionNotification,loadUiProfile,saveUiProfile,initUiProfile,saveUiPreferences,completeOnboarding,setTab,renderBackupMeta,loadBackupMeta,renderUpdateStatus,saveBackupMeta,forwardStats,temporalStability,renderReadiness,backupDue,loadSnapshots,getSafeSnapshot,saveSafeSnapshot,entryQuality,scenarioPlanner,benchmarkMetrics,strategyEdge,dataIntegrityGate,inferTfFromRows,confidenceCalibration,regimeEdgeAnalysis,trendRegimeKey,healthCheck,runHealthCheck,SIM_ROUNDTRIP_COST};
window.addEventListener('DOMContentLoaded',boot);
})();

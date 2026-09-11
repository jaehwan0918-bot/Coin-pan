'use strict';
const fs=require('fs'),path=require('path');
const {installFakeCaches,callWorker}=require('./cf_test_lib.cjs');
const root=path.resolve(__dirname,'..');
const tests=[];const add=(n,c,d='')=>tests.push({name:n,ok:!!c,detail:String(d||'')});
function rows(n=200,{tf=60,invalidUtc=false,noUtc=false}={}){const ms=tf==='day'?86400000:Number(tf)*60000,out=[];for(let i=0;i<n;i++){const ts=1700000000000+i*ms,p=100000+i*10;out.push({timestamp:ts+37000,...(noUtc?{}:{candle_date_time_utc:invalidUtc?'not-a-date':new Date(ts).toISOString().slice(0,19)}),opening_price:p,high_price:p+100,low_price:p-100,trade_price:p+10,candle_acc_trade_volume:50+i})}return out.reverse()}
(async()=>{
 const originalFetch=global.fetch;installFakeCaches();let calls=0;
 try{
   global.fetch=async()=>{calls++;throw new Error('CHAOS_NETWORK_DOWN')};
   let r=await callWorker(root,{query:{market:'KRW-BTC',tf:'60',count:'160'},ip:'10.10.0.1'});add('network throw -> 502',r.status===502,r.status);add('network throw retried 3x',calls===3,calls);add('502 safe error shape',r.body.error==='upstream_unavailable'&&typeof r.body.message==='string',JSON.stringify(r.body));

   calls=0;global.fetch=async()=>{calls++;return new Response('{broken-json',{status:200,headers:{'content-type':'application/json'}})};
   r=await callWorker(root,{query:{market:'KRW-ETH',tf:'240',count:'160'},ip:'10.10.0.2'});add('JSON parser failure -> 502',r.status===502,r.status);add('JSON parser failure retried 3x',calls===3,calls);

   calls=0;global.fetch=async()=>{calls++;return new Response(JSON.stringify({unexpected:true}),{status:200,headers:{'content-type':'application/json'}})};
   r=await callWorker(root,{query:{market:'KRW-XRP',tf:'60',count:'160'},ip:'10.10.0.3'});add('non-array upstream -> 502',r.status===502,r.status);add('non-array not endlessly retried',calls===1,calls);

   calls=0;global.fetch=async()=>{calls++;return new Response(JSON.stringify(rows(80,{tf:60,noUtc:true})),{status:200,headers:{'content-type':'application/json'}})};
   r=await callWorker(root,{query:{market:'KRW-SOL',tf:'60',count:'80'},ip:'10.10.0.4'});add('missing UTC uses timestamp fallback',r.status===200&&r.body.candles.length===80&&r.body.candles.every(x=>Number.isFinite(x.t)),JSON.stringify(r.body.candles?.[0]));add('timestamp fallback remains chronological',r.body.candles[0].t<r.body.candles.at(-1).t);

   calls=0;global.fetch=async()=>{calls++;return new Response(JSON.stringify(rows(80,{tf:60,invalidUtc:true})),{status:200,headers:{'content-type':'application/json'}})};
   r=await callWorker(root,{query:{market:'KRW-DOGE',tf:'60',count:'80'},ip:'10.10.0.5'});add('invalid UTC uses timestamp fallback',r.status===200&&r.body.candles.every(x=>Number.isFinite(x.t)));

   calls=0;global.fetch=async()=>{calls++;const x=rows(80,{tf:60});x[5].trade_price='broken';return new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}})};
   r=await callWorker(root,{query:{market:'KRW-ADA',tf:'60',count:'80'},ip:'10.10.0.6'});add('malformed upstream OHLC fails closed',r.status===502,r.status);add('malformed upstream not returned as candles',r.body.error==='upstream_unavailable'&&!r.body.candles,JSON.stringify(r.body));

   // Cache API failure must degrade to live fetch, never fail the analysis endpoint.
   installFakeCaches({matchThrows:true,putThrows:true});calls=0;global.fetch=async()=>{calls++;return new Response(JSON.stringify(rows(80,{tf:60})),{status:200,headers:{'content-type':'application/json'}})};
   r=await callWorker(root,{query:{market:'KRW-AVAX',tf:'60',count:'80'},ip:'10.10.0.7'});add('Cache API outage falls back to upstream',r.status===200&&r.body.source==='UPBIT PUBLIC API',JSON.stringify(r.body));add('Cache API outage does not duplicate upstream',calls===1,calls);

   // Corrupted cache must be ignored and replaced by good upstream data.
   const fake=installFakeCaches();const cacheKey='https://app.test/__coin_nachimpan_cache/candles?market=KRW-DOT&tf=60&count=80';await fake.api.put(new Request(cacheKey),new Response(JSON.stringify({candles:[{t:1,o:1,h:0,l:2,c:1,v:-1}]}),{headers:{'content-type':'application/json'}}));calls=0;global.fetch=async()=>{calls++;return new Response(JSON.stringify(rows(80,{tf:60})),{status:200,headers:{'content-type':'application/json'}})};
   r=await callWorker(root,{query:{market:'KRW-DOT',tf:'60',count:'80'},ip:'10.10.0.8'});add('corrupt Cloudflare cache ignored',r.status===200&&r.body.source==='UPBIT PUBLIC API',r.body.source);add('corrupt cache triggers one upstream fetch',calls===1,calls);

   // Cache pressure should remain responsive; actual edge cache eviction is Cloudflare-managed.
   installFakeCaches();calls=0;global.fetch=async(url)=>{calls++;const u=new URL(String(url)),tf=u.pathname.includes('/days')?'day':u.pathname.split('/').pop();return new Response(JSON.stringify(rows(60,{tf})),{status:200,headers:{'content-type':'application/json'}})};
   for(let i=0;i<105;i++){const market=`KRW-X${String(i).padStart(3,'0')}`;await callWorker(root,{query:{market,tf:'60',count:'60'},ip:`10.20.${Math.floor(i/250)}.${(i%250)+1}`})}
   const before=calls;r=await callWorker(root,{query:{market:'KRW-X000',tf:'60',count:'60'},ip:'10.21.0.1'});add('105-key cache pressure endpoint responsive',r.status===200,r.status);add('cached key avoids refetch in test cache',calls===before,`before=${before} after=${calls}`);

   installFakeCaches();global.fetch=async()=>new Response(JSON.stringify(rows(60,{tf:15})),{status:200,headers:{'content-type':'application/json'}});let rr;for(let i=0;i<61;i++)rr=await callWorker(root,{query:{market:'KRW-BTC',tf:'15',count:'60'},headers:{'CF-Connecting-IP':'198.51.100.10'},ip:null});add('abusive client 61st -> 429',rr.status===429,rr.status);const other=await callWorker(root,{query:{market:'KRW-BTC',tf:'15',count:'60'},headers:{'CF-Connecting-IP':'198.51.100.11'},ip:null});add('other client unaffected by rate limit',other.status===200,other.status);

   global.fetch=async(url)=>{const u=new URL(String(url)),count=Math.max(1,Number(u.searchParams.get('count')||200)),tf=u.pathname.includes('/days')?'day':u.pathname.split('/').pop();return new Response(JSON.stringify(rows(count,{tf})),{status:200,headers:{'content-type':'application/json'}})};
   r=await callWorker(root,{query:{market:'KRW-BTC?x=1',tf:'60',count:'160'},ip:'10.30.0.1'});add('market injection rejected',r.status===400,r.status);
   r=await callWorker(root,{query:{market:'KRW-BTC',tf:'../../etc',count:'160'},ip:'10.30.0.2'});add('timeframe path injection rejected',r.status===400,r.status);
   r=await callWorker(root,{query:{market:'KRW-BTC',tf:'60',count:'-999'},ip:'10.30.0.3'});add('negative count clamps safely',r.status===200&&r.body.candles.length===60,r.body.candles?.length);
   r=await callWorker(root,{query:{market:'KRW-BTC',tf:'60',count:'999999999'},ip:'10.30.0.4'});add('huge count clamps safely',r.status===200&&r.body.candles.length===200,r.body.candles?.length);
   r=await callWorker(root,{method:'DELETE',query:{market:'KRW-BTC',tf:'60'},ip:'10.30.0.5'});add('unexpected HTTP method rejected',r.status===405,r.status);

   r=await callWorker(root,{pathName:'/api/health',ip:'10.40.0.1'});add('health stays safe/no-order',r.status===200&&r.body.ok===true&&r.body.orderApiEnabled===false&&r.body.paidApiRequired===false,JSON.stringify(r.body));r=await callWorker(root,{pathName:'/api/version',ip:'10.40.0.2'});add('version endpoint survives chaos',r.status===200&&r.body.version==='15.31.29',JSON.stringify(r.body));
 }finally{global.fetch=originalFetch}
 const pass=tests.filter(x=>x.ok).length,total=tests.length,result={version:'15.31.29',scope:'Cloudflare Worker API Chaos E2E',pass,total,failed:tests.filter(x=>!x.ok),tests,generatedAt:new Date().toISOString()};fs.writeFileSync(path.join(root,'docs','V15_31_29_CHAOS_API_E2E_RESULT.json'),JSON.stringify(result,null,2));console.log(`RESULT ${pass}/${total} PASS`);for(const x of result.failed)console.error('FAIL',x.name,x.detail);if(pass!==total)process.exit(1)
})().catch(e=>{console.error(e);process.exit(1)});

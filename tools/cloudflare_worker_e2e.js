'use strict';
const fs=require('fs'),path=require('path');
const {installFakeCaches,callWorker}=require('./cf_test_lib.cjs');
const root=path.resolve(__dirname,'..');
const tests=[];const add=(n,c,d='')=>tests.push({name:n,ok:!!c,detail:String(d||'')});
(async()=>{
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  add('Wrangler main worker',cfg.main==='src/worker.mjs',cfg.main);
  add('Static assets directory',cfg.assets?.directory==='./public',cfg.assets?.directory);
  add('Assets binding',cfg.assets?.binding==='ASSETS',cfg.assets?.binding);
  add('Only API routes run worker first',Array.isArray(cfg.assets?.run_worker_first)&&cfg.assets.run_worker_first.length===1&&cfg.assets.run_worker_first[0]==='/api/*',JSON.stringify(cfg.assets?.run_worker_first));
  add('Compatibility date set',/^2026-09-11$/.test(cfg.compatibility_date),cfg.compatibility_date);
  const headers=fs.readFileSync(path.join(root,'public','_headers'),'utf8');
  for(const h of ['Strict-Transport-Security','X-Content-Type-Options','X-Frame-Options','Referrer-Policy','Permissions-Policy','Content-Security-Policy'])add(`static security header ${h}`,headers.includes(h));
  installFakeCaches();
  const env={ASSETS:{async fetch(req){return new Response(`asset:${new URL(req.url).pathname}`,{status:200,headers:{'content-type':'text/plain'}})}}};
  let r=await callWorker(root,{pathName:'/anything',env,ip:'10.50.0.1'});add('Worker asset fallback binding works',r.status===200&&r.body==='asset:/anything',String(r.body));
  r=await callWorker(root,{pathName:'/api/health',env,ip:'10.50.0.2'});add('API handled before asset binding',r.status===200&&r.body.platform==='cloudflare-workers',JSON.stringify(r.body));
  r=await callWorker(root,{pathName:'/api/unknown',env,ip:'10.50.0.3'});add('unknown API not swallowed by SPA asset fallback',r.status===404,`${r.status}`);
  const worker=fs.readFileSync(path.join(root,'src','worker.mjs'),'utf8');
  add('uses Cloudflare caches.default',worker.includes('caches.default'));
  add('no Node require in Worker',!worker.includes('require('));
  add('no Vercel API files',!fs.existsSync(path.join(root,'api'))&&!fs.existsSync(path.join(root,'vercel.json')));
  add('no paid storage binding',!/(\bKV\b|D1Database|DurableObject|R2Bucket)/.test(worker+JSON.stringify(cfg)));
  const pass=tests.filter(x=>x.ok).length,total=tests.length,result={version:'15.31.29',scope:'Cloudflare architecture E2E',pass,total,failed:tests.filter(x=>!x.ok),tests,generatedAt:new Date().toISOString()};fs.writeFileSync(path.join(root,'docs','V15_31_29_CLOUDFLARE_E2E_RESULT.json'),JSON.stringify(result,null,2));console.log(`RESULT ${pass}/${total} PASS`);if(pass!==total){for(const x of result.failed)console.error('FAIL',x.name,x.detail);process.exit(1)}
})().catch(e=>{console.error(e);process.exit(1)});

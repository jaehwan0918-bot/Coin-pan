'use strict';
const path=require('path');
const {pathToFileURL}=require('url');

let workerPromise;
async function getWorker(root){
  if(!workerPromise){
    const url=pathToFileURL(path.join(root,'src','worker.mjs')).href+`?t=${Date.now()}`;
    workerPromise=import(url).then(m=>m.default);
  }
  return workerPromise;
}

function keyOf(req){return typeof req==='string'?req:String(req?.url||req)}
function installFakeCaches(opts={}){
  const store=new Map();
  const api={
    async match(req){if(opts.matchThrows)throw new Error('CACHE_MATCH_FAILURE');const x=store.get(keyOf(req));return x?x.clone():undefined},
    async put(req,res){if(opts.putThrows)throw new Error('CACHE_PUT_FAILURE');store.set(keyOf(req),res.clone())},
    async delete(req){if(opts.deleteThrows)throw new Error('CACHE_DELETE_FAILURE');return store.delete(keyOf(req))},
  };
  globalThis.caches={default:api};
  return {store,api};
}

async function callWorker(root,{method='GET',pathName='/api/candles',query={},headers={},ip='10.0.0.1',env={}}={}){
  const worker=await getWorker(root);
  const u=new URL(`https://app.test${pathName}`);
  for(const [k,v] of Object.entries(query))u.searchParams.set(k,String(v));
  const h=new Headers(headers);
  if(ip&&!h.has('CF-Connecting-IP'))h.set('CF-Connecting-IP',ip);
  const request=new Request(u.toString(),{method,headers:h});
  const pending=[];
  const ctx={waitUntil(p){pending.push(Promise.resolve(p))}};
  const response=await worker.fetch(request,env,ctx);
  await Promise.allSettled(pending);
  const text=await response.text();
  let body;try{body=JSON.parse(text)}catch{body=text}
  const outHeaders={};response.headers.forEach((v,k)=>outHeaders[k]=v);
  return {status:response.status,headers:outHeaders,body};
}

module.exports={getWorker,installFakeCaches,callWorker};

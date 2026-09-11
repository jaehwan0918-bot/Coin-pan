(()=>{
'use strict';

class LocalUserDataStore {
  constructor({namespace,legacyNamespaces=[]}={}){
    if(!namespace||typeof namespace!=='string')throw new Error('LocalUserDataStore namespace is required');
    this.namespace=namespace;
    this.legacyNamespaces=Array.isArray(legacyNamespaces)?legacyNamespaces.filter(Boolean):[];
    this.memory=new Map();
  }
  _native(){try{return window.localStorage}catch{return null}}
  getItem(key){
    const k=String(key);
    try{
      const s=this._native();
      if(s){const v=s.getItem(k);if(v!==null){this.memory.set(k,v);return v}}
    }catch{}
    return this.memory.has(k)?this.memory.get(k):null;
  }
  setItem(key,value){
    const k=String(key),v=String(value);this.memory.set(k,v);
    try{const s=this._native();if(s){s.setItem(k,v);return true}}catch{}
    return false;
  }
  removeItem(key){
    const k=String(key);this.memory.delete(k);
    try{const s=this._native();if(s)s.removeItem(k)}catch{}
  }
  has(key){return this.getItem(key)!==null}
  getJson(key,fallback=null){try{const raw=this.getItem(key);return raw===null?fallback:JSON.parse(raw)}catch{return fallback}}
  setJson(key,value){return this.setItem(key,JSON.stringify(value))}
  nativeAvailable(){
    const k=`${this.namespace}:__health`,v=`${Date.now()}`;
    try{const s=this._native();if(!s)return false;s.setItem(k,v);const ok=s.getItem(k)===v;s.removeItem(k);return ok}catch{return false}
  }
  dump(){
    const out={};
    try{const s=this._native();if(s)for(let i=0;i<s.length;i++){const k=s.key(i);if(k!==null)out[k]=s.getItem(k)}}catch{}
    for(const [k,v] of this.memory)out[k]=v;
    return out;
  }
  dumpNamespace(){
    const prefix=`${this.namespace}:`,all=this.dump(),out={};
    for(const [k,v] of Object.entries(all))if(k.startsWith(prefix))out[k]=v;
    return out;
  }
  exportSnapshot(){return {schemaVersion:1,namespace:this.namespace,exportedAt:new Date().toISOString(),items:this.dumpNamespace()}}
  importSnapshot(snapshot,{merge=true}={}){
    if(!snapshot||snapshot.schemaVersion!==1||snapshot.namespace!==this.namespace||!snapshot.items||typeof snapshot.items!=='object')throw new Error('Invalid user data snapshot');
    const prefix=`${this.namespace}:`;
    if(!merge){for(const k of Object.keys(this.dumpNamespace()))this.removeItem(k)}
    let count=0;
    for(const [k,v] of Object.entries(snapshot.items)){if(k.startsWith(prefix)&&typeof v==='string'){this.setItem(k,v);count++}}
    return count;
  }
  capabilities(){return Object.freeze({driver:'local',offlineFirst:true,cloudSync:false,namespace:this.namespace})}
}

function createLocalUserDataStore(options){return new LocalUserDataStore(options)}

window.CoinNachimpanStorage=Object.freeze({apiVersion:1,LocalUserDataStore,createLocalUserDataStore});
})();

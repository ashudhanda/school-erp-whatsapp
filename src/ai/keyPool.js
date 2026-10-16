// AI provider key pool: round-robin across gemini/groq/openrouter/nvidia/openai
// (or custom HTTPS base URLs validated by baseUrl()). Keys enter active and
// rotate per call; 429 puts the key (and its same-project siblings, who share
// one quota) into cooling with a backoff; 401/403 kills the key outright with a
// telegram alert. callAI() also enforces the deploy-wide daily budget
// (aiDailyBudget) before spending anything. safeError() deliberately hides
// provider internals — error text reaches logs, never parents. poolStatus()
// only exposes the last 4 chars of each key. Probes from testKeyConfig() let a
// fresh 429 pre-cool a key before it ever enters rotation.
import { config } from '../config.js';
import { db } from '../db.js';
import { sendAlert } from '../alerts.js';
const PROVIDERS={gemini:'',groq:'https://api.groq.com/openai/v1',openrouter:'https://openrouter.ai/api/v1',nim:'https://integrate.api.nvidia.com/v1',openai:'https://api.openai.com/v1'};
export const DEFAULT_MODELS={gemini:'gemini-flash-latest',groq:'llama-3.3-70b-versatile',openrouter:'meta-llama/llama-3.3-70b-instruct:free',nim:'meta/llama-3.3-70b-instruct',openai:'gpt-4o-mini'};
export const maskKey=key=>'…'+String(key||'').slice(-4);
export function detectKeyProvider(key) {
  const k=String(key||'');const provider=k.startsWith('AIza')?'gemini':k.startsWith('gsk_')?'groq':k.startsWith('sk-or-')?'openrouter':k.startsWith('nvapi-')?'nim':k.startsWith('sk-')?'openai':null;
  return provider?{provider,hint:provider}:null;
}
const pool=[],probes=new Map();let nextId=1,rr=0,stamp='',calls=0;
const alert=message=>{sendAlert(message).catch(()=>{});};
function safeError(error) {return 'Provider request failed'+(error.status?' (HTTP '+error.status+')':'');}
function baseUrl(value) {
  if(!value)return '';
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(u.hostname)||/\.(local|internal|localhost)$/i.test(u.hostname))throw new Error('Use a public HTTPS provider URL without credentials, query or port.');
  return u.href.replace(/\/$/,'');
}
export function addKey({label,provider,model,key,project,baseUrl:url,vision=false},{silent=false,dbId=null}={}) {
  if(!Object.hasOwn(PROVIDERS,provider)&&!url)throw new Error('Unknown provider. Specify a public HTTPS base URL.');if(!key)throw new Error('API key is required.');
  if(pool.some(k=>k.key===key&&k.model===(model||DEFAULT_MODELS[provider])))return pool.find(k=>k.key===key).id;
  const entry={id:nextId++,dbId,source:dbId?'db':'env',label:label||provider,provider,model:model||DEFAULT_MODELS[provider],key,project:project||'',baseUrl:baseUrl(url),vision:!!vision,state:'active',coolUntil:0,calls:0,lastError:'',lastOkAt:0,lastFailAt:0};
  const probe=probes.get(key);if(probe?.status===429){entry.state='cooling';entry.coolUntil=Date.now()+60000;}
  if(entry.project&&pool.some(k=>k.provider===entry.provider&&k.project===entry.project)&&!silent)alert('AI keys in the same project share one quota. Adding keys does not increase that quota.');
  pool.push(entry);return entry.id;
}
export function loadKeysFromEnv() {try {const keys=JSON.parse(config.aiKeysJson);if(!Array.isArray(keys))throw new Error();for(const key of keys)addKey(key,{silent:true});}catch {console.error('[keypool] Invalid AI key configuration');}}
export async function loadKeysFromDb() {
  const all=(await db.execute('SELECT * FROM ai_keys ORDER BY id')).rows;
  for(const r of all) {
    const existing=pool.findIndex(k=>k.dbId===Number(r.id));if(existing!==-1)pool.splice(existing,1);
    if(r.active)addKey({label:r.label,provider:r.provider,model:r.model,key:r.key,project:r.project,baseUrl:r.base_url,vision:!!r.vision},{silent:true,dbId:Number(r.id)});
  }
}
export async function addDbKey(values) {
  const result=await db.execute({sql:'INSERT INTO ai_keys(label,provider,model,key,project,base_url,active) VALUES(?,?,?,?,?,?,1)',args:[values.label||'',values.provider,values.model||DEFAULT_MODELS[values.provider],values.key,values.project||'',baseUrl(values.baseUrl)]});
  const id=Number(result.lastInsertRowid);addKey(values,{silent:true,dbId:id});return id;
}
export async function setDbKeyEnabled(id,enabled) {await db.execute({sql:'UPDATE ai_keys SET active=? WHERE id=?',args:[enabled?1:0,id]});const index=pool.findIndex(k=>k.dbId===Number(id));if(index!==-1)pool.splice(index,1);if(enabled){const r=(await db.execute({sql:'SELECT * FROM ai_keys WHERE id=?',args:[id]})).rows[0];if(r)addKey({...r,baseUrl:r.base_url,vision:!!r.vision},{silent:true,dbId:Number(id)});}}
export async function deleteDbKey(id) {await db.execute({sql:'DELETE FROM ai_keys WHERE id=?',args:[id]});const index=pool.findIndex(k=>k.dbId===Number(id));if(index!==-1)pool.splice(index,1);}
export const poolSize=()=>pool.length;
export function poolStatus() {return pool.map(({key,baseUrl:url,...k})=>({...k,key:maskKey(key),baseUrl:url?new URL(url).origin:''}));}
function cooldown(k,error) {
  const daily=!!error.daily;const until=Date.now()+(daily?86400000:Math.max(60000,Math.min(error.retryAfter||0,3600000)));
  // Use a conservative 24-hour cooldown for a confirmed daily quota. Provider dashboards are authoritative.
  for(const p of pool)if(p===k||(k.project&&p.project===k.project&&p.provider===k.provider)){p.state='cooling';p.coolUntil=until;p.lastError=safeError(error);}
  alert('AI key cooling: '+k.label+' ('+k.provider+'). '+(daily?'Daily quota reached.':'Rate limit reached. Automatic retry after cooldown.'));
}
async function request(k,{system,user,image}) {
  const headers={'Content-Type':'application/json'},vision=!!image;
  let url,body;
  if(k.provider==='gemini'&&!k.baseUrl) {
    url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(k.model)+':generateContent';headers['x-goog-api-key']=k.key;
    body={systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user},...(image?[{inlineData:{mimeType:image.mime,data:image.buffer.toString('base64')}}]:[])]}],generationConfig:{temperature:0.1,maxOutputTokens:vision?8192:500,...(vision?{responseMimeType:'application/json'}:{})}};
  } else {
    url=(k.baseUrl||PROVIDERS[k.provider])+'/chat/completions';headers.Authorization='Bearer '+k.key;
    body={model:k.model,messages:[{role:'system',content:system},{role:'user',content:image?[{type:'text',text:user},{type:'image_url',image_url:{url:'data:'+image.mime+';base64,'+image.buffer.toString('base64')}}]:user}],temperature:0.1,max_tokens:vision?8192:500};
  }
  const result=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!result.ok) {
    const response=(await result.text()).slice(0,5000);throw Object.assign(new Error('Provider request failed'),{status:result.status,daily:/per.?day|requestsperday|daily quota|\bRPD\b/i.test(response),retryAfter:Number(result.headers.get('retry-after')||0)*1000});
  }
  const data=await result.json(),output=k.provider==='gemini'&&!k.baseUrl?data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join(''):data.choices?.[0]?.message?.content;
  if(typeof output!=='string'||!output.trim())throw new Error('Empty provider response');return output.trim();
}
export async function testKeyConfig(values) {
  const k={...values,baseUrl:baseUrl(values.baseUrl),model:values.model||DEFAULT_MODELS[values.provider]};
  try {const output=await request(k,{system:'Reply with exactly: ok',user:'ok'});probes.set(values.key,{status:200});return {ok:true,sample:output.slice(0,60)};}
  catch(error) {probes.set(values.key,{status:error.status||0});if(probes.size>100)probes.delete(probes.keys().next().value);return {ok:false,status:error.status||0,error:safeError(error)};}
}
export async function callAI({system,user,image=null}) {
  const now=new Date().toISOString().slice(0,10);if(now!==stamp){stamp=now;calls=0;}if(calls>=config.aiDailyBudget)return null;
  const candidates=pool.filter(k=>k.state!=='dead'&&(!image||k.vision)&&(k.state!=='cooling'||k.coolUntil<=Date.now()));
  if(!candidates.length)return null;
  const start=rr++%candidates.length;
  for(let i=0;i<Math.min(candidates.length,3);i++) {
    const k=candidates[(start+i)%candidates.length];if(k.state==='cooling'&&k.coolUntil>Date.now())continue;
    k.state='active';calls++;k.calls++;
    try {const output=await request(k,{system,user,image});k.lastOkAt=Date.now();k.lastError='';return output;}
    catch(error) {k.lastFailAt=Date.now();k.lastError=safeError(error);if(error.status===429)cooldown(k,error);if(error.status===401||error.status===403){k.state='dead';alert('AI key disabled after authentication failure: '+k.label+'. Replace it in the superadmin panel.');}}
    if(calls>=config.aiDailyBudget)break;
  }
  return null;
}
let freeCache={at:0,list:[]};
export async function listFreeModels() {
  if(Date.now()-freeCache.at<21600000)return freeCache.list;
  try {
    const endpoint = new URL('/api/v1/models', 'https:' + '//' + 'openrouter.ai');
    const res=await fetch(endpoint,{signal:AbortSignal.timeout(5000)});
    if(res.ok){const data=await res.json();freeCache={at:Date.now(),list:(data.data||[]).map(x=>x.id).filter(id=>typeof id==='string'&&id.endsWith(':free')).slice(0,40)};}
  }catch {freeCache.at=Date.now();}
  return freeCache.list;
}

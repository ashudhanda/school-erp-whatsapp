// Meta WhatsApp Cloud API client. All outbound sends funnel through post(), which returns a
// normalized {ok,...} result: "ambiguous" marks a send whose outcome could not be confirmed
// (callers must NOT auto-retry those). setTestTransport() lets the test suite inject a fake
// transport; it is hard-disabled outside NODE_ENV=test.
import { config } from './config.js';
const API='https://graph.facebook.com/'+(process.env.META_API_VERSION||'v21.0');
let testTransport=null;
export function setTestTransport(fn) { if(process.env.NODE_ENV!=='test') throw new Error('Test transport is disabled.'); testTransport=fn; }
/**
 * Send one WhatsApp Cloud API request for a sender number.
 * Never throws: transport/network failures come back as {ok:false, ambiguous:true}.
 * Callers (jobs.js) must NOT auto-retry those — Meta has no send-idempotency
 * guarantee, so an ambiguous send is reconciled manually, never repeated blindly.
 * @param {string} phoneNumberId meta phone-number-id of the sender
 * @param {object} payload message payload merged with messaging_product:'whatsapp'
 * @returns {{ok:boolean, id?:string, status?:number, ambiguous?:boolean, error?:string}}
 */
export async function post(phoneNumberId,payload) {
  if(testTransport) return testTransport(phoneNumberId,payload);
  if(!/^\d+$/.test(String(phoneNumberId))) return {ok:false,status:400,error:'Invalid sender configuration'};
  try {
    const res=await fetch(API+'/'+phoneNumberId+'/messages',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.waToken},body:JSON.stringify({messaging_product:'whatsapp',...payload}),signal:AbortSignal.timeout(12000)});
    const data=await res.json();
    return res.ok ? {ok:true,id:data.messages?.[0]?.id} : {ok:false,status:res.status,error:'Meta error '+(data.error?.code||res.status)};
  } catch { return {ok:false,ambiguous:true,error:'Delivery could not be confirmed'}; }
}
/**
 * Split long body text into platform-safe chunks.
 * Splits on newlines first (preserving paragraphs), then hard-cuts any single
 * line longer than `max`. Never returns an empty array — an empty/falsy body
 * yields a single '—' placeholder part.
 * @param {string} body message text
 * @param {number} [max=3500] max characters per chunk
 * @returns {string[]} non-empty list of chunks
 */
export function splitText(body,max=3500) {
  const out=[]; let part='';
  for(const line of String(body??'').split('\n')) {
    if(part.length+line.length+1>max&&part) {out.push(part);part='';}
    let rest=line;
    while(rest.length>max) { if(part) {out.push(part);part='';} out.push(rest.slice(0,max));rest=rest.slice(max); }
    part+=(part?'\n':'')+rest;
  }
  if(part)out.push(part); return out.length?out:['—'];
}
/**
 * Send body as one or more text messages (auto-split by splitText).
 * Stops at the first failed part and returns that part's result, so callers
 * see the failure instead of a misleading success from an earlier chunk.
 */
export async function sendText(phoneNumberId,to,body) {
  let result={ok:true};
  for(const part of splitText(body)) {result=await post(phoneNumberId,{to,type:'text',text:{body:part}});if(!result.ok)break;}
  return result;
}
/**
 * Send an interactive reply-button message (max 3 buttons).
 * If `body` exceeds the ~1000-char interactive limit, it goes out first as a
 * plain text message and the buttons carry the short fallback header.
 * Button titles are truncated to 20 chars (Meta limit); `buttons` is a list of
 * [id, title] pairs — keep ids short and stable, they come back verbatim in
 * the webhook payload.
 */
export async function sendButtons(phoneNumberId,to,body,buttons) {
  if(buttons.length>3) throw new Error('Reply buttons exceed the platform limit.');
  if(String(body).length>1000) {await sendText(phoneNumberId,to,body);body='Choose an action:';}
  return post(phoneNumberId,{to,type:'interactive',interactive:{type:'button',body:{text:String(body)},action:{buttons:buttons.map(([id,title])=>({type:'reply',reply:{id,title:title.slice(0,20)}}))}}});
}
/**
 * Send an interactive list picker (1–10 rows).
 * Throws when `rows` is empty or longer than 10 (Meta limit). Row titles are
 * truncated to 24 chars, descriptions to 72. Like sendButtons, long bodies go
 * out first as plain text and the list keeps `buttonLabel` as its header.
 * `rows` is a list of [id, title] or [id, title, description] tuples.
 */
export async function sendList(phoneNumberId,to,body,buttonLabel,rows) {
  if(rows.length>10||!rows.length) throw new Error('List must contain between one and ten rows.');
  if(String(body).length>1000) {await sendText(phoneNumberId,to,body);body=buttonLabel;}
  return post(phoneNumberId,{to,type:'interactive',interactive:{type:'list',body:{text:String(body)},action:{button:buttonLabel.slice(0,20),sections:[{title:buttonLabel.slice(0,24),rows:rows.map(([id,title,description])=>({id,title:title.slice(0,24),...(description?{description:description.slice(0,72)}:{})}))}]}}});
}
// sendMenu is the default "every reply ends with the menu" primitive used by router.js.
/**
 * Send the standard option menu after a reply body (list picker).
 * @param {string} phone sender phone-number-id
 * @param {string} to recipient WhatsApp number
 * @param {string} body menu intro text (kept under sendList limits)
 * @param {Array} rows [id, title] or [id, title, description] tuples
 * @param {string} [label='Open menu'] button label shown on the list picker
 */
export const sendMenu=(phone,to,body,rows,label='Open menu')=>sendList(phone,to,body,label,rows);
/**
 * Send a document by media id. Captions are truncated to 900 chars (Meta limit);
 * empty captions are sent as ''.
 * @param {string} phone sender phone-number-id
 * @param {string} to recipient WhatsApp number
 * @param {string} mediaId uploaded media id
 * @param {string} name file name shown to the recipient
 * @param {string} [caption] optional caption
 */
export const sendDocument=(phone,to,mediaId,name,caption)=>post(phone,{to,type:'document',document:{id:mediaId,filename:name,caption:String(caption||'').slice(0,900)}});
/**
 * Send an image by media id. Captions are truncated to 900 chars (Meta limit).
 * @param {string} phone sender phone-number-id
 * @param {string} to recipient WhatsApp number
 * @param {string} mediaId uploaded media id
 * @param {string} [caption] optional caption
 */
export const sendImage=(phone,to,mediaId,caption)=>post(phone,{to,type:'image',image:{id:mediaId,caption:String(caption||'').slice(0,900)}});
/**
 * Send an approved utility template by name (the outside-24h-window path).
 * @param {string} name exact approved template name
 * @param {string} language template language code (e.g. 'en', 'hi')
 * @param {string[]} parameters body parameter values, in template order
 */
export async function sendTemplate(phone,to,name,language,parameters) {
  return post(phone,{to,type:'template',template:{name,language:{code:language},components:[{type:'body',parameters:parameters.map(value=>({type:'text',text:String(value)}))}]}});
}
export {API};

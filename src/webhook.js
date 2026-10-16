// Meta webhook surface for the WhatsApp bot.
// GET / verifies Meta's subscription handshake (hub.mode=subscribe + matching
// verify token; the challenge is echoed back so Meta confirms ownership).
// POST / requires a raw JSON body plus a valid x-hub-signature-256 HMAC with the
// app secret — signature mismatch is a hard 403 before anything is parsed.
// Durable inbox: ingest() stores the payload BEFORE the 200 ack, so a crashed
// run never loses a webhook; a periodic worker (processJobs, started in index.js)
// recovers pending work. The actual routing happens just after the ack on a
// setImmediate tick, so Meta's webhook deadline is never blocked by our work.
// A failed ingest answers 503 — Meta retries 503s, so no message is lost.
import express from 'express';
import {config} from './config.js';
import {signatureValid,ingest,processJobs} from './jobs.js';
export const webhookRouter=express.Router();
webhookRouter.get('/',(req,res)=>{
  if(config.verifyToken&&req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===config.verifyToken)return res.status(200).type('text').send(String(req.query['hub.challenge']||''));
  res.sendStatus(403);
});
webhookRouter.post('/',async(req,res)=>{
  if(!Buffer.isBuffer(req.body)||!signatureValid(req.body,req.get('x-hub-signature-256'),config.appSecret))return res.sendStatus(403);
  let payload;try{payload=JSON.parse(req.body.toString('utf8'));}catch{return res.sendStatus(400);}
  try {
    await ingest(payload);res.sendStatus(200);
    // Durable inbox exists before acknowledgment. A periodic worker recovers pending work.
    setImmediate(()=>processJobs().catch(()=>console.error('[webhook] Queued processing failed')));
  }catch {res.sendStatus(503);}
});

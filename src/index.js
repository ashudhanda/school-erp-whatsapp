// Application entry point.
// createApp() wires the Express app: /health, a / redirect to the panel, the Meta
// webhook with a raw JSON body (for signature verification), the CSRF-protected
// panel, and a plain-text fallback error handler.
// start() prints missing-env warnings (never aborts), runs idempotent migrations,
// loads AI keys, recovers interrupted jobs, then serves and ticks the outbox
// processor (every 750ms) and hourly cleanup. SIGTERM/SIGINT shut down gracefully.
// Running this file directly (node src/index.js) boots the whole server.
import express from 'express';
import {config,bootWarnings} from './config.js';
import {initDb,purgeOldLogs} from './db.js';
import {loadKeysFromEnv,loadKeysFromDb,poolSize} from './ai/keyPool.js';
import {panelRouter} from './panel/routes.js';
import {webhookRouter} from './webhook.js';
import {processJobs,recoverJobs,purgeJobs} from './jobs.js';
import {fileURLToPath} from 'node:url';
export function createApp() {
  const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
  app.get('/health',(_,res)=>res.json({ok:true,keys:poolSize(),database:config.tursoUrl?'turso':'local',uptime:Math.floor(process.uptime())}));
  app.get('/',(_,res)=>res.redirect('/panel/'));
  app.use('/webhook',express.raw({type:'application/json',limit:'1mb'}),webhookRouter);
  app.use('/panel',express.urlencoded({extended:false,limit:'100kb',parameterLimit:200}),panelRouter);
  app.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(err.status||500).send('Request could not be processed.');});return app;
}
export async function start() {
  for(const warning of bootWarnings())console.warn('[setup]',warning);
  await initDb();loadKeysFromEnv();await loadKeysFromDb();await recoverJobs();await purgeJobs();await purgeOldLogs();
  const app=createApp();const server=app.listen(config.port,()=>console.log('[server] Listening on port '+config.port));
  const tick=setInterval(()=>processJobs().catch(()=>console.error('[jobs] Processing failed')),750);tick.unref();
  const purge=setInterval(()=>Promise.all([purgeOldLogs(),purgeJobs()]).catch(()=>console.error('[jobs] Cleanup failed')),3600000);purge.unref();
  const stop=()=>{clearInterval(tick);clearInterval(purge);server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),20000).unref();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await start();

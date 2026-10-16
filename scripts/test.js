// Test runner (used by `npm run test:native`, `npm run test:libsql`, `npm run simulate`).
// Runs every test/*.test.js sequentially with NODE_ENV=test, blanked credentials and
// demo seeding disabled; each test file gets its own isolated temp SQLite database,
// which is removed afterwards. The `native`/`libsql` argv picks the database adapter
// the domain code runs through. LOCAL_CORE_ONLY=1 skips platform.test.js so the
// domain/migration tests can run when Express/XLSX can't be installed.
import {readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const adapter=process.argv[2]||'native',folder=mkdtempSync(join(tmpdir(),'schoolbot-tests-'));
if(!['native','libsql'].includes(adapter))throw new Error('Use native or libsql.');
const env={...process.env,NODE_ENV:'test',SKIP_DEMO_SEED:'1',DB_ADAPTER:adapter,TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:'',AI_KEYS_JSON:'[]',WHATSAPP_TOKEN:'',META_APP_SECRET:'integration-test-secret',META_VERIFY_TOKEN:'integration-verify-token',PANEL_SUPERADMIN_EMAIL:'',PANEL_SUPERADMIN_PASSWORD:''};
const tests=readdirSync('test').filter(f=>f.endsWith('.test.js')).filter(f=>process.env.LOCAL_CORE_ONLY!=='1'||f!=='platform.test.js');
let status=0;
try {for(const name of tests){console.log('\nTEST FILE:',name,'ADAPTER:',adapter);const r=spawnSync(process.execPath,['--test','--test-concurrency=1','test/'+name],{stdio:'inherit',env:{...env,TEST_DB_FILE:join(folder,name+'.db')}});if(r.status)status=r.status||1;}}
finally {rmSync(folder,{recursive:true,force:true});}
if(process.env.LOCAL_CORE_ONLY==='1')console.log('Core-only run: HTTP/XLSX package integration tests were not run.');
process.exit(status);

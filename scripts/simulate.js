// `npm run simulate` — core-only deterministic test run of the offline domain logic.
// Runs the test suite in LOCAL_CORE_ONLY=1 mode (native adapter): no Express/XLSX
// dependencies, no real AI or WhatsApp sends, same isolated temp databases as test.js.
import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['scripts/test.js','native'],{stdio:'inherit',env:{...process.env,LOCAL_CORE_ONLY:'1'}});
process.exit(result.status||0);

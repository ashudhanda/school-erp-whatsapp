// npm run check — syntax-check every .js file under src/, scripts/ and test/
// with `node --check`. Walks directories recursively, exits non-zero on the first
// syntax error (so CI fails fast), and prints how many files passed.
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);}
const files=['src','scripts','test'].flatMap(walk).filter(f=>f.endsWith('.js'));
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status)process.exit(r.status);}
console.log('Syntax passed:',files.length,'JavaScript files');

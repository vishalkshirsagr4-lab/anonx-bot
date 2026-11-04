import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function javascriptFiles(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...javascriptFiles(path));
    else if (name.endsWith('.js')) files.push(path);
  }
  return files;
}

const files = ['src', 'test'].flatMap(javascriptFiles);
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error) {
    console.error('Could not check ' + file + ': ' + result.error.message);
    failed = true;
  } else if (result.status !== 0) {
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('JavaScript syntax checks passed for ' + files.length + ' files.');

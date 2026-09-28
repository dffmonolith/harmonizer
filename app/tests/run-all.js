// run-all.js -- runs the whole standing test suite: the dependency-free logic tests always,
// and the browser smoke test too if Playwright happens to be installed.
//
//   node tests/run-all.js                       tests whatever current.txt points at
//   node tests/run-all.js harmonizer-2.9.html    tests a specific file
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const arg = process.argv[2];
const args = arg ? [arg] : [];

function run(script){
  console.log('\n' + '='.repeat(70));
  console.log('Running ' + script);
  console.log('='.repeat(70));
  const res = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { stdio: 'inherit' });
  return res.status === 0;
}

const logicOk = run('logic.test.js');
const e2eOk = run('e2e.test.js'); // prints SKIP and exits 0 on its own if playwright isn't installed

console.log('\n' + '='.repeat(70));
console.log(logicOk ? 'logic.test.js: PASS' : 'logic.test.js: FAIL');
console.log(e2eOk ? 'e2e.test.js:   PASS (or skipped)' : 'e2e.test.js:   FAIL');
console.log('='.repeat(70));

process.exitCode = (logicOk && e2eOk) ? 0 : 1;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}
const sourceFiles = ['server.js', 'db', 'lib', 'routes', 'public'].flatMap((name) => {
  const file = path.join(root, name);
  return fs.statSync(file).isDirectory() ? filesIn(file) : [file];
});

test('all JavaScript files parse and all relative requires resolve', () => {
  for (const file of sourceFiles.filter((name) => name.endsWith('.js'))) {
    const source = fs.readFileSync(file, 'utf8');
    new vm.Script(source, { filename: file });
    for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      assert.ok(require.resolve(path.resolve(path.dirname(file), match[1])), `${file}: ${match[1]}`);
    }
  }
});

test('every local HTML script, stylesheet and page link exists in public', () => {
  for (const file of sourceFiles.filter((name) => name.endsWith('.html'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:src|href)="(\/[^"?#]*)"/g)) {
      const target = match[1] === '/' ? '/index.html' : match[1];
      assert.ok(fs.existsSync(path.join(root, 'public', target)), `${file}: ${target}`);
    }
    assert.ok(!source.includes('<script>'), `${file} should use separate browser scripts`);
  }
});

test('root contains no misplaced browser or database source files', () => {
  const misplaced = fs.readdirSync(root).filter((name) =>
    /\.(html|css|sql|js)$/.test(name) && name !== 'server.js');
  assert.deepEqual(misplaced, []);
});

test('database init script and schema are in the same directory', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.scripts['db:init'], 'node db/init.js');
  assert.ok(fs.existsSync(path.join(root, 'db/schema.sql')));
});

test('Express serves all pages/assets without exposing server source', async () => {
  const express = require('express');
  const app = express();
  app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const file of sourceFiles.filter((name) => name.startsWith(path.join(root, 'public') + path.sep))) {
      const url = '/' + path.relative(path.join(root, 'public'), file).split(path.sep).join('/');
      const response = await fetch(base + url);
      assert.equal(response.status, 200, url);
      if (url.endsWith('.js')) assert.match(response.headers.get('content-type'), /javascript/);
    }
    assert.equal((await fetch(base + '/')).status, 200);
    for (const url of ['/server.js', '/db/schema.sql', '/lib/auth.js', '/routes/orders.js']) {
      assert.equal((await fetch(base + url)).status, 404, url);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

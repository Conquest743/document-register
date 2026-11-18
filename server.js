'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { realpathSync } = require('node:fs');
const engine = require('./engine');
const port = Number(process.env.PORT || 4193);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('PORT должен быть целым числом от 1024 до 65535.');
const origin = `http://127.0.0.1:${port}`;
const instance = createHash('sha256').update(realpathSync(__dirname)).digest('hex');
const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/fonts/Manrope.ttf': ['fonts/Manrope.ttf', 'font/ttf'], '/fonts/PTSerif-Regular.ttf': ['fonts/PTSerif-Regular.ttf', 'font/ttf'] };
const examples = ['invoice.txt', 'receipt.json', 'needs-review.txt'];
const walkthroughFile = 'demo-invoice.txt';
function json(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 2000000) { const error = Error('Запрос превышает 2 МБ. Выберите файл до 500 000 байт.'); error.status = 413; throw error; } chunks.push(chunk); }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { const error = Error('Некорректный JSON запроса.'); error.status = 400; throw error; }
  if (!result || typeof result !== 'object' || Array.isArray(result)) { const error = Error('Нужен объект данных.'); error.status = 400; throw error; }
  return result;
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (req.headers.host !== `127.0.0.1:${port}`) return json(res, 403, { error: 'Используйте адрес ' + origin });
  try {
    const url = new URL(req.url, origin), route = url.pathname;
    if (route === '/') res.setHeader('X-Portfolio-Instance', instance);
    if (req.method === 'GET' && assets[route]) { const [filename, type] = assets[route]; const content = await fs.readFile(path.join(__dirname, 'public', filename)); res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); return res.end(content); }
    if (req.method === 'GET' && route === '/api/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && route === '/api/state') return json(res, 200, engine.snapshot());
    if (req.method === 'GET' && route.startsWith('/examples/')) {
      const filename = route.slice('/examples/'.length);
      if (filename !== walkthroughFile && !examples.includes(filename)) return json(res, 404, { error: 'Пример не найден.' });
      const content = await fs.readFile(path.join(__dirname, 'examples', filename));
      const type = filename.endsWith('.json') ? 'application/json' : 'text/plain';
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` });
      return res.end(content);
    }
    if (req.method === 'GET' && route === '/api/export') {
      const rows = [['Файл', 'Поставщик', 'Номер', 'Дата', 'Сумма, RUB', 'Статус', 'Пример'], ...engine.snapshot().documents.map(document => [document.filename, document.fields.supplier, document.fields.number, document.fields.date, document.fields.total, document.status === 'ready' ? 'Проверен' : 'На проверке', document.demo ? 'Да' : 'Нет'])];
      const cell = value => '"' + String(value ?? '').replace(/^[\s]*[=+@-]/, "'$&").replace(/"/g, '""') + '"';
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="documents.csv"' });
      return res.end('\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n'));
    }
    if (req.method !== 'POST') return json(res, 404, { error: 'Страница не найдена.' });
    if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'Запрос разрешён только из интерфейса приложения.' });
    const input = await body(req);
    if (route === '/api/documents') return json(res, 200, engine.addDocument(input));
    if (route === '/api/demo-invoice') {
      const text = await fs.readFile(path.join(__dirname, 'examples', walkthroughFile), 'utf8');
      return json(res, 200, engine.addDocument({ filename: walkthroughFile, text, demo: true }));
    }
    if (/^\/api\/documents\/[\w-]+$/.test(route)) return json(res, 200, engine.reviewDocument(route.split('/').at(-1), input));
    if (route === '/api/demo') {
      const results = [];
      for (const filename of examples) results.push(engine.addDocument({ filename, text: await fs.readFile(path.join(__dirname, 'examples', filename), 'utf8'), demo: true }));
      return json(res, 200, { added: results.filter(result => !result.duplicate).length, documents: results.map(result => result.item) });
    }
    return json(res, 404, { error: 'Действие не найдено.' });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ${error.status || 500}: ${error.message}`);
    return json(res, error.status || 500, { error: error.status ? error.message : 'Не удалось сохранить документ. Проверьте доступ к папке data и свободное место на диске.' });
  }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Порт ${port} занят. Откройте ${origin} или задайте другой PORT.` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`Реестр документов: ${origin}\nОстановка: Ctrl+C`);
  if (process.platform === 'win32' && process.argv.includes('--open')) execFile('cmd.exe', ['/c', 'start', '""', origin], { windowsHide: true }, error => { if (error) console.log('Откройте адрес вручную: ' + origin); });
});

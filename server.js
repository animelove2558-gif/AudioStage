// Zero-dependency static server so AudioStage can run in any modern browser: `node server.js`
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'app'), port = +process.env.PORT || 5173;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p; try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end('Bad request'); } // (a lone % is not a crash)
  if (p.includes('\x00')) { res.writeHead(400); return res.end('Bad request'); }
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(root, p));
  if (f !== root && !f.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(data);
  });
});
server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Start with another one:  set PORT=5174 && node server.js` : 'Server error: ' + e.message); process.exit(1); });
server.listen(port, '127.0.0.1', () => console.log(`AudioStage running at http://localhost:${port}`));

// A slow local download server for the app tests (Install VST Support… → Cancel): every file trickles out at ~50 KB/s,
// so the app always has time to show progress and cancel. Prints its port, runs until killed.
const http = require('http');
const s = http.createServer((req, res) => {
  if (req.url === '/gone') { res.writeHead(404); res.end(); return; }
  const n = 4 * 1048576; let i = 0; res.writeHead(200, { 'Content-Length': n });
  const t = setInterval(() => { if (res.destroyed || i >= n) { clearInterval(t); res.end(); return; } res.write(Buffer.alloc(5000)); i += 5000; }, 100);
  res.on('close', () => clearInterval(t));
});
s.listen(0, '127.0.0.1', () => console.log(s.address().port));

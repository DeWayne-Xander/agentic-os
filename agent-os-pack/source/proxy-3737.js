#!/usr/bin/env node
const http = require('http');
const target = 'http://127.0.0.1:3001';
const PORT = 3737;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, target);
  const r = http.request(u, {
    method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:3001', connection: 'close' }
  }, (ur) => {
    res.writeHead(ur.statusCode || 502, ur.headers);
    ur.pipe(res);
  });
  r.on('error', (e) => { res.statusCode = 502; res.end(JSON.stringify({ error: String(e) })); });
  req.pipe(r);
});

server.on('upgrade', (req, socket, head) => {
  const net = require('net');
  const us = net.connect(3001, '127.0.0.1', () => {
    us.write(`${req.method} ${req.url} HTTP/1.1\r\n`);
    for (const [k, v] of Object.entries(req.headers)) us.write(`${k}: ${v}\r\n`);
    us.write('\r\n');
    if (head?.length) us.write(head);
    socket.pipe(us).pipe(socket);
  });
  us.on('error', () => socket.destroy());
});

server.listen(PORT, '0.0.0.0', () => console.log(`Proxy :${PORT} → ${target}`));

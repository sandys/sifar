const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const root = path.join(__dirname, 'fixtures');
const filePath = path.join(root, 'trezor-test.html');

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath !== '/' && urlPath !== '/trezor-test.html') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  fs.readFile(filePath, 'utf8', (err, contents) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Failed to read fixture');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(contents);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Fixture server running at http://localhost:${PORT}`);
});

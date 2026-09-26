import {createServer} from "node:http";

const port = Number(process.env.WEB_PORT ?? 3000);
const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Adaptive Platform</title></head><body><main>
<h1>Adaptive Platform</h1><p>Portal foundation is running.</p>
</main></body></html>`;

createServer((_req, res) => {
  res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});
  res.end(html);
}).listen(port, () => console.log(`Adaptive Web listening on http://localhost:${port}`));

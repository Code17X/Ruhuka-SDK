import {createServer} from "node:http";
import {loadConfig} from "@adaptive/config";
import {AiOrchestrator, MockAiProvider} from "@adaptive/ai";

const config = loadConfig();
const ai = new AiOrchestrator(new MockAiProvider());

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({status:"ok", service:"api"}));
    return;
  }

  if (req.method === "POST" && req.url === "/v1/ai/sessions/demo/messages") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const result = await ai.generate({
          role: "client",
          messages: [{role:"user", content:String(parsed.message ?? "")}]
        });
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({error:"invalid_request"}));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({error:"not_found"}));
});

server.listen(config.apiPort, () => {
  console.log(`Adaptive API listening on http://localhost:${config.apiPort}`);
});

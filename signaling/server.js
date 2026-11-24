const http = require("node:http");
const { WebSocketServer, WebSocket } = require("ws");

const server = http.createServer((req,res) => {
  res.writeHead(200, {"content-type":"text/plain"});
  res.end("GG Transfer signaling service\n");
});
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const rooms = new Map();
const joins = new Map();

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws,{type:"error",message:"Invalid message"}); }
    if (msg.type === "join") {
      const room = String(msg.room || "").toUpperCase();
      if (!/^[A-F0-9]{8}$/.test(room) || !["sender","receiver"].includes(msg.role))
        return send(ws,{type:"error",message:"Invalid room or role"});
      const count = (joins.get(ws) || 0) + 1; joins.set(ws,count);
      if (count > 1) return send(ws,{type:"error",message:"Already joined"});
      let entry = rooms.get(room);
      if (!entry) { entry = {}; rooms.set(room,entry); }
      if (entry[msg.role]) return send(ws,{type:"error",message:"That role is already occupied"});
      entry[msg.role] = ws; ws.room = room; ws.role = msg.role;
      send(ws,{type:"joined"});
      const other = entry[msg.role === "sender" ? "receiver" : "sender"];
      if (other) { send(other,{type:"peer-ready"}); send(ws,{type:"peer-ready"}); }
      return;
    }
    if (!ws.room || !["description","candidate","peer-ready"].includes(msg.type)) return;
    const entry = rooms.get(ws.room);
    const other = entry?.[ws.role === "sender" ? "receiver" : "sender"];
    if (other) send(other,msg);
  });
  ws.on("close", () => {
    if (!ws.room) return;
    const entry = rooms.get(ws.room);
    if (entry?.[ws.role] === ws) delete entry[ws.role];
    const other = entry?.[ws.role === "sender" ? "receiver" : "sender"];
    if (other) send(other,{type:"peer-left"});
    if (entry && !entry.sender && !entry.receiver) rooms.delete(ws.room);
  });
});
const port = process.env.PORT || 8080;
server.listen(port, "0.0.0.0", () => console.log(`GG Transfer signaling listening on ${port}`));

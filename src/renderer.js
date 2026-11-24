const $ = (id) => document.getElementById(id);
const CHUNK = 64 * 1024;
let ws, pc, channel, role, files = [], received = [], active = false, startedAt = 0, sentBytes = 0;
const iceServers = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];

function setStatus(message, tag = "CONECTANDO") {
  $("status").textContent = message; $("stateTag").textContent = tag;
}
function setProgress(value, speed = "—") {
  const pct = Math.max(0, Math.min(100, value));
  $("progressBar").style.width = pct + "%"; $("progressText").textContent = Math.round(pct) + "%"; $("speedText").textContent = speed;
}
function showError(err) { setStatus(err?.message || String(err), "ERROR"); }
function reset() {
  active = false;
  try { channel?.close(); pc?.close(); ws?.close(); } catch {}
  channel = pc = ws = null;
  $("cancelBtn").disabled = true;
}
function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map(x => x.toString(16).padStart(2,"0")).join("").toUpperCase().match(/.{1,4}/g).join("-");
}
function sendSignal(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("El servidor de conexión no está disponible.");
  ws.send(JSON.stringify(data));
}
function connectSignal(code, currentRole) {
  const url = $("signalUrl").value.trim();
  if (!url.startsWith("wss://") && !url.startsWith("ws://localhost")) throw new Error("Configura una URL wss:// válida del servidor de señalización.");
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("Tiempo agotado al conectar con el servidor.")), 12000);
    ws.onopen = () => { clearTimeout(timer); sendSignal({ type:"join", room:code.replace("-",""), role:currentRole }); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("No se pudo conectar al servidor de señalización.")); };
    ws.onmessage = async (event) => {
      try { await onSignal(JSON.parse(event.data)); } catch(e) { showError(e); }
    };
    ws.onclose = () => { if (active) setStatus("Conexión de señalización cerrada", "DESCONECTADO"); };
  });
}
function createPeer() {
  pc = new RTCPeerConnection({ iceServers });
  pc.onicecandidate = e => { if (e.candidate) sendSignal({ type:"candidate", candidate:e.candidate }); };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === "connected") { setStatus("Conexión P2P establecida", "CONECTADO"); $("cancelBtn").disabled = false; }
    if (s === "failed") setStatus("No se pudo establecer P2P. Esta red podría requerir TURN.", "ERROR");
    if (s === "disconnected") setStatus("Conexión interrumpida", "DESCONECTADO");
  };
}
function setupChannel(ch) {
  channel = ch; channel.binaryType = "arraybuffer";
  channel.onopen = () => {
    active = true; startedAt = Date.now(); setStatus("Conectado directamente. Listo para transferir.", "CONECTADO");
    $("cancelBtn").disabled = false;
    if (role === "sender") beginSend();
  };
  channel.onmessage = e => receiveMessage(e.data);
  channel.onclose = () => setStatus("Canal de transferencia cerrado", "DESCONECTADO");
}
async function onSignal(msg) {
  if (msg.type === "peer-ready" && role === "sender") {
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    sendSignal({ type:"description", description:pc.localDescription });
  } else if (msg.type === "description") {
    await pc.setRemoteDescription(msg.description);
    if (role === "receiver") {
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      sendSignal({ type:"description", description:pc.localDescription });
    }
  } else if (msg.type === "candidate" && msg.candidate) {
    try { await pc.addIceCandidate(msg.candidate); } catch {}
  } else if (msg.type === "peer-left") {
    setStatus("La otra computadora se desconectó", "DESCONECTADO");
  } else if (msg.type === "error") throw new Error(msg.message);
}
async function beginSend() {
  if (!files.length) return;
  const manifest = files.map(f => ({ name:f.name, size:f.size, type:f.type || "application/octet-stream" }));
  channel.send(JSON.stringify({ kind:"manifest", files:manifest }));
  sentBytes = 0;
  const total = files.reduce((n,f)=>n+f.size,0);
  for (let index=0; index<files.length; index++) {
    const file = files[index];
    channel.send(JSON.stringify({ kind:"file-start", index }));
    for (let offset=0; offset<file.size; offset+=CHUNK) {
      while (channel.bufferedAmount > 4 * 1024 * 1024) await new Promise(r=>setTimeout(r,30));
      const chunk = await file.slice(offset, offset+CHUNK).arrayBuffer();
      channel.send(chunk); sentBytes += chunk.byteLength;
      const elapsed = Math.max(0.1,(Date.now()-startedAt)/1000);
      setProgress(total ? sentBytes/total*100 : 100, (sentBytes/elapsed/1024/1024).toFixed(2)+" MB/s");
    }
    channel.send(JSON.stringify({ kind:"file-end", index }));
  }
  channel.send(JSON.stringify({ kind:"transfer-end" }));
  setProgress(100); setStatus("Envío completado", "COMPLETADO");
}
let currentFile = null, currentChunks = [], manifest = [];
function receiveMessage(data) {
  if (typeof data === "string") {
    const msg = JSON.parse(data);
    if (msg.kind === "manifest") {
      manifest = msg.files; received = new Array(manifest.length); $("fileList").innerHTML = manifest.map(f=>`<div>• ${escapeHtml(f.name)} — ${formatBytes(f.size)}</div>`).join("");
    } else if (msg.kind === "file-start") {
      currentFile = msg.index; currentChunks = [];
    } else if (msg.kind === "file-end") {
      received[currentFile] = new Blob(currentChunks, { type:manifest[currentFile].type }); currentChunks = [];
      const f = manifest[currentFile]; const a = document.createElement("a");
      a.href = URL.createObjectURL(received[currentFile]); a.download = f.name; a.textContent = "Guardar " + f.name;
      a.style.cssText = "display:block;color:#78b8ff;margin-top:8px";
      $("fileList").appendChild(a);
    } else if (msg.kind === "transfer-end") {
      setProgress(100); setStatus("Recepción completada. Haz clic en cada archivo para guardarlo.", "COMPLETADO");
    }
  } else {
    currentChunks.push(data);
    const total = manifest.reduce((n,f)=>n+f.size,0);
    const got = received.reduce((n,b)=>n+(b?.size||0),0) + currentChunks.reduce((n,b)=>n+b.byteLength,0);
    setProgress(total ? got/total*100 : 0);
  }
}
function formatBytes(n){return n<1024?n+" B":n<1048576?(n/1024).toFixed(1)+" KB":(n/1048576).toFixed(1)+" MB";}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

$("createBtn").onclick = async () => {
  try {
    files = [...$("fileInput").files];
    if (!files.length) throw new Error("Selecciona al menos un archivo antes de crear el código.");
    reset(); role="sender"; const code=makeCode();
    $("senderCode").textContent=code; $("senderCode").classList.remove("hidden");
    setStatus("Esperando que la otra computadora se conecte…", "ESPERANDO");
    createPeer(); setupChannel(pc.createDataChannel("gg-transfer", { ordered:true }));
    await connectSignal(code, role);
    $("cancelBtn").disabled=false;
  } catch(e){showError(e);}
};
$("joinBtn").onclick = async () => {
  try {
    const code=$("joinCode").value.trim().toUpperCase();
    if(!/^[A-F0-9]{4}-[A-F0-9]{4}$/.test(code)) throw new Error("Introduce un código válido de 8 caracteres.");
    reset(); role="receiver"; setStatus("Buscando al emisor…","CONECTANDO"); createPeer();
    pc.ondatachannel=e=>setupChannel(e.channel);
    await connectSignal(code, role);
    sendSignal({type:"peer-ready"}); $("cancelBtn").disabled=false;
  } catch(e){showError(e);}
};
$("cancelBtn").onclick=()=>{reset();setStatus("Conexión cancelada","DESCONECTADO");setProgress(0);};

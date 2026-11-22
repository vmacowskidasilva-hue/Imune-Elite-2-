"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const WA_TOKEN = process.env.WHATSAPP_TOKEN || "";
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WA_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "elite_verify_token";
const WA_APP_SECRET = process.env.WHATSAPP_APP_SECRET || "";
const WA_API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";

function isWaConfigured() {
  return Boolean(WA_TOKEN && WA_PHONE_ID);
}

const clientsByNumber = new Map();

function sendWsFrame(socket, payloadObj) {
  if (socket.destroyed) return;
  const data = Buffer.from(JSON.stringify(payloadObj), "utf8");
  const len = data.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, data]));
}

function broadcastAll(payloadObj) {
  for (const c of clientsByNumber.values()) sendWsFrame(c.socket, payloadObj);
}

function broadcastPeers() {
  broadcastAll({ type: "peers", peers: Array.from(clientsByNumber.values()).map((c) => c.user) });
}

function parseWsFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const byte1 = buffer[offset];
    const byte2 = buffer[offset + 1];
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) !== 0;
    let payloadLen = byte2 & 0x7f;
    let cursor = offset + 2;
    if (payloadLen === 126) {
      if (cursor + 2 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (payloadLen === 127) {
      if (cursor + 8 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const maskLen = masked ? 4 : 0;
    if (cursor + maskLen + payloadLen > buffer.length) break;
    let payload = buffer.subarray(cursor + maskLen, cursor + maskLen + payloadLen);
    if (masked) {
      const mask = buffer.subarray(cursor, cursor + 4);
      const unmasked = Buffer.allocUnsafe(payloadLen);
      for (let i = 0; i < payloadLen; i++) unmasked[i] = payload[i] ^ mask[i % 4];
      payload = unmasked;
    }
    frames.push({ opcode, payload });
    offset = cursor + maskLen + payloadLen;
  }
  return { frames, remaining: buffer.subarray(offset) };
}

function readRawBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) { reject(new Error("Payload too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function verifyWebhookSignature(rawBody, sigHeader) {
  if (!WA_APP_SECRET) return true;
  if (!sigHeader || !sigHeader.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", WA_APP_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sigHeader, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handleWaSend(req, res) {
  if (!isWaConfigured()) {
    return sendJson(res, 400, { ok: false, code: "whatsapp_not_configured", error: "Configure WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID no server.js." });
  }
  let body;
  try { body = JSON.parse((await readRawBody(req)).toString("utf8")); }
  catch { return sendJson(res, 400, { ok: false, error: "JSON inválido." }); }

  const to = String(body.to || "").replace(/\D/g, "");
  const text = String(body.text || "").trim();
  const templateName = body.templateName ? String(body.templateName).trim() : "";
  const templateLang = body.templateLang ? String(body.templateLang).trim() : "en_US";
  if (!to || (!text && !templateName)) return sendJson(res, 400, { ok: false, error: "Informe 'to' e 'text' ou 'templateName'." });

  const payload = templateName
    ? { messaging_product: "whatsapp", to, type: "template", template: { name: templateName, language: { code: templateLang } } }
    : { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: true, body: text } };

  try {
    const apiRes = await fetch(`https://graph.facebook.com/${WA_API_VERSION}/${encodeURIComponent(WA_PHONE_ID)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await apiRes.json().catch(() => ({}));
    if (!apiRes.ok) return sendJson(res, apiRes.status, { ok: false, code: "meta_api_error", error: data.error?.message || "Erro na API da Meta.", details: data });
    return sendJson(res, 200, { ok: true, messageId: data.messages?.[0]?.id || null, waId: data.contacts?.[0]?.wa_id || to });
  } catch (err) {
    return sendJson(res, 502, { ok: false, error: "Falha de rede: " + err.message });
  }
}

async function handleWaWebhookPost(req, res) {
  let raw;
  try { raw = await readRawBody(req); } catch { res.writeHead(413); res.end("Payload too large"); return; }
  if (!verifyWebhookSignature(raw, req.headers["x-hub-signature-256"])) { res.writeHead(401); res.end("Invalid signature"); return; }

  let data;
  try { data = JSON.parse(raw.toString("utf8")); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }

  for (const entry of data.entry || []) {
    for (const change of entry.changes || []) {
      const val = change.value || {};
      const contactsMap = new Map((val.contacts || []).map((c) => [c.wa_id, c.profile?.name || c.wa_id]));
      for (const m of val.messages || []) {
        const from = String(m.from || "").replace(/\D/g, "");
        if (!from) continue;
        const text = m.type === "text" ? (m.text?.body || "") : `[Mensagem WhatsApp: ${m.type || "mídia"}]`;
        broadcastAll({ type: "whatsapp-inbound", from, senderName: contactsMap.get(m.from) || from, waMessageId: m.id, text, ts: m.timestamp ? Number(m.timestamp) * 1000 : Date.now() });
      }
      for (const st of val.statuses || []) {
        const to = String(st.recipient_id || "").replace(/\D/g, "");
        if (to) broadcastAll({ type: "whatsapp-status", to, waMessageId: st.id, status: st.status });
      }
    }
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("EVENT_RECEIVED");
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const reqPath = parsedUrl.pathname;

  if (reqPath === "/api/whatsapp/status" && req.method === "GET") {
    return sendJson(res, 200, { configured: isWaConfigured(), phoneNumberIdConfigured: Boolean(WA_PHONE_ID), apiVersion: WA_API_VERSION, webhookPath: "/webhook/whatsapp" });
  }
  if (reqPath === "/api/whatsapp/send" && req.method === "POST") return handleWaSend(req, res);
  if (reqPath === "/webhook/whatsapp" && req.method === "GET") {
    if (parsedUrl.searchParams.get("hub.mode") === "subscribe" && parsedUrl.searchParams.get("hub.verify_token") === WA_VERIFY_TOKEN) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(parsedUrl.searchParams.get("hub.challenge") || "");
      return;
    }
    res.writeHead(403); res.end("Forbidden"); return;
  }
  if (reqPath === "/webhook/whatsapp" && req.method === "POST") return handleWaWebhookPost(req, res);

  const relPath = reqPath === "/" ? "/index.html" : reqPath;
  const fullPath = path.normalize(path.join(ROOT, relPath));
  if (!fullPath.startsWith(ROOT)) { res.writeHead(403); res.end("Forbidden"); return; }

  fs.readFile(fullPath, (err, content) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fullPath)] || "application/octet-stream" });
    res.end(content);
  });
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "", ""].join("\r\n"));

  let registeredNumber = null;
  let rxBuffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    rxBuffer = Buffer.concat([rxBuffer, chunk]);
    const { frames, remaining } = parseWsFrames(rxBuffer);
    rxBuffer = remaining;

    for (const f of frames) {
      if (f.opcode === 0x8) { socket.end(); return; }
      if (f.opcode === 0x9) { socket.write(Buffer.from([0x8a, 0x00])); continue; }
      if (f.opcode !== 0x1) continue;
      let msg;
      try { msg = JSON.parse(f.payload.toString("utf8")); } catch { continue; }

      if (msg.type === "register" && msg.user?.number) {
        registeredNumber = msg.user.number;
        clientsByNumber.set(registeredNumber, { socket, user: msg.user });
        broadcastPeers();
        continue;
      }
      if (msg.type === "status-post") {
        broadcastAll(msg);
        continue;
      }
      if (msg.to && clientsByNumber.has(msg.to)) {
        sendWsFrame(clientsByNumber.get(msg.to).socket, msg);
      }
    }
  });

  const cleanup = () => {
    if (registeredNumber && clientsByNumber.get(registeredNumber)?.socket === socket) {
      clientsByNumber.delete(registeredNumber);
      broadcastPeers();
    }
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`WhatsApp Web IMUNE ELITE ativo em http://localhost:${PORT} (WhatsApp Cloud API: ${isWaConfigured() ? "CONFIGURADA" : "não configurada"})`);
});

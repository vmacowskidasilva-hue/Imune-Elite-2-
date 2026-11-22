(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function waIcon(name, cls = "") {
    const className = cls ? `wa-ic ${cls}` : "wa-ic";
    return `<svg class="${className}" aria-hidden="true"><use href="#ic-${name}"></use></svg>`;
  }

  function renderTickIcon(status) {
    if (status === "pending") return waIcon("pending-clock", "wa-ic-tick");
    if (status === "read" || status === "delivered") return waIcon("received-tick", "wa-ic-tick");
    return waIcon("sent-tick", "wa-ic-tick");
  }

  // ---------- Helpers ----------
  function normalizeNumber(raw) {
    return String(raw || "").replace(/\D/g, "");
  }

  function formatNumber(raw) {
    const d = normalizeNumber(raw);
    if (!d) return "";
    if (d.length === 13 && d.startsWith("55")) {
      return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
    }
    if (d.length === 11) {
      return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    }
    return `+${d}`;
  }

  function getInitials(name, fallback = "WA") {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return fallback;
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDuration(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function linkify(text) {
    return escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  // ---------- Defensive Imune Analyzers ----------
  function inspectHeavyPayload(text) {
    const raw = String(text || "");
    const zeroWidthCount = (raw.match(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g) || []).length;
    const combiningRuns = (raw.match(/[\u0300-\u036F]{4,}/g) || []).length;
    const isOversized = raw.length > 3500;
    const isFloodChars = zeroWidthCount > 25 || combiningRuns > 5;

    if (!isOversized && !isFloodChars) {
      return { blocked: false, safeText: raw, reason: null };
    }
    const cleaned = raw.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "").slice(0, 420);
    const reason = isOversized
      ? `Texto gigante (${raw.length} chars) neutralizado pelo Anti-Trava`
      : `Excesso de caracteres invisíveis/combinados Unicode (${zeroWidthCount} zero-width, ${combiningRuns} sequências Zalgo)`;
    return { blocked: true, safeText: cleaned, reason };
  }

  function detectSuspiciousLinks(text) {
    const urls = String(text || "").match(/https?:\/\/[^\s<>"']+/gi) || [];
    const warnings = [];
    for (const u of urls) {
      try {
        const host = new URL(u).hostname;
        if (host.includes("xn--") || /[^\x00-\x7F]/.test(host)) {
          warnings.push(`Domínio suspeito/homógrafo detectado (${host}).`);
        }
      } catch {}
    }
    return warnings;
  }

  // ---------- Synthetic Audio Tones ----------
  class ToneEngine {
    constructor() {
      this.ctx = null;
      this.timer = null;
    }
    ensureCtx() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    playBeep(freq, durationMs, gainVal = 0.07) {
      const ctx = this.ensureCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000);
    }
    startRingback() {
      this.stop();
      const pulse = () => this.playBeep(440, 700, 0.05);
      pulse();
      this.timer = setInterval(pulse, 2500);
    }
    startIncomingRing() {
      this.stop();
      const ring = () => {
        this.playBeep(680, 210, 0.08);
        setTimeout(() => this.playBeep(910, 240, 0.08), 230);
      };
      ring();
      this.timer = setInterval(ring, 1750);
    }
    playDtmf(key) {
      const map = { "1": 697, "2": 730, "3": 770, "4": 810, "5": 852, "6": 900, "7": 941, "8": 990, "9": 1040, "*": 640, "0": 1100, "#": 1200 };
      this.playBeep(map[key] || 760, 85, 0.05);
    }
    stop() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
  }
  const tones = new ToneEngine();

  // ---------- App State ----------
  const DEMO_SUPPORT = "5511900000001";
  const DEMO_GUARD = "5511900000002";

  const state = {
    me: null,
    contacts: {},
    chats: {},
    unread: {},
    callHistory: [],
    statuses: [],
    imuneLog: [],
    scheduled: [],
    settings: {
      antiTrava: true,
      antiFlood: true,
      antiDelete: true,
      antiEdit: true,
      antiLink: true,
      hideRead: false,
      hideTyping: false,
      hideRecording: false,
      autoReply: false,
      autoReplyMatch: "",
      autoReplyText: "Olá! Recebi sua mensagem no WhatsApp Web IMUNE ELITE, respondo já.",
      pin: "",
      dnd: false
    },
    onlinePeers: new Map(),
    floodTracker: new Map(),
    activeChatNumber: null,
    activeTab: "chats",
    chatFilter: "all",
    searchQuery: "",
    inChatSearch: "",
    replyTo: null,
    editingMessageId: null,
    typingFrom: new Set(),
    call: null,
    recorder: null,
    recordedChunks: [],
    waCloudConfigured: false,
    waModeByChat: {}
  };

  function storageKey() {
    return state.me ? `imune_elite_v1_${state.me.number}` : null;
  }

  function saveState() {
    const k = storageKey();
    if (!k) return;
    try {
      localStorage.setItem(k, JSON.stringify({
        contacts: state.contacts,
        chats: state.chats,
        unread: state.unread,
        callHistory: state.callHistory.slice(0, 60),
        statuses: state.statuses.slice(0, 30),
        imuneLog: state.imuneLog.slice(0, 50),
        settings: state.settings,
        waModeByChat: state.waModeByChat
      }));
    } catch {}
  }

  function loadState() {
    const k = storageKey();
    if (!k) return;
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const p = JSON.parse(raw);
        state.contacts = p.contacts || {};
        state.chats = p.chats || {};
        state.unread = p.unread || {};
        state.callHistory = p.callHistory || [];
        state.statuses = p.statuses || [];
        state.imuneLog = p.imuneLog || [];
        state.settings = { ...state.settings, ...(p.settings || {}) };
        state.waModeByChat = p.waModeByChat || {};
      }
    } catch {}

    ensureContact(DEMO_SUPPORT, "IMUNE ELITE Oficial", { demo: true, verified: true, favorite: true, status: "Escudo & Suporte" });
    ensureContact(DEMO_GUARD, "Ana Clara", { demo: true, status: "Contato de demonstração" });

    if (!state.chats[DEMO_SUPPORT] || !state.chats[DEMO_SUPPORT].length) {
      state.chats[DEMO_SUPPORT] = [
        {
          id: uid(),
          from: DEMO_SUPPORT,
          to: state.me.number,
          text: `Bem-vindo ao WhatsApp Web IMUNE ELITE, ${state.me.name}! Seu número ativo é ${state.me.displayNumber}.`,
          ts: Date.now() - 120000,
          status: "read",
          reactions: {}
        },
        {
          id: uid(),
          from: DEMO_SUPPORT,
          to: state.me.number,
          text: "Interface estilo WhatsApp Web com os ícones oficiais do WhatsApp Desktop + Anti-Trava, Anti-Delete, Anti-Edit, Privacidade Fantasma, PIN, Status e Ligações WebRTC!",
          ts: Date.now() - 60000,
          status: "read",
          reactions: {}
        }
      ];
    }
    if (!state.chats[DEMO_GUARD] || !state.chats[DEMO_GUARD].length) {
      state.chats[DEMO_GUARD] = [
        {
          id: uid(),
          from: DEMO_GUARD,
          to: state.me.number,
          text: "Oi! Me envie uma mensagem ou abra outra aba com outro número para testar Anti-Delete, Anti-Trava e ligações.",
          ts: Date.now() - 240000,
          status: "read",
          reactions: {}
        }
      ];
    }
    if (!state.statuses.length) {
      state.statuses.push({
        id: uid(),
        author: "IMUNE ELITE Oficial",
        number: DEMO_SUPPORT,
        text: "WhatsApp Web IMUNE ELITE • Escudo Anti-Trava & Anti-Delete operando em 100%",
        bg: "#144d37",
        ts: Date.now() - 180000
      });
    }

    syncSettingsUI();
    saveState();
  }

  function ensureContact(rawNumber, nameHint = "", extra = {}) {
    const num = normalizeNumber(rawNumber);
    if (!num) return null;
    const existing = state.contacts[num];
    if (existing) {
      if (nameHint && existing.name === existing.displayNumber) existing.name = nameHint;
      Object.assign(existing, extra);
      return existing;
    }
    const created = {
      number: num,
      displayNumber: formatNumber(num),
      name: nameHint || formatNumber(num),
      status: extra.status || "offline",
      favorite: Boolean(extra.favorite),
      archived: Boolean(extra.archived),
      blocked: Boolean(extra.blocked),
      verified: Boolean(extra.verified),
      notes: extra.notes || "",
      demo: Boolean(extra.demo)
    };
    state.contacts[num] = created;
    return created;
  }

  function logImuneEvent(kind, detail) {
    state.imuneLog.unshift({ id: uid(), kind, detail, ts: Date.now() });
    if (state.imuneLog.length > 50) state.imuneLog.length = 50;
    const badge = $("#blockedCounterBadge");
    badge.textContent = String(state.imuneLog.length);
    badge.classList.remove("hidden");
    saveState();
    renderImuneLog();
  }

  function showToast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    $("#toastContainer").appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  const REMOTE_SERVER_URL = (() => {
    try {
      const p = new URLSearchParams(location.search).get("server");
      return p ? p.replace(/\/+$/, "") : "";
    } catch {
      return "";
    }
  })();
  const IS_STATIC_HOST = !REMOTE_SERVER_URL && /\.(github\.io|pages\.dev|netlify\.app)$/i.test(location.hostname);

  // ---------- Dual Transport (WebSocket + BroadcastChannel) ----------
  class SignalTransport {
    constructor(onEvent) {
      this.onEvent = onEvent;
      this.ws = null;
      this.wsConnected = false;
      this.bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("imune_elite_signal_v1") : null;
      this.tabId = uid();
      if (this.bc) {
        this.bc.onmessage = (ev) => {
          if (ev.data && ev.data.senderTabId !== this.tabId) this.onEvent(ev.data);
        };
      }
    }

    connect(user) {
      this.user = user;
      this.updateIndicator();
      const canUseWs = !IS_STATIC_HOST && (REMOTE_SERVER_URL || location.protocol === "http:" || location.protocol === "https:");
      if (canUseWs) {
        const wsUrl = REMOTE_SERVER_URL
          ? REMOTE_SERVER_URL.replace(/^http/i, "ws")
          : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
        try {
          const ws = new WebSocket(wsUrl);
          this.ws = ws;
          ws.onopen = () => {
            this.wsConnected = true;
            this.updateIndicator();
            ws.send(JSON.stringify({ type: "register", user }));
          };
          ws.onmessage = (ev) => {
            try { this.onEvent(JSON.parse(ev.data)); } catch {}
          };
          ws.onclose = () => { this.wsConnected = false; this.updateIndicator(); };
          ws.onerror = () => { this.wsConnected = false; this.updateIndicator(); };
        } catch {}
      }
      if (this.bc) {
        this.broadcastLocal({ type: "presence-hello", user });
        window.addEventListener("beforeunload", () => {
          this.broadcastLocal({ type: "presence-bye", number: user.number });
        });
      }
    }

    updateIndicator() {
      const dot = $("#connectionDot");
      const label = $("#transportLabel");
      if (this.wsConnected) {
        dot.classList.remove("offline");
        label.textContent = "Servidor";
      } else {
        dot.classList.add("offline");
        label.textContent = this.bc ? "Multi-Aba" : "Offline";
      }
    }

    broadcastLocal(payload) {
      if (this.bc) this.bc.postMessage({ ...payload, senderTabId: this.tabId });
    }

    send(payload) {
      if (state.settings.dnd) return;
      if (this.wsConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(payload));
      } else {
        this.broadcastLocal(payload);
      }
    }
  }

  const transport = new SignalTransport(handleSignalEvent);

  function checkFlood(from) {
    if (!state.settings.antiFlood) return false;
    const now = Date.now();
    const list = (state.floodTracker.get(from) || []).filter((t) => now - t < 3500);
    list.push(now);
    state.floodTracker.set(from, list);
    return list.length > 6;
  }

  function handleSignalEvent(ev) {
    if (!state.me) return;
    if (state.settings.dnd && !["peers", "presence-hello", "presence-ack", "presence-bye"].includes(ev.type)) return;

    switch (ev.type) {
      case "peers": {
        state.onlinePeers.clear();
        for (const p of ev.peers || []) {
          if (p.number !== state.me.number) {
            state.onlinePeers.set(p.number, p);
            ensureContact(p.number, p.name, { demo: false, status: "online" });
          }
        }
        renderAll();
        break;
      }
      case "presence-hello": {
        const u = ev.user;
        if (!u || u.number === state.me.number) break;
        state.onlinePeers.set(u.number, u);
        ensureContact(u.number, u.name, { demo: false, status: "online" });
        transport.broadcastLocal({ type: "presence-ack", user: state.me, to: u.number });
        renderAll();
        break;
      }
      case "presence-ack": {
        if (ev.to && ev.to !== state.me.number) break;
        const u = ev.user;
        if (!u || u.number === state.me.number) break;
        state.onlinePeers.set(u.number, u);
        ensureContact(u.number, u.name, { demo: false, status: "online" });
        renderAll();
        break;
      }
      case "presence-bye": {
        state.onlinePeers.delete(ev.number);
        if (state.contacts[ev.number] && !state.contacts[ev.number].demo) {
          state.contacts[ev.number].status = "offline";
        }
        renderAll();
        break;
      }
      case "chat-message": {
        if (ev.to !== state.me.number) break;
        const msg = ev.message;
        const contact = ensureContact(msg.from, ev.senderName || formatNumber(msg.from), { demo: false, status: "online" });
        if (contact.blocked) {
          logImuneEvent("Bloqueado", `Mensagem ignorada de número bloqueado (${contact.displayNumber})`);
          break;
        }
        if (checkFlood(msg.from)) {
          logImuneEvent("Anti-Flood", `Rajada rápida de spam filtrada de ${contact.displayNumber}`);
          break;
        }
        if (state.settings.antiTrava && msg.text) {
          const check = inspectHeavyPayload(msg.text);
          if (check.blocked) {
            msg.imuneBlocked = true;
            msg.imuneReason = check.reason;
            msg.safePreview = check.safeText;
            logImuneEvent("Anti-Trava", `${contact.displayNumber}: ${check.reason}`);
          }
        }

        if (!state.chats[msg.from]) state.chats[msg.from] = [];
        if (!state.chats[msg.from].some((m) => m.id === msg.id)) {
          state.chats[msg.from].push(msg);
        }

        if (state.activeChatNumber === msg.from && !state.settings.hideRead) {
          transport.send({ type: "read-receipt", from: state.me.number, to: msg.from, messageId: msg.id });
        } else if (state.activeChatNumber !== msg.from) {
          state.unread[msg.from] = (state.unread[msg.from] || 0) + 1;
          showToast(`${contact.name}: ${(msg.safePreview || msg.text || "Anexo").slice(0, 48)}`);
        }

        if (state.settings.autoReply && !msg.isAutoReply) {
          const kw = (state.settings.autoReplyMatch || "").trim().toLowerCase();
          if (!kw || (msg.text || "").toLowerCase().includes(kw)) {
            setTimeout(() => {
              sendMessageTo(msg.from, state.settings.autoReplyText || "Auto-resposta IMUNE ELITE.", null, { isAutoReply: true });
            }, 600);
          }
        }

        saveState();
        renderAll();
        break;
      }
      case "delete-message": {
        if (ev.to !== state.me.number) break;
        const list = state.chats[ev.from] || [];
        const target = list.find((m) => m.id === ev.messageId);
        if (!target) break;
        if (state.settings.antiDelete) {
          target.deletedByPeer = true;
          logImuneEvent("Anti-Delete", `Mensagem apagada por ${formatNumber(ev.from)} preservada no histórico`);
        } else {
          state.chats[ev.from] = list.filter((m) => m.id !== ev.messageId);
        }
        saveState();
        if (state.activeChatNumber === ev.from) renderMessages();
        break;
      }
      case "edit-message": {
        if (ev.to !== state.me.number) break;
        const list = state.chats[ev.from] || [];
        const target = list.find((m) => m.id === ev.messageId);
        if (!target) break;
        if (state.settings.antiEdit && !target.originalText) {
          target.originalText = target.text;
          logImuneEvent("Anti-Edit", `Edição de ${formatNumber(ev.from)} registrada (original salvo)`);
        }
        target.text = ev.newText;
        target.edited = true;
        saveState();
        if (state.activeChatNumber === ev.from) renderMessages();
        break;
      }
      case "typing": {
        if (ev.to !== state.me.number) break;
        if (ev.isTyping) state.typingFrom.add(ev.from);
        else state.typingFrom.delete(ev.from);
        if (state.activeChatNumber === ev.from) updateChatHeaderStatus();
        break;
      }
      case "read-receipt": {
        if (ev.to !== state.me.number) break;
        for (const m of state.chats[ev.from] || []) {
          if (m.from === state.me.number) m.status = "read";
        }
        saveState();
        if (state.activeChatNumber === ev.from) renderMessages();
        renderChatList();
        break;
      }
      case "reaction": {
        if (ev.to !== state.me.number) break;
        const target = (state.chats[ev.from] || []).find((m) => m.id === ev.messageId);
        if (target) {
          target.reactions = target.reactions || {};
          target.reactions[ev.emoji] = (target.reactions[ev.emoji] || 0) + 1;
          saveState();
          if (state.activeChatNumber === ev.from) renderMessages();
        }
        break;
      }
      case "status-post": {
        if (!ev.status || ev.status.number === state.me.number) break;
        if (!state.statuses.some((s) => s.id === ev.status.id)) {
          state.statuses.unshift(ev.status);
          saveState();
          renderStatusList();
        }
        break;
      }
      case "whatsapp-inbound": {
        const from = normalizeNumber(ev.from);
        if (!from) break;
        ensureContact(from, ev.senderName || formatNumber(from), { demo: false, status: "WhatsApp Oficial" });
        state.waModeByChat[from] = true;
        if (!state.chats[from]) state.chats[from] = [];
        state.chats[from].push({
          id: ev.waMessageId || uid(),
          from,
          to: state.me.number,
          text: ev.text || "",
          viaWhatsapp: true,
          ts: ev.ts || Date.now(),
          status: "read",
          reactions: {}
        });
        if (state.activeChatNumber !== from) {
          state.unread[from] = (state.unread[from] || 0) + 1;
        }
        saveState();
        renderAll();
        break;
      }
      case "whatsapp-status": {
        const num = normalizeNumber(ev.to);
        const target = (state.chats[num] || []).find((m) => m.waMessageId === ev.waMessageId);
        if (target && (ev.status === "delivered" || ev.status === "read")) {
          target.status = ev.status;
          saveState();
          if (state.activeChatNumber === num) renderMessages();
          renderChatList();
        }
        break;
      }
      case "call-invite": {
        if (ev.to !== state.me.number) break;
        if (state.contacts[ev.from]?.blocked) {
          transport.send({ type: "call-decline", callId: ev.callId, from: state.me.number, to: ev.from, reason: "busy" });
          break;
        }
        onIncomingCall(ev);
        break;
      }
      case "call-accept": { if (ev.to === state.me.number) onCallAccepted(ev); break; }
      case "call-decline": { if (ev.to === state.me.number) onCallDeclined(ev); break; }
      case "call-hangup": { if (ev.to === state.me.number) endCall("Chamada encerrada pelo contato"); break; }
      case "webrtc-offer": { if (ev.to === state.me.number) onWebRtcOffer(ev); break; }
      case "webrtc-answer": { if (ev.to === state.me.number) onWebRtcAnswer(ev); break; }
      case "webrtc-ice": { if (ev.to === state.me.number) onWebRtcIce(ev); break; }
    }
  }

  // ---------- WebRTC Call Manager ----------
  const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  async function acquireMedia(kind) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === "video" });
    } catch {
      if (kind === "video") {
        try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); } catch {}
      }
      showToast("Microfone/câmera indisponível — chamada somente escuta.");
      return null;
    }
  }

  function createPeerConnection(peerNumber) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pc.onicecandidate = (ev) => {
      if (ev.candidate && state.call) {
        transport.send({ type: "webrtc-ice", callId: state.call.id, from: state.me.number, to: peerNumber, candidate: ev.candidate });
      }
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (!stream) return;
      $("#remoteAudio").srcObject = stream;
      if (stream.getVideoTracks().length > 0) {
        $("#remoteVideo").srcObject = stream;
        $("#remoteVideo").classList.remove("hidden");
        $("#callAvatarStage").classList.add("hidden");
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") endCall("Conexão encerrada");
    };
    return pc;
  }

  function updateCallButtonIcons() {
    const c = state.call;
    const muted = Boolean(c && c.muted);
    const camOff = !c || c.camOff;
    $("#muteBtn").innerHTML = `${waIcon(muted ? "mic-off" : "mic", "wa-ic-sm")} <span>${muted ? "Sem som" : "Mudo"}</span>`;
    $("#camToggleBtn").innerHTML = `${waIcon(camOff ? "wa-video-off" : "video", "wa-ic-sm")} <span>Vídeo</span>`;
  }

  function openCallUI(contact, kind, isIncoming) {
    $("#callOverlay").classList.remove("hidden");
    $("#callAvatar").textContent = getInitials(contact.name);
    $("#callPeerName").textContent = contact.name;
    $("#callPeerNumber").textContent = contact.displayNumber;
    $("#callAvatarStage").classList.remove("hidden");
    $("#remoteVideo").classList.add("hidden");
    $("#localVideo").classList.add("hidden");
    $("#audioLevelBars").classList.add("hidden");
    $("#callStateText").textContent = isIncoming
      ? (kind === "video" ? "Chamada de vídeo recebida..." : "Chamada de voz recebida...")
      : (kind === "video" ? "Chamando vídeo..." : "Chamando...");
    $("#incomingCallControls").classList.toggle("hidden", !isIncoming);
    $("#activeCallControls").classList.toggle("hidden", isIncoming);
    updateCallButtonIcons();
  }

  async function startCall(rawNumber, kind = "audio") {
    if (state.settings.dnd) { showToast("Desative o Modo Avião para ligar."); return; }
    const targetNum = normalizeNumber(rawNumber);
    if (!targetNum || targetNum === state.me.number) { showToast("Digite outro número válido."); return; }
    if (state.call) { showToast("Já existe uma ligação ativa."); return; }

    const contact = ensureContact(targetNum);
    const callId = uid();
    state.call = { id: callId, peerNumber: targetNum, kind, direction: "out", status: "ringing", connectedAt: null, pc: null, localStream: null, muted: false, camOff: kind !== "video", timer: null, demoTimer: null };
    openCallUI(contact, kind, false);
    tones.startRingback();

    if (contact.demo && !state.onlinePeers.has(targetNum)) {
      state.call.demoTimer = setTimeout(async () => {
        if (!state.call || state.call.id !== callId) return;
        tones.stop();
        const stream = await acquireMedia(kind);
        if (!state.call || state.call.id !== callId) return;
        state.call.localStream = stream;
        if (stream && kind === "video" && stream.getVideoTracks().length) {
          $("#localVideo").srcObject = stream;
          $("#localVideo").classList.remove("hidden");
        }
        markCallConnected();
      }, 1600);
      return;
    }

    transport.send({ type: "call-invite", callId, from: state.me.number, fromName: state.me.name, to: targetNum, kind });
    state.call.ringTimeout = setTimeout(() => {
      if (state.call && state.call.id === callId && state.call.status === "ringing") endCall("Sem resposta");
    }, 35000);
  }

  function onIncomingCall(ev) {
    if (state.call) {
      transport.send({ type: "call-decline", callId: ev.callId, from: state.me.number, to: ev.from, reason: "busy" });
      return;
    }
    const contact = ensureContact(ev.from, ev.fromName, { demo: false, status: "online" });
    state.call = { id: ev.callId, peerNumber: ev.from, kind: ev.kind || "audio", direction: "in", status: "incoming", connectedAt: null, pc: null, localStream: null, muted: false, camOff: ev.kind !== "video", timer: null, pendingCandidates: [] };
    openCallUI(contact, ev.kind, true);
    tones.startIncomingRing();
  }

  async function acceptIncomingCall(kindOverride) {
    const c = state.call;
    if (!c || c.status !== "incoming") return;
    tones.stop();
    c.kind = kindOverride || c.kind;
    c.camOff = c.kind !== "video";
    c.status = "connecting";
    $("#incomingCallControls").classList.add("hidden");
    $("#activeCallControls").classList.remove("hidden");
    $("#callStateText").textContent = "Conectando...";
    updateCallButtonIcons();

    const stream = await acquireMedia(c.kind);
    c.localStream = stream;
    if (stream && c.kind === "video" && stream.getVideoTracks().length) {
      $("#localVideo").srcObject = stream;
      $("#localVideo").classList.remove("hidden");
    }
    c.pc = createPeerConnection(c.peerNumber);
    if (stream) stream.getTracks().forEach((t) => c.pc.addTrack(t, stream));
    transport.send({ type: "call-accept", callId: c.id, from: state.me.number, to: c.peerNumber, kind: c.kind });
  }

  async function onCallAccepted(ev) {
    const c = state.call;
    if (!c || c.id !== ev.callId) return;
    clearTimeout(c.ringTimeout);
    tones.stop();
    c.status = "connecting";
    const stream = await acquireMedia(c.kind);
    c.localStream = stream;
    if (stream && c.kind === "video" && stream.getVideoTracks().length) {
      $("#localVideo").srcObject = stream;
      $("#localVideo").classList.remove("hidden");
    }
    c.pc = createPeerConnection(c.peerNumber);
    if (stream) stream.getTracks().forEach((t) => c.pc.addTrack(t, stream));
    else {
      c.pc.addTransceiver("audio", { direction: "recvonly" });
      if (c.kind === "video") c.pc.addTransceiver("video", { direction: "recvonly" });
    }
    const offer = await c.pc.createOffer();
    await c.pc.setLocalDescription(offer);
    transport.send({ type: "webrtc-offer", callId: c.id, from: state.me.number, to: c.peerNumber, sdp: c.pc.localDescription });
  }

  async function onWebRtcOffer(ev) {
    const c = state.call;
    if (!c || c.id !== ev.callId || !c.pc) return;
    await c.pc.setRemoteDescription(new RTCSessionDescription(ev.sdp));
    for (const cand of c.pendingCandidates || []) await c.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
    c.pendingCandidates = [];
    const answer = await c.pc.createAnswer();
    await c.pc.setLocalDescription(answer);
    transport.send({ type: "webrtc-answer", callId: c.id, from: state.me.number, to: c.peerNumber, sdp: c.pc.localDescription });
    markCallConnected();
  }

  async function onWebRtcAnswer(ev) {
    const c = state.call;
    if (!c || c.id !== ev.callId || !c.pc) return;
    await c.pc.setRemoteDescription(new RTCSessionDescription(ev.sdp));
    markCallConnected();
  }

  async function onWebRtcIce(ev) {
    const c = state.call;
    if (!c || c.id !== ev.callId) return;
    if (c.pc && c.pc.remoteDescription) await c.pc.addIceCandidate(new RTCIceCandidate(ev.candidate)).catch(() => {});
    else { c.pendingCandidates = c.pendingCandidates || []; c.pendingCandidates.push(ev.candidate); }
  }

  function markCallConnected() {
    const c = state.call;
    if (!c) return;
    c.status = "connected";
    c.connectedAt = Date.now();
    $("#audioLevelBars").classList.remove("hidden");
    const tick = () => {
      if (!state.call || state.call.id !== c.id) return;
      const d = formatDuration(Math.floor((Date.now() - c.connectedAt) / 1000));
      $("#callStateText").textContent = `Conectado • ${d}`;
      $("#miniCallText").textContent = `Em chamada com ${state.contacts[c.peerNumber]?.name || c.peerNumber} (${d})`;
    };
    tick();
    c.timer = setInterval(tick, 1000);
  }

  function onCallDeclined(ev) {
    const c = state.call;
    if (!c || c.id !== ev.callId) return;
    endCall(ev.reason === "busy" ? "Ocupado" : "Chamada recusada");
  }

  function endCall(reasonText = "Chamada encerrada", notifyPeer = false) {
    const c = state.call;
    if (!c) return;
    state.call = null;
    tones.stop();
    clearTimeout(c.ringTimeout);
    clearTimeout(c.demoTimer);
    if (c.timer) clearInterval(c.timer);

    if (notifyPeer) {
      transport.send({ type: c.status === "incoming" ? "call-decline" : "call-hangup", callId: c.id, from: state.me.number, to: c.peerNumber });
    }
    if (c.pc) try { c.pc.close(); } catch {}
    if (c.localStream) c.localStream.getTracks().forEach((t) => t.stop());

    const durationSec = c.connectedAt ? Math.max(1, Math.floor((Date.now() - c.connectedAt) / 1000)) : 0;
    const contact = ensureContact(c.peerNumber);
    state.callHistory.unshift({ id: c.id, number: c.peerNumber, name: contact.name, kind: c.kind, direction: c.direction, durationSec, ts: Date.now() });
    saveState();

    $("#remoteVideo").srcObject = null;
    $("#localVideo").srcObject = null;
    $("#remoteAudio").srcObject = null;
    $("#callOverlay").classList.add("hidden");
    $("#miniCallBar").classList.add("hidden");
    showToast(`${reasonText}${durationSec > 0 ? ` (${formatDuration(durationSec)})` : ""}`);
    renderCallHistory();
  }

  // ---------- Messaging ----------
  function sendMessageTo(to, text, attachment = null, extra = {}) {
    if (state.settings.dnd) { showToast("Modo Avião ativo — desative para enviar."); return; }
    if (!to) return;
    const clean = String(text || "").trim();
    if (!clean && !attachment) return;

    if (state.editingMessageId && !attachment) {
      const list = state.chats[to] || [];
      const target = list.find((m) => m.id === state.editingMessageId);
      if (target) {
        if (!target.originalText) target.originalText = target.text;
        target.text = clean;
        target.edited = true;
        transport.send({ type: "edit-message", from: state.me.number, to, messageId: target.id, newText: clean });
      }
      state.editingMessageId = null;
      $("#replyBar").classList.add("hidden");
      saveState();
      renderAll();
      return;
    }

    const msg = {
      id: uid(),
      from: state.me.number,
      to,
      text: clean,
      attachment,
      replyTo: state.replyTo ? { id: state.replyTo.id, sender: state.replyTo.sender, text: state.replyTo.text } : null,
      ts: Date.now(),
      status: state.onlinePeers.has(to) ? "delivered" : "sent",
      reactions: {},
      ...extra
    };

    if (!state.chats[to]) state.chats[to] = [];
    state.chats[to].push(msg);
    state.replyTo = null;
    $("#replyBar").classList.add("hidden");
    saveState();
    renderAll();

    if (state.waModeByChat[to]) {
      sendViaWhatsappCloud(to, msg);
      return;
    }

    const contact = state.contacts[to];
    if (contact && contact.demo && !state.onlinePeers.has(to)) {
      triggerDemoReply(to, clean, attachment);
    } else {
      transport.send({ type: "chat-message", from: state.me.number, senderName: state.me.name, to, message: msg });
    }
  }

  function triggerDemoReply(num, userText, attachment) {
    state.typingFrom.add(num);
    if (state.activeChatNumber === num) updateChatHeaderStatus();
    setTimeout(() => {
      state.typingFrom.delete(num);
      const reply = attachment
        ? `Anexo "${attachment.name}" recebido com segurança pelo WhatsApp Web IMUNE ELITE.`
        : `Recebido no WhatsApp Web IMUNE ELITE: "${userText.slice(0, 80)}". Experimente testar o Anti-Delete, Anti-Trava ou ligar pelo número!`;
      state.chats[num].push({ id: uid(), from: num, to: state.me.number, text: reply, ts: Date.now(), status: "read", reactions: {} });
      for (const m of state.chats[num]) if (m.from === state.me.number) m.status = "read";
      saveState();
      renderAll();
    }, 800);
  }

  // ---------- WhatsApp Cloud API ----------
  async function refreshWaStatus() {
    if (IS_STATIC_HOST || (location.protocol !== "http:" && location.protocol !== "https:")) {
      state.waCloudConfigured = false;
      updateWaModalStatus();
      return;
    }
    try {
      const apiBase = REMOTE_SERVER_URL && /^https?:/i.test(REMOTE_SERVER_URL) ? REMOTE_SERVER_URL : "";
      const r = await fetch(`${apiBase}/api/whatsapp/status`);
      const d = await r.json();
      state.waCloudConfigured = Boolean(d.configured);
    } catch { state.waCloudConfigured = false; }
    updateWaModalStatus();
  }

  function updateWaModalStatus() {
    const b = $("#waStatusBanner");
    if (!b) return;
    if (IS_STATIC_HOST) {
      b.textContent = "Modo estático (GitHub Pages): use contatos demo ou abra outra aba no mesmo navegador.";
    } else if (location.protocol !== "http:" && location.protocol !== "https:") {
      b.textContent = "Abra via node server.js (http://localhost:3000) para usar a Cloud API.";
    } else if (state.waCloudConfigured) {
      b.textContent = "Status: WhatsApp Cloud API CONFIGURADA no server.js.";
    } else {
      b.textContent = "Status: Variáveis WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID não configuradas.";
    }
  }

  async function sendViaWhatsappCloud(to, msg, templateName = "") {
    if (IS_STATIC_HOST || (location.protocol !== "http:" && location.protocol !== "https:")) {
      showToast("Inicie o server.js (ou informe ?server=...) para usar a WhatsApp Cloud API.");
      return;
    }
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, text: msg?.text || "", templateName })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showToast(data.error || "Erro ao enviar pela WhatsApp API.");
        if (data.code === "whatsapp_not_configured") $("#waConfigModal").classList.remove("hidden");
        return;
      }
      if (msg) {
        msg.viaWhatsapp = true;
        msg.waMessageId = data.messageId;
        msg.status = "delivered";
        saveState();
        renderMessages();
        renderChatList();
      }
      showToast("Enviado ao WhatsApp oficial!");
    } catch { showToast("Falha ao contatar /api/whatsapp/send."); }
  }

  // ---------- Rendering ----------
  function renderAll() {
    renderChatList();
    renderStatusList();
    renderCallHistory();
    renderImuneLog();
    renderScheduledList();
    updateUnreadBadge();
    if (state.activeChatNumber) renderActiveChat();
  }

  function updateUnreadBadge() {
    const total = Object.values(state.unread).reduce((a, b) => a + b, 0);
    const el = $("#unreadTotalBadge");
    if (total > 0) {
      el.textContent = total > 99 ? "99+" : String(total);
      el.classList.remove("hidden");
    } else el.classList.add("hidden");
  }

  function renderChatList() {
    const listEl = $("#chatList");
    listEl.innerHTML = "";
    const q = state.searchQuery.toLowerCase();
    const numbers = Array.from(new Set([...Object.keys(state.contacts), ...Object.keys(state.chats)]));

    const items = numbers
      .map((num) => {
        const c = ensureContact(num);
        const msgs = state.chats[num] || [];
        return { c, msgs, last: msgs[msgs.length - 1], unread: state.unread[num] || 0, isOnline: state.onlinePeers.has(num) };
      })
      .filter(({ c, msgs, unread }) => {
        if (state.chatFilter === "archived") return c.archived;
        if (c.archived) return false;
        if (state.chatFilter === "unread" && unread === 0) return false;
        if (state.chatFilter === "favorites" && !c.favorite) return false;
        if (!q) return true;
        return c.name.toLowerCase().includes(q) || c.number.includes(normalizeNumber(q)) || msgs.some((m) => (m.text || "").toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (a.c.favorite !== b.c.favorite) return a.c.favorite ? -1 : 1;
        return (b.last?.ts || 0) - (a.last?.ts || 0);
      });

    if (!items.length) {
      listEl.innerHTML = `<div class="tip-chip" style="margin:10px;">Nenhuma conversa neste filtro. Clique em <strong>Nova conversa</strong> para adicionar um número.</div>`;
      return;
    }

    for (const { c, last, unread, isOnline } of items) {
      const row = document.createElement("div");
      row.className = `chat-item${state.activeChatNumber === c.number ? " active" : ""}`;
      let previewIcon = "";
      if (last && last.from === state.me.number) {
        previewIcon = `<span class="ticks${last.status === "read" ? " read" : ""}">${renderTickIcon(last.status)}</span>`;
      }
      let previewText = c.displayNumber;
      if (last) {
        if (last.imuneBlocked) {
          previewIcon += waIcon("shield-check", "wa-ic-xs");
          previewText = "Mensagem pesada bloqueada";
        } else if (last.attachment) {
          previewIcon += waIcon("attach", "wa-ic-xs");
          previewText = last.attachment.name;
        } else {
          previewText = last.text;
        }
      }

      const verifiedHtml = c.verified ? waIcon("verified", "wa-verified-ic") : "";
      const blockedHtml = c.blocked ? waIcon("block", "wa-ic-xs") : "";
      const pinHtml = c.favorite ? `<span title="Fixada / Favorita">${waIcon("pin", "wa-ic-xs")}</span>` : "";

      row.innerHTML = `
        <div class="avatar">${escapeHtml(getInitials(c.name))}${isOnline ? '<span class="online-ring"></span>' : ""}</div>
        <div class="chat-item-body">
          <div class="chat-item-top">
            <span class="chat-item-name">${escapeHtml(c.name)} ${verifiedHtml} ${blockedHtml}</span>
            <span class="chat-item-time${unread > 0 ? " unread" : ""}">${last ? formatTime(last.ts) : ""}</span>
          </div>
          <div class="chat-item-bottom">
            <span class="chat-item-preview">${previewIcon}<span>${escapeHtml(previewText || "")}</span></span>
            <div class="chat-item-badges">
              ${pinHtml}
              ${unread > 0 ? `<span class="unread-pill">${unread}</span>` : ""}
            </div>
          </div>
        </div>
      `;
      row.onclick = () => openChat(c.number);
      listEl.appendChild(row);
    }
  }

  function renderStatusList() {
    const el = $("#statusList");
    el.innerHTML = "";
    for (const s of state.statuses) {
      const item = document.createElement("div");
      item.className = "status-item";
      item.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <div class="status-swatch" style="background:${escapeHtml(s.bg)}">${escapeHtml(getInitials(s.author))}</div>
          <div style="min-width:0;">
            <strong style="display:block;">${escapeHtml(s.author)}</strong>
            <span class="hint">${formatTime(s.ts)} • ${escapeHtml(s.text.slice(0, 42))}</span>
          </div>
        </div>
      `;
      item.onclick = () => {
        $("#statusViewerAuthor").textContent = s.author;
        $("#statusViewerTime").textContent = formatTime(s.ts);
        $("#statusViewerText").textContent = s.text;
        $("#statusViewerCard").style.background = s.bg || "#144d37";
        $("#statusViewerModal").classList.remove("hidden");
      };
      el.appendChild(item);
    }
  }

  function renderCallHistory() {
    const el = $("#callHistoryList");
    el.innerHTML = "";
    if (!state.callHistory.length) {
      el.innerHTML = `<div class="tip-chip">Nenhuma chamada feita ainda.</div>`;
      return;
    }
    for (const h of state.callHistory.slice(0, 20)) {
      const row = document.createElement("div");
      row.className = "history-row";
      const dirIcon = waIcon(h.direction === "out" ? "outgoing-call" : "incoming-call", "wa-ic-xs");
      const callBtnIcon = waIcon(h.kind === "video" ? "video-outline" : "phone-outline", "wa-ic-sm");
      row.innerHTML = `
        <div>
          <strong style="display:flex;align-items:center;gap:6px;">${dirIcon} ${escapeHtml(h.name)}</strong>
          <span class="hint">${escapeHtml(formatNumber(h.number))} • ${h.kind === "video" ? "Vídeo" : "Voz"} • ${h.durationSec ? formatDuration(h.durationSec) : "Perdida"}</span>
        </div>
        <button class="icon-btn" title="Ligar novamente">${callBtnIcon}</button>
      `;
      row.querySelector("button").onclick = () => startCall(h.number, h.kind);
      el.appendChild(row);
    }
  }

  function renderImuneLog() {
    const el = $("#imuneLogList");
    el.innerHTML = "";
    if (!state.imuneLog.length) {
      el.innerHTML = `<div class="tip-chip" style="justify-content:flex-start;">${waIcon("shield-check", "wa-ic-sm")} <span>Nenhuma ameaça detectada até agora. Escudo em vigília.</span></div>`;
      return;
    }
    for (const l of state.imuneLog.slice(0, 15)) {
      const row = document.createElement("div");
      row.className = "tip-chip";
      row.style.justifyContent = "flex-start";
      row.innerHTML = `<strong>[${escapeHtml(l.kind)}]</strong> ${escapeHtml(l.detail)} <span style="opacity:.7">(${formatTime(l.ts)})</span>`;
      el.appendChild(row);
    }
  }

  function renderScheduledList() {
    const el = $("#scheduledList");
    el.innerHTML = "";
    for (const sc of state.scheduled) {
      const row = document.createElement("div");
      row.className = "tip-chip";
      row.style.justifyContent = "flex-start";
      row.innerHTML = `${waIcon("pending-clock", "wa-ic-xs")} <span>Para ${escapeHtml(formatNumber(sc.to))}: "${escapeHtml(sc.text.slice(0, 32))}"</span>`;
      el.appendChild(row);
    }
  }

  function openChat(rawNumber) {
    const num = normalizeNumber(rawNumber);
    if (!num) return;
    ensureContact(num);
    state.activeChatNumber = num;
    state.unread[num] = 0;
    saveState();

    if (state.onlinePeers.has(num) && !state.settings.hideRead) {
      transport.send({ type: "read-receipt", from: state.me.number, to: num });
    }
    $("#emptyState").classList.add("hidden");
    $("#activeChat").classList.remove("hidden");
    $("#appShell").classList.add("mobile-chat-open");
    renderAll();
    $("#messageInput").focus();
  }

  function updateChatHeaderStatus() {
    const num = state.activeChatNumber;
    if (!num) return;
    const c = state.contacts[num];
    const el = $("#peerStatus");
    if (state.typingFrom.has(num)) {
      el.textContent = "digitando...";
      el.classList.add("typing");
    } else if (state.onlinePeers.has(num)) {
      el.textContent = `online • ${c.displayNumber}`;
      el.classList.remove("typing");
    } else {
      el.textContent = `${c.status || "offline"} • ${c.displayNumber}`;
      el.classList.remove("typing");
    }
  }

  function renderActiveChat() {
    const num = state.activeChatNumber;
    const c = state.contacts[num];
    if (!c) return;
    $("#peerAvatar").textContent = getInitials(c.name);
    $("#peerName").innerHTML = `${escapeHtml(c.name)}${c.verified ? " " + waIcon("verified", "wa-verified-ic") : ""}`;
    $("#headerFavBtn").innerHTML = waIcon(c.favorite ? "star-fill" : "star");
    const badge = $("#peerBadge");
    if (c.blocked) { badge.textContent = "Bloqueado"; badge.classList.remove("hidden"); }
    else if (c.demo && !state.onlinePeers.has(num)) { badge.textContent = "Oficial"; badge.classList.remove("hidden"); }
    else if (state.onlinePeers.has(num)) { badge.textContent = "Online"; badge.classList.remove("hidden"); }
    else badge.classList.add("hidden");

    const waOn = Boolean(state.waModeByChat[num]);
    $("#waModeToggleBtn").classList.toggle("active", waOn);
    $("#waModeToggleBtn").textContent = waOn ? "WA Cloud: ON" : "WA Cloud: OFF";
    $("#waModeBar").classList.toggle("hidden", !waOn);

    updateChatHeaderStatus();
    renderMessages();
    renderDrawer();
  }

  function renderMessages() {
    const container = $("#messagesContainer");
    const num = state.activeChatNumber;
    const q = state.inChatSearch.toLowerCase();
    const list = (state.chats[num] || []).filter((m) => !q || (m.text || "").toLowerCase().includes(q));
    container.innerHTML = "";

    const div = document.createElement("div");
    div.className = "day-divider";
    div.innerHTML = `${waIcon("lock", "wa-ic-xs")} <span>Mensagens protegidas pelo WhatsApp Web IMUNE ELITE • Anti-Trava &amp; Anti-Delete</span>`;
    container.appendChild(div);

    for (const m of list) {
      const row = document.createElement("div");
      const isOut = m.from === state.me.number;
      row.className = `msg-row ${isOut ? "out" : "in"}`;

      const quoteHtml = m.replyTo ? `<div class="msg-quote"><strong>${escapeHtml(m.replyTo.sender)}</strong><span>${escapeHtml(m.replyTo.text)}</span></div>` : "";
      const deletedBadge = m.deletedByPeer ? `<div class="imune-deleted-tag">${waIcon("delete", "wa-ic-xs")} Apagada pelo remetente (salva pelo Imune)</div>` : "";
      const editedBadge = m.edited && m.originalText ? `<div class="imune-edited-tag" title="Original: ${escapeHtml(m.originalText)}">${waIcon("edit", "wa-ic-xs")} Editada (original: ${escapeHtml(m.originalText.slice(0, 60))})</div>` : "";

      let bodyHtml = "";
      if (m.imuneBlocked && !m.revealedSafe) {
        bodyHtml = `
          <div class="imune-shield-box">
            <div class="imune-shield-title">${waIcon("shield-check", "wa-ic-sm")} <span>${escapeHtml(m.imuneReason || "Payload bloqueado")}</span></div>
            <button class="btn-ghost" data-act="reveal-safe">Mostrar trecho seguro</button>
          </div>
        `;
      } else {
        const displayText = m.imuneBlocked ? (m.safePreview || "") : (m.text || "");
        bodyHtml = displayText ? `<div class="msg-text">${linkify(displayText)}</div>` : "";
      }

      let attachHtml = "";
      if (m.attachment) {
        if (m.attachment.type.startsWith("image/")) attachHtml = `<div class="msg-attachment"><img src="${m.attachment.dataUrl}" alt="${escapeHtml(m.attachment.name)}" /></div>`;
        else if (m.attachment.type.startsWith("audio/")) attachHtml = `<div class="msg-attachment"><audio controls src="${m.attachment.dataUrl}"></audio></div>`;
        else attachHtml = `<div class="msg-attachment"><a class="btn-ghost" href="${m.attachment.dataUrl}" download="${escapeHtml(m.attachment.name)}">${waIcon("document", "wa-ic-sm")} <span>${escapeHtml(m.attachment.name)}</span></a></div>`;
      }

      const linkWarns = state.settings.antiLink ? detectSuspiciousLinks(m.text) : [];
      const warnHtml = linkWarns.length ? `<div class="spoof-warning">${waIcon("warning", "wa-ic-sm")} <span>${escapeHtml(linkWarns[0])}</span></div>` : "";
      const ticks = isOut ? `<span class="ticks ${m.status === "read" ? "read" : ""}">${renderTickIcon(m.status)}</span>` : "";
      const reactionsArr = Object.entries(m.reactions || {});
      const reactionsHtml = reactionsArr.length ? `<div class="msg-reactions">${reactionsArr.map(([e, n]) => `<span class="reaction-pill">${e} ${n > 1 ? n : ""}</span>`).join("")}</div>` : "";

      row.innerHTML = `
        <div class="msg-bubble">
          ${deletedBadge}
          ${editedBadge}
          ${quoteHtml}
          ${attachHtml}
          ${bodyHtml}
          ${warnHtml}
          <div class="msg-meta">
            ${m.viaWhatsapp ? '<span class="wa-msg-tag">WhatsApp</span>' : ""}
            <span>${formatTime(m.ts)}</span>
            ${ticks}
          </div>
        </div>
        ${reactionsHtml}
        <div class="msg-hover-bar">
          <button class="mini-action" data-act="reply">${waIcon("reply", "wa-ic-xs")} Responder</button>
          ${m.text ? `<button class="mini-action" data-act="copy">${waIcon("copy", "wa-ic-xs")} Copiar</button>` : ""}
          ${isOut && m.text ? `<button class="mini-action" data-act="edit">${waIcon("edit", "wa-ic-xs")} Editar</button>` : ""}
          ${isOut ? `<button class="mini-action" data-act="delete">${waIcon("delete", "wa-ic-xs")} Apagar</button>` : ""}
          <button class="mini-action" data-react="👍">👍</button>
          <button class="mini-action" data-react="❤️">❤️</button>
          <button class="mini-action" data-react="🛡️">🛡️</button>
        </div>
      `;

      const revealBtn = row.querySelector('[data-act="reveal-safe"]');
      if (revealBtn) revealBtn.onclick = () => { m.revealedSafe = true; renderMessages(); };

      row.querySelector('[data-act="reply"]').onclick = () => {
        const sender = isOut ? state.me.name : (state.contacts[num]?.name || num);
        state.editingMessageId = null;
        state.replyTo = { id: m.id, sender, text: m.text || (m.attachment?.name || "") };
        $("#replySender").textContent = sender;
        $("#replyPreview").textContent = state.replyTo.text;
        $("#replyBar").classList.remove("hidden");
        $("#messageInput").focus();
      };

      const copyBtn = row.querySelector('[data-act="copy"]');
      if (copyBtn) {
        copyBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(m.text || "");
            showToast("Mensagem copiada!");
          } catch {
            showToast("Não foi possível copiar.");
          }
        };
      }

      const editBtn = row.querySelector('[data-act="edit"]');
      if (editBtn) {
        editBtn.onclick = () => {
          state.editingMessageId = m.id;
          state.replyTo = null;
          $("#replySender").textContent = "Editando mensagem";
          $("#replyPreview").textContent = m.text;
          $("#replyBar").classList.remove("hidden");
          $("#messageInput").value = m.text;
          $("#messageInput").focus();
        };
      }

      const delBtn = row.querySelector('[data-act="delete"]');
      if (delBtn) {
        delBtn.onclick = () => {
          state.chats[num] = (state.chats[num] || []).filter((x) => x.id !== m.id);
          transport.send({ type: "delete-message", from: state.me.number, to: num, messageId: m.id });
          saveState();
          renderAll();
        };
      }

      row.querySelectorAll("[data-react]").forEach((b) => {
        b.onclick = () => {
          const emoji = b.dataset.react;
          m.reactions = m.reactions || {};
          m.reactions[emoji] = (m.reactions[emoji] || 0) + 1;
          saveState();
          renderMessages();
          transport.send({ type: "reaction", from: state.me.number, to: num, messageId: m.id, emoji });
        };
      });

      container.appendChild(row);
    }
    container.scrollTop = container.scrollHeight;
  }

  function renderDrawer() {
    const num = state.activeChatNumber;
    if (!num || $("#infoDrawer").classList.contains("hidden")) return;
    const c = state.contacts[num];
    $("#drawerAvatar").textContent = getInitials(c.name);
    $("#drawerName").innerHTML = `${escapeHtml(c.name)}${c.verified ? " " + waIcon("verified", "wa-verified-ic") : ""}`;
    $("#drawerNumber").textContent = c.displayNumber;
    $("#drawerStatus").textContent = state.onlinePeers.has(num) ? "Online agora" : c.status;
    $("#contactNotesInput").value = c.notes || "";
    $("#archiveChatBtn").textContent = c.archived ? "Desarquivar conversa" : "Arquivar conversa";
    $("#blockPeerBtn").textContent = c.blocked ? "Desbloquear número" : "Bloquear número";
    const media = (state.chats[num] || []).filter((m) => m.attachment);
    $("#drawerMediaList").innerHTML = media.length
      ? media.slice(-6).map((m) => `<div class="drawer-media-item">${waIcon("document", "wa-ic-xs")} <span>${escapeHtml(m.attachment.name)}</span></div>`).join("")
      : "<span>Nenhuma mídia.</span>";
  }

  function switchTab(tab) {
    state.activeTab = tab;
    $$(".rail-btn[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $("#tabChats").classList.toggle("hidden", tab !== "chats");
    $("#tabStatus").classList.toggle("hidden", tab !== "status");
    $("#tabCalls").classList.toggle("hidden", tab !== "calls");
    $("#tabImune").classList.toggle("hidden", tab !== "imune");
    $("#tabTools").classList.toggle("hidden", tab !== "tools");
    $("#chatFilters").classList.toggle("hidden", tab !== "chats");
    $("#searchWrap").classList.toggle("hidden", tab !== "chats");
    const titles = { chats: "WhatsApp", status: "Status", calls: "Ligações", imune: "Central Imune", tools: "Ferramentas Pro" };
    $("#sidebarTitle").textContent = titles[tab] || "WhatsApp";
  }

  function syncSettingsUI() {
    const s = state.settings;
    $("#optAntiTrava").checked = s.antiTrava;
    $("#optAntiFlood").checked = s.antiFlood;
    $("#optAntiDelete").checked = s.antiDelete;
    $("#optAntiEdit").checked = s.antiEdit;
    $("#optAntiLink").checked = s.antiLink;
    $("#optHideRead").checked = s.hideRead;
    $("#optHideTyping").checked = s.hideTyping;
    $("#optHideRecording").checked = s.hideRecording;
    $("#optAutoReply").checked = s.autoReply;
    $("#autoReplyMatchInput").value = s.autoReplyMatch || "";
    $("#autoReplyTextInput").value = s.autoReplyText || "";
    $("#dndBanner").classList.toggle("hidden", !s.dnd);
    $("#dndToggleBtn").classList.toggle("dnd-on", s.dnd);
  }

  function syncThemeButton() {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    $("#themeToggleBtn").innerHTML = waIcon(cur === "dark" ? "light-theme" : "dark-theme");
  }

  function updateDialMatch() {
    const num = normalizeNumber($("#dialerInput").value);
    const c = num ? state.contacts[num] : null;
    $("#dialMatchedContact").textContent = c ? `Contato: ${c.name}` : (num ? `Discar para ${formatNumber(num)}` : "");
  }

  function lockApp() {
    if (!state.settings.pin) {
      showToast("Defina um PIN primeiro na Central Imune (escudo).");
      switchTab("imune");
      return;
    }
    $("#unlockPinInput").value = "";
    $("#lockScreen").classList.remove("hidden");
  }

  // ---------- Events ----------
  function setupEvents() {
    const suffix = String(Math.floor(1000 + Math.random() * 8999));
    $("#myNumberInput").value = sessionStorage.getItem("ie_num") || `+55 11 99999-${suffix}`;
    $("#myNameInput").value = sessionStorage.getItem("ie_name") || "Aldemir";
    $("#genNumberBtn").onclick = () => { $("#myNumberInput").value = `+55 11 99999-${Math.floor(1000 + Math.random() * 8999)}`; };

    $("#authForm").onsubmit = (e) => {
      e.preventDefault();
      const name = $("#myNameInput").value.trim();
      const about = $("#myAboutInput").value.trim();
      const number = normalizeNumber($("#myNumberInput").value);
      if (!name || number.length < 4) { showToast("Informe nome e número válidos."); return; }
      state.me = { number, displayNumber: formatNumber(number), name, about };
      sessionStorage.setItem("ie_num", state.me.displayNumber);
      sessionStorage.setItem("ie_name", name);
      $("#authModal").classList.add("hidden");
      $("#appShell").classList.remove("hidden");
      $("#myAvatarInitials").textContent = getInitials(name);
      $("#myNumberDisplay").textContent = state.me.displayNumber;
      $("#emptyMyNumber").textContent = state.me.displayNumber;
      loadState();
      transport.connect(state.me);
      refreshWaStatus();
      renderAll();
    };

    $$(".rail-btn[data-tab]").forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
    $("#emptyOpenDialerBtn").onclick = () => switchTab("calls");
    $("#emptyOpenImuneBtn").onclick = () => switchTab("imune");

    syncThemeButton();
    $("#themeToggleBtn").onclick = () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      document.documentElement.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
      syncThemeButton();
    };
    $("#privacyToggleBtn").onclick = () => {
      const on = document.body.classList.toggle("privacy-blur");
      $("#privacyToggleBtn").classList.toggle("privacy-on", on);
    };
    $("#dndToggleBtn").onclick = () => { state.settings.dnd = !state.settings.dnd; saveState(); syncSettingsUI(); };
    $("#disableDndBtn").onclick = () => { state.settings.dnd = false; saveState(); syncSettingsUI(); };
    $("#lockAppBtn").onclick = lockApp;
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === "l" && state.me) { e.preventDefault(); lockApp(); }
    });
    $("#unlockForm").onsubmit = (e) => {
      e.preventDefault();
      if ($("#unlockPinInput").value === state.settings.pin) $("#lockScreen").classList.add("hidden");
      else showToast("PIN incorreto.");
    };
    $("#profileBtn").onclick = () => showToast(`${state.me.name} • ${state.me.displayNumber}`);

    // Quick add chat
    $("#quickNewChatBtn").onclick = () => { switchTab("chats"); $("#quickAddChatForm").classList.toggle("hidden"); };
    $("#cancelQuickAddBtn").onclick = () => $("#quickAddChatForm").classList.add("hidden");
    $("#quickAddChatForm").onsubmit = (e) => {
      e.preventDefault();
      const num = normalizeNumber($("#quickContactNumber").value);
      const name = $("#quickContactName").value.trim();
      if (num.length < 4) { showToast("Número inválido."); return; }
      ensureContact(num, name || formatNumber(num), { demo: false });
      $("#quickAddChatForm").classList.add("hidden");
      $("#quickContactNumber").value = "";
      $("#quickContactName").value = "";
      openChat(num);
    };

    // Filters & Search
    $("#searchInput").oninput = (e) => { state.searchQuery = e.target.value; renderChatList(); };
    $$("#chatFilters .pill").forEach((p) => {
      p.onclick = () => {
        $$("#chatFilters .pill").forEach((x) => x.classList.remove("active"));
        p.classList.add("active");
        state.chatFilter = p.dataset.filter;
        renderChatList();
      };
    });

    // Status
    $("#statusForm").onsubmit = (e) => {
      e.preventDefault();
      const text = $("#statusTextInput").value.trim();
      if (!text) return;
      const st = { id: uid(), author: state.me.name, number: state.me.number, text, bg: $("#statusBgSelect").value, ts: Date.now() };
      state.statuses.unshift(st);
      $("#statusTextInput").value = "";
      saveState();
      renderStatusList();
      transport.send({ type: "status-post", status: st });
      showToast("Status publicado!");
    };
    $("#closeStatusViewerBtn").onclick = () => $("#statusViewerModal").classList.add("hidden");

    // Dialer
    $$(".dial-key").forEach((k) => (k.onclick = () => { tones.playDtmf(k.dataset.key); $("#dialerInput").value += k.dataset.key; updateDialMatch(); }));
    $("#dialBackspaceBtn").onclick = () => { $("#dialerInput").value = $("#dialerInput").value.slice(0, -1); updateDialMatch(); };
    $("#dialerInput").oninput = updateDialMatch;
    $("#dialAudioCallBtn").onclick = () => startCall($("#dialerInput").value, "audio");
    $("#dialVideoCallBtn").onclick = () => startCall($("#dialerInput").value, "video");
    $("#dialOpenChatBtn").onclick = () => { const n = normalizeNumber($("#dialerInput").value); if (n) openChat(n); };

    // Imune Settings
    [["#optAntiTrava", "antiTrava"], ["#optAntiFlood", "antiFlood"], ["#optAntiDelete", "antiDelete"], ["#optAntiEdit", "antiEdit"], ["#optAntiLink", "antiLink"], ["#optHideRead", "hideRead"], ["#optHideTyping", "hideTyping"], ["#optHideRecording", "hideRecording"], ["#optAutoReply", "autoReply"]].forEach(([sel, key]) => {
      $(sel).onchange = (e) => { state.settings[key] = e.target.checked; saveState(); };
    });
    $("#savePinBtn").onclick = () => {
      state.settings.pin = $("#pinSetupInput").value.trim();
      saveState();
      showToast(state.settings.pin ? "PIN de bloqueio salvo!" : "PIN removido.");
    };

    // Tools Pro
    $("#saveAutoReplyBtn").onclick = () => {
      state.settings.autoReplyMatch = $("#autoReplyMatchInput").value;
      state.settings.autoReplyText = $("#autoReplyTextInput").value;
      state.settings.autoReply = $("#optAutoReply").checked;
      saveState();
      showToast("Regra de auto-resposta salva!");
    };
    $("#scheduleMsgBtn").onclick = () => {
      const to = normalizeNumber($("#schedNumberInput").value) || state.activeChatNumber;
      const text = $("#schedTextInput").value.trim();
      const delay = Math.max(3, Number($("#schedDelayInput").value) || 10);
      if (!to || !text) { showToast("Informe número e mensagem."); return; }
      const item = { id: uid(), to, text };
      state.scheduled.push(item);
      $("#schedTextInput").value = "";
      renderScheduledList();
      showToast(`Mensagem agendada para ${delay}s!`);
      setTimeout(() => {
        state.scheduled = state.scheduled.filter((x) => x.id !== item.id);
        renderScheduledList();
        sendMessageTo(to, text);
      }, delay * 1000);
    };
    $("#exportBackupBtn").onclick = () => {
      const blob = new Blob([JSON.stringify({ contacts: state.contacts, chats: state.chats, settings: state.settings }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `whatsapp-imune-elite-backup-${state.me.number}.json`;
      a.click();
    };
    $("#importBackupBtn").onclick = () => $("#importBackupInput").click();
    $("#importBackupInput").onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(r.result);
          if (data.contacts) Object.assign(state.contacts, data.contacts);
          if (data.chats) Object.assign(state.chats, data.chats);
          if (data.settings) state.settings = { ...state.settings, ...data.settings };
          saveState();
          syncSettingsUI();
          renderAll();
          showToast("Backup restaurado!");
        } catch { showToast("Arquivo JSON inválido."); }
      };
      r.readAsText(f);
      e.target.value = "";
    };

    // Active Chat Header & Drawer
    $("#mobileBackBtn").onclick = (e) => { e.stopPropagation(); $("#appShell").classList.remove("mobile-chat-open"); };
    $("#headerFavBtn").onclick = () => {
      const c = state.contacts[state.activeChatNumber];
      if (!c) return;
      c.favorite = !c.favorite;
      saveState();
      renderAll();
    };
    $("#headerAudioCallBtn").onclick = () => startCall(state.activeChatNumber, "audio");
    $("#headerVideoCallBtn").onclick = () => startCall(state.activeChatNumber, "video");
    $("#headerSearchToggleBtn").onclick = () => { $("#inChatSearchBar").classList.toggle("hidden"); $("#inChatSearchInput").focus(); };
    $("#closeInChatSearchBtn").onclick = () => { $("#inChatSearchBar").classList.add("hidden"); state.inChatSearch = ""; $("#inChatSearchInput").value = ""; renderMessages(); };
    $("#inChatSearchInput").oninput = (e) => { state.inChatSearch = e.target.value; renderMessages(); };

    const toggleDrawer = () => { $("#infoDrawer").classList.toggle("hidden"); renderDrawer(); };
    $("#headerInfoBtn").onclick = toggleDrawer;
    $("#openInfoBtn").onclick = toggleDrawer;
    $("#closeDrawerBtn").onclick = () => $("#infoDrawer").classList.add("hidden");
    $("#drawerCallAudioBtn").onclick = () => startCall(state.activeChatNumber, "audio");
    $("#drawerCallVideoBtn").onclick = () => startCall(state.activeChatNumber, "video");
    $("#contactNotesInput").oninput = (e) => { const c = state.contacts[state.activeChatNumber]; if (c) { c.notes = e.target.value; saveState(); } };
    $("#archiveChatBtn").onclick = () => { const c = state.contacts[state.activeChatNumber]; if (c) { c.archived = !c.archived; saveState(); renderAll(); } };
    $("#blockPeerBtn").onclick = () => { const c = state.contacts[state.activeChatNumber]; if (c) { c.blocked = !c.blocked; saveState(); renderAll(); } };
    $("#clearChatBtn").onclick = () => { if (state.activeChatNumber) { state.chats[state.activeChatNumber] = []; saveState(); renderAll(); } };

    // WhatsApp Cloud API controls
    $("#waConfigBtn").onclick = () => { refreshWaStatus(); $("#waConfigModal").classList.remove("hidden"); };
    $("#closeWaConfigBtn").onclick = () => $("#waConfigModal").classList.add("hidden");
    $("#waModeToggleBtn").onclick = () => {
      const num = state.activeChatNumber;
      if (!num) return;
      state.waModeByChat[num] = !state.waModeByChat[num];
      renderActiveChat();
    };
    $("#sendWaTemplateBtn").onclick = () => {
      const num = state.activeChatNumber;
      if (!num) return;
      const msg = { id: uid(), from: state.me.number, to: num, text: "[Template WhatsApp: hello_world]", viaWhatsapp: true, ts: Date.now(), status: "sent", reactions: {} };
      if (!state.chats[num]) state.chats[num] = [];
      state.chats[num].push(msg);
      saveState();
      renderMessages();
      sendViaWhatsappCloud(num, msg, "hello_world");
    };

    // Composer
    let typingTimer = null;
    $("#messageInput").oninput = () => {
      const ta = $("#messageInput");
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 110) + "px";
      if (!state.settings.hideTyping && state.activeChatNumber && state.onlinePeers.has(state.activeChatNumber)) {
        transport.send({ type: "typing", from: state.me.number, to: state.activeChatNumber, isTyping: true });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => transport.send({ type: "typing", from: state.me.number, to: state.activeChatNumber, isTyping: false }), 1200);
      }
    };
    $("#messageInput").onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessageTo(state.activeChatNumber, $("#messageInput").value);
        $("#messageInput").value = "";
        $("#messageInput").style.height = "auto";
      }
    };
    $("#sendBtn").onclick = () => {
      sendMessageTo(state.activeChatNumber, $("#messageInput").value);
      $("#messageInput").value = "";
      $("#messageInput").style.height = "auto";
    };
    $("#cancelReplyBtn").onclick = () => { state.replyTo = null; state.editingMessageId = null; $("#replyBar").classList.add("hidden"); };
    $("#emojiBtn").onclick = () => $("#emojiPicker").classList.toggle("hidden");
    $$("#emojiPicker button").forEach((b) => (b.onclick = () => { $("#messageInput").value += b.dataset.emoji; $("#emojiPicker").classList.add("hidden"); $("#messageInput").focus(); }));
    $("#attachBtn").onclick = () => $("#fileInput").click();
    $("#fileInput").onchange = (e) => {
      const f = e.target.files[0];
      if (!f || f.size > 4 * 1024 * 1024) { if (f) showToast("Máximo 4 MB."); return; }
      const r = new FileReader();
      r.onload = () => sendMessageTo(state.activeChatNumber, "", { name: f.name, type: f.type || "application/octet-stream", dataUrl: r.result });
      r.readAsDataURL(f);
      e.target.value = "";
    };
    $("#voiceRecordBtn").onclick = async () => {
      if (state.recorder && state.recorder.state === "recording") { state.recorder.stop(); $("#voiceRecordBtn").classList.remove("recording"); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.recordedChunks = [];
        const rec = new MediaRecorder(stream);
        state.recorder = rec;
        rec.ondataavailable = (ev) => { if (ev.data.size) state.recordedChunks.push(ev.data); };
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const r = new FileReader();
          r.onload = () => sendMessageTo(state.activeChatNumber, "", { name: "audio.webm", type: "audio/webm", dataUrl: r.result });
          r.readAsDataURL(new Blob(state.recordedChunks, { type: "audio/webm" }));
        };
        rec.start();
        $("#voiceRecordBtn").classList.add("recording");
        showToast("Gravando áudio... clique novamente para enviar.");
      } catch { showToast("Microfone indisponível."); }
    };

    // Call controls
    $("#acceptAudioBtn").onclick = () => acceptIncomingCall("audio");
    $("#acceptVideoBtn").onclick = () => acceptIncomingCall("video");
    $("#declineCallBtn").onclick = () => endCall("Chamada recusada", true);
    $("#hangupBtn").onclick = () => endCall("Chamada encerrada", true);
    $("#miniHangupBtn").onclick = () => endCall("Chamada encerrada", true);
    $("#minimizeCallBtn").onclick = () => { $("#callOverlay").classList.add("hidden"); $("#miniCallBar").classList.remove("hidden"); };
    $("#miniExpandCallBtn").onclick = () => { $("#miniCallBar").classList.add("hidden"); $("#callOverlay").classList.remove("hidden"); };
    $("#muteBtn").onclick = () => {
      const c = state.call;
      if (!c) return;
      c.muted = !c.muted;
      if (c.localStream) c.localStream.getAudioTracks().forEach((t) => (t.enabled = !c.muted));
      $("#muteBtn").classList.toggle("active", c.muted);
      updateCallButtonIcons();
    };
    $("#camToggleBtn").onclick = () => {
      const c = state.call;
      if (!c) return;
      c.camOff = !c.camOff;
      if (c.localStream) c.localStream.getVideoTracks().forEach((t) => (t.enabled = !c.camOff));
      $("#camToggleBtn").classList.toggle("active", !c.camOff);
      updateCallButtonIcons();
    };
  }

  setupEvents();
})();

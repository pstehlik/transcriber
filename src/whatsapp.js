const path = require('path');
const fs = require('fs');
const setup = require('./setup');

function getAuthDir() { return path.join(setup.getAppDataPath(), 'whatsapp-auth'); }
function getAudioDir() { return path.join(setup.getAppDataPath(), 'whatsapp-audio'); }

// Connection states: 'not-configured' | 'connecting' | 'connected' | 'disconnected'
let status = 'not-configured';
let sock = null;
let onQR = null;
let onStatusChange = null;
let onVoiceMessage = null;
let retryTimeout = null;

function getStatus() {
  return status;
}

function isConfigured() {
  return fs.existsSync(path.join(getAuthDir(), 'creds.json'));
}

function setStatus(newStatus) {
  if (status === newStatus) return;
  status = newStatus;
  onStatusChange?.(newStatus);
}

async function connect(callbacks) {
  if (sock) return;

  onQR = callbacks.onQR;
  onStatusChange = callbacks.onStatusChange;
  onVoiceMessage = callbacks.onVoiceMessage;

  const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    Browsers,
  } = require('@whiskeysockets/baileys');

  // Silence Baileys' verbose pino logging
  const pino = require('pino');
  const logger = pino({ level: 'silent' });

  fs.mkdirSync(getAuthDir(), { recursive: true });
  fs.mkdirSync(getAudioDir(), { recursive: true });

  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(getAuthDir());

  setStatus('connecting');

  sock = makeWASocket({
    auth: state,
    version,
    logger,
    browser: Browsers.macOS('Transcriber'),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      setStatus('connecting');
      onQR?.(qr);
    }

    if (connection === 'open') {
      setStatus('connected');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      sock = null;

      if (loggedOut) {
        // User logged out from phone — clear auth and stop
        clearAuth();
        setStatus('not-configured');
      } else {
        // Temporary disconnect — retry after delay
        setStatus('disconnected');
        clearTimeout(retryTimeout);
        retryTimeout = setTimeout(() => {
          if (status === 'disconnected') {
            connect(callbacks).catch(() => {
              setStatus('disconnected');
            });
          }
        }, 5000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Skip messages sent by us
      if (msg.key.fromMe) continue;

      // Skip group messages — only process individual chats
      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

      // Check for audio/voice message
      const audioMsg =
        msg.message?.audioMessage ||
        msg.message?.pttMessage?.pttMessage ||
        msg.message?.pttMessage;

      if (!audioMsg) continue;

      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const ext = audioMsg.mimetype?.includes('ogg') ? 'ogg' : 'mp4';
        const senderJid = jid.replace('@s.whatsapp.net', '');

        // Use message timestamp + sender for unique filename
        const ts = msg.messageTimestamp
          ? new Date(Number(msg.messageTimestamp) * 1000)
              .toISOString()
              .replace(/[:.]/g, '-')
              .slice(0, 19)
          : Date.now();
        const fileName = `whatsapp-${senderJid}-${ts}.${ext}`;
        const filePath = path.join(getAudioDir(), fileName);

        fs.writeFileSync(filePath, buffer);

        // Get sender name from push name or phone number
        const senderName = msg.pushName || senderJid;

        onVoiceMessage?.({ filePath, fileName, senderName, senderJid });
      } catch (err) {
        console.error('Failed to download WhatsApp voice message:', err.message);
      }
    }
  });
}

function disconnect() {
  clearTimeout(retryTimeout);
  retryTimeout = null;
  if (sock) {
    sock.end();
    sock = null;
  }
  if (isConfigured()) {
    setStatus('disconnected');
  } else {
    setStatus('not-configured');
  }
}

function logout() {
  clearTimeout(retryTimeout);
  retryTimeout = null;
  if (sock) {
    sock.logout().catch(() => {});
    sock = null;
  }
  clearAuth();
  setStatus('not-configured');
}

function clearAuth() {
  try {
    if (fs.existsSync(getAuthDir())) {
      const files = fs.readdirSync(getAuthDir());
      for (const file of files) {
        fs.unlinkSync(path.join(getAuthDir(), file));
      }
    }
  } catch {
    // ignore cleanup errors
  }
}

module.exports = { connect, disconnect, logout, getStatus, isConfigured };

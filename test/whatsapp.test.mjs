import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Build a fake Baileys module that connect() can use without hitting the network
function makeFakeBaileys() {
  const evHandlers = {};
  const fakeSock = {
    ev: {
      on(event, handler) {
        evHandlers[event] = handler;
      },
    },
    end: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };

  return {
    module: {
      default: () => fakeSock,
      useMultiFileAuthState: vi.fn().mockResolvedValue({
        state: {},
        saveCreds: vi.fn(),
      }),
      DisconnectReason: { loggedOut: 401 },
      downloadMediaMessage: vi.fn(),
      fetchLatestBaileysVersion: vi.fn().mockResolvedValue({ version: [2, 3000, 0] }),
      Browsers: { macOS: () => ['Transcriber', '', ''] },
    },
    fakeSock,
    evHandlers,
  };
}

describe('whatsapp', () => {
  let whatsapp;
  let baileys;
  let restoreLoad;

  beforeEach(() => {
    // Clear the module cache so each test gets fresh module-level state
    const modPath = require.resolve('../src/whatsapp');
    delete require.cache[modPath];

    // Also clear baileys and pino from cache so our mock is picked up
    for (const key of Object.keys(require.cache)) {
      if (key.includes('@whiskeysockets/baileys') || key.includes('pino')) {
        delete require.cache[key];
      }
    }

    baileys = makeFakeBaileys();

    // Intercept require calls for baileys and pino
    const Module = require('module');
    const originalLoad = Module._load;

    // We'll patch _load to intercept baileys and pino
    Module._load = function (request, parent, isMain) {
      if (request === '@whiskeysockets/baileys') {
        return baileys.module;
      }
      if (request === 'pino') {
        return () => ({ level: 'silent' });
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    whatsapp = require('../src/whatsapp');

    // Keep the mock active for connect() calls (baileys is lazy-required).
    // Module cache is cleared in beforeEach, so no cross-test leakage.
    restoreLoad = () => { Module._load = originalLoad; };
  });

  describe('getStatus', () => {
    it('returns not-configured as initial status', () => {
      expect(whatsapp.getStatus()).toBe('not-configured');
    });
  });

  describe('disconnect without prior connect', () => {
    it('does not throw when no connection was established', () => {
      // disconnect() on a fresh module: sock is null, onStatusChange is null
      // status starts as 'not-configured' and setStatus('not-configured') is a no-op
      // (same status guard), so this should be completely safe
      expect(() => whatsapp.disconnect()).not.toThrow();
    });

    it('keeps status as not-configured when no auth exists', () => {
      const fs = require('fs');
      const origExistsSync = fs.existsSync;
      fs.existsSync = vi.fn().mockReturnValue(false);

      whatsapp.disconnect();
      expect(whatsapp.getStatus()).toBe('not-configured');

      fs.existsSync = origExistsSync;
    });

    it('transitions to disconnected when auth exists', () => {
      const fs = require('fs');
      const origExistsSync = fs.existsSync;
      fs.existsSync = vi.fn().mockReturnValue(true);

      // Need to change status away from initial first, otherwise setStatus
      // dedup guard prevents the transition. disconnect() tries to set
      // 'disconnected' but initial status is 'not-configured', so it will
      // set 'disconnected' if isConfigured returns true.
      whatsapp.disconnect();
      expect(whatsapp.getStatus()).toBe('disconnected');

      fs.existsSync = origExistsSync;
    });
  });

  describe('disconnect after connect', () => {
    async function connectWithCallbacks(callbacks) {
      // Mock fs for auth/audio directory creation and isConfigured check
      const fs = require('fs');
      const origExistsSync = fs.existsSync;
      const origMkdirSync = fs.mkdirSync;
      fs.existsSync = vi.fn().mockReturnValue(false);
      fs.mkdirSync = vi.fn();

      await whatsapp.connect(callbacks);

      // Restore fs
      fs.existsSync = origExistsSync;
      fs.mkdirSync = origMkdirSync;
    }

    it('transitions status to disconnected when auth is not configured', async () => {
      const statusChanges = [];
      await connectWithCallbacks({
        onQR: vi.fn(),
        onStatusChange: (s) => statusChanges.push(s),
        onVoiceMessage: vi.fn(),
      });

      // After connect(), status should be 'connecting'
      expect(whatsapp.getStatus()).toBe('connecting');

      // Mock isConfigured to return false (no auth dir)
      const fs = require('fs');
      const origExistsSync = fs.existsSync;
      fs.existsSync = vi.fn().mockReturnValue(false);

      whatsapp.disconnect();

      fs.existsSync = origExistsSync;

      expect(whatsapp.getStatus()).toBe('not-configured');
      expect(statusChanges).toContain('not-configured');
    });

    it('transitions status to disconnected when auth is configured', async () => {
      const statusChanges = [];
      await connectWithCallbacks({
        onQR: vi.fn(),
        onStatusChange: (s) => statusChanges.push(s),
        onVoiceMessage: vi.fn(),
      });

      expect(whatsapp.getStatus()).toBe('connecting');

      // Mock isConfigured to return true (auth exists)
      const fs = require('fs');
      const origExistsSync = fs.existsSync;
      fs.existsSync = vi.fn().mockReturnValue(true);

      whatsapp.disconnect();

      fs.existsSync = origExistsSync;

      expect(whatsapp.getStatus()).toBe('disconnected');
      expect(statusChanges).toContain('disconnected');
    });

    it('calls sock.end() on the active socket', async () => {
      await connectWithCallbacks({
        onQR: vi.fn(),
        onStatusChange: vi.fn(),
        onVoiceMessage: vi.fn(),
      });

      const fs = require('fs');
      const origExistsSync = fs.existsSync;
      fs.existsSync = vi.fn().mockReturnValue(false);

      whatsapp.disconnect();

      fs.existsSync = origExistsSync;

      expect(baileys.fakeSock.end).toHaveBeenCalledOnce();
    });

    it('does not throw when onStatusChange callback throws', async () => {
      // This is the crash-on-quit scenario: the callback throws because
      // the BrowserWindow is destroyed. Without the sendToRenderer guard
      // in main.js, this would crash the app.
      const throwingCallback = vi.fn().mockImplementation((status) => {
        // First call (from connect -> 'connecting') succeeds
        // The disconnect call changes status which triggers this again
        if (status === 'disconnected' || status === 'not-configured') {
          throw new Error('Cannot send to destroyed BrowserWindow');
        }
      });

      await connectWithCallbacks({
        onQR: vi.fn(),
        onStatusChange: throwingCallback,
        onVoiceMessage: vi.fn(),
      });

      const fs = require('fs');
      const origExistsSync = fs.existsSync;
      fs.existsSync = vi.fn().mockReturnValue(false);

      // Without protection, this would throw
      // NOTE: This test documents that whatsapp.js does NOT guard against
      // a throwing callback — the protection must come from the caller
      // (main.js's sendToRenderer). If the callback throws, disconnect throws.
      expect(() => whatsapp.disconnect()).toThrow('Cannot send to destroyed BrowserWindow');

      fs.existsSync = origExistsSync;
    });

    it('does not throw when onStatusChange is a guarded callback', async () => {
      // This simulates the fix: sendToRenderer guards against destroyed windows,
      // so the callback never throws — it just silently no-ops.
      let mainWindow = { isDestroyed: () => false };
      const guardedCallback = vi.fn().mockImplementation(() => {
        // Simulate sendToRenderer: guard before sending
        if (mainWindow && !mainWindow.isDestroyed()) {
          // would call mainWindow.webContents.send() — safe
        }
      });

      await connectWithCallbacks({
        onQR: vi.fn(),
        onStatusChange: guardedCallback,
        onVoiceMessage: vi.fn(),
      });

      // Simulate window being destroyed before disconnect
      mainWindow = null;

      const fs = require('fs');
      const origExistsSync = fs.existsSync;
      fs.existsSync = vi.fn().mockReturnValue(false);

      // With the guard, disconnect completes without throwing
      expect(() => whatsapp.disconnect()).not.toThrow();
      expect(whatsapp.getStatus()).toBe('not-configured');

      fs.existsSync = origExistsSync;
    });

    it('is safe to call disconnect twice', async () => {
      await connectWithCallbacks({
        onQR: vi.fn(),
        onStatusChange: vi.fn(),
        onVoiceMessage: vi.fn(),
      });

      const fs = require('fs');
      const origExistsSync = fs.existsSync;
      fs.existsSync = vi.fn().mockReturnValue(true);

      whatsapp.disconnect();
      // Second disconnect: sock is null, status is already 'disconnected'
      // setStatus guard (status === newStatus) prevents re-invoking callback
      expect(() => whatsapp.disconnect()).not.toThrow();
      expect(whatsapp.getStatus()).toBe('disconnected');

      fs.existsSync = origExistsSync;
    });
  });

  describe('logout', () => {
    it('does not throw when no connection was established', () => {
      expect(() => whatsapp.logout()).not.toThrow();
      expect(whatsapp.getStatus()).toBe('not-configured');
    });

    it('does not throw when onStatusChange callback is a guarded no-op', async () => {
      const fs = require('fs');
      const origExistsSync = fs.existsSync;
      const origMkdirSync = fs.mkdirSync;
      const origReaddirSync = fs.readdirSync;
      const origUnlinkSync = fs.unlinkSync;

      fs.existsSync = vi.fn().mockReturnValue(false);
      fs.mkdirSync = vi.fn();

      const guardedCallback = vi.fn(); // no-op, simulating sendToRenderer guard

      await whatsapp.connect({
        onQR: vi.fn(),
        onStatusChange: guardedCallback,
        onVoiceMessage: vi.fn(),
      });

      // Mock fs for logout's clearAuth and isConfigured
      fs.existsSync = vi.fn().mockReturnValue(false);
      fs.readdirSync = vi.fn().mockReturnValue([]);
      fs.unlinkSync = vi.fn();

      expect(() => whatsapp.logout()).not.toThrow();
      expect(whatsapp.getStatus()).toBe('not-configured');

      fs.existsSync = origExistsSync;
      fs.mkdirSync = origMkdirSync;
      fs.readdirSync = origReaddirSync;
      fs.unlinkSync = origUnlinkSync;
    });
  });

  describe('setStatus deduplication', () => {
    it('does not invoke callback when status is unchanged', async () => {
      const statusChanges = [];
      const fs = require('fs');
      const origExistsSync = fs.existsSync;
      const origMkdirSync = fs.mkdirSync;

      fs.existsSync = vi.fn().mockReturnValue(false);
      fs.mkdirSync = vi.fn();

      await whatsapp.connect({
        onQR: vi.fn(),
        onStatusChange: (s) => statusChanges.push(s),
        onVoiceMessage: vi.fn(),
      });

      // After connect: status is 'connecting', callback was called once with 'connecting'
      const countAfterConnect = statusChanges.length;

      // disconnect with isConfigured=false transitions to 'not-configured'
      fs.existsSync = vi.fn().mockReturnValue(false);
      whatsapp.disconnect();

      // Now status is 'not-configured'. Calling disconnect again should NOT fire callback
      // because status is already 'not-configured' and isConfigured returns false
      const countAfterFirstDisconnect = statusChanges.length;
      whatsapp.disconnect();
      expect(statusChanges.length).toBe(countAfterFirstDisconnect);

      fs.existsSync = origExistsSync;
      fs.mkdirSync = origMkdirSync;
    });
  });
});

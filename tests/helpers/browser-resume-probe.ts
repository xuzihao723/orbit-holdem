import type { BrowserContext, Page } from '@playwright/test';
import type { createSocketClient } from '../../apps/web/src/network/socket-client.js';
import type { ResumeCoordinator } from '../../apps/web/src/network/resume-session.js';

declare global {
  interface Window {
    w22Client: ReturnType<typeof createSocketClient>;
    w22Recovery: ResumeCoordinator;
    dropResumeProbeSockets(): number;
  }
}

// A dotted missing path returns Vite's same-origin 404 without the app shell.
export const probePath = '/__resume-probe.txt';
export async function installProbePage(context: BrowserContext) {
  await context.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    const connections = new Set<WebSocket>();
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (new URL(url).pathname !== '/socket.io/') return;
        connections.add(this);
        this.addEventListener('close', () => connections.delete(this), { once: true });
      }
    };
    window.dropResumeProbeSockets = () => {
      const opened = [...connections].filter((socket) => socket.readyState === NativeSocket.OPEN);
      for (const socket of opened) socket.close(1000);
      return opened.length;
    };
  });
}

export async function bootProbe(page: Page, name?: string) {
  return page.evaluate(async (name) => {
    const clientPath = '/src/network/socket-client.ts';
    const resumePath = '/src/network/resume-session.ts';
    const { createSocketClient } = await import(clientPath);
    const { ResumeCoordinator } = await import(resumePath);
    window.w22Client = createSocketClient();
    window.w22Recovery = new ResumeCoordinator(window.w22Client);
    if (name) {
      await window.w22Client.connect();
      const identity = await window.w22Client.guest(name);
      if (!identity.ok) throw Error(identity.code);
    }
    await window.w22Recovery.start();
    return window.w22Client.store.snapshot.controlReady;
  }, name);
}

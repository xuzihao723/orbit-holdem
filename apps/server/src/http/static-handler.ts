import { readFileSync, statSync, realpathSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};
export function serveStatic(root: string, request: IncomingMessage, response: ServerResponse) {
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.writeHead(405);
    response.end();
    return;
  }
  try {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]!);
    if (
      !path.startsWith('/') ||
      path.includes('\0') ||
      path.includes('\\') ||
      path.split('/').some((s) => s.startsWith('.'))
    )
      throw Error();
    const spa =
      /^\/(?:|rules|play|login|register|reset-password|account|history(?:\/[A-Za-z0-9:_-]{1,128})?|(?:room|table)\/[23456789A-HJ-NP-Z]{6})$/.test(
        path,
      );
    const target = realpathSync(resolve(root, spa ? 'index.html' : '.' + path)),
      base = realpathSync(root);
    if (!target.startsWith(base + sep) || !statSync(target).isFile() || !types[extname(target)])
      throw Error();
    const content = readFileSync(target),
      hashed = !spa && /\/assets\/.+-[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(path);
    response.writeHead(200, {
      'Content-Type': types[extname(target)]!,
      'Content-Length': content.length,
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : 'Not Found');
  }
}

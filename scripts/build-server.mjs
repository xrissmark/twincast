// npm run build:server
// Makes a ready-to-run server package in dist/:
//   dist/twincast-server/        server.js, dashboard/, public/, node_modules/ws, package.json
//   dist/twincast-server-<version>.zip
// On the VPS: unzip, then `node server.js` (needs Node.js 18+, no npm install needed).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Windows' own tar (bsdtar) can write zip files; a GNU tar earlier in PATH (Git Bash) can't.
const WIN_TAR = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe');
const TAR = process.platform === 'win32' && fs.existsSync(WIN_TAR) ? WIN_TAR : 'tar';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'package.json'), 'utf8'));
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'twincast-server');
const ZIP = path.join(DIST, `twincast-server-${pkg.version}.zip`);

const copy = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(OUT, to), { recursive: true });

fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(ZIP, { force: true });
fs.mkdirSync(OUT, { recursive: true });

copy('server/server.js', 'server.js');
copy('server/package.json', 'package.json');
copy('server/dashboard', 'dashboard');
copy('public', 'public');

// Bundle the only dependency (ws has no dependencies of its own).
const wsDir = path.dirname(require.resolve('ws/package.json', { paths: [path.join(ROOT, 'server'), ROOT] }));
fs.cpSync(wsDir, path.join(OUT, 'node_modules', 'ws'), { recursive: true });

fs.writeFileSync(path.join(OUT, 'README.txt'), `TwinCast server ${pkg.version}
==========================

Needs Node.js 18 or newer. No "npm install" needed.

Start:            node server.js
Dashboard:        http://<server>:8080/admin/
Password:         printed on first start and saved in admin-password.txt
                  (or set ADMIN_PASSWORD)

Settings (environment variables):
  PORT=8080            port to listen on
  HOST=::              listen address (default: IPv6 + IPv4)
  ADMIN_PASSWORD=...   dashboard password

HTTPS with Caddy (recommended; lets browser users share, not only watch).
Whole Caddyfile:

  twincast.example.com {
      reverse_proxy localhost:8080
  }

Keep it running with systemd (Linux), /etc/systemd/system/twincast.service:

  [Unit]
  Description=TwinCast server
  After=network.target

  [Service]
  WorkingDirectory=/opt/twincast-server
  ExecStart=/usr/bin/node server.js
  Environment=PORT=8080
  Restart=always
  User=www-data

  [Install]
  WantedBy=multi-user.target

then: sudo systemctl enable --now twincast
(www-data must be able to write admin-password.txt in the folder,
or set ADMIN_PASSWORD in the service.)
`);

fs.writeFileSync(path.join(OUT, 'start-server.bat'), '@echo off\r\ncd /d "%~dp0"\r\nnode server.js\r\npause\r\n');

// Zip with the tar that ships with Windows 10+ (bsdtar), or zip on Linux/macOS.
try {
  if (process.platform === 'win32') execFileSync(TAR, ['-a', '-c', '-f', ZIP, '-C', DIST, 'twincast-server'], { stdio: 'inherit' });
  else execFileSync('zip', ['-qr', ZIP, 'twincast-server'], { cwd: DIST, stdio: 'inherit' });
} catch (e) {
  console.warn('Could not create the zip (' + e.message + '); the folder is ready anyway.');
}

const size = (p) => { try { return (fs.statSync(p).size / 1024).toFixed(0) + ' KB'; } catch { return ''; } };
console.log(`\nServer package ready:\n  ${path.relative(ROOT, OUT)}${path.sep}\n  ${path.relative(ROOT, ZIP)}  ${size(ZIP)}`);

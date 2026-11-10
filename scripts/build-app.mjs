// npm run build:app
// Packages the desktop app for Windows (x64):
//   dist/TwinCast-win32-x64/TwinCast.exe   (run directly, no install)
//   dist/TwinCast-<version>-win-x64.zip       (to send to friends)
// Builds the audio helper first if bin/apploopback.exe is missing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

// Windows' own tar (bsdtar) can write zip files; a GNU tar earlier in PATH (Git Bash) can't.
const WIN_TAR = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe');
const TAR = process.platform === 'win32' && fs.existsSync(WIN_TAR) ? WIN_TAR : 'tar';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const DIST = path.join(ROOT, 'dist');
const HELPER = path.join(ROOT, 'bin', 'apploopback.exe');

if (process.platform !== 'win32') {
  console.error('The desktop app uses Windows-only audio capture; build it on Windows.');
  process.exit(1);
}

if (!fs.existsSync(HELPER)) {
  console.log('bin/apploopback.exe is missing - building it (needs Visual Studio C++ tools)…');
  execFileSync('cmd', ['/c', path.join(ROOT, 'native', 'build.bat')], { cwd: ROOT, stdio: 'inherit' });
  if (!fs.existsSync(HELPER)) { console.error('Audio helper build failed.'); process.exit(1); }
}

// Only the app itself goes in: electron/ + public/ + package.json.
const KEEP = /^\/(electron|public)(\/|$)|^\/package\.json$/;

const [outDir] = await packager({
  dir: ROOT,
  out: DIST,
  name: 'TwinCast',
  executableName: 'TwinCast',
  platform: 'win32',
  arch: 'x64',
  appVersion: pkg.version,
  icon: path.join(ROOT, 'assets', 'icon.ico'),
  overwrite: true,
  asar: true,
  prune: true,
  ignore: (p) => p !== '' && !KEEP.test(p.replace(/\\/g, '/')),
  extraResource: [path.join(ROOT, 'bin')], // -> resources/bin/apploopback.exe
  win32metadata: { CompanyName: 'TwinCast', FileDescription: 'TwinCast', ProductName: 'TwinCast' },
});

const ZIP = path.join(DIST, `TwinCast-${pkg.version}-win-x64.zip`);
fs.rmSync(ZIP, { force: true });
try {
  execFileSync(TAR, ['-a', '-c', '-f', ZIP, '-C', DIST, path.basename(outDir)], { stdio: 'inherit' });
} catch (e) {
  console.warn('Could not create the zip (' + e.message + '); the folder is ready anyway.');
}

const mb = (p) => { try { return (fs.statSync(p).size / 1048576).toFixed(0) + ' MB'; } catch { return ''; } };
console.log(`\nDesktop app ready:\n  ${path.relative(ROOT, path.join(outDir, 'TwinCast.exe'))}\n  ${path.relative(ROOT, ZIP)}  ${mb(ZIP)}`);

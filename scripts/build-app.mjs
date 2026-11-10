// npm run build:app      -> builds the Windows installer into dist/
// npm run release        -> same, then publishes it as a GitHub Release (see release.mjs)
//
// Output:
//   dist/TwinCast-Setup-<version>.exe   installer (per-user, no admin) - send this to friends
//   dist/latest.yml + .blockmap         update info used by the in-app updater
//   dist/win-unpacked/TwinCast.exe      the app, runnable without installing (for testing)
//
// Builds the audio helper first if bin/apploopback.exe is missing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, Platform } from 'electron-builder';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = path.join(ROOT, 'bin', 'apploopback.exe');
export const GITHUB = { owner: 'xrissmark', repo: 'twincast' };

export async function buildApp({ publish = 'never' } = {}) {
  if (process.platform !== 'win32') throw new Error('The desktop app uses Windows-only audio capture; build it on Windows.');
  if (!fs.existsSync(HELPER)) {
    console.log('bin/apploopback.exe is missing - building it (needs Visual Studio C++ tools)…');
    execFileSync('cmd', ['/c', path.join(ROOT, 'native', 'build.bat')], { cwd: ROOT, stdio: 'inherit' });
    if (!fs.existsSync(HELPER)) throw new Error('Audio helper build failed.');
  }
  return build({
    projectDir: ROOT,
    targets: Platform.WINDOWS.createTarget(), // targets/arch come from config.win.target
    publish,
    config: {
      appId: 'io.github.xrissmark.twincast',
      productName: 'TwinCast',
      copyright: 'TwinCast',
      directories: { output: 'dist', buildResources: 'assets' },
      // Only the app itself: electron/ + public/ (+ package.json, node_modules for electron-updater).
      files: ['electron/**/*', 'public/**/*', 'package.json'],
      extraResources: [{ from: 'bin', to: 'bin', filter: ['apploopback.exe'] }], // -> resources/bin/apploopback.exe
      asar: true,
      win: {
        icon: 'assets/icon.ico',
        target: [{ target: 'nsis', arch: ['x64'] }],
        artifactName: 'TwinCast-Setup-${version}.${ext}',
      },
      nsis: {
        oneClick: true,              // no wizard: install and start
        perMachine: false,           // per-user: no admin rights needed, updates install silently
        allowElevation: false,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: 'TwinCast',
        installerIcon: 'assets/icon.ico',
        uninstallerIcon: 'assets/icon.ico',
        deleteAppDataOnUninstall: false, // keep settings (server, name, language...)
      },
      // Where the app looks for updates (GitHub Releases of this repository).
      publish: [{ provider: 'github', owner: GITHUB.owner, repo: GITHUB.repo, releaseType: 'release' }],
    },
  });
}

// Run directly: build only (no upload).
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  buildApp().then((files) => {
    console.log('\nDesktop app ready:');
    for (const f of files) console.log('  ' + path.relative(ROOT, f));
  }).catch((e) => { console.error(e.message || e); process.exit(1); });
}

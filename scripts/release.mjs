// npm run release
// Publishes the current version (package.json "version") as a GitHub Release on
// xrissmark/twincast. Installed apps pick it up within a few hours (or on next start).
//
// Steps:
//   1. checks: clean git tree, version not released yet, you are logged in with `gh`
//   2. builds the server package and the Windows installer
//   3. creates GitHub Release v<version> with installer + latest.yml + blockmap (via gh)
//      (the server zip is attached to the same release)
//
// Before running: raise "version" in package.json (and server/package.json), commit, push.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildApp, GITHUB } from './build-app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tag = `v${pkg.version}`;
const run = (cmd, args, opts = {}) => (execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts }) || '').trim(); // '' when output goes to the screen

function gh(args, opts) {
  const candidates = ['gh', path.join(process.env.ProgramFiles || 'C:/Program Files', 'GitHub CLI', 'gh.exe')];
  for (const c of candidates) {
    try { return run(c, args, opts); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  throw new Error('GitHub CLI (gh) not found. Install it: winget install GitHub.cli');
}

// 1) checks
if (run('git', ['status', '--porcelain'])) throw new Error('Uncommitted changes: commit them before releasing.');
const token = gh(['auth', 'token']);
if (!token) throw new Error('Not logged in to GitHub: run gh auth login');
let exists = false;
try { gh(['release', 'view', tag, '--repo', `${GITHUB.owner}/${GITHUB.repo}`], { stdio: ['ignore', 'pipe', 'ignore'] }); exists = true; } catch {}
if (exists) throw new Error(`${tag} is already released. Raise "version" in package.json first.`);
try { run('git', ['ls-remote', '--exit-code', 'origin', 'HEAD']); } catch { throw new Error('Push your code to GitHub first (git push -u origin main).'); }
let upstream = '';
try { upstream = run('git', ['rev-parse', '@{u}']); } catch {}
if (upstream !== run('git', ['rev-parse', 'HEAD'])) throw new Error('Your latest commit is not on GitHub yet: run git push first.');
console.log(`Releasing TwinCast ${tag} to github.com/${GITHUB.owner}/${GITHUB.repo}`);

// 2) server package
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-server.mjs')], { cwd: ROOT, stdio: 'inherit' });

// 3) installer (built locally; uploaded with gh below - more reliable than the builder's uploader)
await buildApp({ publish: 'never' });

// 4) create the release with everything the updater needs, plus the server package
const dist = path.join(ROOT, 'dist');
const serverVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'package.json'), 'utf8')).version;
const files = [
  `TwinCast-Setup-${pkg.version}.exe`,
  `TwinCast-Setup-${pkg.version}.exe.blockmap`,
  'latest.yml', // tells installed apps about this version - must be in every release
  `twincast-server-${serverVersion}.zip`,
].map((f) => path.join(dist, f));
for (const f of files) if (!fs.existsSync(f)) throw new Error('Missing build output: ' + f);
gh(['release', 'create', tag, ...files, '--repo', `${GITHUB.owner}/${GITHUB.repo}`, '--target', run('git', ['rev-parse', 'HEAD']),
  '--title', `TwinCast ${pkg.version}`, '--notes', `Install: download **TwinCast-Setup-${pkg.version}.exe** and run it. Installed apps update automatically.\n\nServer: \`twincast-server-${serverVersion}.zip\`.`],
  { stdio: 'inherit' });

console.log(`\nReleased: https://github.com/${GITHUB.owner}/${GITHUB.repo}/releases/tag/${tag}`);

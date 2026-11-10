# TwinCast

*(formerly ScreenShare. Old and new versions still work together while everyone updates; the app keeps your saved settings.)*

Share your screen with friends in a **room**. Anyone in the room can **share** or **watch**, and several people can share at once.

Your friends hear **only the apps you pick** (for example Firefox or your game). Discord and everything else on your PC is never sent.

## Choosing the sound you share

The desktop app uses Windows' per-process loopback capture (Windows 10 2004 or newer) through `bin/apploopback.exe`. It records the sound of chosen apps (plus their child processes) directly, not your speakers' mix, so it doesn't matter where each app outputs (headset, Wave Link, and so on).

* **Sharing a window** sends that window's app sound (on by default; untick it to share silently). Browsers send the sound of all their tabs.
* **Sharing the entire screen** gives three choices:
  * **Share all**: everything playing on the PC. Friends' streams playing in TwinCast itself are never sent back, so there's no echo.
  * **All but Discord**: everything except Discord. Apps that start playing after you start sharing are added within a few seconds.
  * **Advanced**: tick exactly the apps to send (Discord included, if you want).
* The choice is remembered for next time.

Click **Share screen** to open the **Screen Share** popup: **What you're streaming** (click to pick a window or screen), **Also share audio** and **Sound configuration** (click to choose Share all / All but Discord / Advanced), and **Stream quality**: resolution 720, 1080, 1440 or Source (your screen's own size) and 15, 30 or 60 fps. It shows the upload needed per viewer, and remembers your choices. While sharing, **Change screen** (the first button) picks another window or screen, sound or quality without stopping: friends keep watching without reconnecting. Browser users get the quality part; the browser then asks what to share.

Audio is sent as 160 kbps stereo Opus.

TwinCast has two parts:

* **The server** (`server/`) runs on a cheap VPS or any always-on machine. It introduces people in a room, serves the web page for browser users, and has an admin **dashboard**. No video or audio passes through it, so it needs very little: about 50 MB of RAM and almost no CPU or bandwidth.
* **The desktop app** (`electron/` + `public/`) is what people use to share with per-app sound. Browser users can also join, from the server's address.

## 1. Run the server

You need Node.js 18 or newer on the server. Copy the `server/` **and** `public/` folders to it (the server serves `public/` as the web client), then:

```bash
cd server
npm install
npm start
```

On first start it prints the dashboard address and a generated password, and saves the password in `server/admin-password.txt`.

| Setting (environment variable) | Default | What it does |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `HOST` | `::` (IPv6 + IPv4) | Listen address |
| `ADMIN_PASSWORD` | generated | Dashboard password |
| `WEB_DIR` | `../public` | Folder with the web client |

**Dashboard:** open `http://your-server:8080/admin/` and enter the password. It shows people online, open rooms (who's in each, who's sharing, how long they've been there, reconnects, IP address), peak usage, recent activity, totals since start, and the server's CPU and memory. It refreshes every 2 seconds. Chat messages are never shown or stored.

**HTTPS (recommended):** put Caddy in front of the server and point a domain at the VPS. Caddy gets a free certificate automatically and forwards WebSockets. With HTTPS, browser users can *share* too, not only watch. A whole `Caddyfile`:

```
twincast.example.com {
    reverse_proxy localhost:8080
}
```

To keep the server running after you log out, use a systemd service, `pm2`, or Docker. To try the server on your own PC, double-click **Start Server.bat** (or `npm run server`).

## 2. Use the desktop app

```bash
npm install
```

```bash
npm run app
```

(or double-click **Start TwinCast.bat**)

1. Type the server address (for example `https://twincast.example.com` or `http://[2804:…]:8080`) and click **Test connection**. It checks that the address is a TwinCast server and that rooms can connect, and shows the response time.
2. Enter your name and a room (for example `game-night`), then click **Join room**.
3. Click **Share screen**, pick the Firefox window or your game, check the sound list, and click **Share**.
4. **Copy invite link** gives a link to the room that opens in any browser.

`bin/apploopback.exe` is already built. To rebuild it you need Visual Studio's "Desktop development with C++": `npm run build:native`.

## Languages

The app and the web page are in **English**, **Português (Brasil)** and **Español**. The language follows the PC's or phone's language, and can be changed on the join screen (top right of the card); the choice is remembered. All texts are in `public/i18n.js`; to add a language, copy the `en` block, translate it and add it to `LANGS`. The server dashboard is in English.

## Drawing on a shared screen (annotations)

People watching in the **desktop app** or a **browser on a PC** can draw on a screen shared from the desktop app, like in Zoom. Hover a shared screen and click **✏️ Annotate**:

| Tool | Key | What it does |
|---|---|---|
| ✏️ Draw | D | Freehand pen. Pick a color and thin/medium/thick |
| ✨ Spotlight | S | Glowing marker that fades away a moment after you stop |
| ✔ Stamp | M | ✔ ✖ ★ ❤ ➜ ?, placed with a click |
| T Text | T | Click, type, Enter (Esc cancels) |
| 🧽 Eraser | E | Drag over marks to remove them (your own; the sharer can erase anyone's) |
| ↶ ↷ | Ctrl+Z / Ctrl+Y | Undo / redo your changes |
| 🗑 | | **Clear my marks**, or **Clear all marks** (sharer) |

* Everyone watching sees the marks, with the author's name while they draw. People who join later see the marks already there.
* **The person sharing sees the marks on their real screen.** The app puts a transparent, click-through layer over the shared screen or window, and it follows the window when you move it. Windows hides it from screen capture, so viewers don't get the marks twice in the video (needs Windows 10 2004 or newer).
* While sharing, the **pencil switch** at the right of the bottom bar turns annotations on or off (remembered for next time). Turning it off also clears all marks. While it's on, the **broom** next to it clears all marks. Marks also disappear when sharing stops or you change screen.
* Phones and tablets see the marks but can't draw. Nobody can draw on a screen shared from a browser (the browser can't show the marks on the sharer's screen); viewers see a greyed-out **Annotations off** button explaining why.
* Games in **exclusive fullscreen** don't show the sharer's layer (Windows doesn't allow anything on top of them). Use borderless/windowed mode to see the marks while playing; viewers always see them.

## Building

```bash
npm run build:server
```

Makes `dist/twincast-server/` and `dist/twincast-server-<version>.zip` (about 120 KB). It contains the server, dashboard, web client and its one dependency, so on the VPS you only unzip it and run `node server.js` (no `npm install`). A `README.txt` inside has the Caddy and systemd setup.

```bash
npm run build:app
```

Makes `dist/TwinCast-win32-x64/TwinCast.exe` (runs without installing) and `dist/TwinCast-<version>-win-x64.zip` (about 150 MB) to send to friends. It includes the audio helper, and builds it first if `bin/apploopback.exe` is missing. Windows only.

`npm run build` runs both.

## Choosing what to watch

Nothing plays until you choose it. Streams that are live appear in a **Live now** bar above the stage; click one to watch it. You can watch several at once, and **Stop watching** (the eye button on a stream) closes it. A sharer only sends their stream to people who are watching it, so each extra person who isn't watching costs the sharer no upload. (People on an older version of TwinCast still receive every stream automatically.)

## Joining from a browser

Open the server's address (or an invite link) in any browser, enter a name and room, and join. No install needed.

| Friend wants to… | Use |
|---|---|
| Watch only | Any browser and the invite link |
| Share a screen with sound from one app (no Discord) | The desktop app, with the server address in **Server address** |
| Share from a browser | Chrome or Edge, and the server must use **HTTPS**: share a **tab** with "Share tab audio" to send that tab's sound. Firefox can share video but no audio. |

## Peer-to-peer connections

There is no relay. Video and audio always go directly between the people in a room (WebRTC), preferably over IPv6. A public STUN server (Google) is used only so each PC learns its own public address; no media passes through it.

* People with IPv6 connect directly. Most Brazilian providers support it; check at test-ipv6.com.
* Two people who both have only IPv4 behind CGNAT may not be able to connect to each other. They show **can't connect** in the People list.
* **Radmin VPN or ZeroTier** also work as a shared network between friends.

## Files

* `server/server.js`: the room/signaling server, health check and dashboard API.
* `server/dashboard/`: the admin dashboard page.
* `public/i18n.js`: all on-screen texts (EN / PT-BR / ES).
* `public/`: the web client (rooms, mesh WebRTC, chat, focus/fullscreen, volume per stream). Used by browsers and by the desktop app.
* `electron/`: the desktop app (window picker and per-app audio bridge).
* `native/apploopback.cpp`: the per-process audio capture helper (build with `nativeuild.bat`).
* `test/signaling.test.js`: server tests (`npm test`).

## Troubleshooting

* **Test connection says it can't reach the server:** check the address and port, that the server is running, and that the VPS firewall (and the provider's security group) allows the port.
* **Test connection says the WebSocket is blocked:** your proxy isn't forwarding WebSockets on `/ws`. Caddy does this automatically; nginx needs the `Upgrade` headers.

* **`npm run app` says Electron isn't installed:** run `node node_modules/electron/install.js`.
* **An app isn't in the sound list:** an app only appears after it has played sound at least once. Start the music or game sound, then open **Share screen** again.
* **A friend sees "Click to watch":** their browser blocked autoplay with sound. One click fixes it.
* **The stream is laggy with many viewers:** every viewer gets their own copy of your stream. Pick 720p, or ask someone with a faster upload to share.

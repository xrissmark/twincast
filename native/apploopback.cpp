// apploopback.exe - capture the audio of ONE application (and its child processes)
// using the Windows 10 2004+ process-loopback API. Everything else (Discord, system
// sounds, your friends' voices...) is NOT captured.
//
// Usage:
//   apploopback list                         -> JSON list of apps that have audio sessions
//   apploopback resolve --hwnd <HWND>        -> JSON {pid,name} of the app owning a window
//   apploopback capture --pid <PID> [--exclude] [--parent <PID>]
//   apploopback capture --hwnd <HWND> [--parent <PID>]
//   apploopback track --hwnd <HWND> [--overlay <HWND>] [--parent <PID>]
//        -> JSON lines with the window's position (for the annotation overlay)
//        -> raw PCM on stdout: 48000 Hz, stereo, signed 16-bit little endian
//
// Build: native\build.bat (MSVC)

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <audiopolicy.h>
#include <dwmapi.h>
#include <tlhelp32.h>
#include <io.h>
#include <fcntl.h>
#include <stdio.h>
#include <string>
#include <vector>
#include <map>
#include <set>

#pragma comment(lib, "mmdevapi.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "dwmapi.lib")

static const UINT32 SAMPLE_RATE = 48000;
static const UINT16 CHANNELS = 2;
static DWORD g_seconds = 0; // --seconds N: stop after N seconds (testing)

struct ProcInfo { DWORD ppid; std::wstring exe; };

static std::map<DWORD, ProcInfo> SnapshotProcesses() {
    std::map<DWORD, ProcInfo> m;
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return m;
    PROCESSENTRY32W pe{ sizeof(pe) };
    if (Process32FirstW(snap, &pe)) {
        do { m[pe.th32ProcessID] = { pe.th32ParentProcessID, pe.szExeFile }; } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);
    return m;
}

// Walk up the parent chain while the parent has the same exe name, so that e.g. a
// Firefox content/utility process resolves to the main firefox.exe (whose process
// tree contains every Firefox audio stream).
static DWORD ResolveRoot(DWORD pid, const std::map<DWORD, ProcInfo>& procs) {
    std::set<DWORD> seen;
    while (true) {
        auto it = procs.find(pid);
        if (it == procs.end() || seen.count(pid)) return pid;
        seen.insert(pid);
        auto parent = procs.find(it->second.ppid);
        if (parent == procs.end() || parent->first == pid) return pid;
        if (_wcsicmp(parent->second.exe.c_str(), it->second.exe.c_str()) != 0) return pid;
        pid = parent->first;
    }
}

static std::string Utf8(const std::wstring& w) {
    if (w.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string s(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, nullptr, nullptr);
    return s;
}

static std::string JsonStr(const std::string& s) {
    std::string o = "\"";
    for (char c : s) {
        if (c == '"' || c == '\\') { o += '\\'; o += c; }
        else if ((unsigned char)c < 0x20) { char b[8]; sprintf_s(b, "\\u%04x", c); o += b; }
        else o += c;
    }
    return o + "\"";
}

static std::wstring ExeName(DWORD pid, const std::map<DWORD, ProcInfo>& procs) {
    auto it = procs.find(pid);
    return it == procs.end() ? L"unknown" : it->second.exe;
}

// ---------------------------------------------------------------- list
static int CmdList() {
    auto procs = SnapshotProcesses();
    std::map<DWORD, bool> apps; // root pid -> currently playing
    IMMDeviceEnumerator* en = nullptr;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&en)))) {
        printf("[]\n"); return 1;
    }
    IMMDeviceCollection* devs = nullptr;
    en->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &devs);
    UINT count = 0;
    if (devs) devs->GetCount(&count);
    for (UINT i = 0; i < count; i++) {
        IMMDevice* dev = nullptr;
        if (FAILED(devs->Item(i, &dev))) continue;
        IAudioSessionManager2* mgr = nullptr;
        if (SUCCEEDED(dev->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void**)&mgr))) {
            IAudioSessionEnumerator* se = nullptr;
            if (SUCCEEDED(mgr->GetSessionEnumerator(&se))) {
                int n = 0; se->GetCount(&n);
                for (int j = 0; j < n; j++) {
                    IAudioSessionControl* c = nullptr;
                    if (FAILED(se->GetSession(j, &c))) continue;
                    IAudioSessionControl2* c2 = nullptr;
                    if (SUCCEEDED(c->QueryInterface(IID_PPV_ARGS(&c2)))) {
                        DWORD pid = 0; c2->GetProcessId(&pid);
                        AudioSessionState st; c2->GetState(&st);
                        if (pid != 0 && c2->IsSystemSoundsSession() != S_OK) {
                            DWORD root = ResolveRoot(pid, procs);
                            apps[root] = apps[root] || st == AudioSessionStateActive;
                        }
                        c2->Release();
                    }
                    c->Release();
                }
                se->Release();
            }
            mgr->Release();
        }
        dev->Release();
    }
    if (devs) devs->Release();
    en->Release();

    printf("[");
    bool first = true;
    for (auto& a : apps) {
        printf("%s{\"pid\":%lu,\"name\":%s,\"playing\":%s}", first ? "" : ",", a.first,
               JsonStr(Utf8(ExeName(a.first, procs))).c_str(), a.second ? "true" : "false");
        first = false;
    }
    printf("]\n");
    return 0;
}

// ---------------------------------------------------------------- capture
class ActivateHandler : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
    LONG ref = 1;
public:
    HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    HRESULT hr = E_FAIL;
    IAudioClient* client = nullptr;
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler))
            *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
        else if (riid == __uuidof(IAgileObject))
            *ppv = static_cast<IAgileObject*>(this);
        else { *ppv = nullptr; return E_NOINTERFACE; }
        AddRef(); return S_OK;
    }
    STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&ref); }
    STDMETHODIMP_(ULONG) Release() override { ULONG r = InterlockedDecrement(&ref); if (!r) delete this; return r; }
    STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
        HRESULT hrAct = E_FAIL; IUnknown* unk = nullptr;
        hr = op->GetActivateResult(&hrAct, &unk);
        if (SUCCEEDED(hr)) hr = hrAct;
        if (SUCCEEDED(hr) && unk) hr = unk->QueryInterface(IID_PPV_ARGS(&client));
        if (unk) unk->Release();
        SetEvent(done);
        return S_OK;
    }
};

static int Fail(const char* what, HRESULT hr) {
    fprintf(stderr, "ERROR %s (0x%08lx)\n", what, (unsigned long)hr);
    return 2;
}

static int CmdCapture(DWORD pid, bool exclude, DWORD parentPid) {
    _setmode(_fileno(stdout), _O_BINARY);

    AUDIOCLIENT_ACTIVATION_PARAMS params{};
    params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    params.ProcessLoopbackParams.TargetProcessId = pid;
    params.ProcessLoopbackParams.ProcessLoopbackMode = exclude
        ? PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
        : PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
    PROPVARIANT pv{};
    pv.vt = VT_BLOB;
    pv.blob.cbSize = sizeof(params);
    pv.blob.pBlobData = (BYTE*)&params;

    ActivateHandler* handler = new ActivateHandler();
    IActivateAudioInterfaceAsyncOperation* op = nullptr;
    HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &pv, handler, &op);
    if (FAILED(hr)) return Fail("ActivateAudioInterfaceAsync (needs Windows 10 2004+)", hr);
    WaitForSingleObject(handler->done, INFINITE);
    if (op) op->Release();
    if (FAILED(handler->hr)) return Fail("activation", handler->hr);
    IAudioClient* client = handler->client;

    WAVEFORMATEX fmt{};
    fmt.wFormatTag = WAVE_FORMAT_PCM;
    fmt.nChannels = CHANNELS;
    fmt.nSamplesPerSec = SAMPLE_RATE;
    fmt.wBitsPerSample = 16;
    fmt.nBlockAlign = fmt.nChannels * fmt.wBitsPerSample / 8;
    fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

    hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
        200000 /* 20 ms */, 0, &fmt, nullptr);
    if (FAILED(hr)) return Fail("IAudioClient::Initialize", hr);

    IAudioCaptureClient* cap = nullptr;
    hr = client->GetService(IID_PPV_ARGS(&cap));
    if (FAILED(hr)) return Fail("GetService", hr);
    HANDLE ev = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    client->SetEventHandle(ev);
    hr = client->Start();
    if (FAILED(hr)) return Fail("Start", hr);

    HANDLE parent = parentPid ? OpenProcess(SYNCHRONIZE, FALSE, parentPid) : nullptr;
    fprintf(stderr, "READY pid=%lu\n", (unsigned long)pid);
    fflush(stderr);

    std::vector<BYTE> zeros;
    bool debug = GetEnvironmentVariableW(L"APPLOOPBACK_DEBUG", nullptr, 0) > 0;
    unsigned long long totalFrames = 0, wakes = 0, polls = 0;
    ULONGLONG startTick = GetTickCount64();
    while (true) {
        if (parent && WaitForSingleObject(parent, 0) == WAIT_OBJECT_0) break;
        if (g_seconds && GetTickCount64() - startTick > g_seconds * 1000ULL) break;
        // Wait for the audio event, but also poll every 10 ms: some audio drivers /
        // virtual mixers never signal the event for process-loopback streams.
        DWORD wr = WaitForSingleObject(ev, 10);
        if (wr == WAIT_OBJECT_0) wakes++;
        if (debug && (++polls % 100) == 0) { fprintf(stderr, "wakes=%llu frames=%llu\n", wakes, totalFrames); fflush(stderr); }
        UINT32 packet = 0;
        while (SUCCEEDED(cap->GetNextPacketSize(&packet)) && packet > 0) {
            BYTE* data = nullptr; UINT32 frames = 0; DWORD flags = 0;
            HRESULT gb = cap->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
            if (FAILED(gb) || gb == AUDCLNT_S_BUFFER_EMPTY) {
                if (debug) { fprintf(stderr, "GetBuffer hr=0x%08lx packet=%u\n", (unsigned long)gb, packet); fflush(stderr); }
                break;
            }
            totalFrames += frames;
            size_t bytes = (size_t)frames * fmt.nBlockAlign;
            const BYTE* out = data;
            if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                if (zeros.size() < bytes) zeros.assign(bytes, 0);
                out = zeros.data();
            }
            size_t w = fwrite(out, 1, bytes, stdout);
            cap->ReleaseBuffer(frames);
            if (w != bytes) goto done; // parent closed the pipe
        }
        fflush(stdout);
    }
done:
    if (debug) fprintf(stderr, "END wakes=%llu polls=%llu frames=%llu\n", wakes, polls, totalFrames);
    client->Stop();
    return 0;
}

// First visible window above h in the z-order (may be the overlay itself).
static HWND VisibleAbove(HWND h) {
    HWND w = GetWindow(h, GW_HWNDPREV);
    while (w && !IsWindowVisible(w)) w = GetWindow(w, GW_HWNDPREV);
    return w;
}
static bool IsAbove(HWND w, HWND h) { // is w anywhere above h?
    for (HWND x = GetWindow(h, GW_HWNDPREV); x; x = GetWindow(x, GW_HWNDPREV)) if (x == w) return true;
    return false;
}

// Keep the overlay directly above the shared window, so windows on top of the shared
// window also cover the marks. Windows refuses to *raise* another program's window
// with HWND_TOP, but allows topmost -> not-topmost (which lands at the top of the
// normal windows); lowering it under a given window is always allowed.
static void KeepOverlayAbove(HWND target, HWND overlay) {
    const UINT f = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING;
    HWND above = VisibleAbove(target);
    if (above == overlay) return;
    if (!IsAbove(overlay, target)) {
        SetWindowPos(overlay, HWND_TOPMOST, 0, 0, 0, 0, f);
        SetWindowPos(overlay, HWND_NOTOPMOST, 0, 0, 0, 0, f);
        above = VisibleAbove(target);
        if (above == overlay) return;
    }
    if (above && !(GetWindowLongPtr(above, GWL_EXSTYLE) & WS_EX_TOPMOST))
        SetWindowPos(overlay, above, 0, 0, 0, 0, f); // just under the window that covers the target
}

// track: follow a shared window for the annotation overlay.
// Prints {"x","y","w","h","min"} (physical pixels) whenever the window moves/resizes,
// {"gone":1} when it closes, and keeps the overlay window just above it in z-order.
static int CmdTrack(HWND target, HWND overlay, DWORD parentPid) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    setvbuf(stdout, nullptr, _IONBF, 0);
    HANDLE parent = parentPid ? OpenProcess(SYNCHRONIZE, FALSE, parentPid) : nullptr;
    RECT last = { -1, -1, -1, -1 }; int lastMin = -1;
    for (;;) {
        if (parent && WaitForSingleObject(parent, 0) == WAIT_OBJECT_0) return 0;
        if (!IsWindow(target)) { printf("{\"gone\":1}\n"); return 0; }
        if (overlay && !IsWindow(overlay)) return 0;
        int min = IsIconic(target) || !IsWindowVisible(target) ? 1 : 0;
        RECT r;
        if (FAILED(DwmGetWindowAttribute(target, DWMWA_EXTENDED_FRAME_BOUNDS, &r, sizeof r))) GetWindowRect(target, &r);
        if (min != lastMin || memcmp(&r, &last, sizeof r) != 0) {
            printf("{\"x\":%ld,\"y\":%ld,\"w\":%ld,\"h\":%ld,\"min\":%d}\n", r.left, r.top, r.right - r.left, r.bottom - r.top, min);
            last = r; lastMin = min;
        }
        if (overlay && !min) KeepOverlayAbove(target, overlay);
        Sleep(30);
    }
}

static DWORD PidFromHwnd(unsigned long long hwnd) {
    DWORD pid = 0;
    GetWindowThreadProcessId((HWND)(ULONG_PTR)hwnd, &pid);
    return pid;
}

int wmain(int argc, wchar_t** argv) {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (argc < 2) { fprintf(stderr, "usage: apploopback list | resolve --hwnd N | capture --pid N [--exclude] [--parent N]\n"); return 1; }
    std::wstring cmd = argv[1];
    DWORD pid = 0, parentPid = 0; unsigned long long hwnd = 0, overlayHwnd = 0; bool exclude = false;
    for (int i = 2; i < argc; i++) {
        std::wstring a = argv[i];
        if (a == L"--pid" && i + 1 < argc) pid = wcstoul(argv[++i], nullptr, 10);
        else if (a == L"--hwnd" && i + 1 < argc) hwnd = wcstoull(argv[++i], nullptr, 10);
        else if (a == L"--parent" && i + 1 < argc) parentPid = wcstoul(argv[++i], nullptr, 10);
        else if (a == L"--seconds" && i + 1 < argc) g_seconds = wcstoul(argv[++i], nullptr, 10);
        else if (a == L"--exclude") exclude = true;
        else if (a == L"--overlay" && i + 1 < argc) overlayHwnd = wcstoull(argv[++i], nullptr, 10);
    }
    if (cmd == L"list") return CmdList();
    if (cmd == L"track") return CmdTrack((HWND)(ULONG_PTR)hwnd, (HWND)(ULONG_PTR)overlayHwnd, parentPid);

    auto procs = SnapshotProcesses();
    if (hwnd) pid = PidFromHwnd(hwnd);
    if (!pid) { fprintf(stderr, "ERROR no process found\n"); printf("null\n"); return 1; }
    pid = ResolveRoot(pid, procs);

    if (cmd == L"resolve") {
        printf("{\"pid\":%lu,\"name\":%s}\n", pid, JsonStr(Utf8(ExeName(pid, procs))).c_str());
        return 0;
    }
    if (cmd == L"capture") return CmdCapture(pid, exclude, parentPid);
    fprintf(stderr, "unknown command\n");
    return 1;
}

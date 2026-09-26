'use strict';
// A tiny Windows-only helper for the nick roller: one long-lived PowerShell process hosting a
// compiled C# class, driven over stdin/stdout one line at a time. It can do exactly seven things (read-only except click, path and fsfix):
//   fg                   -> the foreground window's handle, process name and client-area rect
//   cap x y w h          -> screenshot of that screen rectangle, written as raw BGRA to the file
//                           path fixed at startup (big frames don't belong on a pipe)
//   click x y hwnd       -> left click at x,y - ONLY if hwnd is still the foreground window, so a
//                           roll can never click into some other app you alt-tabbed to
//   path hwnd dt x y ... -> glide the mouse through up to 400 points, dt ms apart (same focus rule)
//   cursor               -> current mouse position (to notice you taking the mouse back)
//   diag a b             -> stacking order + fullscreen state, for the Alt+T visibility check
//   fsfix 0|1            -> F11 fix: make a foreground, exactly-fullscreen Minecraft window 1px taller
// All arguments are integers parsed and range-checked on the C# side; nothing from the user or
// the log is ever interpolated into the script. No npm/native dependencies: the C# is compiled
// once at startup with the .NET Framework that ships with Windows.
const { spawn } = require('child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class SolarHelper {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public MOUSEINPUT mi; }
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  public static void Init() { SetProcessDPIAware(); }
  public static string Fg() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "err nofg";
    RECT r; GetClientRect(h, out r);
    POINT p = new POINT(); ClientToScreen(h, ref p);
    uint pid; GetWindowThreadProcessId(h, out pid);
    string name = "";
    try { name = Process.GetProcessById((int)pid).ProcessName; } catch { }
    return "ok " + h.ToInt64() + " " + p.X + " " + p.Y + " " + (r.R - r.L) + " " + (r.B - r.T) + " " + Convert.ToBase64String(Encoding.UTF8.GetBytes(name));
  }
  public static string Cap(int x, int y, int w, int h, string path) {
    using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
      using (Graphics g = Graphics.FromImage(bmp)) g.CopyFromScreen(x, y, 0, 0, new Size(w, h));
      BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      byte[] buf = new byte[w * h * 4];
      for (int row = 0; row < h; row++) Marshal.Copy(d.Scan0 + row * d.Stride, buf, row * w * 4, w * 4);
      bmp.UnlockBits(d);
      File.WriteAllBytes(path, buf);
    }
    return "ok " + w + " " + h;
  }
  public static string Click(int x, int y, long hwnd) {
    if (GetForegroundWindow().ToInt64() != hwnd) return "err notfg";
    SetCursorPos(x, y);
    INPUT[] inp = new INPUT[2];
    inp[0].type = 0; inp[0].mi.flags = 0x0002; // LEFTDOWN
    inp[1].type = 0; inp[1].mi.flags = 0x0004; // LEFTUP
    SendInput(2, inp, Marshal.SizeOf(typeof(INPUT)));
    return "ok";
  }
  // Plays a mouse path point by point, dt ms apart - timed here rather than one pipe round-trip
  // per point, so the motion stays smooth. Aborts the moment hwnd stops being the foreground.
  public static string Path(long hwnd, int dt, long[] pts) {
    for (int i = 0; i + 1 < pts.Length; i += 2) {
      if (GetForegroundWindow().ToInt64() != hwnd) return "err notfg";
      SetCursorPos((int)pts[i], (int)pts[i + 1]);
      System.Threading.Thread.Sleep(dt);
    }
    return "ok";
  }
  // Read-only diagnostics for "why can't I see the popup over my game": stacking position of the
  // foreground window and of two of our windows (a, b), plus the foreground window's style and
  // Windows' own fullscreen state (SHQueryUserNotificationState).
  [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [StructLayout(LayoutKind.Sequential)] struct MONINFO { public int cb; public RECT mon, work; public uint flags; }
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONINFO i);
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int s);
  public static string Diag(long a, long b) {
    IntPtr fg = GetForegroundWindow();
    int pos = 0, pf = -1, pa = -1, pb = -1;
    for (IntPtr h = GetTopWindow(IntPtr.Zero); h != IntPtr.Zero; h = GetWindow(h, 2)) {
      if (!IsWindowVisible(h)) continue; pos++;
      if (h == fg && pf < 0) pf = pos;
      if (h.ToInt64() == a && pa < 0) pa = pos;
      if (h.ToInt64() == b && pb < 0) pb = pos;
    }
    int ex = GetWindowLong(fg, -20), st = GetWindowLong(fg, -16);
    RECT r; GetWindowRect(fg, out r);
    MONINFO mi = new MONINFO(); mi.cb = Marshal.SizeOf(typeof(MONINFO)); GetMonitorInfo(MonitorFromWindow(fg, 2), ref mi);
    bool covers = r.L <= mi.mon.L && r.T <= mi.mon.T && r.R >= mi.mon.R && r.B >= mi.mon.B;
    int q = 0; SHQueryUserNotificationState(out q);
    uint pid; GetWindowThreadProcessId(fg, out pid); string pn = "";
    try { pn = Process.GetProcessById((int)pid).ProcessName; } catch { }
    return "ok " + pf + " " + pa + " " + pb + " " + ((ex & 0x8) != 0 ? 1 : 0) + " " + ((st & unchecked((int)0x80000000)) != 0 ? 1 : 0) + " " + (covers ? 1 : 0) + " " + q + " " + Convert.ToBase64String(Encoding.UTF8.GetBytes(pn));
  }
  // F11 fix. The NVIDIA OpenGL driver puts a window that EXACTLY covers the monitor into an exclusive
  // presentation mode where Windows draws nothing else on top - no overlay, no popups. Making the
  // game window 1px taller keeps it covering the whole screen (taskbar still hidden, looks identical)
  // but the driver no longer goes exclusive. Only ever touches a foreground Minecraft (java/javaw)
  // window, and never activates it or changes the stacking order.
  // Returns: "ok <isMinecraftForeground> <exactFullscreen> <resized>".
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  public static string FsFix(int apply) {
    IntPtr fg = GetForegroundWindow();
    uint pid; GetWindowThreadProcessId(fg, out pid); string pn = "";
    try { pn = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { }
    bool mc = pn == "javaw" || pn == "java";
    if (!mc) return "ok 0 0 0";
    RECT r; GetWindowRect(fg, out r);
    MONINFO mi = new MONINFO(); mi.cb = Marshal.SizeOf(typeof(MONINFO)); GetMonitorInfo(MonitorFromWindow(fg, 2), ref mi);
    bool exact = r.L == mi.mon.L && r.T == mi.mon.T && r.R == mi.mon.R && r.B == mi.mon.B;
    bool done = false;
    // SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER
    if (exact && apply == 1) done = SetWindowPos(fg, IntPtr.Zero, mi.mon.L, mi.mon.T, mi.mon.R - mi.mon.L, mi.mon.B - mi.mon.T + 1, 0x214);
    return "ok 1 " + (exact ? 1 : 0) + " " + (done ? 1 : 0);
  }
  public static string Cursor() { POINT p; GetCursorPos(out p); return "ok " + p.X + " " + p.Y; }
}
'@
[SolarHelper]::Init()
$capPath = $env:SOLAR_CAP_PATH
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $a = $line.Trim().Split(' ')
  $n = @()
  for ($i = 1; $i -lt $a.Length; $i++) { $v = 0L; if (-not [long]::TryParse($a[$i], [ref]$v)) { $n = $null; break }; $n += $v }
  # Screen coordinates/sizes must be sane; only a window handle may be a large number.
  $coordOk = { param($vals) -not ($vals | Where-Object { $_ -lt -100000 -or $_ -gt 100000 }) }
  try {
    if ($n -eq $null) { $out = 'err badargs' }
    elseif ($a[0] -eq 'fg' -and $n.Count -eq 0) { $out = [SolarHelper]::Fg() }
    elseif ($a[0] -eq 'cursor' -and $n.Count -eq 0) { $out = [SolarHelper]::Cursor() }
    elseif ($a[0] -eq 'cap' -and $n.Count -eq 4 -and (& $coordOk $n) -and $n[2] -gt 0 -and $n[3] -gt 0 -and $n[2] * $n[3] -le 40000000) { $out = [SolarHelper]::Cap($n[0], $n[1], $n[2], $n[3], $capPath) }
    elseif ($a[0] -eq 'click' -and $n.Count -eq 3 -and (& $coordOk $n[0..1]) -and $n[2] -gt 0) { $out = [SolarHelper]::Click($n[0], $n[1], $n[2]) }
    elseif ($a[0] -eq 'fsfix' -and $n.Count -eq 1 -and ($n[0] -eq 0 -or $n[0] -eq 1)) { $out = [SolarHelper]::FsFix([int]$n[0]) }
    elseif ($a[0] -eq 'diag' -and $n.Count -eq 2 -and $n[0] -ge 0 -and $n[1] -ge 0) { $out = [SolarHelper]::Diag($n[0], $n[1]) }
    elseif ($a[0] -eq 'path' -and $n.Count -ge 4 -and $n.Count -le 802 -and ($n.Count % 2) -eq 0 -and $n[0] -gt 0 -and $n[1] -ge 1 -and $n[1] -le 50 -and (& $coordOk $n[2..($n.Count - 1)])) {
      $out = [SolarHelper]::Path($n[0], [int]$n[1], [long[]]$n[2..($n.Count - 1)])
    }
    else { $out = 'err badcmd' }
  } catch { $out = 'err ' + ($_.Exception.Message -replace '\s+', ' ') }
  [Console]::Out.WriteLine($out)
}
`;

class WinHelper {
  constructor(capPath) {
    this.capPath = capPath;
    this.proc = null;
    this.pending = [];
    this.buf = '';
  }

  start() {
    if (this.proc) return this.ready;
    if (process.platform !== 'win32') return Promise.reject(new Error('The nick roller only works on Windows.'));
    const env = { ...process.env, SOLAR_CAP_PATH: this.capPath };
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    this.proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    this.proc.stderr.on('data', (d) => { err += d; });
    this.ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => { reject(new Error('helper did not start: ' + err.slice(0, 200))); this.stop(); }, 20000);
      this.pending.push({ resolve: () => { clearTimeout(t); resolve(); }, reject });
    });
    this.proc.stdout.on('data', (d) => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        const p = this.pending.shift();
        if (p) p.resolve(line);
      }
    });
    this.proc.on('exit', () => {
      for (const p of this.pending.splice(0)) p.reject(new Error('helper exited' + (err ? ': ' + err.slice(0, 200) : '')));
      this.proc = null;
    });
    return this.ready;
  }

  request(cmd, timeoutMs = 5000) {
    if (!this.proc) return Promise.reject(new Error('helper not running'));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('helper timed out on ' + cmd.split(' ')[0])), timeoutMs);
      this.pending.push({ resolve: (l) => { clearTimeout(t); resolve(l); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.proc.stdin.write(cmd + '\n');
    });
  }

  async foreground() {
    const r = (await this.request('fg')).split(' ');
    if (r[0] !== 'ok') return null;
    return { hwnd: r[1], x: +r[2], y: +r[3], width: +r[4], height: +r[5], process: Buffer.from(r[6] || '', 'base64').toString('utf8') };
  }

  async capture(x, y, w, h) {
    const r = await this.request(`cap ${x | 0} ${y | 0} ${w | 0} ${h | 0}`);
    if (!r.startsWith('ok')) throw new Error('capture failed: ' + r);
  }

  async click(x, y, hwnd) { return (await this.request(`click ${x | 0} ${y | 0} ${String(hwnd).replace(/\D/g, '')}`)) === 'ok'; }

  // Moves the mouse along points ([{x,y}], at most 400) dt ms apart. false = focus was lost.
  async movePath(points, dt, hwnd) {
    const pts = points.slice(0, 400).map((p) => `${p.x | 0} ${p.y | 0}`).join(' ');
    const r = await this.request(`path ${String(hwnd).replace(/\D/g, '')} ${Math.max(1, Math.min(50, dt | 0))} ${pts}`, points.length * dt + 3000);
    return r === 'ok';
  }

  // Stacking/fullscreen snapshot (see Diag in the C# above). a/b are our window handles.
  async diag(a, b) {
    const r = (await this.request(`diag ${String(a || 0).replace(/\D/g, '') || 0} ${String(b || 0).replace(/\D/g, '') || 0}`)).split(' ');
    if (r[0] !== 'ok') return { error: r.join(' ') };
    return { fgZ: +r[1], overlayZ: +r[2], popupZ: +r[3], fgTopmost: r[4] === '1', fgPopupStyle: r[5] === '1', fgCoversMonitor: r[6] === '1', fullscreenState: +r[7], fgProcess: Buffer.from(r[8] || '', 'base64').toString('utf8') };
  }

  // See FsFix above. apply=false only reports.
  async fullscreenFix(apply) {
    const r = (await this.request(`fsfix ${apply ? 1 : 0}`)).split(' ');
    if (r[0] !== 'ok') throw new Error('fsfix failed: ' + r.join(' '));
    return { minecraftForeground: r[1] === '1', exactFullscreen: r[2] === '1', resized: r[3] === '1' };
  }

  async cursor() { const r = (await this.request('cursor')).split(' '); return { x: +r[1], y: +r[2] }; }

  stop() { if (this.proc) { try { this.proc.stdin.end(); this.proc.kill(); } catch (_) {} } this.proc = null; }
}

module.exports = { WinHelper };

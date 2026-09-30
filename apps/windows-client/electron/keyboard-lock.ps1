# Low-level keyboard hook used while the Pisonet lock screen is active.
# Blocks Alt+Tab / Win / Ctrl+Esc and other task-switch shortcuts that
# Electron's globalShortcut cannot reliably intercept on Windows.
# Staff unlock combo Control+Alt+Shift+M is allowed through.
# Process is killed by the Electron main process when the lock is released.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

$code = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class PisonetKeyboardLock {
  const int WH_KEYBOARD_LL = 13;
  const int WM_KEYDOWN = 0x0100;
  const int WM_SYSKEYDOWN = 0x0104;
  const int LLKHF_ALTDOWN = 0x20;

  const int VK_TAB = 0x09;
  const int VK_ESCAPE = 0x1B;
  const int VK_F4 = 0x73;
  const int VK_SPACE = 0x20;
  const int VK_LWIN = 0x5B;
  const int VK_RWIN = 0x5C;
  const int VK_APPS = 0x5D;
  const int VK_CONTROL = 0x11;
  const int VK_LCONTROL = 0xA2;
  const int VK_RCONTROL = 0xA3;
  const int VK_MENU = 0x12;
  const int VK_LMENU = 0xA4;
  const int VK_RMENU = 0xA5;
  const int VK_SHIFT = 0x10;
  const int VK_LSHIFT = 0xA0;
  const int VK_RSHIFT = 0xA1;
  const int VK_M = 0x4D;

  public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

  [DllImport("user32.dll")]
  static extern bool UnhookWindowsHookEx(IntPtr hhk);

  [DllImport("user32.dll")]
  static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  static extern short GetAsyncKeyState(int vKey);

  [DllImport("kernel32.dll")]
  static extern IntPtr GetModuleHandle(string lpModuleName);

  [StructLayout(LayoutKind.Sequential)]
  struct KBDLLHOOKSTRUCT {
    public uint vkCode;
    public uint scanCode;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  // Keep the delegate alive so the GC does not collect it while hooked.
  static readonly HookProc Proc = HookCallback;
  static IntPtr hookId = IntPtr.Zero;

  static bool IsDown(int vk) {
    return (GetAsyncKeyState(vk) & 0x8000) != 0;
  }

  static bool CtrlDown() {
    return IsDown(VK_CONTROL) || IsDown(VK_LCONTROL) || IsDown(VK_RCONTROL);
  }

  static bool AltDown(uint flags) {
    return (flags & LLKHF_ALTDOWN) != 0
      || IsDown(VK_MENU) || IsDown(VK_LMENU) || IsDown(VK_RMENU);
  }

  static bool ShiftDown() {
    return IsDown(VK_SHIFT) || IsDown(VK_LSHIFT) || IsDown(VK_RSHIFT);
  }

  // Staff maintenance unlock: Control+Alt+Shift+M must still reach Electron.
  static bool IsMaintenanceCombo(uint vk) {
    return vk == VK_M && CtrlDown() && AltDown(0) && ShiftDown();
  }

  static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0) {
      int msg = wParam.ToInt32();
      if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) {
        var info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
        uint vk = info.vkCode;

        if (IsMaintenanceCombo(vk)) {
          return CallNextHookEx(hookId, nCode, wParam, lParam);
        }

        // Win keys + context-menu key (block Start, Win+Tab, Win+D, etc.)
        if (vk == VK_LWIN || vk == VK_RWIN || vk == VK_APPS) {
          return (IntPtr)1;
        }

        bool alt = AltDown(info.flags);
        bool ctrl = CtrlDown();

        // Alt+Tab / Alt+Esc / Alt+F4 / Alt+Space (system menu)
        if (alt && (vk == VK_TAB || vk == VK_ESCAPE || vk == VK_F4 || vk == VK_SPACE)) {
          return (IntPtr)1;
        }

        // Ctrl+Esc (Start) and Ctrl+Shift+Esc (Task Manager)
        if (ctrl && vk == VK_ESCAPE) {
          return (IntPtr)1;
        }
      }
    }
    return CallNextHookEx(hookId, nCode, wParam, lParam);
  }

  [STAThread]
  public static void Run() {
    using (Process cur = Process.GetCurrentProcess())
    using (ProcessModule mod = cur.MainModule) {
      hookId = SetWindowsHookEx(WH_KEYBOARD_LL, Proc, GetModuleHandle(mod.ModuleName), 0);
    }
    if (hookId == IntPtr.Zero) {
      Environment.Exit(1);
    }
    try {
      Application.Run();
    } finally {
      if (hookId != IntPtr.Zero) {
        UnhookWindowsHookEx(hookId);
        hookId = IntPtr.Zero;
      }
    }
  }
}
'@

Add-Type -TypeDefinition $code -ReferencedAssemblies System.Windows.Forms
[PisonetKeyboardLock]::Run()

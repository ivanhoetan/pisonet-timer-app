# Windows Kiosk Lockdown (Layer 2)

The Electron client already enforces an **app-level lock**: when no paid session is
active it goes fullscreen, stays on top, blocks Alt+Tab / Win / Alt+F4 / refresh /
devtools, refuses to minimize or close, and only releases control when a user logs in
with time credits.

That stops casual users. To make the PC **truly** unusable without a login (so nobody
can Task-Manager-kill the app or Alt+Ctrl+Del their way to the desktop), apply these
OS-level steps **on each client PC**. Do this on a *dedicated standard (non-admin)
Windows account* that customers use — never your admin account.

> ⚠️ Read the "Recovery" section first. Shell replacement is powerful; if the app
> crashes the customer account has no desktop until it restarts. Always keep a
> separate admin account you can log into.

---

## Step 1 — Create a dedicated customer account

1. Create a **Standard** (non-admin) local account, e.g. `customer`.
2. Keep your own **Administrator** account separate and password-protected.
3. Set the `customer` account to log in automatically on boot (optional but typical
   for pisonet). You can use `netplwiz` to enable auto-login.

## Step 2 — Disable Task Manager for the customer account

While logged in as `customer`, run `disable-taskmgr.reg` (double-click → Yes).
This sets `DisableTaskMgr` so Ctrl+Shift+Esc / the Ctrl+Alt+Del menu cannot open
Task Manager and kill the timer.

To undo later, run `enable-taskmgr.reg`.

## Step 3 — Replace the Windows shell with the timer (customer account only)

Normally Windows loads `explorer.exe` (taskbar + desktop) as the "shell". Replacing it
with the Pisonet client means the customer account has **no taskbar, no desktop, no
Start menu** — the timer *is* the environment.

1. Install the packaged client and note its full path, e.g.
   `C:\Program Files\Pisonet Timer\Pisonet Timer.exe`.
2. Open `set-shell.reg` in a text editor and change the `Shell` value to that exact
   path (keep the doubled backslashes `\\`).
3. While logged in as `customer`, run the edited `set-shell.reg`.
4. Sign out and back in as `customer`. The timer now launches as the shell.

To revert (back to normal Windows desktop) run `reset-shell.reg` as `customer`.

## Step 4 — Lock down the rest (recommended)

On the customer account, via Group Policy (`gpedit.msc`, Pro/Enterprise) or registry:

- Disable Lock / Switch User / Sign out on the Ctrl+Alt+Del screen.
- Hide drives / block `cmd.exe`, `regedit.exe`, `powershell.exe` (Software
  Restriction Policies / AppLocker).
- Disable USB autorun.

These are optional hardening; Steps 1–3 already block the common escapes.

---

## Recovery (IMPORTANT)

If you ever get locked out or the customer account has no shell:

1. Switch user / sign out (or reboot) and log in as your **Administrator** account —
   it still has the normal `explorer.exe` shell, because the shell change was made
   under `HKEY_CURRENT_USER` of the *customer* account only.
2. From admin you can fix things, or log into `customer` and run `reset-shell.reg`
   and `enable-taskmgr.reg`.

> Because every change here is under **HKEY_CURRENT_USER** (the customer account),
> your admin account is never affected and is your safety net.

---

## How the two layers work together

| Situation                         | App layer (Electron)                         | OS layer (this folder)                    |
| --------------------------------- | -------------------------------------------- | ----------------------------------------- |
| No one logged in / time = 0       | Fullscreen lock, blocks Alt+Tab/Win via low-level keyboard hook, no close | No desktop/taskbar, Task Manager disabled |
| User logs in with time credits    | Releases lock + keyboard hook → free use of the PC | (no effect during session)                |
| Time runs out / forced logout     | Re-locks instantly, kills fullscreen games, returns to login | Still no escape to desktop                |
| Customer tries to kill the app    | Single-instance + auto-start relaunch        | Task Manager disabled; app is the shell   |

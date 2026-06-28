# Registering & Pairing a New PC

This guide explains how to add a client PC (PC02–PC10, or any new unit) to the
Pisonet timer system. There are two parts:

1. **Register** the PC in the admin portal → this generates its credentials.
2. **Pair** the Windows client app on that PC using those credentials.

> Do this once per physical computer. After pairing, the PC remembers its
> settings and auto-starts into the lock screen on every boot.

---

## Before you start

- Admin portal URL: `https://pisonet-timer-api.onrender.com/admin/`
- Admin login (email + password)
- The new PC has the **latest Pisonet client `.exe` installed**
- A **maintenance code** you choose (staff-only secret, used to service the PC)

---

## Part 1 — Register the PC (admin portal)

You can do this from your phone or any browser.

1. Open `https://pisonet-timer-api.onrender.com/admin/` and log in.
2. Go to **Computers** in the menu.
3. Tap **+ Register PC**.
4. Fill in:
   - **Computer code** — short unique ID, e.g. `PC02` (letters, numbers, `-`, `_`)
   - **Display name** — a human label, e.g. `Corner unit by window`
5. Tap **Register**.

A **Pair** popup appears showing a short **pairing code** like `7K2-Q9F`.

> ⏱️ The pairing code is valid for **15 minutes** and can be used **once**. If it
> expires, tap **Pair** on that PC's card to generate a fresh one — no need to
> delete and re-register.

Keep the popup open (or copy the code with **Copy code**) while you set up the PC.

---

## Part 2 — Pair the Windows client (on the PC)

On the new PC, launch the **Pisonet Timer** app. On first run it shows the
**Pair this PC** screen with **Quick pair** selected. Enter:

| Field | Value |
|-------|-------|
| **Server URL** | `https://pisonet-timer-api.onrender.com` (already pre-filled) |
| **Pairing code** | The `XXX-XXX` code from Part 1 (hyphen optional) |
| **Maintenance code** | Your staff-only secret (e.g. a word + numbers) |

Then tap **Save & connect**.

The app fetches its credentials automatically, connects, wakes the server if
needed, and lands on the **login screen**. The PC is now ready for customers.

> **Lost the code or it expired?** In the admin portal → **Computers**, tap
> **Pair** on that PC's card for a new code.
>
> **No internet on the portal device?** Use the **Manual** tab on the pairing
> screen and paste the Computer ID + Auth secret instead (Advanced section of the
> Pair popup).

---

## Part 3 — Verify it works

1. In the admin portal → **Computers**, the new PC should show **ONLINE**
   (it may briefly show OFFLINE until the client connects).
2. On the PC, log in with a test user that has time → the **mini-timer** appears
   top-right with the countdown, a maximize button, and a logout button.
3. Log out → the PC returns to the lock screen.
4. Leave it on the lock screen without touching it → the **60-second
   auto-shutdown** countdown should appear (don't let it finish unless testing).

---

## Repeat for each PC

Do Parts 1–2 for every machine, using a unique **Computer code** each time:

- `PC02`, `PC03`, `PC04`, … `PC10`

Each PC gets its **own** Computer ID and Auth secret — do not reuse one PC's
credentials on another.

---

## Maintenance & remote control (after pairing)

Once a PC is paired, you can manage it from **Computers** in the admin portal:

- **Lock** — log out the current user (time is saved) and lock the PC
- **Shut down** — remotely power off the PC
- **Maintenance** — unlock the PC for servicing (no paid session)

On the PC itself, staff can enter maintenance offline with the key combo
**`Ctrl+Alt+Shift+M`**, then type the **maintenance code** you set during pairing.

> Maintenance is intentionally **not** in the system tray — it's only reachable
> via the admin portal or the key combo, so customers can't bypass the timer.

---

## Troubleshooting

| Problem | Fix |
|--------|-----|
| PC stays **OFFLINE** in portal | Check the PC's internet; confirm Server URL is exactly `https://pisonet-timer-api.onrender.com` (no trailing slash needed) |
| "Computer code already exists" | That code is taken — use a new one (e.g. `PC02B`) |
| Lost the Auth secret | Tap **Pair** on the PC's card for a fresh pairing code, then re-pair the client (no need to delete the PC) |
| "Invalid or expired pairing code" | Codes last 15 min and are single-use — tap **Pair** for a new one |
| First connection is slow | The free server may be waking from sleep (~30–60s); it connects automatically |
| Wrong credentials entered | Re-open the app; if it's stuck on a screen, use `Ctrl+Alt+Shift+M` + maintenance code to access the desktop, then relaunch |

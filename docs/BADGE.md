# Put AI Matchmaker on the Hacker Badge

This app targets the **2026 Hacker Badge, Lua API 2**, using the APIs in `badge_example/badge-app-guide.md`. The complete single-file app is [public/badge/gptinder.lua](../public/badge/gptinder.lua). Use the website's personalized download so its device token is already filled in.

## 1. Bind one badge to one account

1. Complete [SETUP.md](./SETUP.md), then sign into the correct participant's account and approve their profile. For the controlled demo, seed Alex, Blair and Casey first.
2. Click **Download my badge app**. The server creates a random 128-bit device token, binds its hash to the signed-in user for seven days, and downloads the complete `gptinder-NAME.lua` file containing the token. No OpenAI, database, or account sign-in key is in that file.
3. Repeat separately for each person's badge. Do not share a personalized file with another participant. **Manage paired badges** lets you revoke a binding. Download a new copy and reinstall when a binding expires or is revoked.

The template's `__DEVICE_TOKEN__` placeholder deliberately displays a setup message if installed unchanged. The website replaces it automatically. Sharing a personalized app through the badge's Share utility would also share its device identity; use separate downloads instead.

The supplied guide exposes `badge.me.name()`, `role()`, `role_name()`, `badge_id()` and `provisioned()`, but deliberately excludes email, phone and social accounts. The app does not attempt to access them. Website login and the downloaded token establish account binding; an email address, LinkedIn URL or WhatsApp number alone grants no account access. Ask the organizers whether a separate authorized account-linking API exists before planning any integration with their account system.

## 2. Install through the Badge IDE

Open the [Hacker Badge IDE](https://badge.hackthenorth.com/ide/) in desktop Chrome or Edge. Save any existing editor work before replacing it. Use a USB **data** cable. Close other tabs or tools using the serial port.

The guide describes two IDE versions. Use the path matching the controls you actually see; the IDE was not inspected or operated during implementation.

### If “Import app” is visible

1. Choose **Import app** and select the personalized `.lua` file (or paste its entire contents, including the manifest header).
2. Check that the slug is `gptinder`, then choose **Replace editor files**.
3. Turn the badge off, connect USB, and turn it on normally. Do **not** hold Start.
4. Click **Connect** and select **USB JTAG/serial debug unit** / Espressif.
5. Click **Push** and wait for completion. Import only changes the browser editor; Push installs the files.
6. Find **AI Matchmaker** in the badge launcher and press **A** to open it.

### If the page only has Connect / Push / Reboot / ^C

1. Open the downloaded `.lua` file in a text editor.
2. Put only the `key=value` lines between `--[==[badge-app` and `]==]` into the IDE's **manifest.cfg**. Do not include those delimiters.
3. Put all Lua code after `]==]` into **main.lua**.
4. Turn off the badge, attach USB, turn on normally without holding Start, then **Connect → Push**.
5. Open **AI Matchmaker** from the launcher with **A**.

Reboot after changing runtime manifest options on an already-installed slug (`api`, `heap_kb`, `wake_lock`, etc.). Ordinary code updates need Push and reopening the app. A new push using `gptinder` updates that app's uploaded files; personal store data stays scoped to the same slug.

## 3. Connect the laptop bridge

1. Close/disconnect the IDE's serial connection after installation. Only one tab/tool can own a badge's USB serial port at a time.
2. Open the deployed HTTPS website in desktop Chrome or Edge and sign into the account bound to the connected badge. `http://localhost` also works for local development. Other ordinary HTTP origins do not provide Web Serial.
3. Open **AI Matchmaker** on both physical badges. Keep Alex's badge connected by USB to Alex's laptop session; the other badge can be unplugged.
4. In the website, click **Connect badge via USB** and select the same Espressif port. The browser opens it at 115200 baud and reads tagged serial logs.
5. Press **A** on both badges to arm for 30 seconds. Gently bump/tap both badges within that window. Keep only the intended partner close during the eight-second handshake window.
6. If the tap sensor does not trigger, press **A again on both armed badges**. This starts the same handshake without relying on motion detection.
7. After the radio acknowledgement, the connected badge emits its structured event. The website creates one encounter and opens the live conversation. Wait for six stored turns and the compatibility estimate.

The firmware's built-in bump/sync radio frames are **not accessible to Lua**. This app implements its own pairing protocol using the documented `badge.sensor.tap()` and restricted Lua radio channel. Signal-strength filtering is a proximity heuristic, not a guaranteed identity or distance measurement.

The badge says **Badge handshake confirmed** when radio acknowledgement succeeds, then **USB event sent — check the laptop**. That means the radio/serial step completed; only the website can confirm cloud acceptance. There is no supported app-specific USB receive callback for returning a cloud score in the supplied Lua API, so the score appears on the laptop.

## Controls and LEDs

| Control/state                  | Behavior                                                              |
| ------------------------------ | --------------------------------------------------------------------- |
| A                              | Arm for 30 seconds; a second A while armed starts the sensor fallback |
| Gentle tap/bump while armed    | Start an eight-second pairing attempt                                 |
| B                              | Re-emit the last saved encounter over USB; safe to repeat             |
| DOWN                           | Cycle LED brightness 180 → 80 → off                                   |
| HOME                           | Exit, finish a pending save, disable radio, clear LEDs                |
| Armed                          | Coral left-side LEDs (1, 6, 5), violet right-side LEDs (2, 3, 4)      |
| Pairing                        | Amber chase clockwise around the six LEDs                             |
| Acknowledged                   | Slow green pulse; status text remains on screen                       |
| Radio unavailable/unconfigured | Red LEDs and an explanatory screen message                            |

The app uses five widgets, a 48 KiB Lua quota, `wake_lock=1`, bounded callbacks, and no external modules or assets. The foreground app stays awake for the bridge; return HOME when finished. Brightness is session-local. The last confirmed encounter is saved as one 96-character store value once per encounter and can be replayed after reopening. A power cut before that write can lose the newest event.

## Protocol and recovery

Radio frames have application prefix `GT1`. HELLO has 28 bytes: 3-byte prefix, `H`, 16-byte binary device token, 8-byte nonce. ACK has 36 bytes: prefix, `A`, token, nonce, and the peer nonce being acknowledged. Both fit the documented 44-byte limit. Send intervals are 350–449 ms; retransmission is bounded by the pairing window. A candidate's radio MAC/token/nonce are pinned for that window. Packets from other candidates, low-strength signals, invalid lengths or incorrect nonce echoes are ignored.

Only a confirmed handshake emits `GPTINDER:` followed by a versioned JSON record containing the two token/nonce pairs. The browser tolerates the firmware's app-slug log prefix, split chunks, CRLF, noisy logs and oversized lines. It canonicalizes and queues events; the server uses a unique handshake hash, so reversed perspectives, repeated radio packets, B replay and HTTP retries resolve to one encounter.

If the website was disconnected, connect it and press **B** to replay the saved event. If an API call failed, use **Retry pending delivery**; up to 20 undelivered events are retained in that account's current browser tab session. Do not create a new bump merely to retry an old event. A new pairing uses new nonces and intentionally creates a new encounter.

## Troubleshooting and rehearsal

- **No USB device / port in use:** use a data cable and Chrome/Edge; disconnect the IDE and other serial programs; restart normally without holding Start.
- **Radio unavailable:** HOME, reboot, reopen. A successful Push proves installation, not radio startup.
- **No handshake:** confirm both accounts have approved profiles, both badge apps are open, both badges are armed, and taps trigger both screens. Use the second-A fallback, keep the intended badges close, and try a fresh window.
- **Badge confirmed, website rejects:** check that the laptop is signed into the connected badge's owner, both bindings are active/unexpired, and `APP_URL` matches the site. Correct the issue and press B.
- **Conversation failed:** use the website's retry action. Existing messages remain, and processing continues from persisted turns.
- **Missing glyphs:** the badge app intentionally uses plain ASCII screen text. Do not paste Markdown delimiters into `main.lua`.
- **Memory/deadline errors:** record the exact callback/traceback and firmware version. The supplied guide targets updated firmware with 3,000 ms startup, 250 ms tick/receive and 1,000 ms button/exit allowances. These are cutoffs, not performance guarantees; do not assume increasing the heap quota fixes timing or system RAM.

Rehearse initial launch, repeated pairing, duplicate B replay, disconnect/reconnect, missing-sensor fallback, radio failure, HOME cleanup and reopening. Confirm duplicate replay produces the same encounter ID and six unique messages. Test Alex/Blair followed by Alex/Casey after feedback confirmation.

The actual Lua source is syntax/execution-tested using API doubles, including packet loss, duplicate frames, payload limits, replay and cleanup. Physical radio reliability, ESP32/LVGL timing, flash latency, sensor sensitivity and USB behavior still need your badges. The app has not been uploaded to hardware by the coding agent.

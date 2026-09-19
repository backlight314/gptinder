# Put AI Matchmaker on the Hacker Badge

This app targets the 2026 Hacker Badge Lua API 2. The complete app is [public/badge/gptinder.lua](../public/badge/gptinder.lua), and the website produces a personalized download.

## Bind a profile to each badge

1. Complete [SETUP.md](./SETUP.md), sign into the participant's account, and approve their internal profile.
2. Enter the participant's public Instagram, LinkedIn, or X profile URL beside **Download my badge app**.
3. Confirm that the participant owns the profile or has permission to import and store its public content.
4. Download the app. Vercel canonicalizes the URL and binds it to a new random 128-bit badge token for seven days.
5. Repeat in the other participant's account for the other badge.

The Lua file contains only its random token. It does not contain the profile URL, account key, MongoDB credentials, Browserbase credentials, or OpenAI credentials. Do not share a personalized badge app because its token identifies that binding.

## Install through the Badge IDE

Open the [Hacker Badge IDE](https://badge.hackthenorth.com/ide/) in desktop Chrome or Edge with a USB data cable. Close any other tab or tool using the serial port.

If **Import app** is available:

1. Import the personalized Lua file and replace the editor files.
2. Turn the badge off, connect USB, and turn it on normally without holding Start.
3. Connect to the Espressif USB JTAG/serial debug unit.
4. Push the app and open **AI Matchmaker** from the badge launcher.

If the IDE only exposes individual files, put the key/value lines between the manifest delimiters into `manifest.cfg`, put the Lua code after the delimiter into `main.lua`, then connect and push.

## Bump and send one Vercel request

1. Open **AI Matchmaker** on both badges.
2. Press **A** on both badges to arm them for 30 seconds.
3. Gently bump or tap both badges. If the tap sensor does not trigger, press **A** again on both armed badges.
4. During the eight-second handshake, each badge sends a 28-byte HELLO and a 36-byte acknowledged reply over the restricted radio channel.
5. Both badges compare their random tokens and independently choose the lower token as the sender.
6. One screen says **Elected API sender**. The other says **Peer badge elected**.
7. Connect the elected badge by USB to a desktop Chrome or Edge session signed into that badge owner's account.
8. Click **Connect badge via USB** on the website. If the handshake happened before connecting, press **B** on the elected badge.
9. The elected badge emits one serial event. The browser sends one authenticated `POST /api/encounters` request to Vercel.
10. Vercel resolves both token-bound profile URLs, imports both public profiles through Browserbase, stores them in MongoDB, creates one encounter, and starts the conversation workflow.

The badge Lua API has no Wi-Fi, HTTP, or network-fetch API. Web Serial is therefore the required transport between the elected physical badge and Vercel. The non-elected badge never emits the event, including when B is pressed. The API also rejects an event whose local token did not win the election.

## Controls

| Control or state | Behavior                                                            |
| ---------------- | ------------------------------------------------------------------- |
| A                | Arm for 30 seconds; press again while armed for the sensor fallback |
| Gentle tap       | Start the eight-second pairing attempt                              |
| B                | Replay the saved encounter over USB on the elected badge only       |
| DOWN             | Cycle LED brightness                                                |
| HOME             | Exit, finish a pending save, disable radio, and clear LEDs          |
| Armed            | Coral and violet LEDs                                               |
| Pairing          | Amber chase                                                         |
| Confirmed        | Green pulse                                                         |

## Protocol and recovery

Radio frames use the `GT1` prefix. HELLO contains the prefix, type, 16-byte binary token, and 8-byte nonce. ACK adds the peer nonce, keeping the packet below the documented 44-byte limit. The first nearby candidate is pinned for the attempt; malformed, weak, unrelated, and incorrect acknowledgement frames are ignored.

The elected badge emits `GPTINDER:` plus a versioned JSON record containing both token/nonce pairs. The browser handles split chunks, CRLF, noisy logs, and bounded lines. The server validates the election and uses a canonical handshake hash, so replay or an HTTP retry resolves to the same encounter. Profile import records are keyed by encounter so a completed scrape is not repeated.

If delivery fails, use **Retry pending delivery** in the browser. Up to 20 events remain in the current tab session. If the browser was disconnected, connect the elected badge and press **B**. A new bump uses fresh nonces and intentionally represents a new encounter.

## Verification limits

The automated Lua harness runs the real app source with badge API doubles, lost packets, duplicate packets, election, replay, packet-size checks, and cleanup. Type and integration checks cover the server invariants. Browserbase, Vercel, physical radio timing, sensor sensitivity, and USB behavior still require rehearsal on the deployed project and real badges.

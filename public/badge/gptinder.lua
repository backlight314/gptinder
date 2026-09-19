--[==[badge-app
slug=gptinder
name=AI Matchmaker
icon=AI
api=2
heap_kb=48
wake_lock=1
version=1.0.0
]==]

-- Download a personalized copy in the web app. Never put account/API keys here.
-- A arms; gently tap both badges; A again is a sensor fallback.
-- B replays the last USB event. DOWN cycles LED brightness. HOME exits.
local TOKEN = "__DEVICE_TOKEN__"
local PREFIX = "GT1"
local MIN_RSSI = -65
local enabled, armed, pairing, paired = false, false, false, false
local arm_until, pair_until, next_send, next_led, next_replay = 0, 0, 0, 0, 0
local nonce, peer_token, peer_nonce, peer_mac = "", "", "", ""
local last, pending_save, brightness = "", false, 180
local title, status, detail, hint

local function hex(raw)
  return (raw:gsub(".", function(c) return string.format("%02x", string.byte(c)) end))
end

local function unhex(value)
  return (value:gsub("..", function(pair) return string.char(tonumber(pair, 16)) end))
end

local function valid_token(value)
  return #value == 32 and value:match("^[0-9a-f]+$") ~= nil
end

local function new_nonce()
  local result = ""
  for _ = 1, 4 do result = result .. string.format("%04x", badge.sys.random(65536)) end
  return unhex(result)
end

local function emit_last()
  if #last ~= 96 or last:sub(1, 32) ~= TOKEN then
    detail:set_text("No saved encounter on this badge")
    return
  end
  badge.sys.log('GPTINDER:{"type":"gptinder.encounter","version":1,"localToken":"' ..
    TOKEN .. '","peerToken":"' .. last:sub(33, 64) .. '","localNonce":"' ..
    last:sub(65, 80) .. '","peerNonce":"' .. last:sub(81, 96) .. '"}')
  detail:set_text("USB event sent - check the laptop")
end

local function begin_pair()
  if not enabled or not armed then return end
  armed, pairing, paired = false, true, false
  nonce, peer_token, peer_nonce, peer_mac = new_nonce(), "", "", ""
  pair_until, next_send = badge.sys.ms() + 8000, 0
  status:set_text("Finding a nearby hello...")
  detail:set_text("Keep only your intended partner close")
end

local function receive(mac, rssi, payload)
  if not pairing or badge.sys.ms() > pair_until or rssi < MIN_RSSI then return end
  if #payload ~= 28 and #payload ~= 36 then return end
  if payload:sub(1, 3) ~= PREFIX then return end
  local kind = payload:sub(4, 4)
  if (kind ~= "H" or #payload ~= 28) and (kind ~= "A" or #payload ~= 36) then return end
  local token, remote_nonce = payload:sub(5, 20), payload:sub(21, 28)
  if token == unhex(TOKEN) then return end
  if kind == "A" and payload:sub(29, 36) ~= nonce then return end
  -- Pin the first nearby candidate for this short pairing window.
  if peer_mac ~= "" and (peer_mac ~= mac or peer_token ~= token or peer_nonce ~= remote_nonce) then return end
  peer_mac, peer_token, peer_nonce = mac, token, remote_nonce
  if kind == "A" and not paired then
    paired = true
    last = TOKEN .. hex(peer_token) .. hex(nonce) .. hex(peer_nonce)
    pending_save = true
    status:set_text("Badge handshake confirmed")
    detail:set_text("Saving encounter for USB replay...")
    -- Continue ACK retransmission until the original window ends.
  end
end

function on_enter(root)
  local bg = badge.ui.box(root, 320, 240)
  bg:align("center", 0, 0)
  bg:style({bg_color = 0x211D24, border_width = 0, radius = 0})
  title = badge.ui.label(root, "AI Matchmaker")
  title:set_font_size("large")
  title:align("top_mid", 0, 16)
  title:set_color(0xFF887C)
  status = badge.ui.label(root, "Starting radio...")
  status:set_size(296, 42)
  status:style({text_align = "center"})
  status:align("top_mid", 0, 58)
  detail = badge.ui.label(root, "")
  detail:set_size(296, 56)
  detail:style({text_align = "center", text_font = 14})
  detail:align("top_mid", 0, 105)
  hint = badge.ui.label(root, "A arm / fallback   B replay USB\nDOWN lights   HOME exit")
  hint:style({text_align = "center", text_font = 14})
  hint:align("bottom_mid", 0, -12)
  if not valid_token(TOKEN) then
    status:set_text("Pair your account first")
    detail:set_text("Download My badge app from the website")
    return
  end
  last = badge.store.get_str("last_encounter", "")
  enabled = badge.radio.enable()
  if not enabled then
    status:set_text("Radio unavailable")
    detail:set_text("HOME, reboot, then open this app again")
    return
  end
  badge.radio.on_recv(receive)
  status:set_text("Ready - A arms for 30 seconds")
  detail:set_text("Both people need this app open")
end

function on_button(button, kind)
  if kind ~= badge.input.KIND.PRESSED then return end
  local now = badge.sys.ms()
  if button == badge.input.BUTTON.DOWN then
    if brightness == 180 then brightness = 80 elseif brightness == 80 then brightness = 0 else brightness = 180 end
  elseif button == badge.input.BUTTON.B and now >= next_replay then
    next_replay = now + 1000
    emit_last()
  elseif button == badge.input.BUTTON.A and enabled and not pairing then
    if armed then begin_pair() else
      armed, paired, arm_until = true, false, now + 30000
      status:set_text("Armed - gently bump both badges")
      detail:set_text("No tap detected? Press A on both again")
    end
  end
end

function on_tick()
  local now = badge.sys.ms()
  if armed and now > arm_until then
    armed = false
    status:set_text("Arming expired - A to try again")
  end
  if armed and badge.sensor.tap() then begin_pair() end
  if pending_save then
    pending_save = false
    -- One bounded flash write per confirmed encounter; never every frame.
    badge.store.set_str("last_encounter", last)
    emit_last()
  end
  if pairing then
    if now > pair_until then
      pairing = false
      if not paired then status:set_text("No handshake - A to try again") end
    elseif now >= next_send then
      next_send = now + 350 + badge.sys.random(100)
      -- Binary payload: prefix(3), kind(1), token(16), nonce(8), echo(8).
      -- HELLO = 28 bytes; ACK = 36 bytes, below the 44-byte limit.
      local packet = PREFIX .. "H" .. unhex(TOKEN) .. nonce
      if peer_token ~= "" then packet = PREFIX .. "A" .. unhex(TOKEN) .. nonce .. peer_nonce end
      if not badge.radio.send(packet) then detail:set_text("Radio busy - retrying this window") end
    end
  end
  if now < next_led then return end
  next_led = now + 100
  badge.led.clear()
  local level = brightness
  if not enabled then badge.led.set_all(level, 0, 0)
  elseif paired then
    local pulse = math.floor(level * (0.65 + 0.35 * math.sin(now / 400)))
    badge.led.set_all(0, pulse, math.floor(pulse / 3))
  elseif pairing then
    badge.led.set(math.floor(now / 180) % 6 + 1, level, math.floor(level / 2), 0)
  elseif armed then
    for _, i in ipairs({1, 6, 5}) do badge.led.set(i, level, math.floor(level / 3), math.floor(level / 4)) end
    for _, i in ipairs({2, 3, 4}) do badge.led.set(i, math.floor(level / 2), math.floor(level / 4), level) end
  end
  badge.led.show()
end

function on_exit()
  if pending_save then badge.store.set_str("last_encounter", last) end
  if enabled then badge.radio.on_recv(nil); badge.radio.disable() end
  badge.led.clear()
  badge.led.show()
end

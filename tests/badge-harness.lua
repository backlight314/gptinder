local now, packets, max_packet, drops = 0, {}, 0, 0
local function device(token, address)
  local state = {logs = {}, store = {}, receive = nil, tapped = false, disabled = false, leds = {}}
  local widget = {set_font_size = function() end, align = function() end, set_color = function() end,
    set_size = function() end, style = function() end, set_text = function() end}
  local api = {
    ui = {label = function() return widget end, box = function() return widget end},
    input = {BUTTON = {A = 1, B = 2, DOWN = 3}, KIND = {PRESSED = 1, RELEASED = 2}},
    store = {get_str = function(k, default) return state.store[k] or default end,
      set_str = function(k, v) assert(#v <= 128); state.store[k] = v end},
    sys = {ms = function() return now end, random = function(n) return math.random(0, n - 1) end,
      log = function(line) state.logs[#state.logs + 1] = line end},
    sensor = {tap = function() local value = state.tapped; state.tapped = false; return value end},
    radio = {enable = function() return true end, disable = function() state.disabled = true end,
      on_recv = function(fn) state.receive = fn end,
      send = function(payload) assert(#payload <= 44); max_packet = math.max(max_packet, #payload)
        packets[#packets + 1] = {from = address, payload = payload}; return true end},
    led = {clear = function() state.leds = {} end, show = function() end,
      set = function(i, r, g, b) assert(i >= 1 and i <= 6); assert(r >= 0 and r <= 255); state.leds[i] = {r,g,b} end,
      set_all = function() end},
  }
  local env = setmetatable({badge = api}, {__index = _G})
  local chunk = assert(load(APP_SOURCE:gsub('__DEVICE_TOKEN__', token), 'badge', 't', env))
  chunk(); env.on_enter({})
  state.env, state.address = env, address
  return state
end
math.randomseed(42)
local a = device(string.rep('a', 32), 'A')
local b = device(string.rep('b', 32), 'B')
-- Unarmed radio data must do nothing.
a.receive('B', -30, 'GT1H' .. string.rep('b', 24))
assert(#a.logs == 0)
a.env.on_button(1, 1); b.env.on_button(1, 1)
a.tapped, b.tapped = true, true
for step = 1, 100 do
  now = now + 100
  a.env.on_tick(); b.env.on_tick()
  local batch = packets; packets = {}
  for _, packet in ipairs(batch) do
    -- Drop the first two packets, then deliver repeats out of scheduling order.
    if drops < 2 then drops = drops + 1 else
      local target = packet.from == 'A' and b or a
      target.receive(packet.from, -30, packet.payload)
      target.receive(packet.from, -30, packet.payload)
    end
  end
end
assert(max_packet == 36, 'ACK packets must be 36 bytes')
assert(#a.logs == 1 and #b.logs == 0, 'Only the elected badge emits an event')
assert(a.logs[1]:find('"localToken":"' .. string.rep('a', 32) .. '"', 1, true))
assert(a.logs[1]:find('"peerToken":"' .. string.rep('b', 32) .. '"', 1, true))
assert(#a.store.last_encounter == 96)
now = now + 2000; a.env.on_button(2, 1)
assert(#a.logs == 2 and a.logs[1] == a.logs[2], 'B must replay the same nonces')
b.env.on_button(2, 1)
assert(#b.logs == 0, 'The non-elected badge must never emit an API event')
a.env.on_button(3, 1); a.env.on_tick()
a.env.on_exit(); b.env.on_exit()
assert(a.disabled and b.disabled and a.receive == nil and b.receive == nil)

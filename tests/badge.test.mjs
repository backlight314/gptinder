import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lua, lauxlib, lualib, to_luastring, to_jsstring } from 'fengari'

describe('actual Lua app with documented badge API doubles', () => {
  it('elects one sender through lost/duplicate packets, bounds frames, replays and cleans up', () => {
    const source = readFileSync(
      new URL('../public/badge/gptinder.lua', import.meta.url),
      'utf8',
    )
    expect(Buffer.byteLength(source)).toBeLessThan(65536)
    const state = lauxlib.luaL_newstate()
    lualib.luaL_openlibs(state)
    lua.lua_pushstring(state, to_luastring(source))
    lua.lua_setglobal(state, to_luastring('APP_SOURCE'))
    const harness = readFileSync(
      new URL('./badge-harness.lua', import.meta.url),
      'utf8',
    )
    const result = lauxlib.luaL_dostring(state, to_luastring(harness))
    const message =
      result === lua.LUA_OK ? '' : to_jsstring(lua.lua_tostring(state, -1))
    lua.lua_close(state)
    expect(message).toBe('')
  })
})

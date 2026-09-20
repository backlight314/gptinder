'use client'

import { useEffect, useRef, useState } from 'react'
import { Heart } from 'lucide-react'

export default function InteractiveHeart({ large = false, label = 'Send a little love' }: { large?: boolean; label?: string }) {
  const [filled, setFilled] = useState(false)
  const [hearts, setHearts] = useState<number[]>([])
  const nextId = useRef(0)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  function sendHeart() {
    setFilled(true)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => {
      setFilled(false)
      resetTimer.current = null
    }, 650)
    const id = nextId.current++
    setHearts(current => [...current.slice(-19), id])
    const timer = setTimeout(() => {
      setHearts(current => current.filter(value => value !== id))
      timers.current.delete(timer)
    }, 2400)
    timers.current.add(timer)
  }

  return <button type="button" aria-label={label} onClick={sendHeart} className={`interactive-heart ${large ? 'orbit-heart' : 'small-heart'} ${filled ? 'heart-filled' : ''}`}>
    <Heart className="heart-face" size={large ? 56 : 16} strokeWidth={large ? 1.4 : 1.8} fill="currentColor" fillOpacity={filled ? 1 : 0} />
    {hearts.map(id => <span key={id} aria-hidden="true" className={`flying-heart heart-path-${id % 3}`}><Heart size={large ? 26 : 17} fill="currentColor" strokeWidth={1} /></span>)}
  </button>
}

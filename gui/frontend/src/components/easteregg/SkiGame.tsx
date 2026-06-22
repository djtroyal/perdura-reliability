import { useEffect, useRef } from 'react'

/**
 * "SCHUSS — Descent into Madness" — a hidden, original downhill-skiing
 * mini-game (an affectionate homage to the genre, with all-original art, name
 * and code; no copyrighted assets). A scientist in a hypercolor ski suit
 * bombs an endless slope strewn with the mathematical nonsense that has
 * awoken an Eldritch Horror from the depths — which, past a certain distance,
 * gives chase and (inevitably) devours the mathematician.
 *
 * Controls: ← → steer · ↓ tuck (faster) · ↑ snowplow (brake) · Esc quit.
 */

// ---- pixel sprites: each char is a palette key, '.' = transparent ----------

const SKIER = [
  '....HHHH....',
  '...HHHHHH...',
  '...kHHHHk...',
  '...kkkkkk...',
  '....HHHH....',
  '..GGHHHHGG..',
  '.GGHHHHHHGG.',
  '.GHHHHHHHHG.',
  '..hhhhhhhh..',
  '...hhhhhh...',
  '...PPPPPP...',
  '...PP..PP...',
  '..PP....PP..',
  '..YY....YY..',
  '..YY....YY..',
]

const SKIER_CRASH = [
  '............',
  '.k........k.',
  '....HHHH....',
  '..GHHHHHHG..',
  '.G.hhhhhh.G.',
  '...PPPPPP...',
  '.YY..PP..YY.',
  'Y..Y....Y..Y',
  '............',
]

// Eldritch Horror — two animation frames (eyes blink, tentacles writhe).
const MONSTER_A = [
  '..r......r..',
  '..r......r..',
  '.gDDDDDDDDg.',
  'DDDDDDDDDDDD',
  'DeeDDDDDeeDD',
  'DEeDDDDDDeED',
  'DDDDDDDDDDDD',
  'DmmmmmmmmmmD',
  'DwmwmwmwmwmD',
  'DmwmwmwmwmmD',
  'DmmmmmmmmmmD',
  '.DDDDDDDDDD.',
  't.t.t..t.t.t',
  '.t..t..t..t.',
]
const MONSTER_B = [
  '..r......r..',
  '..r......r..',
  '.gDDDDDDDDg.',
  'DDDDDDDDDDDD',
  'DeeDDDDDeeDD',
  'DEeDDDDDDeED',
  'DDDDDDDDDDDD',
  'DmmmmmmmmmmD',
  'DmwmwmwmwmmD',
  'DwmwmwmwmwmD',
  'DmmmmmmmmmmD',
  '.DDDDDDDDDD.',
  '.t.t..t.t.t.',
  't..t.t..t..t',
]
const MONSTER_BLINK = MONSTER_A.map((row, i) => (i === 4 || i === 5) ? 'DDDDDDDDDDDD' : row)

const TREE = [
  '....TT....',
  '...TTTT...',
  '..TTTTTT..',
  '...TTTT...',
  '..TTTTTT..',
  '.TTTTTTTT.',
  'TTTTTTTTTT',
  '....bb....',
  '....bb....',
]

const ROCK = [
  '..oooo..',
  '.oooooo.',
  'oooooooo',
  'ooppoooo',
  '.oooooo.',
]

const STATIC_PALETTE: Record<string, string> = {
  k: '#15151f',         // goggles
  G: '#ffd23f',         // gloves
  P: '#ff3df5',         // ski pants (neon magenta)
  Y: '#ff5722',         // skis
  // monster
  D: '#241036', r: '#d9d2b0', g: '#6a0dad',
  e: '#aaff00', E: '#ff1f1f', m: '#05010a', w: '#f2e9d0', t: '#39ff14',
  // trees / rocks
  T: '#1f8a4d', b: '#5c3a1e', o: '#9aa0a6', p: '#5f656b',
}

// Mathematical "nonsense" littering the slope — hazards that enrage the Horror.
const SYMBOLS = ['Σ', '∫', '∂', 'π', '∞', 'χ²', 'λ', 'σ', '√', 'p<.05', 'H₀', 'dx', 'e^x', '≠']

const CRASH_MSGS = [
  'The integral diverged!',
  'Null hypothesis rejected — by a tree.',
  'Undefined behaviour on the slope.',
  'Your p-value hit a rock.',
  'Confidence interval: catastrophic.',
  'Division by zero. Ouch.',
  'Residuals everywhere.',
]
const DOOM_MSGS = [
  'YOUR MATHEMATICAL NONSENSE ENDS HERE.',
  'THE HORROR HAS BALANCED YOUR EQUATION.',
  'Q.E.D. — Quite Easily Devoured.',
  'REDUCED TO A ROUNDING ERROR.',
  'YOUR THEOREM IS REFUTED.',
]

type Phase = 'title' | 'playing' | 'caught' | 'over'
type ObType = 'tree' | 'rock' | 'sym'
interface Obstacle { x: number; y: number; type: ObType; sym?: string }

interface Game {
  phase: Phase
  scale: number
  w: number
  h: number
  sx: number          // skier screen x
  sy: number          // skier screen y
  camX: number
  camY: number
  dir: number         // -2..2
  tuck: boolean
  brake: boolean
  crash: number       // crash tumble timer
  invuln: number
  obstacles: Obstacle[]
  spawnY: number
  flakes: { x: number; y: number }[]
  monster: { x: number; y: number; active: boolean } | null
  caughtTimer: number
  best: number
  meters: number
  msg: string
  doom: string
  frame: number
}

const VX = [-1.05, -0.72, 0, 0.72, 1.05]
const VY = [0.12, 0.78, 1.0, 0.78, 0.12]
const MONSTER_DIST = 2400      // px of descent before the Horror wakes

function drawSprite(
  ctx: CanvasRenderingContext2D, sprite: string[],
  palette: Record<string, string>, ox: number, oy: number, scale: number,
) {
  for (let r = 0; r < sprite.length; r++) {
    const row = sprite[r]
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch === '.' ) continue
      const color = palette[ch]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(Math.round(ox + c * scale), Math.round(oy + r * scale), scale, scale)
    }
  }
}

function spriteWidth(sprite: string[]) { return sprite[0].length }

export default function SkiGame({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let mounted = true

    const setupSize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = window.innerWidth
      const h = window.innerHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = false
      return { w, h }
    }

    const reset = (): Game => {
      const { w, h } = setupSize()
      const scale = Math.max(3, Math.floor(h / 170))
      const flakes = Array.from({ length: 90 }, () => ({
        x: Math.random() * w, y: Math.random() * h,
      }))
      const prevBest = gameRef.current?.best ?? 0
      return {
        phase: 'title', scale, w, h,
        sx: w / 2, sy: h * 0.3,
        camX: 0, camY: 0,
        dir: 0, tuck: false, brake: false,
        crash: 0, invuln: 0,
        obstacles: [], spawnY: 0, flakes,
        monster: null, caughtTimer: 0,
        best: prevBest, meters: 0, msg: '', doom: '', frame: 0,
      }
    }

    gameRef.current = reset()

    const startRun = () => {
      const g = gameRef.current!
      const fresh = reset()
      fresh.best = g.best
      fresh.phase = 'playing'
      gameRef.current = fresh
    }

    // ---- input ----
    const onKeyDown = (e: KeyboardEvent) => {
      const g = gameRef.current!
      if (e.key.startsWith('Arrow')) e.preventDefault()
      if (e.key === 'Escape') { onClose(); return }

      if (g.phase === 'title') {
        if (e.key.startsWith('Arrow')) startRun()
        return
      }
      if (g.phase === 'over') {
        if (e.key === 'ArrowUp') startRun()
        return
      }
      if (g.phase !== 'playing') return
      if (g.crash > 0) return
      switch (e.key) {
        case 'ArrowLeft': g.dir = Math.max(-2, g.dir - 1); break
        case 'ArrowRight': g.dir = Math.min(2, g.dir + 1); break
        case 'ArrowDown': g.tuck = true; g.dir = 0; break
        case 'ArrowUp': g.brake = true; break
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const g = gameRef.current!
      if (e.key === 'ArrowDown') g.tuck = false
      if (e.key === 'ArrowUp') g.brake = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    const onResize = () => {
      const g = gameRef.current
      if (!g) return
      const { w, h } = setupSize()
      g.w = w; g.h = h; g.sx = w / 2; g.sy = h * 0.3
    }
    window.addEventListener('resize', onResize)

    // ---- spawning ----
    const spawnAhead = (g: Game) => {
      const limit = g.camY + g.h * 1.4
      const density = 0.45 + Math.min(0.9, g.camY / 9000)
      while (g.spawnY < limit) {
        g.spawnY += 26 + Math.random() * 46
        const lanes = Math.random() < density ? 1 : 0
        for (let i = 0; i < lanes; i++) {
          const x = g.camX + (Math.random() - 0.5) * g.w * 1.6
          const roll = Math.random()
          const type: ObType = roll < 0.5 ? 'tree' : roll < 0.78 ? 'rock' : 'sym'
          g.obstacles.push({
            x, y: g.spawnY + Math.random() * 20, type,
            sym: type === 'sym' ? SYMBOLS[(Math.random() * SYMBOLS.length) | 0] : undefined,
          })
        }
      }
      // drop obstacles well above the view
      g.obstacles = g.obstacles.filter(o => o.y > g.camY - g.h)
    }

    // ---- update ----
    const update = (g: Game) => {
      g.frame++
      const base = g.scale * 0.95
      const speedMul = g.tuck ? 1.4 : g.brake ? 0.5 : 1

      if (g.crash > 0) {
        g.crash--
        if (g.crash === 0) g.invuln = 30
      } else {
        const vy = base * VY[g.dir + 2] * speedMul * (g.brake && g.dir === 0 ? 0.5 : 1)
        const vx = base * VX[g.dir + 2] * speedMul
        g.camY += vy
        g.camX += vx
        // flakes drift to convey speed
        for (const f of g.flakes) {
          f.y += vy * 0.6 + 0.6
          f.x -= vx * 0.6
          if (f.y > g.h) { f.y = -4; f.x = Math.random() * g.w }
          if (f.x < 0) f.x += g.w; else if (f.x > g.w) f.x -= g.w
        }
      }
      if (g.invuln > 0) g.invuln--
      g.meters = Math.floor(g.camY / 7)
      if (g.meters > g.best) g.best = g.meters

      spawnAhead(g)

      // collisions
      if (g.crash === 0 && g.invuln === 0) {
        for (const o of g.obstacles) {
          const dx = o.x - g.camX
          const dy = o.y - g.camY
          const halfW = o.type === 'tree' ? g.scale * 4 : g.scale * 3.5
          if (Math.abs(dx) < halfW && dy < g.scale * 2 && dy > -g.scale * 2) {
            g.crash = 45
            g.tuck = false; g.brake = false
            g.msg = CRASH_MSGS[(Math.random() * CRASH_MSGS.length) | 0]
            break
          }
        }
      }

      // the Horror awakens
      if (!g.monster && g.camY > MONSTER_DIST) {
        g.monster = { x: g.camX, y: g.camY - g.sy - 60, active: true }
      }
      if (g.monster) {
        // Slightly faster than a full tuck (base*1.4): the chase is winnable
        // for a while, but the Horror is relentless and will close the gap.
        const maxVy = base * 1.55
        g.monster.y += maxVy
        g.monster.x += Math.sign(g.camX - g.monster.x) * Math.min(base * 0.8, Math.abs(g.camX - g.monster.x))
        const close = Math.abs(g.monster.y - g.camY) < g.scale * 4 && Math.abs(g.monster.x - g.camX) < g.scale * 6
        if (close) {
          g.phase = 'caught'
          g.caughtTimer = 80
          g.doom = DOOM_MSGS[(Math.random() * DOOM_MSGS.length) | 0]
        }
      }
    }

    // ---- render ----
    const W2SX = (g: Game, wx: number) => g.sx + (wx - g.camX)
    const W2SY = (g: Game, wy: number) => g.sy + (wy - g.camY)

    const hyperPalette = (g: Game): Record<string, string> => {
      const hue = (g.frame * 2.4 + (g.tuck ? 80 : 0)) % 360
      return {
        ...STATIC_PALETTE,
        H: `hsl(${hue}, 100%, 62%)`,
        h: `hsl(${(hue + 28) % 360}, 100%, 46%)`,
      }
    }

    const drawSkier = (g: Game, crashed: boolean) => {
      const pal = hyperPalette(g)
      const sprite = crashed ? SKIER_CRASH : SKIER
      const sw = spriteWidth(sprite) * g.scale
      const sh = sprite.length * g.scale
      ctx.save()
      ctx.translate(g.sx, g.sy)
      if (!crashed) ctx.rotate((g.dir * 16 * Math.PI) / 180)
      // shadow
      ctx.fillStyle = 'rgba(80,90,120,0.22)'
      ctx.beginPath()
      ctx.ellipse(0, sh * 0.42, sw * 0.5, g.scale * 1.6, 0, 0, Math.PI * 2)
      ctx.fill()
      drawSprite(ctx, sprite, pal, -sw / 2, -sh / 2, g.scale)
      ctx.restore()
    }

    const drawMonster = (g: Game, mx: number, my: number) => {
      const frame = (g.frame % 150) < 8 ? MONSTER_BLINK
        : ((g.frame >> 3) & 1) ? MONSTER_A : MONSTER_B
      const sw = spriteWidth(frame) * g.scale
      const sh = frame.length * g.scale
      ctx.save()
      ctx.shadowColor = 'rgba(120,255,40,0.55)'
      ctx.shadowBlur = g.scale * 4
      drawSprite(ctx, frame, STATIC_PALETTE, mx - sw / 2, my - sh / 2, g.scale)
      ctx.restore()
    }

    const drawObstacle = (g: Game, o: Obstacle) => {
      const x = W2SX(g, o.x), y = W2SY(g, o.y)
      if (x < -60 || x > g.w + 60 || y < -60 || y > g.h + 60) return
      if (o.type === 'tree') {
        const sw = spriteWidth(TREE) * g.scale, sh = TREE.length * g.scale
        ctx.fillStyle = 'rgba(40,60,90,0.18)'
        ctx.beginPath(); ctx.ellipse(x, y, sw * 0.4, g.scale * 1.4, 0, 0, Math.PI * 2); ctx.fill()
        drawSprite(ctx, TREE, STATIC_PALETTE, x - sw / 2, y - sh, g.scale)
      } else if (o.type === 'rock') {
        const sw = spriteWidth(ROCK) * g.scale, sh = ROCK.length * g.scale
        drawSprite(ctx, ROCK, STATIC_PALETTE, x - sw / 2, y - sh, g.scale)
      } else {
        ctx.save()
        ctx.font = `bold ${g.scale * 5}px ui-monospace, monospace`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(255,40,40,0.8)'
        ctx.shadowBlur = g.scale * 3
        ctx.fillStyle = '#c81e1e'
        const wob = Math.sin((g.frame + o.x) * 0.1) * g.scale * 0.4
        ctx.fillText(o.sym ?? '?', x, y - g.scale * 2 + wob)
        ctx.restore()
      }
    }

    const centerText = (g: Game, lines: { t: string; size: number; color: string; dy: number }[]) => {
      ctx.save()
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      for (const l of lines) {
        ctx.font = `bold ${l.size}px ui-monospace, monospace`
        ctx.fillStyle = l.color
        ctx.fillText(l.t, g.w / 2, g.h / 2 + l.dy)
      }
      ctx.restore()
    }

    const render = (g: Game) => {
      // slope — cool snowy gradient
      const grad = ctx.createLinearGradient(0, 0, 0, g.h)
      grad.addColorStop(0, '#e3edf9')
      grad.addColorStop(1, '#f7fbff')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, g.w, g.h)

      // snow flakes / speed streaks
      ctx.fillStyle = 'rgba(140,160,190,0.5)'
      for (const f of g.flakes) ctx.fillRect(f.x, f.y, 2, 2)

      // obstacles sorted by y for depth
      const obs = [...g.obstacles].sort((a, b) => a.y - b.y)
      for (const o of obs) {
        if (o.y <= g.camY) drawObstacle(g, o)
      }

      // monster behind skier (uphill) draws before skier
      if (g.monster && g.monster.y <= g.camY) {
        drawMonster(g, W2SX(g, g.monster.x), W2SY(g, g.monster.y))
      }

      if (g.phase === 'caught') {
        // shake + chomp
        const k = g.caughtTimer
        const shake = (Math.random() - 0.5) * Math.min(10, k * 0.2)
        ctx.save(); ctx.translate(shake, shake)
        drawSkier(g, true)
        if (g.monster) drawMonster(g, g.sx, g.sy - g.scale * 2)
        ctx.restore()
      } else {
        drawSkier(g, g.crash > 0)
      }

      // obstacles in front of skier (below) for overlap depth
      for (const o of obs) {
        if (o.y > g.camY) drawObstacle(g, o)
      }
      if (g.monster && g.monster.y > g.camY && g.phase !== 'caught') {
        drawMonster(g, W2SX(g, g.monster.x), W2SY(g, g.monster.y))
      }

      // HUD
      ctx.save()
      ctx.font = `bold ${Math.max(13, g.scale * 3.4)}px ui-monospace, monospace`
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#1f2d4a'
      ctx.textAlign = 'left'
      ctx.fillText(`❄ ${g.meters} m`, 16, 14)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#6b7280'
      ctx.fillText(`best ${g.best} m`, g.w - 16, 14)
      if (g.monster) {
        ctx.textAlign = 'center'
        ctx.fillStyle = '#b30f0f'
        ctx.fillText('▲ IT IS BEHIND YOU ▲', g.w / 2, 14)
      }
      ctx.restore()

      if (g.crash > 0 && g.phase === 'playing') {
        centerText(g, [{ t: g.msg, size: Math.max(16, g.scale * 4), color: '#b30f0f', dy: -g.h * 0.18 }])
      }

      // overlays
      if (g.phase === 'title' || g.phase === 'over') {
        ctx.save()
        ctx.fillStyle = 'rgba(12,16,28,0.55)'
        ctx.fillRect(0, 0, g.w, g.h)
        ctx.restore()
      }
      if (g.phase === 'title') {
        centerText(g, [
          { t: 'SCHUSS', size: g.scale * 14, color: '#7cf3ff', dy: -g.h * 0.16 },
          { t: 'Descent into Madness', size: g.scale * 5, color: '#ff5cf0', dy: -g.h * 0.06 },
          { t: 'A scientist. A hypercolor suit. An Eldritch Horror', size: g.scale * 3.2, color: '#e8eefc', dy: g.h * 0.02 },
          { t: 'enraged by your mathematical nonsense.', size: g.scale * 3.2, color: '#e8eefc', dy: g.h * 0.06 },
          { t: '←/→ steer    ↓ tuck    ↑ snowplow', size: g.scale * 3.4, color: '#ffd23f', dy: g.h * 0.16 },
          { t: 'Press an ARROW to drop in    ·    Esc to quit', size: g.scale * 3.2, color: '#9fb3d6', dy: g.h * 0.23 },
        ])
      } else if (g.phase === 'over') {
        centerText(g, [
          { t: 'DEVOURED', size: g.scale * 12, color: '#39ff14', dy: -g.h * 0.16 },
          { t: g.doom, size: g.scale * 3.6, color: '#ff8b8b', dy: -g.h * 0.05 },
          { t: `You descended ${g.meters} m  ·  best ${g.best} m`, size: g.scale * 4, color: '#e8eefc', dy: g.h * 0.04 },
          { t: 'Press ↑ to ride again    ·    Esc to quit', size: g.scale * 3.4, color: '#ffd23f', dy: g.h * 0.16 },
        ])
      }
    }

    // ---- loop ----
    const loop = () => {
      if (!mounted) return
      const g = gameRef.current!
      if (g.phase === 'playing') update(g)
      else if (g.phase === 'caught') {
        g.frame++
        g.caughtTimer--
        if (g.caughtTimer <= 0) g.phase = 'over'
      } else { g.frame++ }
      render(g)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      mounted = false
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('resize', onResize)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[100] bg-black select-none" aria-label="Hidden ski game">
      <canvas ref={canvasRef} className="block w-full h-full" />
      <button
        onClick={onClose}
        title="Quit (Esc)"
        className="absolute top-3 right-3 z-10 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded px-2 py-1 text-xs"
      >
        ✕ esc
      </button>
    </div>
  )
}

import { useEffect, useRef } from 'react'

/**
 * "SCHUSS — Descent into Madness" — a hidden, original downhill-skiing
 * mini-game (an affectionate homage to the genre, with all-original art, name
 * and code; no copyrighted assets). A scientist in a hypercolor ski suit
 * bombs an endless, procedurally-generated slope strewn with the mathematical
 * nonsense that has awoken an Eldritch Horror — which, past a distance, gives
 * relentless chase and (eventually) devours the mathematician.
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

// Airborne tuck (off a ramp): knees up, poles tucked, skis together.
const SKIER_AIR = [
  '....HHHH....',
  '...HHHHHH...',
  '...kkkkkk...',
  '....HHHH....',
  '..GHHHHHHG..',
  '.GHHHHHHHHG.',
  '.GHHHHHHHHG.',
  '..hhhhhhhh..',
  '..hhhhhhhh..',
  '...PPPPPP...',
  '...PPPPPP...',
  '..YYYYYYYY..',
  '..YYYYYYYY..',
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

// Eldritch Horror — animation frames (eyes blink, tentacles writhe, maw gapes).
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
// Maw agape — used during the gobble animation.
const MONSTER_GAPE = [
  '..r......r..',
  '..r......r..',
  '.gDDDDDDDDg.',
  'DDDDDDDDDDDD',
  'DEEDDDDDEEDD',
  'DDDDDDDDDDDD',
  'DwDDDDDDDDwD',
  'mmmmmmmmmmmm',
  'wmmmmmmmmmmw',
  'mmmmmmmmmmmm',
  'wmmmmmmmmmmw',
  'mmmmmmmmmmmm',
  'tDmmmmmmmmDt',
  '.t.t..t.t.t.',
]

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

// Snow kicker / ramp — ski over it to catch big air.
const RAMP = [
  '.........lll',
  '......RRRlll',
  '...RRRRRRlll',
  '.RRRRRRRRlll',
  'RRRRRRRRRlll',
  'SSSSSSSSSSSS',
]

const STATIC_PALETTE: Record<string, string> = {
  k: '#15151f',         // goggles
  G: '#ffd23f',         // gloves
  P: '#ff3df5',         // ski pants (neon magenta)
  Y: '#ff5722',         // skis
  // monster
  D: '#241036', r: '#d9d2b0', g: '#6a0dad',
  e: '#aaff00', E: '#ff1f1f', m: '#05010a', w: '#f2e9d0', t: '#39ff14',
  // trees / rocks / ramp
  T: '#1f8a4d', b: '#5c3a1e', o: '#9aa0a6', p: '#5f656b',
  R: '#bcd9f5', S: '#7fa8d6', l: '#22d3ee',
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
const AIR_MSGS = ['✦ HUGE AIR!', '✦ NICE LINE!', '✦ STYLE POINTS!', '✦ SEND IT!']
const DOOM_MSGS = [
  'YOUR MATHEMATICAL NONSENSE ENDS HERE.',
  'THE HORROR HAS BALANCED YOUR EQUATION.',
  'Q.E.D. — Quite Easily Devoured.',
  'REDUCED TO A ROUNDING ERROR.',
  'YOUR THEOREM IS REFUTED.',
]

type Phase = 'title' | 'playing' | 'caught' | 'over'
type ObType = 'tree' | 'rock' | 'sym' | 'ramp'
interface Obstacle { x: number; y: number; type: ObType; sym?: string }

interface Game {
  phase: Phase
  scale: number
  w: number
  h: number
  sx: number
  sy: number
  camX: number
  camY: number
  dir: number          // -2..2
  tuck: boolean
  brake: boolean
  crash: number        // wipeout timer
  air: number          // remaining airborne frames
  airMax: number
  invuln: number
  obstacles: Obstacle[]
  spawnY: number
  flakes: { x: number; y: number }[]
  monster: { x: number; y: number } | null
  monAnger: number
  caught: number       // gobble-animation frame counter
  best: number
  meters: number
  msg: string
  msgTimer: number
  doom: string
  frame: number
}

const VX = [-1.05, -0.72, 0, 0.72, 1.05]
const VY = [0.12, 0.78, 1.0, 0.78, 0.12]
const SPAWN_M = 1200          // metres of descent before the Horror wakes
const M_PER_PX = 1 / 7        // metres per world pixel

function drawSprite(
  ctx: CanvasRenderingContext2D, sprite: string[],
  palette: Record<string, string>, ox: number, oy: number, scale: number,
) {
  for (let r = 0; r < sprite.length; r++) {
    const row = sprite[r]
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch === '.') continue
      const color = palette[ch]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(Math.round(ox + c * scale), Math.round(oy + r * scale), scale, scale)
    }
  }
}

function drawSpriteC(
  ctx: CanvasRenderingContext2D, sprite: string[], palette: Record<string, string>,
  cx: number, cy: number, cell: number, alpha = 1,
) {
  const w = sprite[0].length * cell
  const h = sprite.length * cell
  if (alpha < 1) { ctx.save(); ctx.globalAlpha = Math.max(0, alpha) }
  drawSprite(ctx, sprite, palette, cx - w / 2, cy - h / 2, cell)
  if (alpha < 1) ctx.restore()
}

const pick = <T,>(a: T[]): T => a[(Math.random() * a.length) | 0]

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
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = false
      return { w, h }
    }

    const reset = (): Game => {
      const { w, h } = setupSize()
      const scale = Math.max(3, Math.floor(h / 170))
      const flakes = Array.from({ length: 90 }, () => ({ x: Math.random() * w, y: Math.random() * h }))
      const prevBest = gameRef.current?.best ?? 0
      return {
        phase: 'title', scale, w, h,
        sx: w / 2, sy: h * 0.3,
        camX: 0, camY: 0,
        dir: 0, tuck: false, brake: false,
        crash: 0, air: 0, airMax: 0, invuln: 0,
        obstacles: [], spawnY: 0, flakes,
        monster: null, monAnger: 0, caught: 0,
        best: prevBest, meters: 0, msg: '', msgTimer: 0, doom: '', frame: 0,
      }
    }

    gameRef.current = reset()

    const startRun = () => {
      const prevBest = gameRef.current?.best ?? 0
      const fresh = reset()
      fresh.best = prevBest
      fresh.phase = 'playing'
      gameRef.current = fresh
    }

    const flash = (g: Game, m: string, frames = 70) => { g.msg = m; g.msgTimer = frames }

    // ---- input ----
    const onKeyDown = (e: KeyboardEvent) => {
      const g = gameRef.current!
      if (e.key.startsWith('Arrow')) e.preventDefault()
      if (e.key === 'Escape') { onClose(); return }
      if (g.phase === 'title') { if (e.key.startsWith('Arrow')) startRun(); return }
      if (g.phase === 'over') { if (e.key === 'ArrowUp') startRun(); return }
      if (g.phase !== 'playing' || g.crash > 0) return
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
      g.scale = Math.max(3, Math.floor(h / 170))
    }
    window.addEventListener('resize', onResize)

    // ---- procedural slope ----
    // Openness oscillates with descent: high → open snowfields ("sweet runs"
    // with ramps), low → dense forest. Hazards spawn around the skier so the
    // endless world is always populated where it matters.
    const placeScatter = (g: Game, x: number, y: number) => {
      const roll = Math.random()
      const type: ObType = roll < 0.62 ? 'tree' : roll < 0.86 ? 'rock' : 'sym'
      g.obstacles.push({ x, y, type, sym: type === 'sym' ? pick(SYMBOLS) : undefined })
    }

    const spawnAhead = (g: Game) => {
      const limit = g.camY + g.h * 1.5
      const band = g.w * 0.95
      let guard = 0
      while (g.spawnY < limit && guard++ < 400) {
        g.spawnY += 22 + Math.random() * 30
        const y = g.spawnY
        const openness = 0.5 + 0.34 * Math.sin(y * 0.0011) + 0.16 * Math.sin(y * 0.00041 + 1.7)
        const density = Math.max(0, 0.62 * (1 - openness))
        for (let i = 0; i < 4; i++) {
          if (Math.random() < density) {
            placeScatter(g, g.camX + (Math.random() - 0.5) * 2 * band, y + Math.random() * 16)
          }
        }
        // tight tree clumps inside the forest
        if (openness < 0.34 && Math.random() < 0.28) {
          const cx = g.camX + (Math.random() - 0.5) * 2 * band
          const n = 2 + ((Math.random() * 3) | 0)
          for (let i = 0; i < n; i++) {
            g.obstacles.push({ x: cx + (Math.random() - 0.5) * 46, y: y + Math.random() * 30, type: 'tree' })
          }
        }
        // ramps + the occasional lone equation out in the open (sweet-run zones)
        if (openness > 0.7 && Math.random() < 0.09) {
          g.obstacles.push({ x: g.camX + (Math.random() - 0.5) * band, y: y + 8, type: 'ramp' })
        }
        if (Math.random() < 0.035) {
          g.obstacles.push({ x: g.camX + (Math.random() - 0.5) * 2 * band, y, type: 'sym', sym: pick(SYMBOLS) })
        }
      }
      g.obstacles = g.obstacles.filter(o => o.y > g.camY - g.h * 0.8)
      if (g.obstacles.length > 600) g.obstacles.splice(0, g.obstacles.length - 600)
    }

    const halfW = (g: Game, t: ObType) =>
      t === 'tree' ? g.scale * 4 : t === 'ramp' ? g.scale * 5 : g.scale * 3.5

    // ---- update ----
    const update = (g: Game) => {
      g.frame++
      if (g.msgTimer > 0) g.msgTimer--
      const base = g.scale * 0.95
      const speedMul = g.air > 0 ? 1.25 : g.tuck ? 1.5 : g.brake ? 0.5 : 1

      if (g.crash > 0) {
        g.crash--
        if (g.crash === 0) g.invuln = 35
      } else {
        const idx = g.dir + 2
        let vy = base * VY[idx] * speedMul
        const vx = base * VX[idx] * speedMul
        if (g.air > 0) vy = base * 1.2            // fly straight & fast while airborne
        if (g.brake && g.dir === 0 && g.air === 0) vy *= 0.5
        g.camY += vy
        g.camX += vx
        for (const f of g.flakes) {
          f.y += vy * 0.6 + 0.6
          f.x -= vx * 0.6
          if (f.y > g.h) { f.y = -4; f.x = Math.random() * g.w }
          if (f.x < 0) f.x += g.w; else if (f.x > g.w) f.x -= g.w
        }
      }
      if (g.air > 0) g.air--
      if (g.invuln > 0) g.invuln--
      if (!Number.isFinite(g.camX)) g.camX = 0
      if (!Number.isFinite(g.camY)) g.camY = 0
      g.meters = Math.max(0, Math.floor(g.camY * M_PER_PX))
      if (g.meters > g.best) g.best = g.meters

      spawnAhead(g)

      // collisions (skip while crashed, airborne, or briefly invulnerable)
      if (g.crash === 0 && g.air === 0 && g.invuln === 0) {
        for (const o of g.obstacles) {
          const dx = o.x - g.camX
          const dy = o.y - g.camY
          if (Math.abs(dx) < halfW(g, o.type) && dy < g.scale * 2 && dy > -g.scale * 2) {
            if (o.type === 'ramp') {
              g.airMax = 52 + (g.tuck ? 16 : 0)
              g.air = g.airMax
              g.invuln = g.airMax + 8
              flash(g, pick(AIR_MSGS), 60)
            } else {
              g.crash = 70
              g.tuck = false; g.brake = false
              flash(g, pick(CRASH_MSGS), 70)
            }
            break
          }
        }
      }

      // the Horror awakens — distance-based (metres), not pixels
      if (!g.monster && g.meters >= SPAWN_M) {
        g.monster = { x: g.camX, y: g.camY - g.h * 0.6 }
        g.monAnger = 0
        flash(g, 'SOMETHING HAS AWOKEN BELOW THE PISTE…', 120)
      }
      if (g.monster) {
        // Relentless homing pursuit: always steers toward the skier, so it can
        // never overshoot and vanish. It grows angrier (faster) over time, so
        // a tucking skier can flee for a while but the Horror always closes in.
        g.monAnger = Math.min(0.85, g.monAnger + 0.00035)
        const sp = base * (1.02 + g.monAnger)
        const dx = g.camX - g.monster.x
        const dy = g.camY - g.monster.y
        const d = Math.hypot(dx, dy) || 1
        g.monster.x += (dx / d) * sp
        g.monster.y += (dy / d) * sp
        const caught = Math.abs(g.monster.x - g.camX) < g.scale * 4.5
                    && Math.abs(g.monster.y - g.camY) < g.scale * 4.5
        if (caught && g.air === 0) {
          g.phase = 'caught'
          g.caught = 0
          g.doom = pick(DOOM_MSGS)
        }
      }
    }

    // ---- render ----
    const W2SX = (g: Game, wx: number) => g.sx + (wx - g.camX)
    const W2SY = (g: Game, wy: number) => g.sy + (wy - g.camY)

    const hyperPalette = (g: Game): Record<string, string> => {
      const hue = (g.frame * 2.4 + (g.tuck ? 80 : 0) + (g.air > 0 ? 160 : 0)) % 360
      return {
        ...STATIC_PALETTE,
        H: `hsl(${hue}, 100%, 62%)`,
        h: `hsl(${(hue + 28) % 360}, 100%, 46%)`,
      }
    }

    const monsterFrame = (g: Game) =>
      (g.frame % 150) < 8 ? MONSTER_BLINK : ((g.frame >> 3) & 1) ? MONSTER_A : MONSTER_B

    const drawMonster = (g: Game, cx: number, cy: number, frame: string[], cell: number) => {
      ctx.save()
      ctx.shadowColor = 'rgba(120,255,40,0.55)'
      ctx.shadowBlur = g.scale * 4
      drawSpriteC(ctx, frame, STATIC_PALETTE, cx, cy, cell)
      ctx.restore()
    }

    const drawSkier = (g: Game) => {
      const pal = hyperPalette(g)
      const airborne = g.air > 0
      const lift = airborne ? Math.sin((1 - g.air / g.airMax) * Math.PI) * g.scale * 16 : 0
      const sprite = g.crash > 0 ? SKIER_CRASH : airborne ? SKIER_AIR : SKIER
      const cell = g.scale
      const sw = sprite[0].length * cell
      const sh = sprite.length * cell
      // ground shadow (shrinks with height)
      const shrink = airborne ? 1 - lift / (g.scale * 22) : 1
      ctx.fillStyle = `rgba(70,90,120,${0.22 * Math.max(0.25, shrink)})`
      ctx.beginPath()
      ctx.ellipse(g.sx, g.sy + sh * 0.42, sw * 0.5 * Math.max(0.4, shrink), g.scale * 1.6 * Math.max(0.4, shrink), 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.save()
      ctx.translate(g.sx, g.sy - lift)
      if (g.crash === 0 && !airborne) ctx.rotate((g.dir * 16 * Math.PI) / 180)
      if (g.crash > 0) ctx.rotate(Math.sin(g.frame * 0.5) * 0.12)   // dazed wobble
      drawSprite(ctx, sprite, pal, -sw / 2, -sh / 2, cell)
      ctx.restore()
      if (g.crash > 0) {
        ctx.save()
        ctx.font = `bold ${g.scale * 4}px ui-monospace, monospace`
        ctx.textAlign = 'center'
        ctx.fillStyle = '#f59e0b'
        ctx.fillText('✸ ✸ ✸', g.sx, g.sy - sh * 0.7 - lift)
        ctx.restore()
      }
    }

    const drawObstacle = (g: Game, o: Obstacle) => {
      const x = W2SX(g, o.x), y = W2SY(g, o.y)
      if (x < -80 || x > g.w + 80 || y < -80 || y > g.h + 80) return
      if (o.type === 'tree') {
        const sw = TREE[0].length * g.scale, sh = TREE.length * g.scale
        ctx.fillStyle = 'rgba(40,60,90,0.18)'
        ctx.beginPath(); ctx.ellipse(x, y, sw * 0.4, g.scale * 1.4, 0, 0, Math.PI * 2); ctx.fill()
        drawSprite(ctx, TREE, STATIC_PALETTE, x - sw / 2, y - sh, g.scale)
      } else if (o.type === 'rock') {
        const sw = ROCK[0].length * g.scale, sh = ROCK.length * g.scale
        drawSprite(ctx, ROCK, STATIC_PALETTE, x - sw / 2, y - sh, g.scale)
      } else if (o.type === 'ramp') {
        const sw = RAMP[0].length * g.scale, sh = RAMP.length * g.scale
        drawSprite(ctx, RAMP, STATIC_PALETTE, x - sw / 2, y - sh, g.scale)
      } else {
        ctx.save()
        ctx.font = `bold ${g.scale * 5}px ui-monospace, monospace`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(255,40,40,0.8)'; ctx.shadowBlur = g.scale * 3
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

    // multi-stage "gobble" animation when the Horror catches the skier
    const renderGobble = (g: Game) => {
      const t = g.caught
      const shakeAmp = t < 50 ? Math.min(12, 4 + t * 0.2) : Math.max(0, 12 - (t - 50) * 0.5)
      const shake = () => (Math.random() - 0.5) * shakeAmp
      ctx.save()
      ctx.translate(shake(), shake())
      // skier gets sucked up into the maw and shrinks away (t 12 → 40)
      const vanish = Math.max(0, 1 - Math.max(0, t - 12) / 28)
      if (vanish > 0.02) {
        // the skier, a shrinking crash sprite, is drawn up into the maw
        const cell = g.scale * vanish
        const rise = (1 - vanish) * g.scale * 10
        drawSpriteC(ctx, SKIER_CRASH, hyperPalette(g), g.sx, g.sy - rise, cell, vanish)
      }
      // monster lunges over the skier, maw agape then chomping shut
      const lunge = Math.min(1, t / 12)
      const my = g.sy - g.scale * 6 + lunge * g.scale * 6
      const gape = t < 12 ? MONSTER_GAPE : t < 30 ? (((t >> 1) & 1) ? MONSTER_GAPE : MONSTER_A) : MONSTER_A
      const pulse = t > 40 ? 1 + Math.sin((t - 40) * 0.4) * 0.06 : 1   // gulp wobble
      drawMonster(g, g.sx, my, gape, g.scale * 1.45 * pulse)
      ctx.restore()
      if (t >= 16 && t <= 52) {
        centerText(g, [{ t: t < 34 ? 'CHOMP!' : 'GULP.', size: g.scale * 11, color: '#39ff14', dy: -g.h * 0.12 }])
      }
    }

    const render = (g: Game) => {
      const grad = ctx.createLinearGradient(0, 0, 0, g.h)
      grad.addColorStop(0, '#e3edf9')
      grad.addColorStop(1, '#f7fbff')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, g.w, g.h)

      ctx.fillStyle = 'rgba(140,160,190,0.5)'
      for (const f of g.flakes) ctx.fillRect(f.x, f.y, 2, 2)

      const obs = [...g.obstacles].sort((a, b) => a.y - b.y)
      for (const o of obs) if (o.y <= g.camY) drawObstacle(g, o)

      if (g.monster && g.monster.y <= g.camY && g.phase !== 'caught') {
        drawMonster(g, W2SX(g, g.monster.x), W2SY(g, g.monster.y), monsterFrame(g), g.scale)
      }

      if (g.phase === 'caught') renderGobble(g)
      else drawSkier(g)

      for (const o of obs) if (o.y > g.camY) drawObstacle(g, o)
      if (g.monster && g.monster.y > g.camY && g.phase !== 'caught') {
        drawMonster(g, W2SX(g, g.monster.x), W2SY(g, g.monster.y), monsterFrame(g), g.scale)
      }

      // HUD
      ctx.save()
      ctx.font = `bold ${Math.max(13, g.scale * 3.4)}px ui-monospace, monospace`
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#1f2d4a'; ctx.textAlign = 'left'
      ctx.fillText(`❄ ${g.meters} m`, 16, 14)
      ctx.fillStyle = '#6b7280'; ctx.textAlign = 'right'
      ctx.fillText(`best ${g.best} m`, g.w - 16, 14)
      if (g.monster && g.phase === 'playing') {
        ctx.textAlign = 'center'; ctx.fillStyle = '#b30f0f'
        const behind = g.monster.y <= g.camY
        ctx.fillText(behind ? '▲ IT IS BEHIND YOU ▲' : '▼ IT IS BELOW YOU ▼', g.w / 2, 14)
      }
      ctx.restore()

      if (g.msgTimer > 0 && (g.phase === 'playing')) {
        const isAir = g.msg.startsWith('✦')
        centerText(g, [{ t: g.msg, size: Math.max(16, g.scale * 4), color: isAir ? '#0ea5e9' : '#b30f0f', dy: -g.h * 0.2 }])
      }

      if (g.phase === 'title' || g.phase === 'over') {
        ctx.save(); ctx.fillStyle = 'rgba(12,16,28,0.55)'; ctx.fillRect(0, 0, g.w, g.h); ctx.restore()
      }
      if (g.phase === 'title') {
        centerText(g, [
          { t: 'SCHUSS', size: g.scale * 14, color: '#7cf3ff', dy: -g.h * 0.16 },
          { t: 'Descent into Madness', size: g.scale * 5, color: '#ff5cf0', dy: -g.h * 0.06 },
          { t: 'A scientist. A hypercolor suit. An Eldritch Horror', size: g.scale * 3.2, color: '#e8eefc', dy: g.h * 0.02 },
          { t: 'enraged by your mathematical nonsense.', size: g.scale * 3.2, color: '#e8eefc', dy: g.h * 0.06 },
          { t: '←/→ steer   ↓ tuck   ↑ snowplow   · hit ramps for air ·', size: g.scale * 3.2, color: '#ffd23f', dy: g.h * 0.16 },
          { t: 'Press an ARROW to drop in   ·   Esc to quit', size: g.scale * 3.1, color: '#9fb3d6', dy: g.h * 0.23 },
        ])
      } else if (g.phase === 'over') {
        centerText(g, [
          { t: 'DEVOURED', size: g.scale * 12, color: '#39ff14', dy: -g.h * 0.16 },
          { t: g.doom, size: g.scale * 3.6, color: '#ff8b8b', dy: -g.h * 0.05 },
          { t: `You descended ${g.meters} m   ·   best ${g.best} m`, size: g.scale * 4, color: '#e8eefc', dy: g.h * 0.04 },
          { t: 'Press ↑ to ride again   ·   Esc to quit', size: g.scale * 3.4, color: '#ffd23f', dy: g.h * 0.16 },
        ])
      }
    }

    // ---- loop ----
    const loop = () => {
      if (!mounted) return
      const g = gameRef.current!
      try {
        if (g.phase === 'playing') update(g)
        else if (g.phase === 'caught') {
          g.frame++; g.caught++
          if (g.caught >= 82) g.phase = 'over'
        } else g.frame++
        render(g)
      } catch {
        // never let a render glitch wedge the game
      }
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

import { useCallback, useEffect, useRef, useState } from 'react'
import { Game, type HudState, type ToastEvent } from './game/game'
import {
  SLOT_COUNT,
  deleteSlot,
  fmtTime,
  getActiveSlot,
  hasSave,
  loadSave,
  renameSlot,
  setActiveSlot,
  slotName,
  slotSummary,
  storeSave,
  type SaveData,
  type Settings,
} from './game/save'
import { fmt } from './game/levels'
import { generatedObbyReward } from './game/generator'
import { currentWeekKey } from './game/weekly'
import { ACHIEVEMENTS } from './game/achievements'
import { PETS, petById } from './game/pets'
import { HATS, TRAILS, CHARM_BONUS, CHARM_MAX, charmPrice } from './game/shop'

const INITIAL_HUD: HudState = {
  speed: 0,
  speedText: '0',
  wins: 0,
  coins: 0,
  mult: 1,
  rebirths: 0,
  rebirthMult: 1,
  gain: 1,
  gainText: '1',
  level: 0,
  levelName: 'Cream',
  levelColor: '#fff3df',
  nextLevelAt: 100,
  nextLevelText: '100',
  muted: false,
  mode: 'hub',
  obbyId: null,
  obbyName: null,
  obbyReward: null,
  obbyTime: null,
  obbyBest: null,
  obbyGoals: null,
  obbyMedals: null,
  practice: null,
  readyMult: null,
  lockedMult: { mult: 2, wins: 3 },
  rebirthReady: false,
  rebirthReqLevel: 5,
}

interface Toast extends ToastEvent {
  id: number
}

export default function App() {
  const [screen, setScreen] = useState<'title' | 'game'>('title')
  const [save, setSave] = useState<SaveData>(() => loadSave())
  const [saveExists, setSaveExists] = useState(() => hasSave())
  const [activeSlot, setActiveSlotState] = useState(() => getActiveSlot())
  const [showSlots, setShowSlots] = useState(
    () => !Array.from({ length: SLOT_COUNT }, (_, i) => hasSave(i + 1)).some(Boolean),
  )
  const [hud, setHud] = useState<HudState>(INITIAL_HUD)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [showTrophy, setShowTrophy] = useState(false)
  const [showPets, setShowPets] = useState(false)
  const [showShop, setShowShop] = useState(false)
  const [paused, setPaused] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const toastId = useRef(0)

  const pushToast = useCallback((t: ToastEvent) => {
    const id = ++toastId.current
    setToasts((prev) => [...prev.slice(-3), { ...t, id }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id))
    }, 4200)
  }, [])

  // any open overlay pauses the game world
  useEffect(() => {
    gameRef.current?.setPaused(paused || showTrophy || showPets || showShop)
  }, [paused, showTrophy, showPets, showShop, screen])

  useEffect(() => {
    if (screen !== 'game' || !canvasRef.current) return
    const game = new Game(canvasRef.current, loadSave(), {
      onHud: (h) => setHud(h),
      onToast: (t) => pushToast(t),
      onPauseToggle: () => setPaused((p) => !p),
      onPetsToggle: () => setShowPets((p) => !p),
      onOpenShop: () => setShowShop(true),
      onSaveChanged: () => {
        setSave(loadSave())
        setSaveExists(hasSave())
      },
    })
    gameRef.current = game
    game.audio.unlock()
    game.audio.startBgm()
    game.start()
    return () => {
      game.destroy()
      gameRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])

  const handlePlay = useCallback(() => setScreen('game'), [])

  const handleSelectSlot = useCallback((n: number) => {
    setActiveSlot(n)
    setActiveSlotState(n)
    setSave(loadSave(n))
    setSaveExists(hasSave(n))
    setShowSlots(false)
  }, [])

  const refreshSlot = useCallback(() => {
    const n = getActiveSlot()
    setActiveSlotState(n)
    setSave(loadSave(n))
    setSaveExists(hasSave(n))
  }, [])

  /** Equip works both in-game (through Game) and on the title screen (direct save edit). */
  const handleEquipPet = useCallback((id: string | null) => {
    if (gameRef.current) {
      gameRef.current.equipPet(id)
    } else {
      const s = loadSave()
      s.equippedPet = id
      storeSave(s)
      setSave(s)
    }
  }, [])

  const handleSettings = useCallback((s: Settings) => {
    gameRef.current?.updateSettings(s)
    setSave((prev) => ({ ...prev, settings: s }))
  }, [])

  if (screen === 'title') {
    return (
      <>
        {showSlots ? (
          <SlotPicker
            activeSlot={activeSlot}
            onSelect={handleSelectSlot}
            onChanged={refreshSlot}
          />
        ) : (
          <TitleScreen
            save={save}
            saveExists={saveExists}
            slotLabel={`Slot ${activeSlot} · ${slotName(activeSlot)}`}
            onPlay={handlePlay}
            onSwitchSlots={() => setShowSlots(true)}
            onTrophy={() => setShowTrophy(true)}
            onPets={() => setShowPets(true)}
          />
        )}
        {showTrophy && <TrophyRoom save={save} onClose={() => setShowTrophy(false)} />}
        {showPets && <PetsPanel save={save} onEquip={handleEquipPet} onClose={() => setShowPets(false)} />}
      </>
    )
  }

  const muteIcon =
    hud.muted ? '🔇' : save.settings.sfxVol === 0 ? '🔈' : save.settings.sfxVol < 0.5 ? '🔉' : '🔊'

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#2b2333] select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <Hud
        hud={hud}
        muteIcon={muteIcon}
        gameRef={gameRef}
        onTrophy={() => setShowTrophy(true)}
        onPets={() => setShowPets(true)}
        onShop={() => setShowShop(true)}
        onPause={() => setPaused(true)}
      />
      <ToastStack toasts={toasts} />
      {showTrophy && <TrophyRoom save={save} onClose={() => setShowTrophy(false)} />}
      {showPets && <PetsPanel save={save} onEquip={handleEquipPet} onClose={() => setShowPets(false)} />}
      {showShop && <ShopPanel save={save} gameRef={gameRef} onClose={() => setShowShop(false)} />}
      {paused && !showTrophy && !showPets && !showShop && (
        <PauseMenu
          settings={save.settings}
          onSettings={handleSettings}
          onResume={() => setPaused(false)}
          onHub={() => {
            gameRef.current?.exitToHub()
            setPaused(false)
          }}
          onQuitToTitle={() => {
            setScreen('title') // effect cleanup destroys the game, which flushes the save
            setPaused(false)
            window.setTimeout(refreshSlot, 0) // after the game's destroy() flush
          }}
        />
      )}
    </div>
  )
}

/* ---------------- Toasts ---------------- */

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-16 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-bounce rounded-2xl border-2 border-[#ffd24a] bg-[#2b2333]/90 px-5 py-2.5 text-center shadow-xl"
          style={{ animationDuration: '0.6s', animationIterationCount: 2 }}
        >
          <div className="text-base font-black text-white">
            {t.icon} {t.title}
          </div>
          {t.desc && <div className="text-xs font-bold text-[#ffd9a8]">{t.desc}</div>}
        </div>
      ))}
    </div>
  )
}

/* ---------------- Title screen ---------------- */

function TitleScreen(props: {
  save: SaveData
  saveExists: boolean
  slotLabel: string
  onPlay: () => void
  onSwitchSlots: () => void
  onTrophy: () => void
  onPets: () => void
}) {
  const { save, saveExists, slotLabel, onPlay, onSwitchSlots, onTrophy, onPets } = props
  const pet = petById(save.equippedPet)
  return (
    <div className="fixed inset-0 overflow-y-auto bg-gradient-to-b from-[#ffd9a8] via-[#ffe6ef] to-[#ffeef4]">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center gap-6 px-6 py-10">
        <div className="text-center">
          <div className="flex items-end justify-center gap-2">
            <div className="animate-bounce text-7xl" style={{ animationDuration: '2.4s' }}>
              🥟
            </div>
            {pet && (
              <div
                className="animate-bounce text-4xl"
                style={{ animationDuration: '2.4s', animationDelay: '0.3s' }}
                title={pet.name}
              >
                {pet.icon}
              </div>
            )}
          </div>
          <h1
            className="mt-2 text-5xl font-black tracking-tight text-[#7a3b2e] sm:text-6xl"
            style={{ textShadow: '0 4px 0 #ffd24a, 0 8px 0 rgba(0,0,0,0.12)' }}
          >
            SPEED DUMPLING
            <span className="block text-[#e0444a]">ESCAPE</span>
          </h1>
          <p className="mt-3 text-lg font-semibold text-[#9a6a4f]">
            Run on treadmills. Get faster. Rebirth. Collect pets. Escape infinite obbies.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={onPlay}
            className="rounded-2xl bg-[#ff5a5f] px-14 py-4 text-2xl font-black text-white shadow-[0_6px_0_#c93b40] transition-transform hover:scale-105 active:translate-y-1 active:shadow-[0_2px_0_#c93b40]"
          >
            ▶ PLAY
          </button>
          <button
            onClick={onTrophy}
            className="rounded-2xl bg-[#ffd24a] px-5 py-4 text-lg font-black text-[#7a4b1a] shadow-[0_6px_0_#d9a520] transition-transform hover:scale-105 active:translate-y-1 active:shadow-[0_2px_0_#d9a520]"
          >
            🏆 Trophies
          </button>
          <button
            onClick={onPets}
            className="rounded-2xl bg-[#7ee0d2] px-5 py-4 text-lg font-black text-[#1e5a52] shadow-[0_6px_0_#4ab8a9] transition-transform hover:scale-105 active:translate-y-1 active:shadow-[0_2px_0_#4ab8a9]"
          >
            🐾 Pets
          </button>
        </div>

        <button
          onClick={onSwitchSlots}
          className="rounded-xl bg-white/70 px-4 py-2 text-sm font-black text-[#7a3b2e] shadow transition-transform hover:scale-105"
        >
          💾 {slotLabel} — switch save
        </button>

        {saveExists && (save.speed > 0 || save.wins > 0 || save.rebirths > 0) && (
          <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl bg-white/70 px-5 py-2 text-sm font-bold text-[#7a3b2e] shadow">
            <span>⚡ {fmt(save.speed)}</span>
            <span>🏆 {fmt(save.wins)}</span>
            <span>🪙 {fmt(save.coins)}</span>
            <span>🌀 {save.rebirths}</span>
            <span>🎖️ {Object.values(save.medals).reduce((a, b) => a + b, 0)}</span>
            <span>⏱️ {fmtTime(save.totalPlayTime)}</span>
          </div>
        )}

        <div className="grid w-full gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-white/80 p-5 shadow-lg">
            <h2 className="mb-2 text-lg font-black text-[#7a3b2e]">🎮 Controls</h2>
            <ul className="space-y-1 text-sm font-semibold text-[#8a6a55]">
              <li><Kbd>A</Kbd>/<Kbd>D</Kbd> or <Kbd>←</Kbd>/<Kbd>→</Kbd> — move</li>
              <li><Kbd>Space</Kbd>/<Kbd>W</Kbd>/<Kbd>↑</Kbd> — jump</li>
              <li><Kbd>E</Kbd> — interact (gates, shrine, shop, button)</li>
              <li><Kbd>Tab</Kbd>/<Kbd>P</Kbd> — pets · <Kbd>R</Kbd> — exit obby</li>
              <li><Kbd>Esc</Kbd> — pause · <Kbd>M</Kbd> — mute</li>
            </ul>
          </div>
          <div className="rounded-2xl bg-white/80 p-5 shadow-lg">
            <h2 className="mb-2 text-lg font-black text-[#7a3b2e]">📈 How to play</h2>
            <ul className="space-y-1 text-sm font-semibold text-[#8a6a55]">
              <li>🎢 <b>Ride treadmills</b> for +25⚡ × your full multiplier — the fast path</li>
              <li>🏃 Grass running ticks too, but capped at ×3 gain</li>
              <li>🥉🥈🥇 Earn 3 medals per obby (finish · 🥈 target · 🥇 stretch) to unlock the next door</li>
              <li>🚪 Infinite obbies — Obby 4+ generated forever (e.g. Obby 6: +{generatedObbyReward(6)}🏆), grab 🪙 on the way</li>
              <li>🌀 <b>Rebirth at Lv 5</b> for permanent ×2 gain · 🐾 pets give passive bonuses · 🎯 practice is endless</li>
              <li>🛒 Spend coins at the hub shop on hats, trails & speed charms</li>
            </ul>
          </div>
        </div>
        <p className="text-xs font-semibold text-[#b08a70]">Progress saves automatically in your browser.</p>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-[#d8c8b8] bg-[#fff8ef] px-1.5 py-0.5 text-[11px] font-bold text-[#7a5a45] shadow-[0_2px_0_#d8c8b8]">
      {children}
    </kbd>
  )
}

/* ---------------- HUD ---------------- */

function Hud(props: {
  hud: HudState
  muteIcon: string
  gameRef: React.RefObject<Game | null>
  onTrophy: () => void
  onPets: () => void
  onShop: () => void
  onPause: () => void
}) {
  const { hud, muteIcon, gameRef, onTrophy, onPets, onShop, onPause } = props
  return (
    <>
      <div className="absolute left-4 top-4 flex flex-col gap-2">
        <div className="flex items-center gap-3 rounded-2xl bg-black/35 px-4 py-2 backdrop-blur-sm">
          <span className="text-3xl font-black tabular-nums text-white">⚡ {hud.speedText}</span>
          <span
            className="rounded-full px-3 py-1 text-sm font-black text-[#4a3520]"
            style={{ backgroundColor: hud.levelColor }}
          >
            Lv {hud.level} {hud.levelName}
          </span>
          {hud.rebirths > 0 && (
            <span className="rounded-full bg-[#c084ff] px-3 py-1 text-sm font-black text-white">
              🌀 ×{hud.rebirths}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-xl bg-black/35 px-3 py-1.5 text-sm font-black text-[#ffd24a] backdrop-blur-sm">
            🏆 {fmt(hud.wins)}
          </span>
          <span className="rounded-xl bg-black/35 px-3 py-1.5 text-sm font-black text-[#ffd24a] backdrop-blur-sm">
            🪙 {fmt(hud.coins)}
          </span>
          <span className="rounded-xl bg-black/35 px-3 py-1.5 text-sm font-black text-[#8be06a] backdrop-blur-sm">
            +{hud.gainText}/tick
            {hud.rebirths > 0 && <span className="ml-1 text-white/60">({hud.rebirths}🌀)</span>}
          </span>
          <span className="rounded-xl bg-black/35 px-3 py-1.5 text-xs font-bold text-white/80 backdrop-blur-sm">
            next Lv at {hud.nextLevelText}⚡
          </span>
        </div>
        {hud.mode === 'obby' && (
          <div className="flex items-center gap-2 rounded-xl bg-[#7d6fd0]/80 px-3 py-1.5 text-sm font-black text-white backdrop-blur-sm">
            {hud.obbyId === -2 ? (
              <span>
                🎯 Practice — Segment {hud.practice?.segment ?? 0} · {hud.practice?.checkpoints ?? 0} checkpoints ·
                free play
              </span>
            ) : hud.obbyId === -1 ? (
              <span>⭐ Weekly Challenge — finish for big 🪙 (+2 🏆)</span>
            ) : (
              <span>{hud.obbyName} — reach the trophy! (+{fmt(hud.obbyReward ?? 0)} 🏆)</span>
            )}
            {hud.obbyGoals && (
              <span className="rounded-lg bg-black/30 px-2 py-0.5 text-xs tabular-nums">
                🥈 {fmtTime(hud.obbyGoals.target)} · 🥇 {fmtTime(hud.obbyGoals.stretch)}
              </span>
            )}
            {hud.obbyMedals != null && (
              <span className="text-xs">
                {['🥉', '🥈', '🥇'].map((m, i) => (
                  <span key={m} style={{ opacity: i < (hud.obbyMedals ?? 0) ? 1 : 0.25 }}>{m}</span>
                ))}
              </span>
            )}
            <span className="rounded-lg bg-black/30 px-2 py-0.5 tabular-nums">
              ⏱ {hud.obbyTime != null ? fmtTime(hud.obbyTime) : '0.0s'}
            </span>
            {hud.obbyId !== -2 && (
              <span className="text-xs font-bold text-white/75">
                {hud.obbyBest != null ? `best ${fmtTime(hud.obbyBest)}` : 'no record yet'}
              </span>
            )}
            <span className="text-xs font-bold text-white/60">R = exit</span>
          </div>
        )}
      </div>

      <div className="absolute right-4 top-4 flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <button
            onClick={() => gameRef.current?.toggleMute()}
            className="rounded-xl bg-black/35 px-3 py-2 text-lg backdrop-blur-sm transition-transform hover:scale-105"
            title="Mute (M)"
          >
            {muteIcon}
          </button>
          <button onClick={onPets} className="rounded-xl bg-black/35 px-3 py-2 text-lg backdrop-blur-sm transition-transform hover:scale-105" title="Pets (Tab)">
            🐾
          </button>
          <button onClick={onShop} className="rounded-xl bg-black/35 px-3 py-2 text-lg backdrop-blur-sm transition-transform hover:scale-105" title="Shop">
            🛒
          </button>
          <button onClick={onTrophy} className="rounded-xl bg-black/35 px-3 py-2 text-lg backdrop-blur-sm transition-transform hover:scale-105" title="Trophy Room">
            🏆
          </button>
          <button onClick={onPause} className="rounded-xl bg-black/35 px-3 py-2 text-lg backdrop-blur-sm transition-transform hover:scale-105" title="Pause (Esc)">
            ⏸️
          </button>
        </div>
        {hud.readyMult != null && (
          <button
            onClick={() => gameRef.current?.activateMultiplier()}
            className="animate-pulse rounded-xl bg-[#ff5a5f] px-4 py-2 text-sm font-black text-white shadow-[0_4px_0_#c93b40] transition-transform hover:scale-105 active:translate-y-0.5"
          >
            🔴 ACTIVATE +{hud.readyMult} SPEED!
          </button>
        )}
        {hud.readyMult == null && hud.lockedMult != null && (
          <div className="rounded-xl bg-black/35 px-3 py-2 text-xs font-bold text-white/70 backdrop-blur-sm">
            🔒 +{hud.lockedMult.mult} Speed unlocks at {hud.lockedMult.wins} 🏆
          </div>
        )}
        {hud.rebirthReady ? (
          <button
            onClick={() => gameRef.current?.tryRebirth()}
            className="animate-pulse rounded-xl bg-[#c084ff] px-4 py-2 text-sm font-black text-white shadow-[0_4px_0_#8a5cc9] transition-transform hover:scale-105 active:translate-y-0.5"
          >
            🌀 REBIRTH (×{hud.rebirthMult * 2} gain)
          </button>
        ) : (
          <div className="rounded-xl bg-black/35 px-3 py-2 text-xs font-bold text-white/70 backdrop-blur-sm">
            🔒 🌀 Rebirth unlocks at Lv {hud.rebirthReqLevel}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/30 px-4 py-1.5 text-xs font-bold text-white/85 backdrop-blur-sm">
        {hud.mode === 'obby'
          ? 'A/D move · Space jump · R exit obby'
          : 'A/D move · Space jump · E interact · 🎢 ride belts +25⚡ · grass ticks ≤×3 · Esc pause'}
      </div>
    </>
  )
}

/* ---------------- Pets panel ---------------- */

function PetsPanel(props: {
  save: SaveData
  onEquip: (id: string | null) => void
  onClose: () => void
}) {
  const { save, onEquip, onClose } = props
  const ctx = {
    wins: save.wins,
    rebirths: save.rebirths,
    highestLevel: save.highestLevel,
    maxObbyCompleted: save.maxObbyCompleted,
    achievements: save.achievements.length,
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[86vh] w-[520px] overflow-y-auto rounded-3xl bg-[#fff8ef] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-black text-[#7a3b2e]">🐾 Pets</h2>
          <button onClick={onClose} className="rounded-xl bg-[#e0e0e8] px-3 py-1.5 text-sm font-black text-[#666] hover:bg-[#d0d0da]">
            ✕ Close
          </button>
        </div>
        <p className="mb-3 text-xs font-bold text-[#9a6a4f]">Equip ONE pet — its bonus is always active. (Tab / P to toggle)</p>
        <div className="space-y-2">
          {PETS.map((p) => {
            const unlocked = p.unlocked(ctx)
            const equipped = save.equippedPet === p.id
            return (
              <div
                key={p.id}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 shadow-sm ${
                  equipped ? 'bg-[#d8f7d0] ring-2 ring-[#8be06a]' : unlocked ? 'bg-white/85' : 'bg-[#e6e2da] opacity-70'
                }`}
              >
                <span className="text-3xl" style={unlocked ? undefined : { filter: 'grayscale(1)' }}>
                  {p.icon}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-black text-[#7a3b2e]">{p.name}</div>
                  <div className="text-[11px] font-semibold text-[#9a6a4f]">{p.desc}</div>
                  <div className="text-[11px] font-black text-[#2f9e44]">{p.bonus}</div>
                  {!unlocked && <div className="text-[11px] font-bold text-[#a05555]">🔒 {p.unlockText}</div>}
                </div>
                {unlocked &&
                  (equipped ? (
                    <button
                      onClick={() => onEquip(null)}
                      className="rounded-xl bg-[#8be06a] px-3 py-1.5 text-xs font-black text-white shadow hover:brightness-105"
                    >
                      Equipped ✓
                    </button>
                  ) : (
                    <button
                      onClick={() => onEquip(p.id)}
                      className="rounded-xl bg-[#6cc4ff] px-3 py-1.5 text-xs font-black text-white shadow hover:brightness-105"
                    >
                      Equip
                    </button>
                  ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ---------------- Shop panel ---------------- */

function ShopPanel(props: {
  save: SaveData
  gameRef: React.RefObject<Game | null>
  onClose: () => void
}) {
  const { save, gameRef, onClose } = props
  const g = () => gameRef.current
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[86vh] w-[520px] overflow-y-auto rounded-3xl bg-[#fff8ef] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-black text-[#7a3b2e]">🛒 Dumpling Shop</h2>
          <div className="flex items-center gap-2">
            <span className="rounded-xl bg-[#ffd24a] px-3 py-1.5 text-sm font-black text-[#7a4b1a]">
              🪙 {fmt(save.coins)}
            </span>
            <button onClick={onClose} className="rounded-xl bg-[#e0e0e8] px-3 py-1.5 text-sm font-black text-[#666] hover:bg-[#d0d0da]">
              ✕
            </button>
          </div>
        </div>

        <h3 className="mb-2 text-base font-black text-[#7a3b2e]">🎩 Hats</h3>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {HATS.map((h) => {
            const owned = save.ownedHats.includes(h.id)
            const equipped = save.equippedHat === h.id
            return (
              <div key={h.id} className={`rounded-xl px-3 py-2 shadow-sm ${equipped ? 'bg-[#d8f7d0] ring-2 ring-[#8be06a]' : 'bg-white/85'}`}>
                <div className="text-sm font-black text-[#7a3b2e]">{h.icon} {h.name}</div>
                {owned ? (
                  <button
                    onClick={() => g()?.equipHat(equipped ? null : h.id)}
                    className={`mt-1 rounded-lg px-3 py-1 text-xs font-black text-white ${equipped ? 'bg-[#8be06a]' : 'bg-[#6cc4ff]'}`}
                  >
                    {equipped ? 'Equipped ✓' : 'Equip'}
                  </button>
                ) : (
                  <button
                    onClick={() => g()?.buyHat(h.id)}
                    className="mt-1 rounded-lg bg-[#ffd24a] px-3 py-1 text-xs font-black text-[#7a4b1a] hover:brightness-105"
                  >
                    Buy {h.price} 🪙
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <h3 className="mb-2 text-base font-black text-[#7a3b2e]">🌈 Speed trails</h3>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {TRAILS.map((t) => {
            const owned = t.id === 'default' || save.ownedTrails.includes(t.id)
            const equipped = save.equippedTrail === t.id
            return (
              <div key={t.id} className={`rounded-xl px-3 py-2 shadow-sm ${equipped ? 'bg-[#d8f7d0] ring-2 ring-[#8be06a]' : 'bg-white/85'}`}>
                <div className="flex items-center gap-1.5 text-sm font-black text-[#7a3b2e]">
                  {t.colors.length > 0 ? (
                    <span className="flex">
                      {t.colors.map((c) => (
                        <span key={c} className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: c }} />
                      ))}
                    </span>
                  ) : (
                    <span>🎨</span>
                  )}
                  {t.name}
                </div>
                {owned ? (
                  <button
                    onClick={() => g()?.equipTrail(t.id)}
                    className={`mt-1 rounded-lg px-3 py-1 text-xs font-black text-white ${equipped ? 'bg-[#8be06a]' : 'bg-[#6cc4ff]'}`}
                  >
                    {equipped ? 'Equipped ✓' : 'Equip'}
                  </button>
                ) : (
                  <button
                    onClick={() => g()?.buyTrail(t.id)}
                    className="mt-1 rounded-lg bg-[#ffd24a] px-3 py-1 text-xs font-black text-[#7a4b1a] hover:brightness-105"
                  >
                    Buy {t.price} 🪙
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <h3 className="mb-2 text-base font-black text-[#7a3b2e]">🧿 Speed Charms</h3>
        <div className="rounded-xl bg-white/85 px-4 py-3 shadow-sm">
          <div className="text-sm font-black text-[#7a3b2e]">
            Permanent +{Math.round(CHARM_BONUS * 100)}% speed gain each — {save.charms}/{CHARM_MAX} owned
            {save.charms > 0 && <span className="text-[#2f9e44]"> (+{Math.round(save.charms * CHARM_BONUS * 100)}% total)</span>}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-lg tracking-wider">{'🧿'.repeat(save.charms)}{'⚪'.repeat(CHARM_MAX - save.charms)}</span>
            {save.charms < CHARM_MAX ? (
              <button
                onClick={() => g()?.buyCharm()}
                className="ml-auto rounded-lg bg-[#ffd24a] px-3 py-1.5 text-xs font-black text-[#7a4b1a] hover:brightness-105"
              >
                Buy {charmPrice(save.charms)} 🪙
              </button>
            ) : (
              <span className="ml-auto text-xs font-black text-[#2f9e44]">MAXED OUT!</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Pause menu ---------------- */

function PauseMenu(props: {
  settings: Settings
  onSettings: (s: Settings) => void
  onResume: () => void
  onHub: () => void
  onQuitToTitle: () => void
}) {
  const { settings, onSettings, onResume, onHub, onQuitToTitle } = props
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[380px] rounded-3xl bg-[#fff8ef] p-6 shadow-2xl">
        <h2 className="mb-4 text-center text-2xl font-black text-[#7a3b2e]">⏸️ PAUSED</h2>
        <div className="mb-3 flex flex-col gap-2">
          <button onClick={onResume} className="rounded-xl bg-[#ff5a5f] py-2.5 text-base font-black text-white shadow-[0_4px_0_#c93b40] transition-transform hover:scale-[1.02] active:translate-y-0.5">
            ▶ Resume
          </button>
          <button onClick={onHub} className="rounded-xl bg-[#6cc4ff] py-2.5 text-base font-black text-white shadow-[0_4px_0_#4a93d9] transition-transform hover:scale-[1.02] active:translate-y-0.5">
            🏠 Back to Hub
          </button>
        </div>
        <div className="mb-3 space-y-3 rounded-2xl bg-white/70 p-4">
          <label className="block text-xs font-black text-[#7a5a45]">
            🎵 Music {Math.round(settings.musicVol * 100)}%
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.musicVol * 100)}
              onChange={(e) => onSettings({ ...settings, musicVol: Number(e.target.value) / 100 })}
              className="mt-1 w-full accent-[#ff5a5f]"
            />
          </label>
          <label className="block text-xs font-black text-[#7a5a45]">
            🔊 Sound FX {Math.round(settings.sfxVol * 100)}%
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.sfxVol * 100)}
              onChange={(e) => onSettings({ ...settings, sfxVol: Number(e.target.value) / 100 })}
              className="mt-1 w-full accent-[#ff5a5f]"
            />
          </label>
          <div className="flex items-center justify-between text-xs font-black text-[#7a5a45]">
            <span>📳 Screen shake</span>
            <button
              onClick={() => onSettings({ ...settings, shake: !settings.shake })}
              className={`rounded-lg px-3 py-1 font-black text-white ${settings.shake ? 'bg-[#8be06a]' : 'bg-[#b0b0bc]'}`}
            >
              {settings.shake ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="flex items-center justify-between text-xs font-black text-[#7a5a45]">
            <span>👻 Ghost replay</span>
            <button
              onClick={() => onSettings({ ...settings, ghost: !settings.ghost })}
              className={`rounded-lg px-3 py-1 font-black text-white ${settings.ghost ? 'bg-[#8be06a]' : 'bg-[#b0b0bc]'}`}
            >
              {settings.ghost ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="flex items-center justify-between text-xs font-black text-[#7a5a45]">
            <span>✨ Particles</span>
            <button
              onClick={() => onSettings({ ...settings, particles: settings.particles === 'high' ? 'low' : 'high' })}
              className={`rounded-lg px-3 py-1 font-black text-white ${settings.particles === 'high' ? 'bg-[#8be06a]' : 'bg-[#b0b0bc]'}`}
            >
              {settings.particles === 'high' ? 'HIGH' : 'LOW'}
            </button>
          </div>
        </div>
        <button onClick={onQuitToTitle} className="w-full rounded-xl bg-[#e0e0e8] py-2 text-xs font-black text-[#7a5a45] hover:bg-[#d5d5e0]">
          💾 Save & quit to title
        </button>
      </div>
    </div>
  )
}

/* ---------------- Trophy Room ---------------- */

function TrophyRoom({ save, onClose }: { save: SaveData; onClose: () => void }) {
  const bestEntries = Object.entries(save.bestTimes)
    .map(([id, t]) => ({ id: Number(id), t }))
    .sort((a, b) => a.id - b.id)
  const unlocked = new Set(save.achievements)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[86vh] w-[560px] overflow-y-auto rounded-3xl bg-[#fff8ef] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-black text-[#7a3b2e]">🏆 Trophy Room</h2>
          <button onClick={onClose} className="rounded-xl bg-[#e0e0e8] px-3 py-1.5 text-sm font-black text-[#666] hover:bg-[#d0d0da]">
            ✕ Close
          </button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          <Stat icon="🏆" label="Total wins" value={fmt(save.wins)} />
          <Stat icon="⚡" label="Best speed" value={fmt(save.highestSpeed)} />
          <Stat icon="📶" label="Best level" value={`Lv ${save.highestLevel}`} />
          <Stat icon="🌀" label="Rebirths" value={`${save.rebirths}`} />
          <Stat icon="🪙" label="Coins" value={fmt(save.coins)} />
          <Stat icon="⏱️" label="Play time" value={fmtTime(save.totalPlayTime)} />
        </div>

        <h3 className="mb-2 text-base font-black text-[#7a3b2e]">🎖️ Obby medals & best times</h3>
        {bestEntries.length === 0 ? (
          <p className="mb-4 rounded-xl bg-white/70 p-3 text-sm font-semibold text-[#9a6a4f]">
            No obbies completed yet — get out there, dumpling!
          </p>
        ) : (
          <div className="mb-4 grid grid-cols-2 gap-2">
            {bestEntries.map((e) => {
              const medals = save.medals[String(e.id)] ?? 0
              return (
                <div key={e.id} className="flex items-center justify-between rounded-xl bg-white/80 px-3 py-2 text-sm font-bold text-[#7a5a45] shadow-sm">
                  <span>
                    Obby {e.id}{' '}
                    <span className="ml-0.5">
                      {['🥉', '🥈', '🥇'].map((m, i) => (
                        <span key={m} style={{ opacity: i < medals ? 1 : 0.22 }}>{m}</span>
                      ))}
                    </span>
                  </span>
                  <span className="tabular-nums text-[#2f9e44]">{fmtTime(e.t)}</span>
                </div>
              )
            })}
          </div>
        )}

        <h3 className="mb-2 text-base font-black text-[#7a3b2e]">⭐ Weekly Challenge</h3>
        <WeeklySection weeklyBest={save.weeklyBest} />

        <h3 className="mb-2 text-base font-black text-[#7a3b2e]">
          🎖️ Achievements ({unlocked.size}/{ACHIEVEMENTS.length})
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {ACHIEVEMENTS.map((a) => {
            const has = unlocked.has(a.id)
            return (
              <div
                key={a.id}
                className={`rounded-xl px-3 py-2 shadow-sm ${
                  has ? 'bg-[#fff3c9] ring-2 ring-[#ffd24a]' : 'bg-[#e6e2da] opacity-70'
                }`}
              >
                <div className="text-sm font-black text-[#7a3b2e]">
                  {has ? a.icon : '🔒'} {a.name}
                </div>
                <div className="text-[11px] font-semibold text-[#9a6a4f]">{a.desc}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/80 px-3 py-2 text-center shadow-sm">
      <div className="text-lg">{icon}</div>
      <div className="text-base font-black tabular-nums text-[#7a3b2e]">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-[#9a6a4f]">{label}</div>
    </div>
  )
}

function WeeklySection({ weeklyBest }: { weeklyBest: Record<string, number> }) {
  const thisWeek = currentWeekKey()
  const entries = Object.entries(weeklyBest).sort(([a], [b]) => b.localeCompare(a))
  if (entries.length === 0) {
    return (
      <p className="mb-4 rounded-xl bg-white/70 p-3 text-sm font-semibold text-[#9a6a4f]">
        No weekly challenges completed yet — find the golden ⭐ door in the hub!
      </p>
    )
  }
  return (
    <div className="mb-4 grid grid-cols-2 gap-2">
      {entries.map(([week, t]) => (
        <div
          key={week}
          className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm font-bold shadow-sm ${
            week === thisWeek ? 'bg-[#fff3c9] text-[#7a4b1a] ring-2 ring-[#ffd24a]' : 'bg-white/80 text-[#7a5a45]'
          }`}
        >
          <span>{week === thisWeek ? '⭐ ' : ''}{week}</span>
          <span className="tabular-nums text-[#2f9e44]">{fmtTime(t)}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------------- Save slots ---------------- */

function SlotPicker(props: {
  activeSlot: number
  onSelect: (n: number) => void
  onChanged: () => void
}) {
  const { activeSlot, onSelect, onChanged } = props
  const [tick, setTick] = useState(0)
  void tick // re-render trigger after rename/delete
  const summaries = Array.from({ length: SLOT_COUNT }, (_, i) => slotSummary(i + 1))

  const handleDelete = (n: number, name: string) => {
    if (window.confirm(`Delete "${name}" (Slot ${n})? All progress in this slot will be lost!`)) {
      deleteSlot(n)
      onChanged()
      setTick((t) => t + 1)
    }
  }

  const handleRename = (n: number, value: string) => {
    renameSlot(n, value)
    onChanged()
    setTick((t) => t + 1)
  }

  return (
    <div className="fixed inset-0 overflow-y-auto bg-gradient-to-b from-[#ffd9a8] via-[#ffe6ef] to-[#ffeef4]">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col items-center justify-center gap-6 px-6 py-10">
        <div className="text-center">
          <div className="text-6xl">💾</div>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-[#7a3b2e]">CHOOSE YOUR SAVE</h1>
          <p className="mt-2 text-sm font-semibold text-[#9a6a4f]">
            Up to {SLOT_COUNT} dumplings per browser — each slot keeps its own progress.
          </p>
        </div>
        <div className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map((s) => (
            <div
              key={`${s.slot}-${tick}`}
              className={`flex flex-col gap-3 rounded-2xl p-5 shadow-lg ${
                s.slot === activeSlot && s.exists ? 'bg-[#fff3c9] ring-2 ring-[#ffd24a]' : 'bg-white/80'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wide text-[#b08a70]">
                  Slot {s.slot}
                </span>
                {s.slot === activeSlot && s.exists && (
                  <span className="rounded-full bg-[#ffd24a] px-2 py-0.5 text-[10px] font-black text-[#7a4b1a]">
                    ACTIVE
                  </span>
                )}
              </div>
              {s.exists ? (
                <>
                  <input
                    defaultValue={s.name}
                    maxLength={24}
                    onBlur={(e) => handleRename(s.slot, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                    className="w-full rounded-lg border border-[#e8d8c8] bg-white px-3 py-1.5 text-base font-black text-[#7a3b2e] outline-none focus:border-[#ffb26b]"
                    aria-label={`Rename slot ${s.slot}`}
                  />
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-[#8a6a55]">
                    <span>📶 Lv {s.level}</span>
                    <span>🏆 {fmt(s.wins)}</span>
                    <span>🎖️ {s.medals}</span>
                    <span>🌀 {s.rebirths}</span>
                    <span>⏱️ {fmtTime(s.playTime)}</span>
                  </div>
                  <div className="mt-auto flex gap-2">
                    <button
                      onClick={() => onSelect(s.slot)}
                      className="flex-1 rounded-xl bg-[#ff5a5f] py-2 text-sm font-black text-white shadow-[0_3px_0_#c93b40] transition-transform hover:scale-[1.02] active:translate-y-0.5"
                    >
                      ▶ Load
                    </button>
                    <button
                      onClick={() => handleDelete(s.slot, s.name)}
                      className="rounded-xl bg-[#e0e0e8] px-3 py-2 text-sm font-black text-[#a04444] hover:bg-[#d5d5e0]"
                      title="Delete this save"
                    >
                      🗑
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="py-2 text-center text-sm font-bold text-[#b08a70]">
                    Empty — New Game
                  </div>
                  <button
                    onClick={() => onSelect(s.slot)}
                    className="mt-auto rounded-xl bg-[#8be06a] py-2 text-sm font-black text-white shadow-[0_3px_0_#5da843] transition-transform hover:scale-[1.02] active:translate-y-0.5"
                  >
                    ✨ Start here
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

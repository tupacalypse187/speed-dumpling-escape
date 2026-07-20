/**
 * All sound is synthesized with the Web Audio API — no audio files.
 * The AudioContext is created lazily on the first user gesture (Play button).
 * Two volume buses (music / SFX) feed a master mute gain.
 */

interface ToneOpts {
  freq: number
  freqEnd?: number
  dur: number
  type?: OscillatorType
  vol?: number
  when?: number // offset in seconds from now
  attack?: number // fade-in time (default ~instant)
  dest?: AudioNode
}

// Chiptune BGM: 64 eighth-note steps @ 132 BPM.
const LEAD: number[] = [
  523, 0, 659, 0, 784, 0, 659, 0,
  880, 0, 784, 0, 659, 0, 587, 0,
  523, 0, 659, 0, 784, 0, 880, 0,
  784, 0, 659, 0, 587, 659, 523, 0,
  440, 0, 523, 0, 659, 0, 523, 0,
  587, 0, 659, 0, 587, 0, 440, 0,
  523, 0, 659, 0, 784, 0, 1047, 0,
  880, 784, 659, 587, 523, 0, 0, 0,
]
const BASS: number[] = [
  131, 131, 110, 110, 87, 87, 98, 98,
  131, 131, 110, 110, 87, 98, 131, 131,
]

export class AudioManager {
  muted: boolean
  private musicVol: number
  private sfxVol: number
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfxBus: GainNode | null = null
  private bgmBus: GainNode | null = null
  private bgmTimer: number | null = null
  private bgmStep = 0
  private nextNoteTime = 0

  constructor(muted: boolean, musicVol = 0.8, sfxVol = 1) {
    this.muted = muted
    this.musicVol = musicVol
    this.sfxVol = sfxVol
  }

  /** Must be called from a user gesture at least once. */
  unlock(): void {
    this.ensure()
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      this.ctx = new AC()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 1
      this.master.connect(this.ctx.destination)
      this.sfxBus = this.ctx.createGain()
      this.sfxBus.gain.value = this.sfxVol
      this.sfxBus.connect(this.master)
      this.bgmBus = this.ctx.createGain()
      this.bgmBus.gain.value = 0.32 * this.musicVol
      this.bgmBus.connect(this.master)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02)
    }
  }

  setMusicVol(v: number): void {
    this.musicVol = v
    if (this.ctx && this.bgmBus) {
      this.bgmBus.gain.setTargetAtTime(0.32 * v, this.ctx.currentTime, 0.03)
    }
  }

  setSfxVol(v: number): void {
    this.sfxVol = v
    if (this.ctx && this.sfxBus) {
      this.sfxBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03)
    }
  }

  get volumes(): { music: number; sfx: number } {
    return { music: this.musicVol, sfx: this.sfxVol }
  }

  private tone(opts: ToneOpts): void {
    const ctx = this.ensure()
    if (!ctx || !this.master || !this.sfxBus) return
    const t0 = ctx.currentTime + (opts.when ?? 0)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = opts.type ?? 'square'
    osc.frequency.setValueAtTime(opts.freq, t0)
    if (opts.freqEnd != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t0 + opts.dur)
    }
    const vol = opts.vol ?? 0.2
    const attack = opts.attack ?? 0.005
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t0 + attack)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.dur)
    osc.connect(gain)
    gain.connect(opts.dest ?? this.sfxBus)
    osc.start(t0)
    osc.stop(t0 + opts.dur + 0.05)
  }

  // ---- SFX ----

  tick(): void {
    this.tone({ freq: 980, freqEnd: 1240, dur: 0.06, type: 'square', vol: 0.16 })
  }

  jump(): void {
    this.tone({ freq: 240, freqEnd: 560, dur: 0.16, type: 'triangle', vol: 0.28 })
  }

  land(): void {
    this.tone({ freq: 140, freqEnd: 60, dur: 0.12, type: 'sine', vol: 0.32 })
  }

  levelUp(): void {
    const notes = [523, 659, 784, 1047]
    notes.forEach((f, i) =>
      this.tone({ freq: f, dur: 0.16, type: 'square', vol: 0.2, when: i * 0.09 }),
    )
    this.tone({ freq: 1568, dur: 0.3, type: 'triangle', vol: 0.14, when: 0.36 })
  }

  win(): void {
    const seq: Array<[number, number]> = [
      [659, 0], [784, 0.1], [1047, 0.2], [1319, 0.32], [1568, 0.46],
    ]
    seq.forEach(([f, w]) => this.tone({ freq: f, dur: 0.2, type: 'square', vol: 0.2, when: w }))
    this.tone({ freq: 2093, dur: 0.45, type: 'triangle', vol: 0.12, when: 0.6 })
  }

  click(): void {
    this.tone({ freq: 220, freqEnd: 90, dur: 0.05, type: 'square', vol: 0.35 })
    this.tone({ freq: 1400, dur: 0.03, type: 'square', vol: 0.12, when: 0.01 })
  }

  death(): void {
    this.tone({ freq: 380, freqEnd: 70, dur: 0.45, type: 'sawtooth', vol: 0.28 })
  }

  denied(): void {
    this.tone({ freq: 180, freqEnd: 120, dur: 0.14, type: 'square', vol: 0.22 })
    this.tone({ freq: 150, freqEnd: 100, dur: 0.16, type: 'square', vol: 0.2, when: 0.12 })
  }

  portal(): void {
    this.tone({ freq: 300, freqEnd: 900, dur: 0.3, type: 'sine', vol: 0.25 })
  }

  coin(): void {
    this.tone({ freq: 1319, dur: 0.07, type: 'sine', vol: 0.22 })
    this.tone({ freq: 1976, dur: 0.16, type: 'sine', vol: 0.18, when: 0.06 })
  }

  achievement(): void {
    ;[880, 1175, 1568].forEach((f, i) =>
      this.tone({ freq: f, dur: 0.22, type: 'triangle', vol: 0.2, when: i * 0.09 }),
    )
  }

  record(): void {
    ;[1047, 1319, 1568, 2093].forEach((f, i) =>
      this.tone({ freq: f, dur: 0.14, type: 'square', vol: 0.18, when: i * 0.06 }),
    )
  }

  /** Treadmill drop-off: airy whoosh sweep + a bright ding. */
  whoosh(): void {
    this.tone({ freq: 1600, freqEnd: 300, dur: 0.35, type: 'sawtooth', vol: 0.1, attack: 0.04 })
    this.tone({ freq: 800, freqEnd: 200, dur: 0.3, type: 'triangle', vol: 0.14, attack: 0.03 })
    this.tone({ freq: 1976, dur: 0.14, type: 'sine', vol: 0.2, when: 0.22 })
  }

  /** Rebirth ceremony: deep gong + sustained choir chord. */
  ceremony(): void {
    // gong: low fundamental + inharmonic partials, long decay
    this.tone({ freq: 92, dur: 2.2, type: 'sine', vol: 0.5, attack: 0.01 })
    this.tone({ freq: 138, dur: 1.8, type: 'sine', vol: 0.25, attack: 0.02 })
    this.tone({ freq: 185, dur: 1.5, type: 'sine', vol: 0.18, attack: 0.03 })
    // choir: slow-attack major chord
    const chord = [261.6, 329.6, 392, 523.2]
    chord.forEach((f) =>
      this.tone({ freq: f, dur: 2.0, type: 'triangle', vol: 0.1, attack: 0.5, when: 0.25 }),
    )
    this.tone({ freq: 1047, dur: 1.2, type: 'sine', vol: 0.12, attack: 0.3, when: 0.9 })
  }

  // ---- BGM ----

  startBgm(): void {
    const ctx = this.ensure()
    if (!ctx || this.bgmTimer != null) return
    this.bgmStep = 0
    this.nextNoteTime = ctx.currentTime + 0.1
    this.bgmTimer = window.setInterval(() => this.scheduleBgm(), 40)
  }

  stopBgm(): void {
    if (this.bgmTimer != null) {
      clearInterval(this.bgmTimer)
      this.bgmTimer = null
    }
  }

  private scheduleBgm(): void {
    const ctx = this.ctx
    if (!ctx || !this.bgmBus) return
    const stepDur = 60 / 132 / 2 // eighth note @ 132 BPM
    while (this.nextNoteTime < ctx.currentTime + 0.18) {
      const step = this.bgmStep
      const lead = LEAD[step % LEAD.length]
      if (lead > 0) {
        this.tone({
          freq: lead,
          dur: stepDur * 0.9,
          type: 'square',
          vol: 0.11,
          when: this.nextNoteTime - ctx.currentTime,
          dest: this.bgmBus,
        })
      }
      if (step % 4 === 0) {
        const bass = BASS[Math.floor(step / 4) % BASS.length]
        this.tone({
          freq: bass,
          dur: stepDur * 3.2,
          type: 'triangle',
          vol: 0.22,
          when: this.nextNoteTime - ctx.currentTime,
          dest: this.bgmBus,
        })
      }
      if (step % 2 === 1) {
        this.tone({
          freq: 6000,
          dur: 0.02,
          type: 'square',
          vol: 0.03,
          when: this.nextNoteTime - ctx.currentTime,
          dest: this.bgmBus,
        })
      }
      this.nextNoteTime += stepDur
      this.bgmStep = (this.bgmStep + 1) % 64
    }
  }
}

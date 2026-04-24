/**
 * SoundManager - Quản lý toàn bộ âm thanh của game.
 *
 * ── SETUP TRONG EDITOR ──
 *   1. Tạo 1 Node tên "SoundManager" (persistent, không bị destroy khi đổi scene).
 *   2. Gắn component này vào Node đó.
 *   3. Gắn thêm 2 component AudioSource vào cùng Node:
 *        - AudioSource đầu tiên  → kéo vào slot "bgmSource"  (loop = true, volume = 0.5)
 *        - AudioSource thứ hai  → kéo vào slot "sfxSource"  (loop = false, volume = 1.0)
 *   4. Kéo các file .mp3 / .ogg vào từng AudioClip slot bên dưới.
 *
 * ── DANH SÁCH ÂM THANH ──
 *   BGM:
 *     bgmMain            - Nhạc nền game chính (loop)
 *     bgmFreeSpin        - Nhạc nền Free Spin (loop)
 *
 *   REEL / SPIN:
 *     spinStartSound     - Tiếng nhấn Spin + bắt đầu quay
 *     reelStopSound      - Tiếng "cộp" mỗi khi 1 reel dừng
 *
 *   LONG SPIN (suýt trúng):
 *     anticipationSound  - Nhạc hồi hộp khi Cột 3 đang quay dài
 *     longSpinThudSound  - Tiếng "rầm" khi Cột 3 khựng lại
 *
 *   WIN:
 *     winSmallSound      - Thắng thường (normal win)
 *     winBigSound        - Thắng lớn (BigWin)
 *     winMegaSound       - Thắng cực lớn (MegaWin / SuperWin)
 *     coinLoopSound      - Tiếng coin loop (phát lặp khi count-up đang chạy)
 *     coinEndSound       - Tiếng coin kết thúc (phát 1 lần khi count-up xong, không loop)
 *
 *   JACKPOT:
 *     jackpotRevealSound - Tiếng nổ hũ khi popup xuất hiện
 *     jackpotCelebSound  - Tiếng pháo hoa chúc mừng (loop trong popup)
 *
 *   FREE SPIN:
 *     freeSpinStartSound - Tiếng kích hoạt Free Spin
 *     freeSpinEndSound   - Tiếng kết thúc vòng Free Spin
 *
 *   UI:
 *     btnClickSound      - Tiếng nhấn nút chung
 *     betChangeSound     - Tiếng thay đổi mức cược
 */

import { _decorator, Component, AudioSource, AudioClip } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { GameData } from '../data/GameData';

const { ccclass, property } = _decorator;

@ccclass('SoundManager')
export class SoundManager extends Component {

    // ── SINGLETON ──────────────────────────────────────────────────────────────
    private static _instance: SoundManager | null = null;
    static get instance(): SoundManager | null { return SoundManager._instance; }

    // ── AUDIO SOURCES ─────────────────────────────────────────────────────────
    /** AudioSource cho nhạc nền (kéo từ Inspector, cần set loop = true) */
    @property({ type: AudioSource, tooltip: 'AudioSource dành riêng cho BGM (loop=true)\n→ Kéo component AudioSource vào đây' })
    bgmSource: AudioSource | null = null;

    /** AudioSource cho hiệu ứng âm thanh (kéo từ Inspector, loop = false) */
    @property({ type: AudioSource, tooltip: 'AudioSource dành riêng cho SFX (loop=false)\n→ Kéo component AudioSource vào đây' })
    sfxSource: AudioSource | null = null;

    /** AudioSource riêng cho anticipation sound (loop trong lúc long spin) */
    @property({ type: AudioSource, tooltip: 'AudioSource riêng cho âm thanh hồi hộp long spin (loop=true)\n→ Kéo component AudioSource vào đây' })
    anticipationSource: AudioSource | null = null;

    /** AudioSource riêng cho coin loop (loop trong suốt quá trình count-up tiền) */
    @property({ type: AudioSource, tooltip: 'AudioSource riêng cho tiếng coin loop (loop=true)\n→ Kéo component AudioSource mới vào đây' })
    coinSource: AudioSource | null = null;

    // ── BGM ───────────────────────────────────────────────────────────────────
    /** Nhạc nền game chính */
    @property({ type: AudioClip, tooltip: '🎵 BGM game chính (loop)\n→ Kéo file .mp3/.ogg vào đây' })
    bgmMain: AudioClip | null = null;

    /** Nhạc nền Free Spin */
    @property({ type: AudioClip, tooltip: '🎵 BGM Free Spin (loop)\n→ Kéo file .mp3/.ogg vào đây' })
    bgmFreeSpin: AudioClip | null = null;

    // ── REEL / SPIN ───────────────────────────────────────────────────────────
    /** Tiếng nhấn Spin + bắt đầu quay reel */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng bắt đầu quay\n→ Kéo file âm thanh vào đây' })
    spinStartSound: AudioClip | null = null;

    /** Tiếng "cộp" khi mỗi reel dừng lại */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng reel dừng (chơi mỗi khi 1 cột dừng)\n→ Kéo file âm thanh vào đây' })
    reelStopSound: AudioClip | null = null;

    // ── LONG SPIN ─────────────────────────────────────────────────────────────
    /** Nhạc hồi hộp khi Cột 3 đang trong trạng thái long spin */
    @property({ type: AudioClip, tooltip: '🔊 Âm thanh anticipation (loop) khi long spin\n→ Kéo file âm thanh vào đây' })
    anticipationSound: AudioClip | null = null;

    /** Tiếng "rầm" mạnh khi Cột 3 khựng lại */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng thud khi reel 3 dừng sau long spin\n→ Kéo file âm thanh vào đây' })
    longSpinThudSound: AudioClip | null = null;

    // ── WIN ───────────────────────────────────────────────────────────────────
    /** Thắng thường */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng thắng nhỏ / normal win\n→ Kéo file âm thanh vào đây' })
    winSmallSound: AudioClip | null = null;

    /** Thắng lớn (Big Win) */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng thắng lớn (BigWin)\n→ Kéo file âm thanh vào đây' })
    winBigSound: AudioClip | null = null;

    /** Thắng cực lớn (Mega / Super Win) */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng thắng cực lớn (MegaWin/SuperWin)\n→ Kéo file âm thanh vào đây' })
    winMegaSound: AudioClip | null = null;

    /** Tiếng coin loop — phát lặp khi count-up tiền đang chạy */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng coin loop (phát lặp liên tục khi count-up đang chạy)\n→ Kéo file âm thanh vào đây' })
    coinLoopSound: AudioClip | null = null;

    /** Tiếng coin kết thúc — phát 1 lần khi count-up xong */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng coin kết thúc (phát 1 lần, không loop, khi count-up xong)\n→ Kéo file âm thanh vào đây' })
    coinEndSound: AudioClip | null = null;

    // ── JACKPOT ───────────────────────────────────────────────────────────────
    /** Tiếng nổ hũ khi popup jackpot xuất hiện */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng nổ hũ jackpot\n→ Kéo file âm thanh vào đây' })
    jackpotRevealSound: AudioClip | null = null;

    /** Tiếng pháo hoa / chúc mừng trong popup jackpot */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng pháo hoa chúc mừng jackpot (loop)\n→ Kéo file âm thanh vào đây' })
    jackpotCelebSound: AudioClip | null = null;

    // ── FREE SPIN ─────────────────────────────────────────────────────────────
    /** Tiếng kích hoạt Free Spin */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng bắt đầu Free Spin\n→ Kéo file âm thanh vào đây' })
    freeSpinStartSound: AudioClip | null = null;

    /** Tiếng kết thúc Free Spin */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng kết thúc Free Spin\n→ Kéo file âm thanh vào đây' })
    freeSpinEndSound: AudioClip | null = null;

    // ── UI ────────────────────────────────────────────────────────────────────
    /** Tiếng nhấn nút chung (Spin, Continue, ...) */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng click nút chung\n→ Kéo file âm thanh vào đây' })
    btnClickSound: AudioClip | null = null;

    /** Tiếng thay đổi mức cược */
    @property({ type: AudioClip, tooltip: '🔊 Tiếng thay đổi mức cược\n→ Kéo file âm thanh vào đây' })
    betChangeSound: AudioClip | null = null;

    // ── VOLUME SETTINGS ───────────────────────────────────────────────────────
    @property({ tooltip: 'Âm lượng BGM (0–1)', range: [0, 1, 0.05], slide: true })
    bgmVolume: number = 0.5;

    @property({ tooltip: 'Âm lượng SFX (0–1)', range: [0, 1, 0.05], slide: true })
    sfxVolume: number = 1.0;

    // ── INTERNAL ──────────────────────────────────────────────────────────────
    private _bgmMuted: boolean = false;
    private _sfxMuted: boolean = false;

    // ── LIFECYCLE ─────────────────────────────────────────────────────────────

    onLoad(): void {
        console.log('[SoundManager] onLoad - setting instance');
        console.log('[SoundManager] onLoad - timestamp:', Date.now());
        SoundManager._instance = this;
        // Make node persistent across scenes using Cocos Creator's persistent root node system
        const game = (window as any).cc?.game || (window as any).cc?.Game;
        console.log('[SoundManager] onLoad - cc.game found:', !!game, '| addPersistRootNode:', !!game?.addPersistRootNode);
        if (game?.addPersistRootNode) {
            game.addPersistRootNode(this.node);
            console.log('[SoundManager] onLoad - node added to persistent roots ✓');
        } else {
            // Fallback: just detach from parent
            this.node.parent?.setParent(null);
            console.warn('[SoundManager] onLoad - ⚠️ addPersistRootNode NOT available! Node NOT persistent - will be destroyed on scene change!');
        }
        this._bindEvents();
        console.log('[SoundManager] onLoad - COMPLETE, ready to play audio');
    }

    /**
     * start() chạy sau onLoad() và sau khi tất cả Component trong scene đã onLoad xong.
     * Nếu GAME_READY đã bị emit trước onLoad() của SoundManager (race condition khi đổi scene),
     * dùng scheduleOnce(0) để thử phát BGM ở frame tiếp theo.
     */
    start(): void {
        console.log('[SoundManager] start() called — checking if BGM needs immediate start');
        console.log('[SoundManager] start() state:', {
            hasBgmSource: !!this.bgmSource,
            hasBgmMain: !!this.bgmMain,
            bgmSourcePlaying: this.bgmSource?.playing ?? false,
        });
        // Nếu bgmSource chưa phát (GAME_READY có thể đã fire trước khi listener đăng ký)
        // → thử phát lại ở frame kế tiếp để tránh race condition
        this.scheduleOnce(() => {
            if (this.bgmSource && !this.bgmSource.playing && !this._bgmMuted) {
                console.warn('[SoundManager] start() fallback — BGM not playing, attempting to start now (GAME_READY may have fired before listener registered)');
                this.playBGM(this.bgmMain);
            } else {
                console.log('[SoundManager] start() fallback check — BGM already playing or muted, no action needed');
            }
        }, 0.5);
    }

    onDestroy(): void {
        console.warn('[SoundManager] ⚠️ onDestroy called! timestamp:', Date.now(),
            '| This means the node is being destroyed (scene change or node removal).',
            '| If this fires BEFORE GAME_READY, the listener will be lost!');
        if (SoundManager._instance === this) SoundManager._instance = null;
        EventBus.instance.offTarget(this);
    }

    // ── EVENT BINDING ─────────────────────────────────────────────────────────

    private _bindEvents(): void {
        const bus = EventBus.instance;
        console.log('[SoundManager] ★ Binding events, bus:', bus);

        // Game flow
        bus.on(GameEvents.GAME_READY,              this._onGameReady,           this);
        bus.on(GameEvents.REELS_START_SPIN,         this._onSpinStart,           this);
        bus.on(GameEvents.REEL_STOPPED,             this._onReelStopped,         this);
        bus.on(GameEvents.LONG_SPIN_VFX_START,      this._onLongSpinStart,       this);
        bus.on(GameEvents.LONG_SPIN_VFX_END,        this._onLongSpinEnd,         this);
        bus.on(GameEvents.WIN_PRESENT_START,        this._onWinPresentStart,     this);
        bus.on(GameEvents.WIN_COUNTUP_DONE,         this._onWinCountDone,        this);
        bus.on(GameEvents.JACKPOT_TRIGGER,          this._onJackpotTrigger,      this);
        bus.on(GameEvents.JACKPOT_END,              this._onJackpotEnd,          this);
        bus.on(GameEvents.FREE_SPIN_START,          this._onFreeSpinStart,       this);
        bus.on(GameEvents.FREE_SPIN_END,            this._onFreeSpinEnd,         this);
        bus.on(GameEvents.BET_CHANGED,              this._onBetChanged,          this);
        
        console.log('[SoundManager] ★ Events bound successfully - GAME_READY listener registered');
    }

    // ── EVENT HANDLERS ────────────────────────────────────────────────────────

    private _onGameReady(): void {
        console.log('[SoundManager] ★★★ _onGameReady CALLED! timestamp:', Date.now());
        console.log('[SoundManager] _onGameReady state:', {
            hasBgmSource: !!this.bgmSource,
            hasBgmMain: !!this.bgmMain,
            bgmMuted: this._bgmMuted,
            bgmMainName: this.bgmMain?.name ?? 'NULL',
            bgmSourcePlaying: this.bgmSource?.playing ?? false,
        });
        this.playBGM(this.bgmMain);
    }

    private _onSpinStart(): void {
        this.playSFX(this.spinStartSound);
    }

    private _onReelStopped(_reelIndex: number): void {
        this.playSFX(this.reelStopSound);
    }

    private _onLongSpinStart(): void {
        // Bắt đầu phát anticipation loop khi long spin VFX kích hoạt
        if (this.anticipationSource && this.anticipationSound) {
            this.anticipationSource.clip = this.anticipationSound;
            this.anticipationSource.loop = true;
            this.anticipationSource.volume = this.sfxVolume;
            this.anticipationSource.play();
        }
    }

    private _onLongSpinEnd(): void {
        // Dừng anticipation, phát thud
        if (this.anticipationSource) {
            this.anticipationSource.stop();
        }
        this.playSFX(this.longSpinThudSound);
    }

    private _onWinPresentStart(resp: { totalWin: number }): void {
        if (resp.totalWin <= 0) return;
        this.playSFX(this.winSmallSound);
        // Bắt đầu coin loop trong suốt quá trình count-up
        this.playCoinLoop();
    }

    private _onWinCountDone(totalWin: number): void {
        // Dừng coin loop — không phát coinEnd ở đây (chỉ popup mới phát coinEnd)
        this.stopCoinLoop();

        const data = GameData.instance;
        const ratio = totalWin / data.totalBet;
        const cfg = data.config;
        if (ratio >= cfg.superWinThreshold) {
            this.playSFX(this.winMegaSound);
        } else if (ratio >= cfg.bigWinThreshold) {
            this.playSFX(this.winBigSound);
        }
    }

    private _onJackpotTrigger(): void {
        this.playSFX(this.jackpotRevealSound);
        // bgm jackpot thay thế bgm thường
        if (this.bgmSource && this.jackpotCelebSound) {
            this.bgmSource.stop();
            this.playBGM(this.jackpotCelebSound);
        }
    }

    private _onJackpotEnd(): void {
        this.playBGM(this.bgmMain);
    }

    private _onFreeSpinStart(): void {
        this.playSFX(this.freeSpinStartSound);
        this.playBGM(this.bgmFreeSpin);
    }

    private _onFreeSpinEnd(): void {
        this.playSFX(this.freeSpinEndSound);
        this.playBGM(this.bgmMain);
    }

    private _onBetChanged(): void {
        this.playSFX(this.betChangeSound);
    }

    // ── PUBLIC API ────────────────────────────────────────────────────────────
    /**  
     * Initialize BGM manually if GAME_READY event hasn't triggered yet.  
     * Call this from GameManager if needed for timing issues.  
     */
    initBGM(): void {
        console.log('[SoundManager.initBGM] Manual initialization triggered');
        this.playBGM(this.bgmMain);
    }

    /**  
     * Get status for debugging  
     */
    getStatus(): object {
        return {
            hasInstance: !!SoundManager._instance,
            hasBgmSource: !!this.bgmSource,
            hasBgmMain: !!this.bgmMain,
            bgmMuted: this._bgmMuted,
            masterVolume: this.masterVolume,
        };
    }
    /** Phát nhạc nền (loop). Dừng bài cũ trước. */
    playBGM(clip: AudioClip | null): void {
        console.log('[SoundManager.playBGM]', {
            hasSource: !!this.bgmSource,
            hasClip: !!clip,
            bgmMuted: this._bgmMuted,
            clipName: clip?.name
        });
        if (!this.bgmSource || !clip || this._bgmMuted) {
            console.log('[SoundManager.playBGM] Early return - missing required components');
            return;
        }
        console.log('[SoundManager.playBGM] Starting playback');
        this.bgmSource.stop();
        this.bgmSource.clip = clip;
        this.bgmSource.loop = true;
        this.bgmSource.volume = this.bgmVolume;
        this.bgmSource.play();
    }

    /** Phát SFX 1 lần. */
    playSFX(clip: AudioClip | null): void {
        if (!this.sfxSource || !clip || this._sfxMuted) return;
        this.sfxSource.playOneShot(clip, this.sfxVolume);
    }

    /** Bắt đầu phát coin loop (khi count-up tiền bắt đầu). */
    playCoinLoop(): void {
        if (!this.coinSource || !this.coinLoopSound || this._sfxMuted) return;
        this.coinSource.clip = this.coinLoopSound;
        this.coinSource.loop = true;
        this.coinSource.volume = this.sfxVolume;
        if (!this.coinSource.playing) this.coinSource.play();
    }

    /** Dừng coin loop (khi count-up tiền kết thúc). */
    stopCoinLoop(): void {
        if (this.coinSource) this.coinSource.stop();
    }

    /** Phát tiếng coin kết thúc (1 lần, không loop). */
    playCoinEnd(): void {
        this.playSFX(this.coinEndSound);
    }

    /** Click nút — gọi trực tiếp từ UIController hoặc bất kỳ button nào. */
    playButtonClick(): void {
        this.playSFX(this.btnClickSound);
    }

    /** Đặt âm lượng tổng (0–1): áp dụng cả BGM và SFX */
    setMasterVolume(ratio: number): void {
        const v = Math.max(0, Math.min(1, ratio));
        this.bgmVolume = v;
        this.sfxVolume = v;
        if (this.bgmSource && !this._bgmMuted) this.bgmSource.volume = v;
        if (this.sfxSource)  this.sfxSource.volume = v;
        if (this.anticipationSource) this.anticipationSource.volume = v;
        if (this.coinSource) this.coinSource.volume = v;
    }

    get masterVolume(): number { return this.bgmVolume; }

    /** Bật/tắt BGM */
    setBGMMuted(muted: boolean): void {
        this._bgmMuted = muted;
        if (this.bgmSource) {
            if (muted) this.bgmSource.pause();
            else       this.bgmSource.play();
        }
    }

    /** Bật/tắt SFX */
    setSFXMuted(muted: boolean): void {
        this._sfxMuted = muted;
        if (muted) {
            if (this.anticipationSource) this.anticipationSource.stop();
            if (this.coinSource) this.coinSource.stop();
        }
    }

    /** Bật/tắt BGM */
    toggleBGM(): void {
        this.setBGMMuted(!this._bgmMuted);
    }

    /** Bật/tắt SFX */
    toggleSFX(): void {
        this.setSFXMuted(!this._sfxMuted);
    }

    get bgmMuted(): boolean { return this._bgmMuted; }
    get sfxMuted(): boolean { return this._sfxMuted; }
}

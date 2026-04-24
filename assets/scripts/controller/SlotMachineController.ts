/**
 * SlotMachineController - Điều phối 3 ReelController.
 *
 * FLOW 2 PHA:
 *   Phase 1: REELS_START_SPIN → reel quay ngay lập tức (trước khi chờ server)
 *   Phase 2: SPIN_RESPONSE    → ra lệnh dừng reel tại đúng vị trí (rands)
 *
 * LONG SPIN VFX:
 *   Khi LONG_SPIN_TRIGGERED: Cột 3 delay thêm 2.5–3s.
 *   Ngay khi Cột 2 dừng xong → bật longSpinVFXNode + emit LONG_SPIN_VFX_START (audio anticipation).
 *   Khi Cột 3 dừng hẳn     → tắt longSpinVFXNode + emit LONG_SPIN_VFX_END (audio thud).
 *
 * SETUP LONG SPIN VFX TRONG EDITOR:
 *   1. Tạo 1 Node con "LongSpinVFX" đặt bên trong / đè lên Cột 3.
 *   2. Gắn component Sprite vào Node đó.
 *   3. Kéo Node vào slot "longSpinVFXNode" bên dưới.
 *   4. Kéo danh sách SpriteFrame (các frame hoạt ảnh) vào mảng "vfxFrames".
 *   5. Điều chỉnh "vfxFPS" (tốc độ frame mặc định 12 fps).
 */

import { _decorator, Component, Node, Sprite, SpriteFrame, screen } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { SpinResponse } from '../data/SlotTypes';
import { GameData } from '../data/GameData';
import { ReelController } from './ReelController';
import { AutoSpinManager, SpeedMode } from '../manager/AutoSpinManager';

const { ccclass, property } = _decorator;

@ccclass('SlotMachineController')
export class SlotMachineController extends Component {

    @property({ type: [ReelController], tooltip: 'Kéo 3 ReelController (cột 0, 1, 2) vào đây' })
    reels: ReelController[] = [];

    @property({ type: Node, tooltip: 'Slot machine background node (animated background quanh reels)' })
    slotBackgroundNode: Node | null = null;

    @property({ type: SpriteFrame, tooltip: 'Slot background sprite - Normal Spin' })
    normalSprite: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'Slot background sprite - Free Spin' })
    freeSpinSprite: SpriteFrame | null = null;

    @property({ tooltip: 'Delay giữa việc bắt đầu quay mỗi reel (seconds)' })
    startStaggerDelay: number = 0.3;

    @property({ tooltip: 'Delay giữa việc dừng mỗi reel (seconds)' })
    stopInterval: number = 0.3;

    @property({ tooltip: 'Thời gian giảm tốc của Reel 3 khi Long Spin — kéo dài hơn để tạo cảm giác hồi hộp (seconds)' })
    longSpinDecelDuration: number = 1.2;

    @property({
        tooltip: 'Center index khởi tạo cho mỗi reel (trước lần spin đầu tiên).\nLấy từ vị trí strip 1,2,3 của Parsheet (0-based: 0,1,2).',
    })
    initialCenterIndices: number[] = [0, 1, 2];

    private _longSpinOnReel3: boolean = false;
    /** Flag tích cực: true suốt từ khi LONG_SPIN_TRIGGERED đến khi cột 3 dừng */
    private _isLongSpinActive: boolean = false;
    private _stoppedCount: number = 0;

    // ─── LONG SPIN VFX ───
    /**
     * Node hiệu ứng VFX bao quanh Cột 3 khi long spin.
     *
     * EDITOR SETUP:
     *   - Tạo Node con "LongSpinVFX" đặt chồng lên Cột 3 (z-order cao hơn).
     *   - Gắn Sprite component vào Node đó.
     *   - Kéo Node vào slot này.
     *   - Bắt đầu active = false.
     */
    @property({ type: Node, tooltip: 'Node VFX quanh Cột 3 khi long spin (phải inactive ban đầu)\n→ Tạo Node con, gắn Sprite, kéo vào đây' })
    longSpinVFXNode: Node | null = null;

    /**
     * Mảng SpriteFrame cho animation VFX (loop).
     *
     * EDITOR SETUP:
     *   - Kéo lần lượt các frame ảnh vào mảng này theo thứ tự.
     *   - Tạm thời dùng sprite thường; sau thay bằng Spine.
     */
    @property({ type: [SpriteFrame], tooltip: 'Danh sách SpriteFrame cho animation VFX loop\n→ Kéo lần lượt các frame vào đây' })
    vfxFrames: SpriteFrame[] = [];

    @property({ tooltip: 'Tốc độ chạy frame VFX (frames/giây)' })
    vfxFPS: number = 12;

    private _vfxSprite: Sprite | null = null;
    private _vfxFrameIdx: number = 0;
    private _vfxCb: (() => void) | null = null;
    private _isFreeSpin: boolean = false;
    /** Danh sách {reelIndex, rowIndex} cần show hint khi long spin bắt đầu */
    private _hintPositions: { reelIndex: number; rowIndex: number }[] = [];
    private _hintBounceCb: (() => void) | null = null;

    // ─── LIFECYCLE ───

    onLoad(): void {
        const bus = EventBus.instance;
        bus.on(GameEvents.REELS_START_SPIN, this._onReelsStartSpin, this);
        bus.on(GameEvents.SPIN_RESPONSE, this._onSpinResponse, this);
        bus.on(GameEvents.LONG_SPIN_TRIGGERED, this._onLongSpin, this);
        bus.on(GameEvents.LONG_SPIN_SYMBOL_HINT, this._onLongSpinHint, this);
        bus.on(GameEvents.ENTER_SUCCESS, this._onEnterSuccess, this);
        bus.on(GameEvents.FREE_SPIN_START, this._onFreeSpinStart, this);
        bus.on(GameEvents.FREE_SPIN_END, this._onFreeSpinEnd, this);
        bus.on(GameEvents.RESUME_NORMAL_SPIN, this._onResumeNormalSpin, this);

        // Khởi tạo AutoSpinManager sớm
        AutoSpinManager.instance;

        // Gán stopDelay tăng dần cho từng reel
        for (let i = 0; i < this.reels.length; i++) {
            this.reels[i].reelIndex = i;
            this.reels[i].stopDelay = i * this.stopInterval;
        }

        // Cache Sprite component trên VFX node
        if (this.longSpinVFXNode) {
            this._vfxSprite = this.longSpinVFXNode.getComponent(Sprite);
            this.longSpinVFXNode.active = false;
        }
    }

    start(): void {
        // Hiển thị symbol cố định từ vị trí strip 1,2,3 của Parsheet
        const indices = this.initialCenterIndices.length >= this.reels.length
            ? this.initialCenterIndices
            : [0, 1, 2];
        this.setInitialSymbols(indices);
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
    }

    // ─── SLOT BACKGROUND SPRITE (NORMAL/FREE SPIN) ───

    /**
     * Cập nhật sprite cho slot machine background theo Free Spin mode.
     * Normal Spin: normalSprite
     * Free Spin: freeSpinSprite
     */
    private _updateSlotBackgroundSprite(isFreeSpin: boolean): void {
        if (!this.slotBackgroundNode) return;

        const spriteComponent = this.slotBackgroundNode.getComponent(Sprite);
        if (!spriteComponent) return;

        const sprite = isFreeSpin ? this.freeSpinSprite : this.normalSprite;
        if (sprite) {
            spriteComponent.spriteFrame = sprite;
        }
    }

    /** FREE_SPIN_START event → cập nhật slot background sprite sang FreeSpin */
    private _onFreeSpinStart(): void {
        this._isFreeSpin = true;
        this._updateSlotBackgroundSprite(true);
    }

    /** FREE_SPIN_END event → cập nhật slot background sprite về Normal */
    private _onFreeSpinEnd(): void {
        this._isFreeSpin = false;
        this._updateSlotBackgroundSprite(false);
    }

    /**
     * Resume Normal Spin bị gián đoạn: snap reel về vị trí kết quả cuối,
     * đợi một frame để render xong rồi emit REELS_STOPPED kích hoạt win flow.
     */
    private _onResumeNormalSpin(rands: number[]): void {
        console.error(`[RESUME-DEBUG] SlotMachineController._onResumeNormalSpin — rands=${JSON.stringify(rands)}`);
        this.setInitialSymbols(rands);
        this.scheduleOnce(() => {
            EventBus.instance.emit(GameEvents.REELS_STOPPED);
        }, 0.2);
    }

    /**
     * Sau khi Enter thành công và PS được apply, gán symbol đúng từ strip.
     * Dùng center=1 (index 1 của strip sau snap) cho mỗi reel.
     */
    private _onEnterSuccess(): void {
        const data = GameData.instance;
        const strips = data.config.reelStrips;
        if (!strips || strips.length < this.reels.length) return;
        // Dùng index 0 của mỗi strip sau snap: tìm vị trí đầu tiên có symbol thật
        for (let i = 0; i < this.reels.length; i++) {
            const strip = strips[i];
            // Tìm index đầu tiên có symbol thật (không phải empty -1)
            let startIdx = 0;
            for (let j = 0; j < strip.length; j++) {
                if (strip[j] >= 0) { startIdx = j; break; }
            }
            this.reels[i].setSymbols(startIdx);
            console.log(`[REELS] Init Reel${i} from PS strip at idx=${startIdx} → ${strip[startIdx]}`);
        }
    }

    // ─── PHASE 1: BẮT ĐẦU QUAY (ngay khi nhấn Spin, trước khi chờ server) ───

    private _onReelsStartSpin(): void {
        this._stoppedCount = 0;
        this._isLongSpinActive = false;
        this._hintPositions = [];
        this._stopHintBounce();
        this._resetVFX();

        // Áp dụng speed mode trước khi spin
        this._applySpeedMode();

        const mode = AutoSpinManager.instance.speedMode;
        const noStagger = mode === SpeedMode.TURBO || mode === SpeedMode.QUICK;
        for (let i = 0; i < this.reels.length; i++) {
            const reel = this.reels[i];
            const delay = noStagger ? 0 : i * this.startStaggerDelay;
            this._scheduleReelStart(reel, delay);
        }
    }

    /**
     * Áp dụng cài đặt tốc độ cho từng ReelController dựa vào SpeedMode hiện tại.
     * Normal: mặc định | Quick: 2× | Turbo: gần như dừng ngay.
     */
    private _applySpeedMode(): void {
        const mode = AutoSpinManager.instance.speedMode;
        const fs = this._isFreeSpin;
        for (let i = 0; i < this.reels.length; i++) {
            const reel = this.reels[i];
            switch (mode) {
                case SpeedMode.QUICK:
                    reel.spinSpeed        = 6000;
                    reel.minSpinDuration  = fs ? 0.6  : 0.4;
                    reel.decelDuration    = fs ? 0.45 : 0.3;
                    reel.stopDelay        = 0;
                    reel.skipLaunchBounce = true;
                    reel.longSpinDelay    = 0.8;
                    break;
                case SpeedMode.TURBO:
                    reel.spinSpeed        = 6000;
                    reel.minSpinDuration  = fs ? 0.4  : 0.25;
                    reel.decelDuration    = fs ? 0.18 : 0.1;
                    reel.stopDelay        = 0;
                    reel.longSpinDelay    = 1;
                    reel.skipLaunchBounce = true;
                    break;
                default: // NORMAL
                    reel.spinSpeed        = 4000;
                    reel.minSpinDuration  = fs ? 1  : 0.5;
                    reel.decelDuration    = fs ? 0.45 : 0.3;
                    reel.stopDelay        = i * this.stopInterval;
                    reel.skipLaunchBounce = false;
                    reel.longSpinDelay    = 2;
                    break;
            }
        }
    }
    private _scheduleReelStart(reel: ReelController, delay: number): void {
        this.scheduleOnce(() => {
            reel.startSpin();
        }, delay);
    }

    // ─── PHASE 2: NHẬN KẾT QUẢ → RA LỆNH DỪNG ───

    private _onSpinResponse(response: SpinResponse): void {
        for (let i = 0; i < this.reels.length; i++) {
            const reel = this.reels[i];
            const centerIndex = response.rands[i];
            const isLong = this._longSpinOnReel3 && i === 2;
            const reelIdx = i; // capture for closure

            // Reel 3 long spin: kéo dài thời gian giảm tốc để tạo cảm giác hồi hộp
            if (isLong) {
                reel.decelDuration = this.longSpinDecelDuration;
            }

            reel.onSnapComplete = () => {
                this._onReelSnapped(reelIdx);
            };

            reel.onStopComplete = () => {
                this._onReelStopped(reelIdx);
            };

            reel.stopAt(centerIndex, isLong);
        }

        this._longSpinOnReel3 = false;
    }

    /**
     * Gọi ngay khi reel snap về rest (trước bounce).
     * Phát spine effect tức thì — không chờ bounce xong mới bật.
     */
    private _onReelSnapped(reelIndex: number): void {
        if (this._isLongSpinActive) {
            const hintPos = this._hintPositions.find(p => p.reelIndex === reelIndex);
            if (hintPos) {
                EventBus.instance.emit(GameEvents.LONG_SPIN_HINT_SHOW, [hintPos]);
            }
        }
    }

    private _onReelStopped(reelIndex: number): void {
        this._stoppedCount++;
        EventBus.instance.emit(GameEvents.REEL_STOPPED, reelIndex);

        // Cột 2 (index 1) vừa dừng trong khi long spin đang active → bật VFX
        if (reelIndex === 1 && this._isLongSpinActive) {
            this._tryStartLongSpinVFX();
        }

        // Cột 3 vừa dừng → tắt VFX
        if (reelIndex === 2) {
            this._stopLongSpinVFX();
        }

        if (this._stoppedCount >= this.reels.length) {
            EventBus.instance.emit(GameEvents.REELS_STOPPED);
        }
    }

    // ─── LONG SPIN VFX ────────────────────────────────────────────────────────

    private _onLongSpin(): void {
        this._longSpinOnReel3 = true;        this._isLongSpinActive = true;    }

    /**
     * Gọi sau khi Cột 2 dừng và Cột 3 đang trong long spin.
     * Bật VFX node + emit event để SoundManager phát anticipation sound.
     */
    private _tryStartLongSpinVFX(): void {
        if (!this.longSpinVFXNode) return;
        // Chỉ bật nếu của sổ long spin vẫn đang hoạt động và cột 3 chưa dừng
        if (!this._isLongSpinActive) return;
        if (this._stoppedCount >= this.reels.length) return;

        this.longSpinVFXNode.active = true;
        this._vfxFrameIdx = 0;
        this._startVFXLoop();
        EventBus.instance.emit(GameEvents.LONG_SPIN_VFX_START);
    }

    /** Bắt đầu loop sprite frame cho VFX */
    private _startVFXLoop(): void {
        this._stopVFXLoop();
        if (this.vfxFrames.length === 0) return;

        this._vfxCb = () => {
            if (!this.longSpinVFXNode?.active) {
                this._stopVFXLoop();
                return;
            }
            if (this._vfxSprite && this.vfxFrames.length > 0) {
                this._vfxSprite.spriteFrame = this.vfxFrames[this._vfxFrameIdx % this.vfxFrames.length];
                this._vfxFrameIdx++;
            }
        };
        this.schedule(this._vfxCb, 1 / this.vfxFPS);
    }

    /** Dừng VFX sprite loop */
    private _stopVFXLoop(): void {
        if (this._vfxCb) {
            this.unschedule(this._vfxCb);
            this._vfxCb = null;
        }
    }

    /** Tắt VFX hoàn toàn khi Cột 3 dừng */
    private _stopLongSpinVFX(): void {
        const wasActive = this._isLongSpinActive && this.longSpinVFXNode?.active;
        this._isLongSpinActive = false;
        this._stopVFXLoop();
        this._stopHintBounce();
        if (this.longSpinVFXNode) {
            this.longSpinVFXNode.active = false;
        }
        // Chỉ emit thud nếu VFX đã bật (long spin thật sự)
        if (wasActive) {
            EventBus.instance.emit(GameEvents.LONG_SPIN_VFX_END);
        }
    }

    /** Reset hoàn toàn khi spin mới bắt đầu */
    private _resetVFX(): void {
        this._stopVFXLoop();
        this._stopHintBounce();
        if (this.longSpinVFXNode) this.longSpinVFXNode.active = false;
    }

    // ─── LONG SPIN SYMBOL BOUNCE HINT ─────────────────────────────────────────

    /**
     * Nhận payload từ GameManager: danh sách {reelIndex, rowIndex} cần bounce.
     * Lưu lại — sẽ bắt đầu bounce khi _tryStartLongSpinVFX() được gọi (cột 2 dừng).
     */
    private _onLongSpinHint(positions: { reelIndex: number; rowIndex: number }[]): void {
        this._hintPositions = positions;
    }

    /**
     * Thông báo cho SymbolHighlighter bắt đầu spine effect trên các hint symbols.
     * Không còn dùng — hint được emit per-reel trong _onReelStopped.
     */
    private _startHintBounce(): void {
        this._hintBounceCb = () => {};
    }

    private _stopHintBounce(): void {
        this._hintBounceCb = null;
    }

    /**
     * Set hiển thị tĩnh (dùng cho init).
     */
    setInitialSymbols(centerIndices: number[]): void {
        for (let i = 0; i < this.reels.length && i < centerIndices.length; i++) {
            this.reels[i].setSymbols(centerIndices[i]);
        }
    }
}

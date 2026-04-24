/**
 * ProgressiveWinPopup - Popup BIG WIN / SUPER WIN / EPIC WIN / MEGA WIN.
 *
 * ── ĐIỀU KIỆN HIỆN (theo tài liệu p.36) ──
 *   BIG WIN  : totalWin ≥ totalBet × 25
 *   SUPER WIN: totalWin ≥ totalBet × 50
 *   EPIC WIN : totalWin ≥ totalBet × 100
 *   MEGA WIN : totalWin ≥ totalBet × 200
 *
 * ── SETUP TRONG EDITOR ──
 *   1. Tạo Node "ProgressiveWinPopup" (bắt đầu inactive).
 *   2. Gắn component này vào node đó.
 *   3. Cấu trúc node con:
 *
 *        ProgressiveWinPopup  ← component này
 *          ├── spineBig         ← sp.Skeleton cho BIG WIN  (bắt đầu inactive)
 *          ├── spineSuper       ← sp.Skeleton cho SUPER WIN (bắt đầu inactive)
 *          ├── spineEpic        ← sp.Skeleton cho EPIC WIN  (bắt đầu inactive)
 *          ├── spineMega        ← sp.Skeleton cho MEGA WIN  (bắt đầu inactive)
 *          ├── tierLabel        ← Label tên tier ("BIG WIN", "MEGA WIN", ...)
 *          ├── amountLabel      ← Label số tiền (count-up từ 0)
 *          └── clickOverlay     ← Node trong suốt bắt click đóng popup
 *
 * ── FLOW (LINEAR PROGRESSIVE) ──
 *   GameManager gọi showPopup(tier, amount, callback).
 *   1. Activate node, luôn bắt đầu từ spineBig (BIG WIN).
 *   2. Spine play "in" → "loop" + bắt đầu count-up 0 → amount.
 *   3. Khi số tiền vượt ngưỡng SUPER/EPIC/MEGA: chuyển spine tương ứng,
 *      cập nhật tierLabel + particle rateOverTime (số tiền chạy liên tục, KHÔNG đóng popup).
 *   4. Sau count-up:
 *      - Auto-Spin đang bật  → tự đóng sau autoCloseTimeout giây.
 *      - Không có Auto-Spin  → giữ trạng thái cuối, chờ player bấm.
 *   5. Spine play "out" → delay → deactivate node → callback().
 */

import { _decorator, Component, Node, Label, screen } from 'cc';
import { sp } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { L } from '../core/LocalizationManager';
import { AutoSpinManager } from '../manager/AutoSpinManager';
import { BetManager } from '../manager/BetManager';
import { SoundManager } from '../manager/SoundManager';
import { SpriteNumber } from '../core/SpriteNumber';

const { ccclass, property } = _decorator;

/** Tương ứng với WinTier enum (BIG=2, SUPER=3, EPIC=4, MEGA=5) */
export const enum ProgressiveWinTier {
    BIG  = 'big_win',
    SUPER = 'super_win',
    EPIC  = 'epic_win',
    MEGA  = 'mega_win',
}

/** Ngưỡng multiplier theo tài liệu p.36 */
export const PROGRESSIVE_WIN_THRESHOLDS = [
    { tier: ProgressiveWinTier.MEGA,  multiplier: 200 },
    { tier: ProgressiveWinTier.EPIC,  multiplier: 100 },
    { tier: ProgressiveWinTier.SUPER, multiplier: 50  },
    { tier: ProgressiveWinTier.BIG,   multiplier: 25  },
];

@ccclass('ProgressiveWinPopup')
export class ProgressiveWinPopup extends Component {

    // ── EDITOR NODE SLOTS ──────────────────────────────────────────────────────

    /** sp.Skeleton cho BIG WIN (bắt đầu inactive) */
    @property({ type: sp.Skeleton, tooltip: 'Spine effect BIG WIN\n→ Kéo sp.Skeleton node vào đây' })
    spineBig: sp.Skeleton | null = null;

    /** sp.Skeleton cho SUPER WIN (bắt đầu inactive) */
    @property({ type: sp.Skeleton, tooltip: 'Spine effect SUPER WIN\n→ Kéo sp.Skeleton node vào đây' })
    spineSuper: sp.Skeleton | null = null;

    /** sp.Skeleton cho EPIC WIN (bắt đầu inactive) */
    @property({ type: sp.Skeleton, tooltip: 'Spine effect EPIC WIN\n→ Kéo sp.Skeleton node vào đây' })
    spineEpic: sp.Skeleton | null = null;

    /** sp.Skeleton cho MEGA WIN (bắt đầu inactive) */
    @property({ type: sp.Skeleton, tooltip: 'Spine effect MEGA WIN\n→ Kéo sp.Skeleton node vào đây' })
    spineMega: sp.Skeleton | null = null;

    /** Label tên tier: "BIG WIN", "SUPER WIN", "EPIC WIN", "MEGA WIN" */
    @property({ type: Label, tooltip: 'Label tên tier\n→ Kéo Label node vào đây' })
    tierLabel: Label | null = null;

    /**
     * SpriteNumber hiển thị số tiền trúng (count-up).
     * → Kéo Node gắn component SpriteNumber vào đây.
     */
    @property({ type: SpriteNumber, tooltip: 'SpriteNumber node hiển thị số tiền (count-up)\n→ Kéo Node gắn SpriteNumber vào đây' })
    amountDisplay: SpriteNumber | null = null;

    /**
     * Index trong mảng currencySprites của SpriteNumber.
     * -1 = không hiển thị ký hiệu tiền tệ.
     */
    @property({ tooltip: 'Index ký hiệu tiền tệ trong SpriteNumber.currencySprites.\n-1 = không dùng ký hiệu tiền tệ.' })
    currencyIndex: number = 0;

    /** Node trong suốt bắt click đóng popup */
    @property({ type: Node, tooltip: 'Node trong suốt bắt click đóng\n→ Tạo Widget fill + kéo vào đây' })
    clickOverlay: Node | null = null;

    /** Node chứa Particle effect 1 (play 1 lần khi activate) */
    @property({ type: Node, tooltip: 'Node chứa ParticleSystem effect 1\n→ Kéo Node gắn ParticleSystem vào đây' })
    particleNode1: Node | null = null;

    /** Node chứa Particle effect 2 (play 1 lần khi activate) */
    @property({ type: Node, tooltip: 'Node chứa ParticleSystem effect 2\n→ Kéo Node gắn ParticleSystem vào đây' })
    particleNode2: Node | null = null;

    /** Node chứa Particle effect với scale theo orientation (landscape: 100,100,100 | portrait: 100,200,100) */
    @property({ type: Node, tooltip: 'Node chứa ParticleSystem effect với scale theo orientation\n→ Kéo Node gắn ParticleSystem vào đây' })
    particleNodeOrientationBased: Node | null = null;

    /** Node chứa Particle effect với Rave Over Time theo level (active cùng lúc với effects khác) */
    @property({ type: Node, tooltip: 'Node chứa ParticleSystem effect với Rave Over Time theo level\n→ Kéo Node gắn ParticleSystem vào đây' })
    particleNodeRave: Node | null = null;

    // ── ANIMATION PARAMS ─────────────────────────────────────────────────────

    @property({ tooltip: 'Thời gian mỗi tier hiển thị (giây).\nTổng = tierDuration × số tier. VD: BIG→MEGA = 4 × 5 = 20 giây.' })
    tierDuration: number = 5.0;

    @property({ tooltip: 'Timeout tự đóng popup (giây) - NORMAL mode' })
    autoCloseTimeout: number = 5.0;

    @property({ tooltip: 'Delay sau khi play "out" animation trước khi đóng popup (giây)' })
    outAnimCloseDelay: number = 1.0;

    @property({ tooltip: 'Rave Over Time value cho BIG WIN' })
    raveOverTimeBig: number = 1.0;

    @property({ tooltip: 'Rave Over Time value cho SUPER WIN' })
    raveOverTimeSuper: number = 2.0;

    @property({ tooltip: 'Rave Over Time value cho EPIC WIN' })
    raveOverTimeEpic: number = 3.0;

    @property({ tooltip: 'Rave Over Time value cho MEGA WIN' })
    raveOverTimeMega: number = 4.0;


     @property({ tooltip: 'Rave Over Time value cho BIG WIN' })
    raveOverTimeBig2: number = 0.4;

    @property({ tooltip: 'Rave Over Time value cho SUPER WIN' })
    raveOverTimeSuper2: number = 0.5;

    @property({ tooltip: 'Rave Over Time value cho EPIC WIN' })
    raveOverTimeEpic2: number = 0.6;

    @property({ tooltip: 'Rave Over Time value cho MEGA WIN' })
    raveOverTimeMega2: number = 0.8;


    // ── INTERNAL ─────────────────────────────────────────────────────────────

    private _callback: (() => void) | null = null;
    private _isOpen: boolean = false;
    private _isCountingUp: boolean = false;
    private _countUpTarget: number = 0;
    private _countUpCb: (() => void) | null = null;
    private _autoCloseCb: (() => void) | null = null;
    private _outAnimCloseCb: (() => void) | null = null;
    private _activeSpine: sp.Skeleton | null = null;
    private _activeTier: ProgressiveWinTier | null = null;

    // Progressive linear flow state
    private _totalBet: number = 0;
    private _segments: { tier: ProgressiveWinTier; startAmount: number; endAmount: number }[] = [];
    private _currentSegIndex: number = 0;

    // ── LIFECYCLE ────────────────────────────────────────────────────────────

    onLoad(): void {
        this.node.active = false;
        EventBus.instance.on(GameEvents.PROGRESSIVE_WIN_SHOW, this._onProgressiveWinShow, this);
        // Lắng nghe screen events để cập nhật scale của orientation-based particle effect khi xoay/resize
        screen.on('window-resize', this._onScreenChange, this);
        screen.on('orientation-change', this._onScreenChange, this);
    }

    onDestroy(): void {
        this._cleanup();
        EventBus.instance.offTarget(this);
        // Hủy listener screen events
        screen.off('window-resize', this._onScreenChange, this);
        screen.off('orientation-change', this._onScreenChange, this);
    }

    // ── EVENT HANDLER ────────────────────────────────────────────────────────

    private _onProgressiveWinShow(tier: ProgressiveWinTier, amount: number): void {
        this.showPopup(tier, amount, () => {
            EventBus.instance.emit(GameEvents.PROGRESSIVE_WIN_END);
        });
    }

    // ── PUBLIC API ───────────────────────────────────────────────────────────

    showPopup(tier: ProgressiveWinTier, amount: number, callback: () => void): void {
        if (this._isOpen) return;
        this._isOpen = true;
        this._callback = callback;
        this._totalBet = BetManager.instance.totalBet;

        // Build segments: amount-based thresholds, each segment plays for tierDuration seconds
        this._buildSegments(tier, amount);
        this._currentSegIndex = 0;

        // Deactivate all spines
        for (const s of [this.spineBig, this.spineSuper, this.spineEpic, this.spineMega]) {
            if (s) s.node.active = false;
        }

        if (this.amountDisplay) {
            this.amountDisplay.setData(0, this.currencyIndex);
            this.amountDisplay.node.active = false;
        }

        // Always start with BIG WIN spine
        const startTier = this._segments[0].tier;
        this._activeTier = startTier;
        this._activeSpine = this._getSpineForTier(startTier);
        if (this.tierLabel) this.tierLabel.string = L(startTier);

        this.node.active = true;

        // Activate overlay early to catch click-skip at any point
        if (this.clickOverlay) {
            this.clickOverlay.active = true;
            this.clickOverlay.on(Node.EventType.TOUCH_END, this._onClickClose, this);
        }

        // Play particle effects for starting tier
        this._playParticleEffects();

        const startSpine = this._activeSpine;
        if (startSpine) {
            startSpine.node.active = true;
            startSpine.setAnimation(0, 'in', false);
            startSpine.setCompleteListener(() => {
                startSpine.setCompleteListener(null);
                startSpine.setAnimation(0, 'loop', true);
                if (this.amountDisplay) this.amountDisplay.node.active = true;
                this._startCountUp(0, amount, () => {
                    this._waitForClose();
                });
            });
        } else {
            if (this.amountDisplay) this.amountDisplay.node.active = true;
            this._startCountUp(0, amount, () => {
                this._waitForClose();
            });
        }
    }

    // ── PRIVATE ──────────────────────────────────────────────────────────────

    /**
     * Build count-up segments with amount-based tier thresholds.
     * Each segment = one tier, plays for tierDuration seconds.
     * Transition happens when the counted amount reaches the next tier's threshold.
     * Fine decimal precision is computed per segment based on per-tick increment.
     */
    private _buildSegments(finalTier: ProgressiveWinTier, finalAmount: number): void {
        const tierOrder = [
            ProgressiveWinTier.BIG,
            ProgressiveWinTier.SUPER,
            ProgressiveWinTier.EPIC,
            ProgressiveWinTier.MEGA,
        ];
        // Multiplier at which we switch TO the next tier
        const nextThresholdMuls = [50, 100, 200];
        const finalIndex = tierOrder.indexOf(finalTier);

        this._segments = [];
        let curStart = 0;

        for (let i = 0; i <= finalIndex; i++) {
            let endAmount: number;
            if (i < finalIndex) {
                // Clamp intermediate threshold to finalAmount — handles debug/small amounts
                endAmount = Math.min(this._totalBet * nextThresholdMuls[i], finalAmount);
            } else {
                endAmount = finalAmount;
            }

            const range = endAmount - curStart;
            // Break only if range < 0 (impossible) OR if this is NOT the final segment and range = 0
            // Prevents skipping the final tier when finalAmount exactly equals the tier threshold
            if (range < 0) break;
            if (range === 0 && i < finalIndex) break;

            this._segments.push({
                tier: tierOrder[i],
                startAmount: curStart,
                endAmount,
            });
            curStart = endAmount;
        }
    }

    private _getSpineForTier(tier: ProgressiveWinTier): sp.Skeleton | null {
        switch (tier) {
            case ProgressiveWinTier.BIG:   return this.spineBig;
            case ProgressiveWinTier.SUPER: return this.spineSuper;
            case ProgressiveWinTier.EPIC:  return this.spineEpic;
            case ProgressiveWinTier.MEGA:  return this.spineMega;
        }
    }

    /**
     * Transition to a new tier spine while count-up continues uninterrupted.
     * Deactivates current spine, activates new spine, plays "in" → "loop".
     * Updates tierLabel and particle rateOverTime values.
     */
    private _transitionToTier(tier: ProgressiveWinTier): void {
        if (this._activeSpine) {
            this._activeSpine.setCompleteListener(null);
            this._activeSpine.node.active = false;
        }

        this._activeTier = tier;
        const newSpine = this._getSpineForTier(tier);
        this._activeSpine = newSpine;

        if (this.tierLabel) this.tierLabel.string = L(tier);
        this._updateParticleRateForTier(tier);

        if (newSpine) {
            newSpine.node.active = true;
            newSpine.setAnimation(0, 'in', false);
            newSpine.setCompleteListener(() => {
                newSpine.setCompleteListener(null);
                // Guard: only switch to loop if this spine is still the active one
                if (this._activeSpine === newSpine) {
                    newSpine.setAnimation(0, 'loop', true);
                }
            });
        }
    }

    /** Update rateOverTime on running particles when tier changes (no restart). */
    private _updateParticleRateForTier(tier: ProgressiveWinTier): void {
        const rateValue = this._getRateOverTimeValue(tier);
        if (this.particleNodeOrientationBased) {
            for (const p of this._getParticlesFrom(this.particleNodeOrientationBased)) {
                p.rateOverTime.mode = 0;
                p.rateOverTime.constant = rateValue;
            }
        }
        const rateValue2 = this._getRateOverTimeValue2(tier);
        if (this.particleNodeRave) {
            for (const p of this._getParticlesFrom(this.particleNodeRave)) {
                p.rateOverTime.mode = 0;
                p.rateOverTime.constant = rateValue2;
            }
        }
    }

    private _startCountUp(from: number, to: number, onDone: () => void): void {
        if (!this.amountDisplay) { onDone(); return; }
        this._stopCountUp();
        this._isCountingUp = true;
        this._countUpTarget = to;
        this._currentSegIndex = 0;
        this.amountDisplay?.beginCountUp();
        SoundManager.instance?.playCoinLoop();

        // Total duration = numSegments × tierDuration (e.g. BIG→MEGA = 4×5 = 20s)
        const totalDuration = this._segments.length * this.tierDuration;
        const interval = 1 / 30;
        let elapsed = 0;

        // Fixed decimal count for the entire animation — keep consistent to avoid layout shift.
        // If final amount < 100, always show 2 decimal places (e.g. 2.00, 3.00, 99.99).
        // If >= 100, show 0 (integer).
        const fixedDecimals = to < 100 ? 2 : 0;
        this.amountDisplay.lockWidth(to, this.currencyIndex, fixedDecimals);

        this._countUpCb = () => {
            elapsed += interval;

            // Determine current segment by elapsed time
            const segIndex = Math.min(
                Math.floor(elapsed / this.tierDuration),
                this._segments.length - 1
            );

            // Transition tier when segment changes
            if (segIndex > this._currentSegIndex) {
                this._currentSegIndex = segIndex;
                this._transitionToTier(this._segments[segIndex].tier);
            }

            const seg = this._segments[segIndex];
            const segStartTime = segIndex * this.tierDuration;
            const localT = Math.min((elapsed - segStartTime) / this.tierDuration, 1);
            // Linear interpolation within segment: constant small increments at 30fps
            const cur = seg.startAmount + (seg.endAmount - seg.startAmount) * localT;

            // Round to fixed precision — consistent across all segments
            const factor = Math.pow(10, fixedDecimals);
            const rounded = Math.round(cur * factor) / factor;
            this.amountDisplay!.setData(rounded, this.currencyIndex, fixedDecimals);

            if (elapsed >= totalDuration) {
                this._isCountingUp = false;
                this.amountDisplay!.endCountUp();
                this.amountDisplay!.setData(to, this.currencyIndex, fixedDecimals);
                this.amountDisplay!.unlockWidth();
                this._stopCountUp();
                SoundManager.instance?.stopCoinLoop();
                SoundManager.instance?.playCoinEnd();
                onDone();
            }
        };
        this.schedule(this._countUpCb, interval);
    }

    private _stopCountUp(): void {
        if (this._countUpCb) {
            this.unschedule(this._countUpCb);
            this._countUpCb = null;
        }
    }

    private _waitForClose(): void {
        // Auto-Spin đang bật → tự đóng sau timeout.
        // Không có Auto-Spin → giữ nguyên, chờ player bấm (clickOverlay đã active).
        const isAutoSpin = AutoSpinManager.instance.autoSpinCount > 0;
        if (!isAutoSpin) return;

        const multiplier = AutoSpinManager.instance.getTimingMultiplier();
        const timeout = this.autoCloseTimeout * multiplier;
        this._autoCloseCb = () => { this._closePopup(); };
        this.scheduleOnce(this._autoCloseCb, timeout);
    }

    private _onClickClose(): void {
        SoundManager.instance?.playButtonClick();
        if (this._autoCloseCb) {
            this.unschedule(this._autoCloseCb);
            this._autoCloseCb = null;
        }
        if (this._isCountingUp) {
            // Skip count-up: jump directly to final tier + final amount
            this._isCountingUp = false;
            this._stopCountUp();

            // Force transition to the final tier if not already there
            const finalSeg = this._segments[this._segments.length - 1];
            const finalTier = finalSeg.tier;
            if (this._activeTier !== finalTier) {
                this._currentSegIndex = this._segments.length - 1;
                // Skip "in" anim on skip — go straight to loop
                if (this._activeSpine) {
                    this._activeSpine.setCompleteListener(null);
                    this._activeSpine.node.active = false;
                }
                this._activeTier = finalTier;
                const finalSpine = this._getSpineForTier(finalTier);
                this._activeSpine = finalSpine;
                if (finalSpine) {
                    finalSpine.node.active = true;
                    finalSpine.setAnimation(0, 'loop', true);
                }
                if (this.tierLabel) this.tierLabel.string = L(finalTier);
                this._updateParticleRateForTier(finalTier);
            }

            const to = this._countUpTarget;
            const getDecimals = (v: number) => v < 100 ? 2 : 0;
            this.amountDisplay?.endCountUp();
            this.amountDisplay?.setData(to, this.currencyIndex, getDecimals(to));
            this.amountDisplay?.unlockWidth();
            SoundManager.instance?.stopCoinLoop();
            SoundManager.instance?.playCoinEnd();

            // After skip: if auto-spin, close after short delay; otherwise next click closes
            const isAutoSpin = AutoSpinManager.instance.autoSpinCount > 0;
            if (isAutoSpin) {
                this._autoCloseCb = () => { this._closePopup(); };
                this.scheduleOnce(this._autoCloseCb, 1.0);
            }
            return;
        }
        this._closePopup();
    }

    private _closePopup(): void {
        if (!this._isOpen) return;
        this._isOpen = false;

        if (this.clickOverlay) {
            this.clickOverlay.off(Node.EventType.TOUCH_END, this._onClickClose, this);
            this.clickOverlay.active = false;
        }

        this._isCountingUp = false;
        this._stopCountUp();

        const spine = this._activeSpine;
        if (spine) {
            // Stop particle effects ngay lập tức
            this._stopParticleEffects();
            
            // Play "out" animation ngay, không đợi xong
            spine.setAnimation(0, 'out', false);
            this.amountDisplay.node.active = false; // Ẩn số tiền đến khi show popup mới, tránh flash số cũ khi show liên tục
            spine.setCompleteListener(null); // Không nghe completion, delay thôi
            // Delay rồi đóng popup
            if (this._outAnimCloseCb) {
                this.unschedule(this._outAnimCloseCb);
            }
            this._outAnimCloseCb = () => {
                this._outAnimCloseCb = null;
                this._finishClose();
            };
            this.scheduleOnce(this._outAnimCloseCb, this.outAnimCloseDelay);
        } else {
            this._finishClose();
        }
    }

    private _finishClose(): void {
        this.node.active = false;
        this._activeSpine = null;
        const cb = this._callback;
        this._callback = null;
        cb?.();
    }

    private _onScreenChange(): void {
        this._applyOrientationScale();
    }

    private _isLandscape(): boolean {
        const size = screen.windowSize;
        return size.width >= size.height;
    }

    private _applyOrientationScale(): void {
        if (!this.particleNodeOrientationBased) return;
        const isLandscape = this._isLandscape();
        if (isLandscape) {
            // Landscape: scale (100, 100, 100)
            this.particleNodeOrientationBased.scale = this.particleNodeOrientationBased.scale.set(100, 100, 100);
        } else {
            // Portrait: scale (100, 200, 100)
            this.particleNodeOrientationBased.scale = this.particleNodeOrientationBased.scale.set(100, 200, 100);
        }
    }

    /** Lấy tất cả ParticleSystem từ node (bản thân + children) */
    private _getParticlesFrom(node: Node): any[] {
        const results: any[] = [];
        const self = node.getComponent('cc.ParticleSystem');
        if (self) results.push(self);
        for (const child of node.children) {
            const ps = child.getComponent('cc.ParticleSystem');
            if (ps) results.push(ps);
        }
        return results;
    }

    private _playParticleEffects(): void {
        if (this.particleNode1) {
            this.particleNode1.active = true;
            for (const p of this._getParticlesFrom(this.particleNode1)) {
                p.stop();
                p.play();
            }
        }
        if (this.particleNode2) {
            this.particleNode2.active = true;
            for (const p of this._getParticlesFrom(this.particleNode2)) {
                p.stop();
                p.play();
            }
        }
        const rateValue = this._getRateOverTimeValue(this._activeTier);
        if (this.particleNodeOrientationBased) {
            this.particleNodeOrientationBased.active = true;
            // Áp dụng scale dựa trên orientation (sẽ tự cập nhật khi xoay màn hình)
            this._applyOrientationScale();
            for (const p of this._getParticlesFrom(this.particleNodeOrientationBased)) {
                // rateOverTime là CurveRange — phải set mode Constant (0) rồi gán constant
                p.rateOverTime.mode = 0;
                p.rateOverTime.constant = rateValue;
                p.stop();
                p.play();
            }
        }

        const rateValue2 = this._getRateOverTimeValue2(this._activeTier);
        if (this.particleNodeRave) {
            this.particleNodeRave.active = true;
            for (const p of this._getParticlesFrom(this.particleNodeRave)) {
                p.rateOverTime.mode = 0;
                p.rateOverTime.constant = rateValue2;
                p.stop();
                p.play();
            }
        }
    }

    private _stopParticleEffects(): void {
        for (const node of [this.particleNode1, this.particleNode2, this.particleNodeOrientationBased, this.particleNodeRave]) {
            if (!node) continue;
            for (const p of this._getParticlesFrom(node)) {
                p.stop();
            }
        }
    }

    private _getRateOverTimeValue(tier: ProgressiveWinTier | null): number {
        switch (tier) {
            case ProgressiveWinTier.BIG:   return this.raveOverTimeBig;
            case ProgressiveWinTier.SUPER: return this.raveOverTimeSuper;
            case ProgressiveWinTier.EPIC:  return this.raveOverTimeEpic;
            case ProgressiveWinTier.MEGA:  return this.raveOverTimeMega;
            default:                       return 1.0;
        }
    }

    
    private _getRateOverTimeValue2(tier: ProgressiveWinTier | null): number {
        switch (tier) {
            case ProgressiveWinTier.BIG:   return this.raveOverTimeBig2;
            case ProgressiveWinTier.SUPER: return this.raveOverTimeSuper2;
            case ProgressiveWinTier.EPIC:  return this.raveOverTimeEpic2;
            case ProgressiveWinTier.MEGA:  return this.raveOverTimeMega2;
            default:                       return 1.0;
        }
    }

    private _cleanup(): void {
        this._stopCountUp();
        if (this._autoCloseCb) {
            this.unschedule(this._autoCloseCb);
            this._autoCloseCb = null;
        }
        if (this._outAnimCloseCb) {
            this.unschedule(this._outAnimCloseCb);
            this._outAnimCloseCb = null;
        }
        for (const s of [this.spineBig, this.spineSuper, this.spineEpic, this.spineMega]) {
            if (s) s.setCompleteListener(null);
        }
    }
}

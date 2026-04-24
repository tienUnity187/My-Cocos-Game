/**
 * JackpotPopup - Popup chúc mừng trúng hũ Jackpot (Grand / Major / Minor / Mini).
 *
 * ── SETUP TRONG EDITOR ──
 *   1. Tạo Node "JackpotPopup" (bắt đầu inactive).
 *   2. Gắn component này vào node đó.
 *   3. Cấu trúc node con:
 *
 *        JackpotPopup  ← component này
 *          ├── spineGrand       ← sp.Skeleton cho GRAND  (bắt đầu inactive)
 *          ├── spineMajor       ← sp.Skeleton cho MAJOR  (bắt đầu inactive)
 *          ├── spineMinor       ← sp.Skeleton cho MINOR  (bắt đầu inactive)
 *          ├── spineMini        ← sp.Skeleton cho MINI   (bắt đầu inactive)
 *          ├── titleLabel       ← Label tên hũ ("GRAND JACKPOT", ...)
 *          ├── amountDisplay    ← Node gắn SpriteNumber (count-up từ 0)
 *          └── clickOverlay     ← Node trong suốt bắt click đóng popup
 *
 * ── FLOW ──
 *   GameManager / EventBus gửi JACKPOT_TRIGGER(jackpotType, amount).
 *   1. Activate node; đặt đúng spine theo jackpotType.
 *   2. Spine play "in" → "loop" + bắt đầu count-up 0 → amount trong countUpDuration giây.
 *   3. Sau count-up:
 *      - Auto-Spin đang bật → tự đóng sau autoCloseTimeout giây.
 *      - Không Auto-Spin   → giữ nguyên, chờ player bấm clickOverlay.
 *   4. Bấm vào (hoặc timeout):
 *      - Nếu đang count-up → nhảy thẳng tới tiền max rồi đóng ngay.
 *      - Nếu count-up xong → đóng popup.
 *   5. Spine play "out" → delay outAnimCloseDelay → deactivate node → callback().
 */

import { _decorator, Component, Node, Label, ParticleSystem } from 'cc';
import { sp } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { JackpotType } from '../data/SlotTypes';
import { L } from '../core/LocalizationManager';
import { AutoSpinManager } from '../manager/AutoSpinManager';
import { SoundManager } from '../manager/SoundManager';
import { SpriteNumber } from '../core/SpriteNumber';

const { ccclass, property } = _decorator;

/** Map JackpotType → localization key */
const JACKPOT_L10N_KEYS: Record<number, string> = {
    [JackpotType.GRAND]:  'grand_jackpot',
    [JackpotType.MAJOR]:  'major_jackpot',
    [JackpotType.MINOR]:  'minor_jackpot',
    [JackpotType.MINI]:   'mini_jackpot',
};

@ccclass('JackpotPopup')
export class JackpotPopup extends Component {

    // ── EDITOR NODE SLOTS ──────────────────────────────────────────────────────

    /** sp.Skeleton cho GRAND JACKPOT (bắt đầu inactive) */
    @property({ type: sp.Skeleton, tooltip: 'Spine effect GRAND JACKPOT\n→ Kéo sp.Skeleton node vào đây' })
    spineGrand: sp.Skeleton | null = null;

    /** sp.Skeleton cho MAJOR JACKPOT (bắt đầu inactive) */
    @property({ type: sp.Skeleton, tooltip: 'Spine effect MAJOR JACKPOT\n→ Kéo sp.Skeleton node vào đây' })
    spineMajor: sp.Skeleton | null = null;

    /** sp.Skeleton cho MINOR JACKPOT (bắt đầu inactive) */
    @property({ type: sp.Skeleton, tooltip: 'Spine effect MINOR JACKPOT\n→ Kéo sp.Skeleton node vào đây' })
    spineMinor: sp.Skeleton | null = null;

    /** sp.Skeleton cho MINI JACKPOT (bắt đầu inactive) */
    @property({ type: sp.Skeleton, tooltip: 'Spine effect MINI JACKPOT\n→ Kéo sp.Skeleton node vào đây' })
    spineMini: sp.Skeleton | null = null;

    /** Label tên hũ: "GRAND JACKPOT", "MAJOR JACKPOT", ... */
    @property({ type: Label, tooltip: 'Label tên hũ jackpot\n→ Kéo Label node vào đây' })
    titleLabel: Label | null = null;

    /**
     * SpriteNumber hiển thị số tiền trúng (count-up từ 0 → amount).
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

    /** Node chứa Particle effect (play khi activate, stop khi close) */
    @property({ type: Node, tooltip: 'Node chứa ParticleSystem effect\n→ Kéo Node gắn ParticleSystem vào đây' })
    particleNode: Node | null = null;

    /** Node chứa Particle effect thứ 2 — play khi spine 'in' bắt đầu, stop khi spine 'out' hoàn thành */
    @property({ type: ParticleSystem, tooltip: 'Node chứa ParticleSystem thứ 2\n→ Play khi animation "in", Stop khi animation "out" xong' })
    particleNodeInOut: ParticleSystem | null = null;

    // ── ANIMATION PARAMS ─────────────────────────────────────────────────────

    @property({ tooltip: 'Thời gian count-up số tiền (giây)' })
    countUpDuration: number = 3.0;

    @property({ tooltip: 'Timeout tự đóng popup sau khi count-up xong (giây) - chỉ áp dụng khi Auto-Spin bật' })
    autoCloseTimeout: number = 3.0;

    @property({ tooltip: 'Delay sau khi play "out" animation trước khi đóng popup (giây)' })
    outAnimCloseDelay: number = 1.0;

    // ── INTERNAL ─────────────────────────────────────────────────────────────

    private _callback: (() => void) | null = null;
    private _isOpen: boolean = false;
    private _isCountingUp: boolean = false;
    private _countUpTarget: number = 0;
    private _countUpCb: (() => void) | null = null;
    private _autoCloseCb: (() => void) | null = null;
    private _outAnimCloseCb: (() => void) | null = null;
    private _activeSpine: sp.Skeleton | null = null;

    // ── LIFECYCLE ────────────────────────────────────────────────────────────

    onLoad(): void {
        this.node.active = false;
        console.log('[JackpotPopup] ✓ onLoad() called — registering JACKPOT_TRIGGER listener', {
            nodeName: this.node.name,
            hasSpineGrand: !!this.spineGrand,
            hasSpineMajor: !!this.spineMajor,
            hasSpineMinor: !!this.spineMinor,
            hasSpineMini: !!this.spineMini,
            hasTitleLabel: !!this.titleLabel,
            hasAmountDisplay: !!this.amountDisplay,
            hasClickOverlay: !!this.clickOverlay,
        });
        EventBus.instance.on(GameEvents.JACKPOT_TRIGGER, this._onJackpotTrigger, this);
    }

    onDestroy(): void {
        this._cleanup();
        EventBus.instance.offTarget(this);
    }

    // ── EVENT HANDLER ────────────────────────────────────────────────────────

    private _onJackpotTrigger(jackpotType: JackpotType, amount: number): void {
        const jackpotNames = ['NONE', 'MINI', 'MINOR', 'MAJOR', 'GRAND'];
        console.log('[JackpotPopup] 🎰 _onJackpotTrigger received', {
            jackpotType,
            jackpotName: jackpotNames[jackpotType] ?? 'UNKNOWN',
            amount,
            timestamp: Date.now(),
        });
        this.showPopup(jackpotType, amount, () => {
            console.log('[JackpotPopup] ✓ Popup closed → emitting JACKPOT_END');
            EventBus.instance.emit(GameEvents.JACKPOT_END);
        });
    }

    // ── PUBLIC API ───────────────────────────────────────────────────────────

    /**
     * Hiện popup jackpot.
     * @param jackpotType  Loại hũ (GRAND / MAJOR / MINOR / MINI)
     * @param amount       Số tiền thực tế trúng
     * @param callback     Gọi khi popup đóng xong — GameManager tiếp tục flow
     */
    showPopup(jackpotType: JackpotType, amount: number, callback: () => void): void {
        if (this._isOpen) {
            console.warn('[JackpotPopup] ⚠️  Already open, ignoring duplicate trigger');
            return;
        }
        console.log('[JackpotPopup] 📂 showPopup() called', {
            jackpotType,
            amount,
            nodeName: this.node.name,
            nodeParent: this.node.parent?.name ?? 'NO_PARENT',
        });
        this._isOpen = true;
        this._callback = callback;
        this._countUpTarget = amount;

        // Deactivate all spines
        for (const s of [this.spineGrand, this.spineMajor, this.spineMinor, this.spineMini]) {
            if (s) s.node.active = false;
        }

        // Init amount display
        if (this.amountDisplay) {
            this.amountDisplay.setData(0, this.currencyIndex);
            this.amountDisplay.node.active = false;
        }

        // Set title
        if (this.titleLabel) {
            this.titleLabel.string = L(JACKPOT_L10N_KEYS[jackpotType] ?? 'grand_jackpot');
        }

        // Activate node
        console.log('[JackpotPopup] ✓ Activating popup node...');
        this.node.active = true;

        // Activate overlay early so player can skip at any time
        if (this.clickOverlay) {
            this.clickOverlay.active = true;
            this.clickOverlay.on(Node.EventType.TOUCH_END, this._onClickClose, this);
        }

        // Activate the correct spine and start flow
        this._activeSpine = this._getSpineForType(jackpotType);
        const spine = this._activeSpine;

        if (spine) {
            console.log('[JackpotPopup] ✓ Spine found, playing "in" animation');
            spine.node.active = true;
            this._playParticleEffects();
            this._playParticleInOut();
            spine.setAnimation(0, 'in', false);
            spine.setCompleteListener(() => {
                console.log('[JackpotPopup] ✓ "in" animation complete → playing "loop"');
                spine.setCompleteListener(null);
                spine.setAnimation(0, 'loop', true);
                if (this.amountDisplay) this.amountDisplay.node.active = true;
                this._startCountUp(amount, () => {
                    this._waitForClose();
                });
            });
        } else {
            console.warn('[JackpotPopup] ⚠️  No spine found for jackpot type', jackpotType);
            if (this.amountDisplay) this.amountDisplay.node.active = true;
            this._startCountUp(amount, () => {
                this._waitForClose();
            });
        }
    }

    // ── PRIVATE ──────────────────────────────────────────────────────────────

    private _getSpineForType(type: JackpotType): sp.Skeleton | null {
        switch (type) {
            case JackpotType.GRAND: return this.spineGrand;
            case JackpotType.MAJOR: return this.spineMajor;
            case JackpotType.MINOR: return this.spineMinor;
            case JackpotType.MINI:  return this.spineMini;
            default:                return null;
        }
    }

    /**
     * Count-up số tiền từ 0 → to trong countUpDuration giây tại 30fps.
     * Giữ 2 số thập phân nếu to < 100, ngược lại hiển thị số nguyên.
     * Dùng lockWidth để tránh layout shift trong suốt quá trình đếm.
     */
    private _startCountUp(to: number, onDone: () => void): void {
        if (!this.amountDisplay) { onDone(); return; }
        this._stopCountUp();
        this._isCountingUp = true;
        this.amountDisplay?.beginCountUp();
        SoundManager.instance?.playCoinLoop();

        const interval = 1 / 30;
        let elapsed = 0;
        const fixedDecimals = to < 100 ? 2 : 0;
        this.amountDisplay.lockWidth(to, this.currencyIndex, fixedDecimals);

        this._countUpCb = () => {
            elapsed += interval;
            const t = Math.min(elapsed / this.countUpDuration, 1);
            const cur = to * t; // linear — consistent tick size at 30fps

            const factor = Math.pow(10, fixedDecimals);
            const rounded = Math.round(cur * factor) / factor;
            this.amountDisplay!.setData(rounded, this.currencyIndex, fixedDecimals);

            if (elapsed >= this.countUpDuration) {
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
        // Auto-Spin bật → tự đóng sau timeout; không bật → chờ player bấm.
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
            // Skip count-up: nhảy thẳng tới tiền max
            this._isCountingUp = false;
            this._stopCountUp();

            const to = this._countUpTarget;
            const fixedDecimals = to < 100 ? 2 : 0;
            this.amountDisplay?.endCountUp();
            this.amountDisplay?.setData(to, this.currencyIndex, fixedDecimals);
            this.amountDisplay?.unlockWidth();
            SoundManager.instance?.stopCoinLoop();
            SoundManager.instance?.playCoinEnd();

            // Auto-Spin → đóng nhanh sau 1 giây; không → đợi click tiếp theo
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
        this._stopParticleEffects();

        const spine = this._activeSpine;
        if (spine) {
            spine.setCompleteListener(null);
              this._stopParticleInOut();
            spine.setAnimation(0, 'out', false);
            if (this.amountDisplay) this.amountDisplay.node.active = false;

            // Stop particleNodeInOut when 'out' animation completes
            spine.setCompleteListener(() => {
                spine.setCompleteListener(null);
              
            });

            if (this._outAnimCloseCb) this.unschedule(this._outAnimCloseCb);
            this._outAnimCloseCb = () => {
                this._outAnimCloseCb = null;
                this._finishClose();
            };
            this.scheduleOnce(this._outAnimCloseCb, this.outAnimCloseDelay);
        } else {
            this._stopParticleInOut();
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
        if (this.particleNode) {
            this.particleNode.active = true;
            for (const p of this._getParticlesFrom(this.particleNode)) {
                p.stop();
                p.play();
            }
        }
    }

    private _stopParticleEffects(): void {
        if (this.particleNode) {
            for (const p of this._getParticlesFrom(this.particleNode)) {
                p.stop();
            }
        }
    }

    private _playParticleInOut(): void {
        if (this.particleNodeInOut) {
            this.particleNodeInOut.node.active = true;
           // for (const p of this._getParticlesFrom(this.particleNodeInOut)) {
                 this.particleNodeInOut.stop();
                 this.particleNodeInOut.play();
         //   }
        }
    }

    private _stopParticleInOut(): void {
        if (this.particleNodeInOut) {
           // for (const p of this._getParticlesFrom(this.particleNodeInOut)) {
                 this.particleNodeInOut.stop();
           // }
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
        for (const s of [this.spineGrand, this.spineMajor, this.spineMinor, this.spineMini]) {
            if (s) s.setCompleteListener(null);
        }
    }
}

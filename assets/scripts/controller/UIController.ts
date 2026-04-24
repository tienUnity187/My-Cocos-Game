/**
 * UIController - Xử lý tương tác UI cơ bản.
 * Bind nút Spin, label Balance/Bet/Win, nút +/- Bet.
 * - Balance count-up/down animation khi thay đổi
 * - Spin button mờ đi khi không thể spin
 */

import { _decorator, Component, Node, Label, Button, tween, Vec3, Color, Tween, Sprite, SpriteFrame, RichText } from 'cc';
import { formatCurrency } from '../core/FormatUtils';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { BetManager } from '../manager/BetManager';
import { WalletManager } from '../manager/WalletManager';
import { GameData } from '../data/GameData';
import { JackpotDisplay } from './JackpotDisplay';
import { L } from '../core/LocalizationManager';
import { AutoSpinManager } from '../manager/AutoSpinManager';

const { ccclass, property } = _decorator;

@ccclass('UIController')
export class UIController extends Component {

    @property({ type: Label, tooltip: 'Label hiển thị Balance' })
    balanceLabel: Label | null = null;

    @property({ type: Label, tooltip: 'Label hiển thị Total Bet' })
    betLabel: Label | null = null;

    @property({ type: RichText, tooltip: 'Label hiển thị Win' })
    winLabel: RichText | null = null;

    @property({ type: Label, tooltip: 'Label hiển thị base win (trước hệ số)' })
    baseWinLabel: Label | null = null;

    @property({ type: Label, tooltip: 'Label hiển thị hệ số nhân (2x, 3x, 5x...)' })
    multiplierLabel: Label | null = null;

    @property({ type: Label, tooltip: 'Label hiển thị số tiền thắng của vòng reel hiện tại' })
    roundWinLabel: Label | null = null;

    @property({ type: Button, tooltip: 'Nút Spin' })
    spinButton: Button | null = null;

    @property({ type: Button, tooltip: 'Nút tăng Bet' })
    betUpButton: Button | null = null;

    @property({ type: Button, tooltip: 'Nút giảm Bet' })
    betDownButton: Button | null = null;

    @property({ type: Button, tooltip: 'Nút Auto Spin Free — chỉ hiển thị khi ở chế độ FREE SPIN' })
    autoSpinFreeButton: Button | null = null;

    @property({ type: Button, tooltip: 'Nút Buy Bonus — mua free spin' })
    btnBuyBonus: Button | null = null;

    @property({ type: Label, tooltip: 'Label hiển thị mode quay: NORMAL SPIN / FREE SPIN x10' })
    spinModeLabel: Label | null = null;

    @property({ type: SpriteFrame, tooltip: 'Sprite bình thường của nút Spin (idle)' })
    spinButtonNormalSprite: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'Sprite khi đang quay của nút Spin (spinning)' })
    spinButtonSpinningSprite: SpriteFrame | null = null;

    @property({ type: JackpotDisplay, tooltip: 'Component JackpotDisplay để update khi bet thay đổi' })
    jackpotDisplay: JackpotDisplay | null = null;

    @property({ tooltip: 'Thời gian count-up balance (giây)' })
    balanceCountDuration: number = 0.6;

    @property({ tooltip: 'Màu betLabel bình thường (không có activate item)' })
    betLabelNormalColor: Color = new Color(255, 255, 255, 255);

    @property({ tooltip: 'Màu betLabel cảnh báo khi activate item đang bật' })
    betLabelWarningColor: Color = new Color(255, 220, 50, 255);

    // ─── INTERNAL ───
    private _displayedBalance: number = 0;
    private _balanceCountCb: (() => void) | null = null;
    private _targetBalance: number = 0;
    private _isFreeSpinMode: boolean = false;
    private _freeSpinRemaining: number = 0;
    private _freeSpinTotal: number = 0;
    /** Tổng tiền thắng tích lũy trong free spin session — dùng cho hiển thị UI */
    private _freeSpinAccumulatedWin: number = 0;
    /** Giá trị đang hiển thị trên baseWinLabel (dùng cho count-up animation) */
    private _displayedFreeSpinWin: number = 0;
    /** Callback count-up animation cho freeSpinWin */
    private _freeSpinWinCountCb: (() => void) | null = null;
    /** Flag để tracking xem rotation animation đang chạy hay đã dừng */
    private _spinButtonAnimationRunning: boolean = false;
    /** Trạng thái enabled cuối cùng của spin button (từ UI_SPIN_BUTTON_STATE) */
    private _spinEnabled: boolean = true;

    // ─── LIFECYCLE ───

    onLoad(): void {
        this._bindUI();
        this._bindEvents();
    }

    start(): void {
        // Hiển thị balance ngay khi vào game (tránh race condition với BALANCE_UPDATED event)
        const initialBalance = WalletManager.instance.balance;
        this._displayedBalance = initialBalance;
        this._targetBalance = initialBalance;
        if (this.balanceLabel) {
            this.balanceLabel.string = L('CLIENT_CURRENENCY_SYMBOL') + formatCurrency(initialBalance);
        }

        // Khởi tạo winLabel ngay khi vào game (tránh null/empty khi GAME_READY event chậm emit)
        if (this.winLabel) {
            this.winLabel.string = L('UI_CONTROL_PANEL_GUIDE_3');
        }

        // Cập nhật betLabel ngay khi onLoad hoàn thành
        EventBus.instance.emit(GameEvents.BET_CHANGED, {
            betIndex: BetManager.instance.betIndex,
            currentBet: BetManager.instance.currentBet,
            coinValue: BetManager.instance.coinValue,
            totalBet: BetManager.instance.totalBet,
        });

        // Bắt đầu spin button rotation animation
        this._startSpinButtonRotationLoop();
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
        this._spinButtonAnimationRunning = false;
        if (this.spinButton) {
            Tween.stopAllByTarget(this.spinButton.node);
        }
    }

    // ─── UI BINDING ───

    private _bindUI(): void {
        if (this.spinButton) {
            this.spinButton.node.on('click', this._onSpinClick, this);
        }
        if (this.betUpButton) {
            this.betUpButton.node.on('click', this._onBetUp, this);
        }
        if (this.betDownButton) {
            this.betDownButton.node.on('click', this._onBetDown, this);
        }
        if (this.autoSpinFreeButton) {
            this.autoSpinFreeButton.node.on('click', this._onAutoSpinFreeClick, this);
        }
        if (this.btnBuyBonus) {
            this.btnBuyBonus.node.on('click', this._onBuyBonusClick, this);
        }
    }

    private _bindEvents(): void {
        const bus = EventBus.instance;
        bus.on(GameEvents.BALANCE_UPDATED, this._onBalanceUpdated, this);
        bus.on(GameEvents.BET_CHANGED, this._onBetChanged, this);
        bus.on(GameEvents.UI_SPIN_BUTTON_STATE, this._onSpinButtonState, this);
        bus.on(GameEvents.WIN_COUNTUP_DONE, this._onWinCountDone, this);
        bus.on(GameEvents.WIN_PRESENT_START, this._onWinPresentStart, this);
        bus.on(GameEvents.FREE_SPIN_START, this._onFreeSpinStart, this);
        bus.on(GameEvents.FREE_SPIN_COUNT_UPDATED, this._onFreeSpinCountUpdated, this);
        bus.on(GameEvents.FREE_SPIN_END, this._onFreeSpinEnd, this);
        bus.on(GameEvents.REELS_START_SPIN, this._onReelsStartSpin, this);
        bus.on(GameEvents.AUTO_SPIN_CHANGED, this._onAutoSpinChanged, this);
        bus.on(GameEvents.BUY_BONUS_SUCCESS, this._onBuyBonusSuccess, this);
        bus.on(GameEvents.BUY_BONUS_FAILED, this._onBuyBonusFailed, this);
        bus.on(GameEvents.BUY_BONUS_TOTAL_BET_CHANGED, this._onBuyBonusTotalBetChanged, this);
        bus.on(GameEvents.GAME_READY, () => {
            if (this.spinModeLabel) this.spinModeLabel.string = L('normal_spin');
            // Reset labels khi game ready
            if (this.winLabel) this.winLabel.string = L('UI_CONTROL_PANEL_GUIDE_3');
            if (this.roundWinLabel) this.roundWinLabel.string = '';
            if (this.baseWinLabel) this.baseWinLabel.string = '';
            if (this.multiplierLabel) this.multiplierLabel.string = '';
        }, this);
    }

    // ─── BUTTON HANDLERS ───

    private _onSpinClick(): void {
        // Trong freeSpin: không cho hủy auto spin
        if (this._isFreeSpinMode) return;
        // Nếu đang auto spin active → pause
        if (AutoSpinManager.instance.isAutoSpinActive) {
            AutoSpinManager.instance.pauseAutoSpin();
            return;
        }
        EventBus.instance.emit(GameEvents.SPIN_REQUEST);
    }

    private _onReelsStartSpin(): void {
        if (this._isFreeSpinMode) {
            // FreeSpin mode: winLabel hiển thị tổng tích lũy + spin count (giữ nguyên, không reset số)
            this._updateFreeSpinWinLabel();
        } else {
            this._updateNormalWinLabel(0);
            if (this.baseWinLabel) this.baseWinLabel.string = '';
        }
        if (this.roundWinLabel) this.roundWinLabel.string = '';
        if (this.multiplierLabel) this.multiplierLabel.string = '';
        this._setSpinButtonSprite(false);
    }

    private _onAutoSpinChanged(count: number): void {
        const isAutoSpinActive = AutoSpinManager.instance.isAutoSpinActive;
        // Ẩn/hiện autoSpinFreeButton theo trạng thái auto spin
        if (this.autoSpinFreeButton) {
            this.autoSpinFreeButton.interactable = !isAutoSpinActive && !this._isFreeSpinMode;
        }
        // Reset winLabel về mặc định khi auto spin dừng
        if (!isAutoSpinActive && this.winLabel) {
            this.winLabel.string = L('UI_CONTROL_PANEL_GUIDE_3');
        }
    }

    private _onBetUp(): void {
        BetManager.instance.changeBetIndex(1);
    }

    private _onBetDown(): void {
        BetManager.instance.changeBetIndex(-1);
    }

    private _onAutoSpinFreeClick(): void {
        // 🎯 Bấm nút Auto Spin Free → gửi signal cho GameManager xử lý
        // GameManager sẽ kiểm tra điều kiện (freeSpinRemaining > 0) rồi chuyển mode + spin
        EventBus.instance.emit(GameEvents.FREE_SPIN_AUTO_TRIGGERED);
    }

    private _onBuyBonusClick(): void {
        // 🎯 Bấm nút Buy Bonus → gửi request tải danh sách items từ server
        EventBus.instance.emit(GameEvents.BUY_BONUS_REQUEST);
    }

    // ─── EVENT HANDLERS ───

    private _onBalanceUpdated(balance: number): void {
        this._targetBalance = balance;
        this._animateBalance(this._displayedBalance, balance);
    }

    private _onBetChanged(info: { totalBet: number }): void {
        if (this.betLabel) {
            this.betLabel.string = L('CLIENT_CURRENENCY_SYMBOL') + formatCurrency(info.totalBet);
        }
        if (this.jackpotDisplay) {
            this.jackpotDisplay.refresh();
        }
    }

    private _onBuyBonusTotalBetChanged(info: { displayBet: number; isActive: boolean }): void {
        if (this.betLabel) {
            this.betLabel.string = L('CLIENT_CURRENENCY_SYMBOL') + formatCurrency(info.displayBet);
            this.betLabel.color = info.isActive ? this.betLabelWarningColor : this.betLabelNormalColor;
        }
    }

    private _onSpinButtonState(enabled: boolean): void {
        this._spinEnabled = enabled;
        const isAutoSpinActive = AutoSpinManager.instance.isAutoSpinActive;
        if (this.spinButton) {
            // Khi đang auto spin: giữ button luôn interactable để player nhấn cancel
            this.spinButton.interactable = enabled || (isAutoSpinActive && !this._isFreeSpinMode);
            tween(this.spinButton.node)
                .to(0.15, { scale: enabled ? new Vec3(1, 1, 1) : new Vec3(0.92, 0.92, 1) })
                .start();
            this.spinButton.node.setScale(
                enabled ? new Vec3(1, 1, 1) : new Vec3(0.92, 0.92, 1)
            );
            if (enabled) {
                this._setSpinButtonSprite(true);
            }
        }
        if (this.betUpButton) this.betUpButton.interactable = enabled;
        if (this.betDownButton) this.betDownButton.interactable = enabled;
        // Disable Buy Bonus button khi reel đang quay
        if (this.btnBuyBonus) this.btnBuyBonus.interactable = enabled;
        // autoSpinFreeButton: chỉ enabled khi idle, không auto spin, không free spin
        if (this.autoSpinFreeButton) this.autoSpinFreeButton.interactable = enabled && !this._isFreeSpinMode && !isAutoSpinActive;
    }

    private _onWinPresentStart(resp: { totalWin: number; featureMultiple?: number }): void {
        if (this._isFreeSpinMode) {
            // FreeSpin: đọc tổng thực tế từ GameData (GameManager đã cộng trước khi emit)
            // và animate count-up liên tục trên winLabel — KHÔNG reset số về 0
            this._freeSpinAccumulatedWin = GameData.instance.freeSpinTotalWin;
            this._animateFreeSpinWin(this._displayedFreeSpinWin, this._freeSpinAccumulatedWin);

            if (resp.totalWin > 0) {
                this._playWinLabelZoomEffect();
            }

            if (this.roundWinLabel) {
                this.roundWinLabel.string = resp.totalWin > 0 ? formatCurrency(resp.totalWin) : '';
            }
            if (resp.featureMultiple && resp.featureMultiple > 1) {
                if (this.multiplierLabel) this.multiplierLabel.string = `×${resp.featureMultiple.toFixed(1)}x`;
            } else {
                if (this.multiplierLabel) this.multiplierLabel.string = '';
            }
            return;
        }

        // Normal spin
        this._updateNormalWinLabel(resp.totalWin);
        if (resp.totalWin > 0) {
            this._playWinLabelZoomEffect();
        }
        if (this.roundWinLabel) {
            this.roundWinLabel.string = resp.totalWin > 0 ? formatCurrency(resp.totalWin) : '0';
        }
        if (resp.featureMultiple && resp.featureMultiple > 1) {
            const baseWin = resp.totalWin / resp.featureMultiple;
            if (this.baseWinLabel) this.baseWinLabel.string = formatCurrency(baseWin);
            if (this.multiplierLabel) this.multiplierLabel.string = `×${resp.featureMultiple.toFixed(1)}x`;
        } else {
            if (this.baseWinLabel) this.baseWinLabel.string = '';
            if (this.multiplierLabel) this.multiplierLabel.string = '';
        }
    }

    private _onWinCountDone(_totalWin: number): void {
        // winLabel now shows "WIN X" text set in _onWinPresentStart — no override needed
    }

    private _onFreeSpinStart(): void {
        this._isFreeSpinMode = true;
        this._freeSpinTotal = this._freeSpinRemaining;
        // Resume case: nếu server đã khôi phục tổng win (stage 4/9 mid-session),
        // dùng giá trị đó thay vì reset về 0
        const data = GameData.instance;
        if (data.freeSpinTotalWinRestoredFromServer && data.freeSpinTotalWin > 0) {
            this._freeSpinAccumulatedWin = data.freeSpinTotalWin;
            this._displayedFreeSpinWin = data.freeSpinTotalWin;  // snap ngay, không animate
        } else {
            this._freeSpinAccumulatedWin = 0;
            this._displayedFreeSpinWin = 0;
        }
        if (this._freeSpinWinCountCb) {
            this.unschedule(this._freeSpinWinCountCb);
            this._freeSpinWinCountCb = null;
        }
        // Lock autoSpinFreeButton trong suốt session free spin
        if (this.autoSpinFreeButton) this.autoSpinFreeButton.interactable = false;
        this._updateFreeSpinWinLabel();
    }

    private _onFreeSpinCountUpdated(remaining: number): void {
        this._freeSpinRemaining = remaining;
        this._isFreeSpinMode = true;
        if (this._freeSpinTotal === 0) this._freeSpinTotal = remaining;
        if (this.spinModeLabel) {
            this.spinModeLabel.string = L('free_spin_mode', { count: remaining });
        }
    }

    private _onFreeSpinEnd(_totalWin: number): void {
        this._isFreeSpinMode = false;
        this._freeSpinRemaining = 0;
        this._freeSpinTotal = 0;
        this._freeSpinAccumulatedWin = 0;
        this._displayedFreeSpinWin = 0;
        if (this._freeSpinWinCountCb) {
            this.unschedule(this._freeSpinWinCountCb);
            this._freeSpinWinCountCb = null;
        }
        // autoSpinFreeButton: chỉ hiện khi không còn auto spin active
        const isAutoSpinActive = AutoSpinManager.instance.isAutoSpinActive;
        if (this.autoSpinFreeButton) this.autoSpinFreeButton.interactable = !isAutoSpinActive;
        if (this.spinModeLabel) {
            this.spinModeLabel.string = L('normal_spin');
        }
        if (this.winLabel) this.winLabel.string = L('UI_CONTROL_PANEL_GUIDE_3');
    }

    private _onBuyBonusSuccess(): void {
        // 🎯 Mua bonus thành công → button sẽ được enable lại sau khi free spin kết thúc
        // Có thể thêm feedback về thành công tại đây nếu cần
    }

    private _onBuyBonusFailed(): void {
        // 🎯 Mua bonus thất bại → button vẫn enabled để user thử lại
        // Có thể hiển thị error message tại đây
    }

    private _startSpinButtonRotationLoop(): void {
        if (!this.spinButton) return;

        const node = this.spinButton.node;
        this._spinButtonAnimationRunning = true;
        const animationLoop = () => {
            if (!this._spinButtonAnimationRunning) return;
            tween(node)
                .to(0.25, { eulerAngles: new Vec3(0, 0, -30) }, { easing: 'quadOut' })
                .to(0.6, { eulerAngles: new Vec3(0, 0, 0) }, { easing: 'sineOut' })
                .call(animationLoop)
                .start();
        };
        animationLoop();
    }

    private _setSpinButtonSprite(normal: boolean): void {
        if (!this.spinButton) return;
        const sprite = this.spinButton.node.getComponentInChildren(Sprite);
        if (!sprite) return;

        if (normal) {
            // Đổi sang normal sprite → bắt đầu xoay
            const frame = this.spinButtonNormalSprite;
            if (frame) sprite.spriteFrame = frame;
            // Reset eulerAngles về 0 và bắt đầu animation
            this.spinButton.node.setRotationFromEuler(0, 0, 0);
            this._startSpinButtonRotationLoop();
        } else {
            // Đổi sang spinning sprite → dừng xoay
            const frame = this.spinButtonSpinningSprite;
            if (frame) sprite.spriteFrame = frame;
            // Dừng animation và reset eulerAngles về 0
            this._spinButtonAnimationRunning = false;
            Tween.stopAllByTarget(this.spinButton.node);
            this.spinButton.node.setRotationFromEuler(0, 0, 0);
        }
    }

    // ─── FREE SPIN WIN DISPLAY ───

    /**
     * Cập nhật winLabel cho Normal Spin (có hoặc không có auto spin).
     * Dòng 1: kết quả tiền thắng (hoặc guide text nếu chưa có).
     * Dòng 2 (chỉ khi auto spin đang chạy): số lượt còn lại.
     */
    private _updateNormalWinLabel(totalWin: number): void {
        if (!this.winLabel) return;
        const autoCount = AutoSpinManager.instance.autoSpinCount;
        const isAutoSpinActive = AutoSpinManager.instance.isAutoSpinActive;
        const currencySymbol = L('CLIENT_CURRENENCY_SYMBOL');

        let line1: string;
        if (totalWin > 0) {
            line1 = "<color=#F5FF00>" + L('UI_CONTROL_PANEL_TEXT_PAY_WIN') + "</color>: " + currencySymbol + formatCurrency(totalWin);
        } else {
            line1 = isAutoSpinActive ? L('UI_CONTROL_PANEL_GUIDE_4') : L('UI_CONTROL_PANEL_GUIDE_3');
        }

        if (isAutoSpinActive) {
            const line2 = "<size=30>" + L('UI_CONTROL_PANEL_TEXT_AUTO_SPIN') + ": " + autoCount + "</size>";
            this.winLabel.string = line1 + "\n" + line2;
        } else {
            this.winLabel.string = line1;
        }
    }

    /** Cập nhật winLabel: localized format */
    private _updateFreeSpinWinLabel(): void {
        if (!this.winLabel) return;
        const totalStr = formatCurrency(this._displayedFreeSpinWin);
        const currencySymbol = L('CLIENT_CURRENENCY_SYMBOL');
        const payWinLabel = "<color=#F5FF00>" + L('UI_CONTROL_PANEL_TEXT_PAY_WIN') + "</color>";
        const freeSpinLabel = "<size=30>" + L('UI_CONTROL_PANEL_TEXT_FREE_SPIN') ;
        this.winLabel.string = `${payWinLabel}: ${currencySymbol}${totalStr}\n${freeSpinLabel}: ${this._freeSpinRemaining}`+ "</size>";
    }

    /**
     * Animate count-up từ from → to trên winLabel.
     * Luôn bắt đầu từ _displayedFreeSpinWin hiện tại để đảm bảo số tăng liên tục,
     * không bao giờ giật về giá trị cũ hay 0 trong cùng 1 session.
     */
    private _animateFreeSpinWin(from: number, to: number): void {
        if (!this.winLabel) {
            this._displayedFreeSpinWin = to;
            return;
        }

        // Hủy animation cũ (tiếp tục từ giá trị đang hiển thị, không reset)
        if (this._freeSpinWinCountCb) {
            this.unschedule(this._freeSpinWinCountCb);
            this._freeSpinWinCountCb = null;
        }

        // Không có thay đổi: chỉ refresh spin count
        if (from === to) {
            this._updateFreeSpinWinLabel();
            return;
        }

        const duration = 0.6;
        let elapsed = 0;
        const interval = 1 / 30;
        const startVal = from;

        this._freeSpinWinCountCb = () => {
            elapsed += interval;
            const t = Math.min(elapsed / duration, 1);
            const eased = 1 - (1 - t) * (1 - t); // ease-out quad
            this._displayedFreeSpinWin = startVal + (to - startVal) * eased;
            this._updateFreeSpinWinLabel();

            if (t >= 1) {
                this._displayedFreeSpinWin = to;
                this._updateFreeSpinWinLabel();
                this.unschedule(this._freeSpinWinCountCb!);
                this._freeSpinWinCountCb = null;
            }
        };

        this.schedule(this._freeSpinWinCountCb, interval);
    }

    private _animateBalance(from: number, to: number): void {
        if (!this.balanceLabel) {
            this._displayedBalance = to;
            return;
        }

        // Hủy animation cũ
        if (this._balanceCountCb) {
            this.unschedule(this._balanceCountCb);
            this._balanceCountCb = null;
        }

        const duration = this.balanceCountDuration;
        let elapsed = 0;
        const interval = 1 / 30;
        const startVal = from;

        this._balanceCountCb = () => {
            elapsed += interval;
            const t = Math.min(elapsed / duration, 1);
            const eased = 1 - (1 - t) * (1 - t); // ease-out quad
            const cur = startVal + (to - startVal) * eased;
            this._displayedBalance = cur;
            this.balanceLabel!.string = L('CLIENT_CURRENENCY_SYMBOL') + formatCurrency(cur);

            if (t >= 1) {
                this._displayedBalance = to;
                this.balanceLabel!.string = L('CLIENT_CURRENENCY_SYMBOL') + formatCurrency(to);
                this.unschedule(this._balanceCountCb!);
                this._balanceCountCb = null;
            }
        };

        this.schedule(this._balanceCountCb, interval);
    }

    /** 🎨 Hiệu ứng zoom nhẹ cho winLabel khi có tiền thắng */
    private _playWinLabelZoomEffect(): void {
        if (!this.winLabel) return;

        const node = this.winLabel.node;
        // Reset scale trước khi play animation
        node.setScale(new Vec3(1, 1, 1));

        tween(node)
            .to(0.15, { scale: new Vec3(1.12, 1.12, 1) }, { easing: 'backOut' })
            .to(0.15, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
            .start();
    }
}

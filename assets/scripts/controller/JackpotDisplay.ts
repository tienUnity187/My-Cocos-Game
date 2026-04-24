/**
 * JackpotDisplay - Hiển thị giá trị 4 loại jackpot.
 *
 * ── SETUP TRONG EDITOR ──
 *   1. Tạo 4 Node (grandLabel, majorLabel, minorLabel, miniLabel).
 *   2. Mỗi Node gắn Component Label.
 *   3. Kéo Node vào slot tương ứng (grand/major/minor/miniLabelNode).
 *
 * ── AUTO UPDATE ──
 *   - Lắng nghe JACKPOT_VALUES_UPDATED từ server/mock polling → dùng giá trị thực.
 *   - Lắng nghe BET_CHANGED → fallback tính từ multiplier khi chưa có jackpotValues.
 *   - jackpotValues: [MINI, MINOR, MAJOR, GRAND] (thứ tự từ server API).
 */

import { _decorator, Component, Label, sp } from 'cc';
import { GameData } from '../data/GameData';
import { formatCurrency } from '../core/FormatUtils';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { L } from '../core/LocalizationManager';
import { JackpotType } from '../data/SlotTypes';

const { ccclass, property } = _decorator;

@ccclass('JackpotDisplay')
export class JackpotDisplay extends Component {

    @property({ type: Label, tooltip: 'Label hiển thị GRAND jackpot (Wild 3X)' })
    grandLabel: Label | null = null;

    @property({ type: Label, tooltip: 'Label hiển thị MAJOR jackpot (Red Lightning)' })
    majorLabel: Label | null = null;

    @property({ type: Label, tooltip: 'Label hiển thị MINOR jackpot (Blue Lightning)' })
    minorLabel: Label | null = null;

    @property({ type: Label, tooltip: 'Label hiển thị MINI jackpot (Mix Special)' })
    miniLabel: Label | null = null;

    // ─── SPINE ───────────────────────────────────────────────────────────────

    @property({
        type: sp.Skeleton,
        tooltip: 'Spine effect GRAND jackpot (index 3).\nAnimation mặc định lấy từ field "Default Anim" trên sp.Skeleton.',
    })
    spineGrand: sp.Skeleton | null = null;

    @property({
        type: sp.Skeleton,
        tooltip: 'Spine effect MAJOR jackpot (index 2).\nAnimation mặc định lấy từ field "Default Anim" trên sp.Skeleton.',
    })
    spineMajor: sp.Skeleton | null = null;

    @property({
        type: sp.Skeleton,
        tooltip: 'Spine effect MINOR jackpot (index 1).\nAnimation mặc định lấy từ field "Default Anim" trên sp.Skeleton.',
    })
    spineMinor: sp.Skeleton | null = null;

    @property({
        type: sp.Skeleton,
        tooltip: 'Spine effect MINI jackpot (index 0).\nAnimation mặc định lấy từ field "Default Anim" trên sp.Skeleton.',
    })
    spineMini: sp.Skeleton | null = null;

    // ─── Private ─────────────────────────────────────────────────────────────

    /** Ánh xạ jackpot index [MINI=0, MINOR=1, MAJOR=2, GRAND=3] → sp.Skeleton */
    private get _spineByIndex(): (sp.Skeleton | null)[] {
        return [this.spineMini, this.spineMinor, this.spineMajor, this.spineGrand];
    }

    /** Flag: jackpot này đến từ long spin (spine đã play tại LONG_SPIN_JACKPOT_REVEAL) */
    private _isLongSpinJackpot: boolean = false;

    // ─── LIFECYCLE ───

    onLoad(): void {
        this._updateAll();
        this._initSpines();
        EventBus.instance.on(GameEvents.JACKPOT_VALUES_UPDATED, this._onJackpotValuesUpdated, this);
        EventBus.instance.on(GameEvents.BET_CHANGED, this._onBetChanged, this);
        EventBus.instance.on(GameEvents.JACKPOT_TRIGGER, this._onJackpotTrigger, this);
        EventBus.instance.on(GameEvents.LONG_SPIN_JACKPOT_REVEAL, this._onLongSpinJackpotReveal, this);
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
    }

    // ─── EVENT HANDLERS ───

    private _onJackpotValuesUpdated(_vals: number[]): void {
        this._updateAll();
    }

    private _onBetChanged(): void {
        this._updateAll();
    }

    private _onJackpotTrigger(jackpot: JackpotType): void {
        // JackpotType: MINI=1, MINOR=2, MAJOR=3, GRAND=4 → spine index = jackpot - 1
        // Chỉ play ở đây khi là normal spin (long spin đã play tại LONG_SPIN_JACKPOT_REVEAL).
        if (!this._isLongSpinJackpot) {
            this.playJackpotSpine(jackpot - 1);
        }
        this._isLongSpinJackpot = false;
    }

    private _onLongSpinJackpotReveal(_positions: { reelIndex: number; rowIndex: number }[], jackpot: JackpotType): void {
        // Reel 3 vừa chạm đích — play spine ngay, trước khi popup hiện.
        this._isLongSpinJackpot = true;
        this.playJackpotSpine(jackpot - 1);
    }

    // ─── SPINE ───

    /**
     * Khởi tạo tất cả spine: đóng băng ngay tại chỗ, KHÔNG gọi setAnimation.
     * Gọi setAnimation sẽ restart track → engine render 1 tick → chớp.
     * Ở đây chỉ cần timeScale = 0 để ngăn animation tự chạy.
     * Spine đã được engine init với Default Anim tại time=0 trước update đầu tiên.
     */
    private _initSpines(): void {
        for (const spine of this._spineByIndex) {
            if (!spine) continue;
            spine.setCompleteListener(null);
            spine.timeScale = 0;
        }
    }

    /**
     * Đặt spine về frame đầu của animation hiện tại và dừng lại.
     * Dùng sau khi play xong — lúc này CẦN setAnimation để rewind về frame 0.
     */
    private _freezeAtFirstFrame(spine: sp.Skeleton): void {
        const animName = spine.animation;
        if (!animName) return;
        spine.setCompleteListener(null);
        spine.timeScale = 0;
        spine.setAnimation(0, animName, false);
        // timeScale đã = 0 → setAnimation đặt track tại time=0, không advance
    }

    /**
     * Play animation jackpot 1 lần rồi dừng tại frame đầu.
     *
     * @param jackpotIndex  Index jackpot theo thứ tự server: MINI=0, MINOR=1, MAJOR=2, GRAND=3.
     *                      Dùng -1 để bỏ qua không play spine nào.
     */
    public playJackpotSpine(jackpotIndex: number): void {
        const spines = this._spineByIndex;
        if (jackpotIndex < 0 || jackpotIndex >= spines.length) return;
        const spine = spines[jackpotIndex];
        if (!spine) return;

        const animName = spine.animation;
        if (!animName) return;

        spine.setCompleteListener(null);
        spine.timeScale = 1;
        spine.setAnimation(0, animName, false);
        spine.setCompleteListener(() => {
            spine.setCompleteListener(null);
            this._freezeAtFirstFrame(spine);
        });
    }

    // ─── UPDATE ───

    /**
     * Cập nhật tất cả các label.
     *
     * Ưu tiên: jackpotValues từ server/mock (nếu có giá trị > 0).
     * Fallback: tính từ totalBet × jackpotMultipliers (khi chưa nhận được jackpot polling).
     */
    private _updateAll(): void {
        const data = GameData.instance;
        const vals = data.jackpotValues; // [MINI, MINOR, MAJOR, GRAND]
        const hasServerValues = vals && vals.some(v => v > 0);

        const currencySymbol = L('CLIENT_CURRENENCY_SYMBOL');
        if (hasServerValues) {
            // Dùng giá trị thực từ server/mock — thứ tự: [MINI, MINOR, MAJOR, GRAND]
            if (this.miniLabel)  this.miniLabel.string  = `${currencySymbol}${formatCurrency(vals[0])}`;
            if (this.minorLabel) this.minorLabel.string = `${currencySymbol}${formatCurrency(vals[1])}`;
            if (this.majorLabel) this.majorLabel.string = `${currencySymbol}${formatCurrency(vals[2])}`;
            if (this.grandLabel) this.grandLabel.string = `${currencySymbol}${formatCurrency(vals[3])}`;
        } else {
            // Fallback: tính từ multiplier × totalBet
            const mults = data.config.jackpotMultipliers || { GRAND: 500, MAJOR: 250, MINOR: 100, MINI: 25 };
            const totalBet = data.totalBet;

            if (this.grandLabel) this.grandLabel.string = `${currencySymbol}${formatCurrency(totalBet * mults.GRAND)}`;
            if (this.majorLabel) this.majorLabel.string = `${currencySymbol}${formatCurrency(totalBet * mults.MAJOR)}`;
            if (this.minorLabel) this.minorLabel.string = `${currencySymbol}${formatCurrency(totalBet * mults.MINOR)}`;
            if (this.miniLabel)  this.miniLabel.string  = `${currencySymbol}${formatCurrency(totalBet * mults.MINI)}`;
        }
    }

    /** Refresh (dùng nếu bet/coin thay đổi) */
    public refresh(): void {
        this._updateAll();
    }
}

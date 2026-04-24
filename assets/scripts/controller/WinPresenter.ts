/**
 * WinPresenter - Trình diễn kết quả thắng.
 *
 * FLOW MỚI:
 *   1. Khi reel dừng (WIN_PRESENT_START):
 *      - Hiện TẤT CẢ winning lines cùng 1 lúc (WIN_SHOW_ALL_LINES)
 *      - Show BigWin popup nếu cần
 *   2. Sau 1 giây: emit WIN_PRESENT_END → GameManager bật nút Spin
 *   3. Đồng thời bắt đầu vòng lặp cycling: line1 → (1s) → line2 → ... → loop
 *   4. Khi REELS_START_SPIN: hủy cycling, reset hoàn toàn
 */

import { _decorator, Component, Label } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { GameData } from '../data/GameData';
import { SpinResponse, SlotStageType, WinTier } from '../data/SlotTypes';
import { L } from '../core/LocalizationManager';

const { ccclass, property } = _decorator;

@ccclass('WinPresenter')
export class WinPresenter extends Component {

    @property({ type: Label, tooltip: 'Label hiển thị tiền thắng (không bắt buộc)' })
    winLabel: Label | null = null;

    @property({ tooltip: 'Delay trước khi bật Spin sau khi hiện line (giây)' })
    spinEnableDelay: number = 1.0;

    @property({ tooltip: 'Thời gian mỗi line trong vòng lặp cycling (giây)' })
    lineCycleDuration: number = 2.0;

    /** Tăng mỗi round mới — callback từ round cũ bỏ qua nếu lỗi thời */
    private _generation: number = 0;
    private _isPresenting: boolean = false;
    /** Reference đến cycling callback đang chạy (dùng để unschedule chính xác) */
    private _cycleCallback: (() => void) | null = null;
    /** Đang trong chế độ free spin — bỏ qua các ghi winLabel khi đúng */
    private _isFreeSpinMode: boolean = false;
    /** Tất cả spine highlight đã hoàn tất animation (do SymbolHighlighter báo) */
    private _highlightAnimDone: boolean = false;
    /** Gen đang chờ WIN_HIGHLIGHT_ANIM_DONE để emit WIN_PRESENT_END; -1 = không chờ */
    private _pendingPresentEndGen: number = -1;
    /** Danh sách line thắng của vòng quay gần nhất (dùng để cycle sau jackpot popup) */
    private _lastMatchedLines: SpinResponse['matchedLinePays'] = [];

    // ─── LIFECYCLE ───

    onLoad(): void {
        EventBus.instance.on(GameEvents.WIN_PRESENT_START, this._onWinStart, this);
        EventBus.instance.on(GameEvents.REELS_START_SPIN,  this._onReelsStartSpin, this);
        EventBus.instance.on(GameEvents.WIN_HIGHLIGHT_ANIM_DONE, this._onHighlightAnimDone, this);
        EventBus.instance.on(GameEvents.JACKPOT_END, this._onJackpotEndForCycle, this);
        EventBus.instance.on(GameEvents.FREE_SPIN_COUNT_UPDATED, (remaining: number) => {
            this._isFreeSpinMode = remaining > 0;
        }, this);
        EventBus.instance.on(GameEvents.FREE_SPIN_END, () => {
            this._isFreeSpinMode = false;
        }, this);
    }

    onDestroy(): void {
        this.unscheduleAllCallbacks();
        EventBus.instance.offTarget(this);
    }

    // ─── RESET KHI SPIN MỚI BẮT ĐẦU ───

    private _onReelsStartSpin(): void {
        this._generation++;
        this._stopCycling();
        this.unscheduleAllCallbacks();
        this._isPresenting = false;
        this._highlightAnimDone = false;
        this._pendingPresentEndGen = -1;
        // Trong free spin: UIController quản lý winLabel — không ghi đè ở đây
        if (!this._isFreeSpinMode && this.winLabel) {
            this.winLabel.string = L('good_luck');
        }
    }

    // ─── XỬ LÝ KẾT QUẢ ─────────────────────────────────────────────

    private _onWinStart(response: SpinResponse): void {
        this._generation++;
        const myGen = this._generation;
        this._stopCycling();
        this.unscheduleAllCallbacks();
        this._isPresenting = false;
        this._highlightAnimDone = false;
        this._pendingPresentEndGen = -1;
        // console.log(`[WinPresenter] WIN_PRESENT_START`);
        // Lưu lại lines để dùng sau jackpot popup (nếu WIN_PRESENT_START không được emit trong jackpot path)
        this._lastMatchedLines = response.matchedLinePays;
        // Không có tiền thắng → kết thúc ngay để GameManager mở Spin
        if (response.totalWin <= 0) {
            if (!this._isFreeSpinMode && this.winLabel) this.winLabel.string = L('no_win');
            this._finishPresentation(myGen);
            return;
        }

        this._isPresenting = true;

        // Cập nhật win label ngay khi có kết quả (chỉ ngoài free spin)
        if (!this._isFreeSpinMode && this.winLabel) {
            this.winLabel.string = L('win_amount', { amount: response.totalWin.toFixed(2) });
        }

        // 1) Hiện TẤT CẢ winning lines cùng 1 lúc
        if (response.matchedLinePays.length > 0) {
            // Truyền spinEnableDelay để SymbolHighlighter dùng đúng duration (thay vì property riêng)
            EventBus.instance.emit(GameEvents.WIN_SHOW_ALL_LINES, response.matchedLinePays, this.spinEnableDelay);
        }

        // 2) Show Big/Mega/Super Win popup nếu cần
        const winTier = GameData.instance.getWinTier(response.totalWin);
        if (winTier >= WinTier.BIG_WIN) {
            EventBus.instance.emit(GameEvents.WIN_POPUP, winTier, response.totalWin);
        }

        // 3) Free Spin multiplier thông báo
        if (response.featureMultiple && response.featureMultiple > 1) {
            EventBus.instance.emit(GameEvents.FREE_SPIN_MULTIPLIER, response.featureMultiple);
        }

        // 4) Sau spinEnableDelay giây: bật Spin + bắt đầu cycling
        this.scheduleOnce(() => {
            if (this._generation !== myGen) return;

            // Kết thúc presentation → GameManager bật nút Spin
            // (không gọi _finishPresentation vì nó gọi unscheduleAllCallbacks
            //  sẽ can thiệp vào cycling sắp được đăng ký)
            this._isPresenting = false;
            EventBus.instance.emit(GameEvents.WIN_COUNTUP_DONE, response.totalWin);

            // Bắt đầu vòng lặp cycling qua từng winning line
            // Bỏ qua cycling khi lần quay tiếp theo là auto (free spin)
            const willAutoSpin = response.nextStage === SlotStageType.FREE_SPIN
                || response.nextStage === SlotStageType.FREE_SPIN_START
                || response.nextStage === SlotStageType.FREE_SPIN_RE_TRIGGER;

            // Trong freespin có kết quả thắng: chờ tất cả spine animation hoàn tất
            // trước khi emit WIN_PRESENT_END (để lần quay tiếp không bắt đầu giữa chừng).
            if (willAutoSpin && response.matchedLinePays.length > 0) {
                if (this._highlightAnimDone) {
                    // Spine đã xong trước spinEnableDelay → emit ngay
                    EventBus.instance.emit(GameEvents.WIN_PRESENT_END);
                } else {
                    // Đánh dấu chờ — _onHighlightAnimDone sẽ emit khi spine xong
                    this._pendingPresentEndGen = myGen;
                    // Fallback phòng trường hợp WIN_HIGHLIGHT_ANIM_DONE không bao giờ fire
                    this.scheduleOnce(() => {
                        if (this._pendingPresentEndGen === myGen) {
                            this._pendingPresentEndGen = -1;
                            if (this._generation === myGen) {
                                EventBus.instance.emit(GameEvents.WIN_PRESENT_END);
                            }
                        }
                    }, 3.0);
                }
            } else {
                // Normal spin: emit WIN_PRESENT_END TRƯỚC khi start cycling.
                // Lý do: PayOutDisplay lắng nghe WIN_PRESENT_END để _hideAllEffects().
                // Nếu emit sau _startLineCycle, WIN_PRESENT_END sẽ xóa effect của line đầu tiên
                // ngay sau khi nó vừa được set → line đầu không hiển thị, từ line 2 mới thấy.
                EventBus.instance.emit(GameEvents.WIN_PRESENT_END);
            }

            if (!willAutoSpin && response.matchedLinePays.length >= 1) {
                this._startLineCycle(response.matchedLinePays, myGen);
            }
        }, this.spinEnableDelay);
    }

    // ─── CYCLING LOOP (lặp lại vô hạn đến khi spin mới) ─────────────

    private _startLineCycle(lines: SpinResponse['matchedLinePays'], gen: number): void {
        this._stopCycling();
        let lineIdx = 0;

        // Emit line đầu tiên ngay lập tức
        EventBus.instance.emit(GameEvents.UI_UPDATE_WIN_LABEL, lines[lineIdx]);
        lineIdx = (lineIdx + 1) % lines.length;

        // Dùng schedule (repeating interval) thay vì đệ qui scheduleOnce
        // để tránh vấn đề dedup của scheduler Cocos Creator
        this._cycleCallback = () => {
            if (this._generation !== gen) {
                this._stopCycling();
                return;
            }
            EventBus.instance.emit(GameEvents.UI_UPDATE_WIN_LABEL, lines[lineIdx]);
            lineIdx = (lineIdx + 1) % lines.length;
        };
        this.schedule(this._cycleCallback, this.lineCycleDuration);
    }

    private _stopCycling(): void {
        if (this._cycleCallback) {
            this.unschedule(this._cycleCallback);
            this._cycleCallback = null;
        }
    }

    /**
     * Sau jackpot popup đóng (Normal spin): WIN_PRESENT_START không được emit trong jackpot path,
     * nên cycling chưa bao giờ chạy. Khởi động lại cycling tại đây nếu có line thắng.
     * Bỏ qua trong free spin (free spin tự auto-spin tiếp).
     */
    private _onJackpotEndForCycle(): void {
        if (this._isFreeSpinMode) return;

        // _lastMatchedLines rỗng khi WIN_PRESENT_START chưa được emit (jackpot normal spin path)
        // → fallback lấy từ GameData
        const lines = this._lastMatchedLines.length > 0
            ? this._lastMatchedLines
            : (GameData.instance.lastSpinResponse?.matchedLinePays ?? []);

        if (lines.length < 1) return;
        this._generation++;
        this._startLineCycle(lines, this._generation);
    }

    // ─── FINISH ───

    /** Callback khi SymbolHighlighter báo tất cả spine animation đã hoàn tất */
    private _onHighlightAnimDone(): void {
        this._highlightAnimDone = true;
        if (this._pendingPresentEndGen >= 0 && this._pendingPresentEndGen === this._generation) {
            this._pendingPresentEndGen = -1;
            EventBus.instance.emit(GameEvents.WIN_PRESENT_END);
        }
    }

    private _finishPresentation(gen: number): void {
        if (this._generation !== gen) return;
        this._stopCycling();
        this.unscheduleAllCallbacks();
        this._isPresenting = false;
        // console.log(`[WinPresenter] WIN_PRESENT_END`);
        EventBus.instance.emit(GameEvents.WIN_PRESENT_END);
    }
}

import { _decorator, Component } from 'cc';
import { IndicatorItem } from './IndicatorItem';

const { ccclass, property } = _decorator;

@ccclass('PaylineIndicatorManager')
export class PaylineIndicatorManager extends Component {

    @property({ type: [IndicatorItem], tooltip: 'Mảng 9 IndicatorItem bên trái (index 0 = Line 1 = Middle horizontal)\n★ Phải kéo đủ 9 item, KHÔNG để slot nào trống (null).' })
    leftIndicators: IndicatorItem[] = [];

    @property({ type: [IndicatorItem], tooltip: 'Mảng 9 IndicatorItem bên phải (index 0 = Line 1 = Middle horizontal)\n★ Phải kéo đủ 9 item, KHÔNG để slot nào trống (null).' })
    rightIndicators: IndicatorItem[] = [];

    onLoad(): void {
        // Validate cấu hình Inspector — phát hiện sớm slot null thay vì im lặng
        // Dùng console.error vì console.warn bị tắt trong ServerConfig (_silenceGameLogs)
        for (let i = 0; i < this.leftIndicators.length; i++) {
            if (!this.leftIndicators[i]) {
                console.error(`[PaylineIndicatorManager] leftIndicators[${i}] is NULL — Line ${i + 1} sẽ không highlight được!`);
            }
        }
        for (let i = 0; i < this.rightIndicators.length; i++) {
            if (!this.rightIndicators[i]) {
                console.error(`[PaylineIndicatorManager] rightIndicators[${i}] is NULL — Line ${i + 1} sẽ không highlight được!`);
            }
        }
        console.error(`[PaylineIndicatorManager] onLoad — leftIndicators.length=${this.leftIndicators.length}, rightIndicators.length=${this.rightIndicators.length}`);
    }

    resetAllIndicators(): void {
        for (const item of this.leftIndicators) {
            item?.setHighlight(false);
        }
        for (const item of this.rightIndicators) {
            item?.setHighlight(false);
        }
    }

    showWinLine(lineIndex: number): void {
        this.resetAllIndicators();
        this._highlightLine(lineIndex);
    }

    showMultipleWinLines(lineIndices: number[]): void {
        this.resetAllIndicators();
        for (const index of lineIndices) {
            this._highlightLine(index);
        }
    }

    /**
     * Ánh xạ từ payLineIndex (0-based, từ server) sang vị trí mảng indicator trong Inspector.
     * Thứ tự đúng theo định nghĩa payline:
     *   Line 1 (idx 0): [1,0],[1,1],[1,2] — Hàng giữa ngang
     *   Line 2 (idx 1): [0,0],[0,1],[0,2] — Hàng trên ngang
     *   Line 3 (idx 2): [2,0],[2,1],[2,2] — Hàng dưới ngang
     *   Line 4 (idx 3): [0,0],[1,1],[2,2] — Chéo trên-trái → dưới-phải
     *   Line 5 (idx 4): [2,0],[1,1],[0,2] — Chéo dưới-trái → trên-phải
     *   Line 6 (idx 5): [1,0],[0,1],[1,2] — Nón ngửa (Giữa→Trên→Giữa)
     *   Line 7 (idx 6): [1,0],[2,1],[1,2] — Nón úp  (Giữa→Dưới→Giữa)
     *   Line 8 (idx 7): [2,0],[1,1],[2,2] — Chữ V   (Dưới→Giữa→Dưới)
     *   Line 9 (idx 8): [0,0],[1,1],[0,2] — Chữ V ngược (Trên→Giữa→Trên)
     *
     * Nếu Inspector kéo indicator không đúng thứ tự, sửa mảng dưới đây thay vì đổi thứ tự drag.
     * Ví dụ: Line 8 và Line 9 bị hoán đổi → đặt INDICATOR_REMAP[7]=8, INDICATOR_REMAP[8]=7
     */
    private static readonly INDICATOR_REMAP: number[] = [0, 2, 1, 4, 3, 6, 5, 8, 7];
    //                                         Line:     1  2  3  4  5  6  7  8  9

    private _highlightLine(lineIndex: number): void {
        const indicatorIndex = PaylineIndicatorManager.INDICATOR_REMAP[lineIndex] ?? lineIndex;
        const left  = this.leftIndicators[indicatorIndex];
        const right = this.rightIndicators[indicatorIndex];
        if (!left && !right) {
            console.error(`[PaylineIndicatorManager] _highlightLine(${lineIndex}→indicator[${indicatorIndex}]): không có indicator nào để highlight!`);
            return;
        }
        if (left)  left.setHighlight(true);
        if (right) right.setHighlight(true);
    }

    /** Đặt mode game cho tất cả indicators (Base Game hoặc Feature/Free Bonus) */
    public setFeatureGameMode(isFeature: boolean): void {
        for (const item of this.leftIndicators) {
            item?.setFeatureGameMode(isFeature);
        }
        for (const item of this.rightIndicators) {
            item?.setFeatureGameMode(isFeature);
        }
    }
}

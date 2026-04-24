/**
 * SpriteNumber - Hiển thị số bằng các Sprite riêng lẻ thay vì Bitmap Font.
 *
 * ★ SETUP TRONG EDITOR:
 *   1. Tạo Node (ví dụ: "ScoreDisplay"), gắn component SpriteNumber vào.
 *   2. Component tự động thêm và cấu hình Layout (HORIZONTAL, CONTAINER) khi chạy.
 *      → Bạn có thể điều chỉnh Layout.spacingX bằng property "spacing" trong Inspector.
 *   3. Kéo đúng 10 SpriteFrame (số 0, 1, 2 ... 9) vào mảng numberSprites (phải đúng thứ tự).
 *   4. Kéo SpriteFrame dấu chấm (.) vào dotSprite.
 *   5. Kéo SpriteFrame dấu phẩy (,) vào commaSprite.
 *   6. (Tuỳ chọn) Kéo các SpriteFrame ký hiệu tiền tệ vào mảng currencySprites.
 *      Ví dụ: index 0 = $,  index 1 = đ,  index 2 = ¥
 *   7. Chọn currencyPosition = START (tiền tệ trước số) hoặc END (tiền tệ sau số).
 *
 * ★ GỌI TỪ SCRIPT KHÁC:
 *   import { SpriteNumber } from '../core/SpriteNumber';
 *
 *   const sn = this.scoreNode.getComponent(SpriteNumber);
 *
 *   sn.setData(1234567);        // → "1,234,567"   (không có ký hiệu tiền tệ)
 *   sn.setData(9999.5, 0);      // → "$9,999.50"   (currencySprites[0] = $, position = START)
 *   sn.setData(500, 1);         // → "500đ"         (currencySprites[1] = đ, position = END)
 *
 * ★ NODE POOL:
 *   Component dùng NodePool để tái sử dụng node — không bao giờ destroy/create node
 *   trong quá trình cập nhật, tránh lag khi liên tục refresh điểm số.
 */

import {
    _decorator, Component, Enum, Node, NodePool,
    Sprite, SpriteFrame, tween, Tween, UITransform, Vec3,
} from 'cc';

const { ccclass, property } = _decorator;

// ─── Enum ────────────────────────────────────────────────────────────────────

export enum CurrencyPosition {
    /** Ký hiệu tiền tệ đứng TRƯỚC số: ví dụ $1,000 */
    START = 0,
    /** Ký hiệu tiền tệ đứng SAU số: ví dụ 1,000đ */
    END = 1,
}

// ─── Component ───────────────────────────────────────────────────────────────

@ccclass('SpriteNumber')
export class SpriteNumber extends Component {

    // ─── Inspector Properties ─────────────────────────────────────────────

    @property({
        type: [SpriteFrame],
        tooltip: '10 SpriteFrame cho chữ số 0 → 9.\nPHẢI đúng thứ tự: index 0 = hình "0", index 9 = hình "9".',
    })
    numberSprites: SpriteFrame[] = [];

    @property({
        type: SpriteFrame,
        tooltip: 'SpriteFrame cho dấu chấm thập phân (.).',
    })
    dotSprite: SpriteFrame | null = null;

    @property({
        type: SpriteFrame,
        tooltip: 'SpriteFrame cho dấu phẩy phân cách hàng nghìn (,).',
    })
    commaSprite: SpriteFrame | null = null;

    @property({
        type: [SpriteFrame],
        tooltip: 'Mảng ký hiệu tiền tệ.\nVí dụ: index 0 = $,  index 1 = đ,  index 2 = ¥\nTruyền index tương ứng vào setData() để hiển thị.',
    })
    currencySprites: SpriteFrame[] = [];

    @property({
        type: Enum(CurrencyPosition),
        tooltip: 'START = ký hiệu đứng trước số ($100).\nEND   = ký hiệu đứng sau số (100đ).',
    })
    currencyPosition: CurrencyPosition = CurrencyPosition.START;

    @property({
        tooltip: 'Khoảng cách (px) giữa các chữ số kề nhau.',
        range: [0, 30, 1],
        slide: true,
    })
    spacing: number = 2;

    @property({
        tooltip: 'Khoảng cách phụ thêm quanh dấu chấm (.) và phẩy (,).\nSố âm = gần hơn (chồng vào). Ví dụ: -4 = kéo vào 4px hai phía',
        range: [-30, 20, 1],
        slide: true,
    })
    punctuationSpacingOffset: number = -3;

    @property({
        tooltip: 'Chiều rộng tối đa (px) cho toàn bộ chuỗi số.\n' +
                 'Nếu tổng width vượt quá giá trị này, node sẽ được scale nhỏ lại vừa khít.\n' +
                 '0 = tắt tính năng (lấy theo ContentSize.width của node nếu > 0, ngược lại không giới hạn).',
        range: [0, 2000, 1],
    })
    maxWidth: number = 0;

    // ─── Jolt Effect ──────────────────────────────────────────────────────

    @property({
        tooltip: 'Bật/tắt hiệu ứng giật nhún khi setData() được gọi.',
    })
    joltEnabled: boolean = true;

    @property({
        tooltip: 'Thời gian tối thiểu (giây) giữa hai lần giật.\n' +
                 'Được random giữa Min-Max để tạo cảm giác sét đánh tự nhiên hơn.',
        range: [0, 5, 0.05],
        slide: true,
    })
    joltIntervalMin: number = 0.15;

    @property({
        tooltip: 'Thời gian tối đa (giây) giữa hai lần giật.\n' +
                 'Phải >= joltIntervalMin.',
        range: [0, 5, 0.05],
        slide: true,
    })
    joltIntervalMax: number = 0.35;

    @property({
        tooltip: 'Tổng thời gian của một lần giật (giây).\n' +
                 'Giai đoạn lên chiếm 35%, giai đoạn nẩy trở về chiếm 65%.',
        range: [0.05, 1.5, 0.01],
        slide: true,
    })
    joltDuration: number = 0.3;

    @property({
        tooltip: 'Scale đỉnh khi giật (nhân với scale hiện tại).\n' +
                 'Ví dụ: 1.15 = phình to 15% rồi nẩy về.\n' +
                 '1.0 = không đổi kích thước (chỉ dùng joltOffsetY).',
        range: [1.0, 2.0, 0.01],
        slide: true,
    })
    joltScale: number = 1.12;

    @property({
        tooltip: 'Dịch chuyển dọc (px) tại đỉnh giật. Số dương = lên trên, số âm = xuống dưới.',
        range: [-30, 30, 1],
        slide: true,
    })
    joltOffsetY: number = 6;

    // ─── Private State ────────────────────────────────────────────────────

    /** Pool tái sử dụng node digit/symbol — không bao giờ destroy mid-game. */
    private _pool: NodePool = new NodePool();
    /** Các node đang hiển thị trên màn hình. */
    private _activeNodes: Node[] = [];
    /** Width/Height đã khoá — 0 = dynamic (tính lại mỗi frame). */
    private _lockedWidth: number = 0;
    private _lockedHeight: number = 0;

    /** Scale hiệu dụng do maxWidth áp đặt (dùng để jolt nhân lên đúng). */
    private _effectiveScale: number = 1;
    /** Đang trong chế độ count-up — số nguyên sẽ được hiển thị với .00 */
    private _isCounting: boolean = false;
    /** Lưu scale ban đầu của node khi component load — dùng để giữ default scale. */
    private _initialScale: number = 1;
    /** Thời điểm (ms) lần giật cuối cùng — dùng để kiểm tra joltInterval. */
    private _lastJoltTime: number = -Infinity;
    /** Tween hiệu ứng giật đang chạy (nếu có). */
    private _joltTween: Tween<Node> | null = null;

    // ─── Lifecycle ────────────────────────────────────────────────────────

    onLoad(): void {
        // Lưu scale ban đầu của node để sau này áp dụng maxWidth scaling trên cơ sở này
        const initialScale = this.node.scale.x; // Giả sử x, y, z đều bằng nhau
        this._initialScale = initialScale > 0 ? initialScale : 1;
    }

    onDestroy(): void {
        this._stopJolt();
        this._recycleAll();
        this._pool.clear();
    }

    // ─── Public API ───────────────────────────────────────────────────────

    /**
     * Tính trước kích thước container dựa trên giá trị đích (lớn nhất) và khoá lại.
     * Sau khi gọi, setData() sẽ KHÔNG thay đổi contentSize hay scale nữa → tránh layout nhảy.
     * Gọi unlockWidth() để trở về chế độ dynamic sau khi count-up xong.
     */
    lockWidth(finalValue: number, currencyIndex: number = -1, minDecimals: number = 0): void {
        const { totalWidth, maxHeight } = this._computeSize(finalValue, currencyIndex, minDecimals);
        this._lockedWidth  = totalWidth;
        this._lockedHeight = maxHeight;
        // Áp dụng ngay để container đúng size trước khi count-up bắt đầu
        const parentTf = this.node.getComponent(UITransform);
        if (parentTf) parentTf.setContentSize(totalWidth, maxHeight);
        const effectiveMaxWidth = this.maxWidth > 0
            ? this.maxWidth
            : (parentTf && parentTf.contentSize.width > 0 ? parentTf.contentSize.width : 0);
        if (effectiveMaxWidth > 0 && totalWidth > effectiveMaxWidth) {
            // Apply maxWidth scaling ON TOP OF initial scale
            const maxWidthScale = effectiveMaxWidth / totalWidth;
            const finalScale = this._initialScale * maxWidthScale;
            this._effectiveScale = finalScale;
            this.node.setScale(finalScale, finalScale, 1);
        } else {
            // Không cần maxWidth scaling — giữ initial scale, không ghi đè
            this._effectiveScale = this._initialScale;
            this.node.setScale(this._initialScale, this._initialScale, 1);
        }
    }

    /** Huỷ khoá width — setData() trở về chế độ tính lại động mỗi frame. */
    unlockWidth(): void {
        this._lockedWidth  = 0;
        this._lockedHeight = 0;
    }

    /** Bắt đầu chế độ count-up: số nguyên sẽ hiển thị .00 trong khi đang chạy. */
    beginCountUp(): void {
        this._isCounting = true;
    }

    /** Kết thúc chế độ count-up: số nguyên trở về hiển thị không có phần thập phân. */
    endCountUp(): void {
        this._isCounting = false;
    }

    /**
     * Cập nhật số hiển thị.
     *
     * @param value         Số cần hiển thị. Hỗ trợ integer và float (tối đa 2 chữ số thập phân).
     *                      Số nguyên: không hiển thị phần thập phân.
     *                      Ví dụ: 1234567 → "1,234,567" | 9.5 → "9.50"
     * @param currencyIndex Index trong mảng currencySprites để hiển thị ký hiệu tiền tệ.
     *                      Truyền -1 (mặc định) để bỏ qua ký hiệu tiền tệ.
     */
    setData(value: number, currencyIndex: number = -1, minDecimals: number = 0): void {
        this._recycleAll();

        // Ghi nhận maxWidth TRƯỚC khi ghi đè contentSize ở cuối hàm
        const parentTf0 = this.node.getComponent(UITransform);
        const effectiveMaxWidth = this.maxWidth > 0
            ? this.maxWidth
            : (parentTf0 && parentTf0.contentSize.width > 0 ? parentTf0.contentSize.width : 0);

        const hasCurrency = currencyIndex >= 0 && currencyIndex < this.currencySprites.length;
        const formatted   = this._formatNumber(value, minDecimals);

        // ── Xây danh sách SpriteFrame theo thứ tự hiển thị ──────────────
        const frames: SpriteFrame[] = [];

        if (hasCurrency && this.currencyPosition === CurrencyPosition.START) {
            frames.push(this.currencySprites[currencyIndex]);
        }

        for (const ch of formatted) {
            if (ch >= '0' && ch <= '9') {
                const frame = this.numberSprites[+ch];
                if (frame) frames.push(frame);
            } else if (ch === '.') {
                if (this.dotSprite) frames.push(this.dotSprite);
            } else if (ch === ',') {
                if (this.commaSprite) frames.push(this.commaSprite);
            }
        }

        if (hasCurrency && this.currencyPosition === CurrencyPosition.END) {
            frames.push(this.currencySprites[currencyIndex]);
        }

        if (frames.length === 0) return;

        // ── Pass 1: Tính tổng width để căn giữa ──────────────────────────
        let totalWidth = 0;
        let maxHeight  = 0;
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            totalWidth += frame.originalSize.width;
            maxHeight = Math.max(maxHeight, frame.originalSize.height);
            if (i < frames.length - 1) {
                const isPunct     = frame === this.dotSprite || frame === this.commaSprite;
                const isNextPunct = frames[i + 1] === this.dotSprite || frames[i + 1] === this.commaSprite;
                totalWidth += (isPunct || isNextPunct)
                    ? this.spacing + this.punctuationSpacingOffset
                    : this.spacing;
            }
        }

        // ── Pass 2: Spawn/reuse node, đặt vị trí thủ công ────────────────
        // Bắt đầu từ -totalWidth/2 để căn giữa quanh pivot của parent node
        let cursorX = -totalWidth / 2;
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const w = frame.originalSize.width;

            const node   = this._acquireNode();
            const sprite = node.getComponent(Sprite)!;
            sprite.spriteFrame = frame;

            const tf = node.getComponent(UITransform)!;
            tf.setContentSize(frame.originalSize);

            // Anchor mặc định (0.5, 0.5) → đặt vị trí tại tâm node
            node.setPosition(cursorX + w / 2, 0, 0);

            // Tính gap sang node tiếp theo
            if (i < frames.length - 1) {
                const isPunct     = frame === this.dotSprite || frame === this.commaSprite;
                const isNextPunct = frames[i + 1] === this.dotSprite || frames[i + 1] === this.commaSprite;
                const gap = (isPunct || isNextPunct)
                    ? this.spacing + this.punctuationSpacingOffset
                    : this.spacing;
                cursorX += w + gap;
            }

            this.node.addChild(node);
            this._activeNodes.push(node);
        }

        // Cập nhật kích thước UITransform của parent node
        if (this._lockedWidth > 0) {
            // Width đã khoá — chỉ cập nhật vị trí sprite, bỏ qua contentSize & scale
        } else {
            const parentTf = this.node.getComponent(UITransform);
            if (parentTf) parentTf.setContentSize(totalWidth, maxHeight);
            // Scale để vừa maxWidth nếu cần — áp dụng trên cơ sở initial scale
            if (effectiveMaxWidth > 0 && totalWidth > effectiveMaxWidth) {
                const maxWidthScale = effectiveMaxWidth / totalWidth;
                const finalScale = this._initialScale * maxWidthScale;
                this._effectiveScale = finalScale;
                this.node.setScale(finalScale, finalScale, 1);
            } else {
                // Không cần maxWidth scaling — giữ initial scale, không ghi đè
                this._effectiveScale = this._initialScale;
                this.node.setScale(this._initialScale, this._initialScale, 1);
            }
        }

        // Kích hoạt hiệu ứng giật nếu đủ điều kiện
        if (this.joltEnabled) {
            const now = Date.now();
            const interval = this._getRandomJoltInterval();
            if (now - this._lastJoltTime >= interval * 1000) {
                this._lastJoltTime = now;
                this.playJolt();
            }
        }
    }

    /**     * Random thời gian giật giữa joltIntervalMin và joltIntervalMax.
     */
    private _getRandomJoltInterval(): number {
        return this.joltIntervalMin + Math.random() * (this.joltIntervalMax - this.joltIntervalMin);
    }

    /**     * Phát hiệu ứng giật nhún một lần.
     * Có thể gọi thủ công từ script khác bất cứ lúc nào.
     * Hiệu ứng: phình nhanh lên đỉnh → nẩy đàn hồi về trạng thái ban đầu.
     */
    public playJolt(): void {
        this._stopJolt();
        const es   = this._effectiveScale;
        const peak = es * this.joltScale;
        const rise = this.joltDuration * 0.35;
        const fall = this.joltDuration * 0.65;
        const origPos = this.node.position.clone();
        const peakPos = new Vec3(origPos.x, origPos.y + this.joltOffsetY, origPos.z);
        this._joltTween = tween(this.node)
            .to(rise, { scale: new Vec3(peak, peak, 1), position: peakPos }, { easing: 'backOut' })
            .to(fall, { scale: new Vec3(es,   es,   1), position: origPos }, { easing: 'elasticOut' })
            .call(() => { this._joltTween = null; })
            .start();
    }

    /**
     * Định dạng số thành chuỗi có dấu phân cách hàng nghìn.
     * Nhất quán với FormatUtils.formatCurrency nhưng không thêm ký hiệu tiền tệ.
     *   1234567   → "1,234,567"
     *   1234.5    → "1,234.50"
     *   0.1       → "0.10"
     */
    private _formatNumber(value: number, minDecimals: number = 0): string {
        const isInteger = Number.isInteger(value) || Math.abs(value - Math.round(value)) < 0.005;
        // Khi đang count-up: số nguyên vẫn hiển thị .00
        if (isInteger && minDecimals <= 0 && !this._isCounting) {
            return Math.round(value).toLocaleString('en-US');
        }
        const decimals = Math.max(minDecimals, isInteger ? (this._isCounting ? 2 : 0) : 2);
        const fixed = value.toFixed(decimals);
        const [intPart, decPart] = fixed.split('.');
        const formattedInt = parseInt(intPart, 10).toLocaleString('en-US');
        return decPart ? `${formattedInt}.${decPart}` : formattedInt;
    }

    /**
     * Tính totalWidth và maxHeight cho một giá trị mà không render.
     * Dùng bởi lockWidth() để pre-compute kích thước container.
     */
    private _computeSize(value: number, currencyIndex: number, minDecimals: number): { totalWidth: number; maxHeight: number } {
        const hasCurrency = currencyIndex >= 0 && currencyIndex < this.currencySprites.length;
        const formatted   = this._formatNumber(value, minDecimals);
        const frames: SpriteFrame[] = [];
        if (hasCurrency && this.currencyPosition === CurrencyPosition.START)
            frames.push(this.currencySprites[currencyIndex]);
        for (const ch of formatted) {
            if (ch >= '0' && ch <= '9') {
                const frame = this.numberSprites[+ch];
                if (frame) frames.push(frame);
            } else if (ch === '.') {
                if (this.dotSprite) frames.push(this.dotSprite);
            } else if (ch === ',') {
                if (this.commaSprite) frames.push(this.commaSprite);
            }
        }
        if (hasCurrency && this.currencyPosition === CurrencyPosition.END)
            frames.push(this.currencySprites[currencyIndex]);
        let totalWidth = 0, maxHeight = 0;
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            totalWidth += frame.originalSize.width;
            maxHeight = Math.max(maxHeight, frame.originalSize.height);
            if (i < frames.length - 1) {
                const isPunct     = frame === this.dotSprite || frame === this.commaSprite;
                const isNextPunct = frames[i + 1] === this.dotSprite || frames[i + 1] === this.commaSprite;
                totalWidth += (isPunct || isNextPunct)
                    ? this.spacing + this.punctuationSpacingOffset
                    : this.spacing;
            }
        }
        return { totalWidth, maxHeight };
    }

    /** Dừng tween giật đang chạy và đặt lại scale về trạng thái hiệu dụng. */
    private _stopJolt(): void {
        if (this._joltTween) {
            this._joltTween.stop();
            this._joltTween = null;
            const es = this._effectiveScale;
            this.node.setScale(es, es, 1);
        }
    }

    /**
     * Đưa tất cả node đang hiển thị về pool — KHÔNG destroy.
     * Đây là điểm mấu chốt giúp tránh GC khi cập nhật điểm số liên tục.
     */
    private _recycleAll(): void {
        for (const node of this._activeNodes) {
            node.removeFromParent();
            this._pool.put(node);
        }
        this._activeNodes.length = 0;
    }

    /**
     * Lấy node từ pool nếu có, ngược lại tạo node mới.
     * Node mới chỉ được tạo khi pool chưa có node sẵn (thường chỉ vài lần đầu).
     */
    private _acquireNode(): Node {
        let node = this._pool.get();
        if (!node) {
            node = new Node('digit');
            // Sprite extends Renderable2D có @requireComponent(UITransform):
            // engine tự động thêm UITransform khi addComponent(Sprite) được gọi.
            // Tuyệt đối KHÔNG gọi addComponent(UITransform) thủ công — sẽ crash.
            const sprite = node.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        }
        // Node từ pool đã có đủ cả Sprite lẫn UITransform từ lần tạo trước → dùng thẳng.
        return node;
    }
}

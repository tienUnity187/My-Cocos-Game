/**
 * ReelController - Điều khiển 1 reel (1 cột slot machine).
 *
 * ── THIẾT KẾ: PER-NODE SCROLL ──
 *
 *   Mỗi node có Y riêng, được track trong _nodeY[].
 *   Mỗi frame (SPINNING): tất cả di chuyển xuống cùng tốc độ (spinSpeed * dt).
 *   Khi 1 node đi quá đáy (bottomEdge) → wrap riêng node đó lên đỉnh + đổi symbol.
 *   → Cuộn xuống mượt, không jitter, không jump toàn bộ.
 *
 *   Khi dừng (DECELERATING): gán đúng 5 symbol kết quả, đặt trên viewport,
 *   cubicOut scroll xuống về đúng rest positions.
 *
 * ── NODE LAYOUT ──
 *   [0] ExtraTop2  (buffer)  Y cao nhất
 *   [1] ExtraTop1  (buffer)
 *   [2] Top        (visible — row 0)
 *   [3] Mid        (visible — payline center)
 *   [4] Bot        (visible — row 2)
 *   [5] ExtraBot1  (buffer)
 *   [6] ExtraBot2  (buffer)  Y thấp nhất
 *
 *   Nodes 0,1,5,6 nằm ngoài Mask → invisible, dùng làm buffer khi wrap.
 *
 * ── SPIN FLOW ──
 *   startSpin()    → LAUNCHING: bounce up → SPINNING
 *   SPINNING       → update() cuộn tất cả nodes xuống, wrap từng node riêng
 *   stopAt(idx)    → delay → DECELERATING: gán symbols, cubicOut về rest
 *   _finishDecel() → snap rest + bounce nhỏ → IDLE → onStopComplete()
 */

import { _decorator, Component, Node, tween, Vec3, Tween } from 'cc';
import { GameData } from '../data/GameData';

const { ccclass, property } = _decorator;

enum ReelState { IDLE, LAUNCHING, SPINNING, DECELERATING }

@ccclass('ReelController')
export class ReelController extends Component {

    @property({
        type: [Node],
        tooltip: '7 Node symbol TOP→BOT:\n[0]=ExtraTop2 [1]=ExtraTop1 [2]=Top [3]=Mid [4]=Bot [5]=ExtraBot1 [6]=ExtraBot2',
    })
    symbolNodes: Node[] = [];

    @property({ tooltip: 'Index của reel (0, 1, 2)' })
    reelIndex: number = 0;

    @property({ tooltip: 'Khoảng cách Y giữa tâm các symbol (pixels)' })
    symbolHeight: number = 150;

    @property({ tooltip: 'Tốc độ cuộn xuống khi spin (pixels/sec)' })
    spinSpeed: number = 1500;

    @property({ tooltip: 'Delay trước khi giảm tốc (giây). Set bởi SlotMachineController.' })
    stopDelay: number = 0;

    @property({ tooltip: 'Thời gian quay tối thiểu (giây)' })
    minSpinDuration: number = 0.8;

    @property({ tooltip: 'Thời gian giảm tốc khi dừng (giây)' })
    decelDuration: number = 0.45;

    @property({ tooltip: 'Khoảng cách từ đích (pixels) để bắt đầu spine effect sớm — 0 = chờ snap hẳn' })
    spineTriggerDistance: number = 120;

    @property({ tooltip: 'Delay thêm cho Long Spin (giây)' })
    longSpinDelay: number = 0;

    @property({ tooltip: 'Tốc độ cuộn khi Long Spin (pixels/sec). 0 = dùng spinSpeed mặc định' })
    longSpinSpeed: number = 0;

    @property({ tooltip: 'Auto-layout 5 nodes từ Mid (node[2])' })
    autoLayoutSymbols: boolean = false;

    /** Bỏ qua bounce lên khi bắt đầu spin (dùng cho Turbo). Set bởi SlotMachineController. */
    skipLaunchBounce: boolean = false;

    // ─── CALLBACK ───
    onStopComplete: (() => void) | null = null;
    /** Gọi ngay khi snap về rest (trước bounce) — dùng để bật spine effect tức thì tại điểm dừng */
    onSnapComplete: (() => void) | null = null;

    // ─── INTERNAL ───
    private _state: ReelState = ReelState.IDLE;
    private _restPositions: Vec3[] = [];    // rest positions gốc (từ editor/auto-layout)
    private _nodeY: number[] = [];          // Y hiện tại của mỗi node (owned by scroll system)
    private _topEdge: number = 0;           // Y cao nhất node có thể (ExtraTop rest + 0.5h)
    private _bottomEdge: number = 0;        // Y thấp nhất (ExtraBot rest - 0.5h) → wrap trigger
    private _totalSpan: number = 0;         // 5 * symbolHeight — wrap distance
    private _logPrefix: string = '';
    private _spinStartTime: number = 0;
    private _pendingStop: { centerIndex: number; longSpin: boolean } | null = null;
    private _isLongSpin: boolean = false;

    // Deceleration state
    private _decelStartY: number[] = [];    // Y start cho mỗi node khi bắt đầu decel
    private _decelTargetY: number[] = [];   // Y target  = restPositions
    private _decelElapsed: number = 0;
    private _snapFired: boolean = false;    // đã fire onSnapComplete trong decel này chưa

    // ─── LIFECYCLE ───

    private get _strip(): number[] {
        const data = GameData.instance;
        // Dùng FreeSpinReel.Strips khi đang trong Free Spin — Rands từ server index vào đúng strips
        const isFreeSpin = data.freeSpinRemaining > 0;
        const strips = isFreeSpin ? data.config.freeSpinReelStrips : data.config.reelStrips;
        return strips[this.reelIndex] ?? data.config.reelStrips[this.reelIndex] ?? [];
    }

    onLoad(): void {
        this._logPrefix = `[Reel ${this.reelIndex}]`;

        // Auto-layout: node[3] = Mid giữ Y, các node khác cách đều
        if (this.autoLayoutSymbols && this.symbolNodes.length === 7) {
            const midPos = this.symbolNodes[3].position;
            const offsets = [3, 2, 1, 0, -1, -2, -3]; // ExtraTop2 cao nhất → ExtraBot2 thấp nhất
            for (let i = 0; i < 7; i++) {
                this.symbolNodes[i].setPosition(midPos.x, midPos.y + offsets[i] * this.symbolHeight, midPos.z);
            }
        }

        // Snapshot rest positions
        this._restPositions = this.symbolNodes.map(n => n.position.clone());
        this._nodeY = this._restPositions.map(p => p.y);

        // Auto-detect symbolHeight
        if (this._restPositions.length >= 4) {
            const gap1 = Math.abs(this._restPositions[1].y - this._restPositions[2].y);
            const gap2 = Math.abs(this._restPositions[2].y - this._restPositions[3].y);
            const avg  = (gap1 + gap2) / 2;
            if (avg > 1 && Math.abs(avg - this.symbolHeight) > 1) {
                console.warn(`${this._logPrefix} symbolHeight=${this.symbolHeight} → detected=${avg.toFixed(0)}, auto-correcting`);
                this.symbolHeight = avg;
            }
        }

        // Compute edges
        // ExtraTop = highest Y, ExtraBot = lowest Y
        const ys = this._restPositions.map(p => p.y);
        this._topEdge = Math.max(...ys) + this.symbolHeight * 0.5;
        this._bottomEdge = Math.min(...ys) - this.symbolHeight * 0.5;
        this._totalSpan = this.symbolNodes.length * this.symbolHeight; // 5h

        console.log(`${this._logPrefix} h=${this.symbolHeight} restY=[${ys.map(y=>y.toFixed(0))}] top=${this._topEdge.toFixed(0)} bot=${this._bottomEdge.toFixed(0)}`);
    }

    // ─── UPDATE ───

    update(dt: number): void {
        if (this._state === ReelState.SPINNING) {
            const speed = (this._isLongSpin && this.longSpinSpeed > 0) ? this.longSpinSpeed : this.spinSpeed;
            this._scrollDown(speed * dt);
        } else if (this._state === ReelState.DECELERATING) {
            this._updateDecel(dt);
        }
    }

    // ─── PUBLIC API ───

    startSpin(): void {
        if (this._state !== ReelState.IDLE) return;
        this._state = ReelState.LAUNCHING;

        // Kill tweens, snap to rest
        for (let i = 0; i < this.symbolNodes.length; i++) {
            Tween.stopAllByTarget(this.symbolNodes[i]);
            this.symbolNodes[i].setPosition(this._restPositions[i]);
            this._nodeY[i] = this._restPositions[i].y;
        }

        for (const n of this.symbolNodes) n.emit('spin-start');

        if (this.skipLaunchBounce) {
            this._state = ReelState.SPINNING;
            this._spinStartTime = Date.now();
            for (const n of this.symbolNodes) n.emit('spin-fast');
            if (this._pendingStop) {
                // Kết quả đã có sẵn → dùng _scheduleStop để minSpinDuration được tôn trọng
                // (Turbo có minSpinDuration=0 nên vẫn decel ngay; QUICK sẽ chờ đủ thời gian)
                const ps = this._pendingStop;
                this._pendingStop = null;
                this._scheduleStop(ps.centerIndex, ps.longSpin);
            }
            // (nếu chưa có kết quả → cuộn, stopAt() sẽ gọi _scheduleStop khi đến)
            return;
        }

        // Bounce up then start spinning
        const bounceH = this.symbolHeight * 0.3;
        let done = 0;
        for (let i = 0; i < this.symbolNodes.length; i++) {
            const node = this.symbolNodes[i];
            const rest = this._restPositions[i];
            tween(node)
                .to(0.12, { position: new Vec3(rest.x, rest.y + bounceH, rest.z) }, { easing: 'sineOut' })
                .to(0.08, { position: rest.clone() }, { easing: 'sineIn' })
                .call(() => {
                    if (++done >= this.symbolNodes.length) {
                        // Sync _nodeY sau bounce
                        for (let j = 0; j < this.symbolNodes.length; j++) {
                            this._nodeY[j] = this._restPositions[j].y;
                        }
                        this._state = ReelState.SPINNING;
                        this._spinStartTime = Date.now();
                        for (const n of this.symbolNodes) n.emit('spin-fast');
                        if (this._pendingStop) {
                            const ps = this._pendingStop;
                            this._pendingStop = null;
                            this._scheduleStop(ps.centerIndex, ps.longSpin);
                        }
                    }
                })
                .start();
        }
    }

    stopAt(centerIndex: number, longSpin: boolean = false): void {
        if (this._state === ReelState.IDLE || this._state === ReelState.LAUNCHING) {
            this._pendingStop = { centerIndex, longSpin };
            return;
        }
        if (this._state !== ReelState.SPINNING) return;
        this._scheduleStop(centerIndex, longSpin);
    }

    setSymbols(centerIndex: number): void {
        const syms = this._getSymbols7(centerIndex);
        for (let i = 0; i < this.symbolNodes.length && i < syms.length; i++) {
            this.symbolNodes[i].setPosition(this._restPositions[i]);
            this._nodeY[i] = this._restPositions[i].y;
            this.symbolNodes[i].emit('spin-stop');
            this.symbolNodes[i].emit('symbol-changed', syms[i]);
        }
    }

    get isIdle(): boolean { return this._state === ReelState.IDLE; }

    /** Trả về rest position gốc của node theo index (dùng cho bounce hint). */
    getRestPosition(nodeIndex: number): Vec3 {
        return this._restPositions[nodeIndex]?.clone() ?? Vec3.ZERO.clone();
    }

    // ─── SPINNING: cuộn xuống liên tục ──────────────────────────────────────

    /**
     * Di chuyển TẤT CẢ nodes xuống delta pixels.
     * Node nào rơi dưới bottomEdge → wrap lên topEdge + gán random symbol mới.
     *
     * Mỗi node wrap RIÊNG → chỉ 1 node nhảy lên đầu mỗi lần, không jitter toàn bộ.
     */
    private _scrollDown(delta: number): void {
        const stripLen = this._strip.length;

        for (let i = 0; i < this.symbolNodes.length; i++) {
            this._nodeY[i] -= delta;  // di chuyển xuống

            // Wrap: node xuống quá bottom → nhảy lên top
            while (this._nodeY[i] < this._bottomEdge) {
                this._nodeY[i] += this._totalSpan;

                // Random symbol khi wrap (tạo cảm giác slot machine)
                if (stripLen > 0) {
                    const randIdx = Math.floor(Math.random() * stripLen);
                    const symId = this._strip[randIdx];
                    this.symbolNodes[i].emit('symbol-changed', symId);
                }
            }

            this.symbolNodes[i].setPosition(this._restPositions[i].x, this._nodeY[i], 0);
        }
    }

    // ─── STOP / DECELERATE ──────────────────────────────────────────────────

    private _scheduleStop(centerIndex: number, longSpin: boolean): void {
        const elapsed   = (Date.now() - this._spinStartTime) / 1000;
        const minWait   = Math.max(0, this.minSpinDuration - elapsed);
        const longExtra = longSpin ? this.longSpinDelay : 0;
        const delay     = this.stopDelay + minWait + longExtra;

        // ★ LONG SPIN: Ngay khi stopAt gọi, emit 'spin-stop' để signal SymbolView stop blur
        // Symbol vẫn tiếp tục quay (vật lý), nhưng hiển thị normal sprite thay vì blur.
        if (longSpin) {
            this._isLongSpin = true;
            for (const n of this.symbolNodes) n.emit('spin-stop');
        }

        if (delay <= 0 && this.skipLaunchBounce) {
            // Turbo: decel ngay trong frame này, không qua scheduleOnce
            this._beginDecel(centerIndex);
        } else {
            this.scheduleOnce(() => this._beginDecel(centerIndex), delay);
        }
    }

    /**
     * Bắt đầu decelerate: gán đúng 5 symbols kết quả, đặt TRÊN viewport,
     * rồi cubicOut cuộn xuống về rest positions.
     *
     * Đây là lúc DUY NHẤT force-swap symbols — vì nodes đang ngoài viewport
     * (trên mask) nên người chơi không thấy sự thay đổi.
     */
    private _beginDecel(centerIndex: number): void {
        if (this._state !== ReelState.SPINNING) return;

        for (const n of this.symbolNodes) n.emit('spin-stop');
        this._isLongSpin = false;

        // Lấy 7 symbols: [ExtraTop2, ExtraTop1, Top, Mid, Bot, ExtraBot1, ExtraBot2]
        const syms = this._getSymbols7(centerIndex);

        // Đặt tất cả nodes TRÊN viewport (trên mask, invisible)
        // Mỗi node cách restPos thêm dropOffset pixels lên trên
        const dropOffset = this.symbolHeight * 3; // đủ cao để ngoài mask

        this._decelStartY = [];
        this._decelTargetY = [];

        for (let i = 0; i < this.symbolNodes.length; i++) {
            const startY = this._restPositions[i].y + dropOffset;
            this._decelStartY.push(startY);
            this._decelTargetY.push(this._restPositions[i].y);
            this._nodeY[i] = startY;
            this.symbolNodes[i].setPosition(this._restPositions[i].x, startY, 0);
            this.symbolNodes[i].emit('symbol-changed', syms[i]);
        }

        this._decelElapsed = 0;
        this._snapFired = false;
        this._state = ReelState.DECELERATING;

        // Log
        const SN = ['7','77','777','BAR','BB','3X','BNS','R⚡','B⚡'];
        const fmt = (id: number) => id < 0 ? '___' : (SN[id] ?? `?${id}`);
        console.log(`${this._logPrefix} decel center=${centerIndex} → [${syms.map(fmt)}]`);
    }

    /**
     * cubicOut ease từ startY → targetY cho mỗi node.
     * Tất cả nodes ease cùng nhau → giữ đúng khoảng cách symbolHeight.
     */
    private _updateDecel(dt: number): void {
        this._decelElapsed += dt;
        const t = Math.min(this._decelElapsed / this.decelDuration, 1);
        const eased = 1 - Math.pow(1 - t, 3); // cubicOut

        for (let i = 0; i < this.symbolNodes.length; i++) {
            const y = this._decelStartY[i] + (this._decelTargetY[i] - this._decelStartY[i]) * eased;
            this._nodeY[i] = y;
            this.symbolNodes[i].setPosition(this._restPositions[i].x, y, 0);
        }

        // Kích hoạt spine sớm khi node trung tâm (Mid) đủ gần đích
        if (!this._snapFired && this.spineTriggerDistance > 0) {
            const midRemaining = Math.abs(this._nodeY[3] - this._decelTargetY[3]);
            if (midRemaining <= this.spineTriggerDistance) {
                this._snapFired = true;
                this.onSnapComplete?.();
            }
        }

        if (t >= 1) this._finishDecel();
    }

    private _finishDecel(): void {
        // Snap chính xác
        for (let i = 0; i < this.symbolNodes.length; i++) {
            this.symbolNodes[i].setPosition(this._restPositions[i]);
            this._nodeY[i] = this._restPositions[i].y;
        }

        this._state = ReelState.IDLE;

        // Nếu spineTriggerDistance = 0 (disabled), fire onSnapComplete tại đây
        if (!this._snapFired) {
            this._snapFired = true;
            this.onSnapComplete?.();
        }

        // Bounce nhỏ
        const oh = this.symbolHeight * 0.08;
        let done = 0;
        for (let i = 0; i < this.symbolNodes.length; i++) {
            const node = this.symbolNodes[i];
            const rest = this._restPositions[i];
            tween(node)
                .to(0.08, { position: new Vec3(rest.x, rest.y - oh, 0) }, { easing: 'sineOut' })
                .to(0.12, { position: rest.clone() },                       { easing: 'backOut' })
                .call(() => { if (++done >= this.symbolNodes.length) this.onStopComplete?.(); })
                .start();
        }
    }

    // ─── HELPERS ─────────────────────────────────────────────────────────────

    /**
     * 7 symbol IDs quanh centerIndex trên strip:
     *   [center-3, center-2, center-1, center, center+1, center+2, center+3]
     *   → map vào [ExtraTop2, ExtraTop1, Top, Mid, Bot, ExtraBot1, ExtraBot2]
     */
    private _getSymbols7(centerIndex: number): number[] {
        const L = this._strip.length;
        if (L === 0) return [0, 0, 0, 0, 0, 0, 0];
        const c = ((centerIndex % L) + L) % L;
        const result: number[] = [];
        for (let off = -3; off <= 3; off++) {
            result.push(this._strip[((c + off) % L + L) % L]);
        }
        return result;
    }
}



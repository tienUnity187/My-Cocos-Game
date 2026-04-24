/**
 * SymbolHighlighter — Highlight symbol thắng bằng fillBlack overlay per reel.
 *
 * Thay vì vẽ đường payline, component này dim các symbol KHÔNG thắng bằng cách:
 *   1. Mỗi reel có 1 node "fillBlack" (màu đen, mặc định alpha=0, nằm NGOÀI reel parent).
 *   2. Sau khi reel dừng và có kết quả:
 *      - Reparent fillBlack VÀO cùng parent với symbolNodes[1..3].
 *      - setSiblingIndex để:  non-winning → fillBlack (alpha=0.7) → winning symbols
 *      - Winning symbols nằm TRÊN fillBlack → nổi bật.
 *      - Non-winning symbols nằm DƯỚI fillBlack → bị tối.
 *   3. Khi spin mới bắt đầu: reset fillBlack alpha về 0.
 *
 * ── SETUP TRONG EDITOR ──
 *   1. Gắn SymbolHighlighter vào 1 Node nào đó (ví dụ cùng node với SlotMachineController).
 *   2. Kéo 3 ReelController vào mảng "reels" (col 0, 1, 2).
 *   3. Tạo 3 node "FillBlack_Reel0/1/2" (Sprite màu đen, kích thước lớn hơn hoặc bằng 1 reel):
 *      - Đặt ở bất kỳ đâu trên Canvas (KHÔNG ở trong reel parent).
 *      - Thêm UIOpacity component, opacity = 0.
 *      - Kéo 3 node đó vào mảng "fillBlackNodes" theo đúng thứ tự reel.
 *
 * ── NODE LAYOUT ReelController ──
 *   symbolNodes[0] = ExtraTop2  (buffer/clip)
 *   symbolNodes[1] = ExtraTop1  (buffer/clip)
 *   symbolNodes[2] = Top        (row 0, visible)
 *   symbolNodes[3] = Mid        (row 1, visible)
 *   symbolNodes[4] = Bot        (row 2, visible)
 *   symbolNodes[5] = ExtraBot1  (buffer/clip)
 *   symbolNodes[6] = ExtraBot2  (buffer/clip)
 *
 *   Tất cả là con của cùng 1 parent (reel scroll container).
 *
 * ── SIBLING ORDER SAU KHI ÁP DỤNG ──
 *   [idx 0] ExtraTop2 (giữ nguyên, dưới fillBlack)
 *   [idx 1] ExtraTop1 (giữ nguyên, dưới fillBlack)
 *   [idx 2..] non-winning visible symbols
 *   [idx ..] ExtraBot1 (đặt tường minh dưới fillBlack — tránh highlight ngoài mask)
 *   [idx ..] ExtraBot2 (đặt tường minh dưới fillBlack — tránh highlight ngoài mask)
 *   [idx ..] fillBlack (alpha ≈ 179 = 0.7 × 255)
 *   [idx ..] winning visible symbols (nổi bật trên fillBlack)
 */

import { _decorator, Component, Node, UIOpacity, tween, Tween, Vec3, sp, instantiate } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { GameData } from '../data/GameData';
import { MatchedLinePay } from '../data/SlotTypes';
import { ReelController } from './ReelController';
import { PaylineIndicatorManager } from './PaylineIndicatorManager';
import { SymbolView } from './SymbolView';

const { ccclass, property } = _decorator;

/** Dữ liệu theo dõi 1 spine node đang active (pool hoặc clone) */
interface ActiveSpineEntry {
    spineNode:    Node;
    skel:         sp.Skeleton | null;
    view:         SymbolView  | null;
    isClone:      boolean;
    poolIdx:      number;              // symId (pool node), -1 nếu là clone
    symbolNode:   Node;               // node cần lắng nghe 'symbol-changed'
    _onSymChanged: (() => void) | null; // bound listener để off() sau
}

interface CellPos { col: number; row: number; }

@ccclass('SymbolHighlighter')
export class SymbolHighlighter extends Component {

    // ── EDITOR PROPERTIES ────────────────────────────────────────────────────

    @property({
        type: [ReelController],
        tooltip: '3 ReelController theo thứ tự cột 0, 1, 2',
    })
    reels: ReelController[] = [];

    @property({
        type: [Node],
        tooltip: '3 fillBlack nodes — 1 per reel.\n'
               + 'Đặt NGOÀI reel parent ban đầu (ví dụ con của Canvas).\n'
               + 'Mỗi node cần UIOpacity component, opacity = 0 ban đầu.',
    })
    fillBlackNodes: Node[] = [];

    @property({ tooltip: 'Opacity của fillBlack khi active (0–255). 0.7 × 255 ≈ 179' })
    fillAlpha: number = 179;

    @property({ tooltip: 'Thời gian fade IN fillBlack (giây)' })
    fadeDuration: number = 0.15;

    @property({ tooltip: 'Scale zoom symbol thắng (1 = không zoom)' })
    cellZoomScale: number = 1.15;

    @property({ tooltip: 'Thời gian mỗi nhịp zoom in/out (giây)' })
    cellZoomDuration: number = 0.18;

    @property({ type: PaylineIndicatorManager, tooltip: 'PaylineIndicatorManager để highlight ô số đường thắng' })
    paylineIndicator: PaylineIndicatorManager | null = null;

    @property({
        type: [Node],
        tooltip: 'Pool 9 Spine effect nodes, index = SymbolId (0-8).\n'
               + 'Mỗi node có sp.Skeleton đúng SkeletonData, inactive mặc định.\n'
               + 'Dùng chung cho tất cả cell, reparent vào symbol node khi win.\n'
               + '[0]=7  [1]=77  [2]=777  [3]=BAR  [4]=BARBAR  [5]=3X Wild  [6]=Bonus  [7]=Red  [8]=Blue',
    })
    spineEffectNodes: Node[] = [];

    @property({
        type: [Number],
        tooltip: 'Local position X cho mỗi spine effect node, index = SymbolId (0-8).\n'
               + 'Y mặc định = 0, chỉ cần thiết lập X.\n'
               + '[0]=7  [1]=77  [2]=777  [3]=BAR  [4]=BARBAR  [5]=3X Wild  [6]=Bonus  [7]=Red  [8]=Blue',
    })
    spineLocalPosX: number[] = [];

    @property({ tooltip: 'Tên animation Spine phát khi highlight (default: "animation")' })
    spineAnimName: string = 'animation';

    @property({ tooltip: 'Thời gian 1 vòng animation spine ở timeScale=1 (giây)' })
    spineAnimDuration: number = 1.0;

    @property({ tooltip: 'Thời gian "show all" highlight — phải khớp WinPresenter.spinEnableDelay (giây)' })
    showAllHighlightDuration: number = 1.0;

    @property({ tooltip: 'Thời gian mỗi chu kỳ line cycling — phải khớp WinPresenter.lineCycleDuration (giây)' })
    lineCycleHighlightDuration: number = 2.0;

    // ── INTERNAL STATE ────────────────────────────────────────────────────────

    private _zoomedNodes: Node[] = [];
    /** Parent gốc của mỗi spine pool node trước khi reparent */
    private _origSpineParents: (Node | null)[] = [];
    /** Tất cả spine đang active, mỗi entry tự quản lý lifecycle qua setCompleteListener */
    private _activeSpines: ActiveSpineEntry[] = [];    /** Entries đã deactivate spine nhưng vẫn chờ 'symbol-changed' để restore sprite */
    private _pendingListeners: ActiveSpineEntry[] = [];    /** Tăng mỗi lần highlight cycle mới — callback cũ sẽ tự bỏ qua nếu gen lệch */
    private _spineGen: number = 0;
    /** Đang chờ tất cả spine từ "show all" hoàn tất để emit WIN_HIGHLIGHT_ANIM_DONE */
    private _watchingHighlightDone: boolean = false;

    /** Parent gốc của mỗi fillBlack node (trước khi reparent) */
    private _origFillBlackParents: (Node | null)[] = [];
    /** Sibling index gốc của mỗi fillBlack node */
    private _origFillBlackSiblings: number[] = [];
    /** Cells của lần jackpot reveal gần nhất — dùng để loop highlight sau popup */
    private _jackpotCells: CellPos[] = [];
    /** Callback schedule lặp highlight jackpot */
    private _jackpotCycleCallback: (() => void) | null = null;
    /** Sibling index gốc của từng symbolNode per reel: [col][nodeIdx 0-4] */
    private _origSymbolSiblings: number[][] = [];

    // ── LIFECYCLE ────────────────────────────────────────────────────────────

    onLoad(): void {
        // Ghi nhớ trạng thái gốc để restore sau này
        for (let col = 0; col < 3; col++) {
            const fb = this.fillBlackNodes[col] ?? null;
            this._origFillBlackParents.push(fb?.parent ?? null);
            this._origFillBlackSiblings.push(fb?.getSiblingIndex() ?? 0);

            const reel = this.reels[col];
            const sibArr: number[] = [];
            if (reel) {
                for (let i = 0; i < reel.symbolNodes.length; i++) {
                    sibArr.push(reel.symbolNodes[i]?.getSiblingIndex() ?? i);
                }
            }
            this._origSymbolSiblings.push(sibArr);
        }

        // Đảm bảo tất cả fillBlack bắt đầu với opacity = 0
        for (const fb of this.fillBlackNodes) {
            if (fb) this._setOpacity(fb, 0);
        }

        // Lưu parent gốc của 9 spine pool nodes, đảm bảo tất cả inactive
        for (const sn of this.spineEffectNodes) {
            this._origSpineParents.push(sn?.parent ?? null);
            if (sn) sn.active = false;
        }

        const bus = EventBus.instance;
        bus.on(GameEvents.UI_UPDATE_WIN_LABEL, this._onLineHighlight, this);
        bus.on(GameEvents.WIN_SHOW_ALL_LINES,  this._onShowAllLines,  this);
        bus.on(GameEvents.JACKPOT_END,         this._onJackpotEndHighlight, this);
        bus.on(GameEvents.REELS_START_SPIN,    this._onReelsStartSpin, this);
        // Cập nhật highlight frame mode khi vào/thoát Feature game
        bus.on(GameEvents.FREE_SPIN_START,     this._onFeatureGameStart, this);
        bus.on(GameEvents.FREE_SPIN_END,       this._onFeatureGameEnd,   this);
        // Long spin hint: spine effect trên 2 symbol ở reel1+reel2 tương tự highlight
        bus.on(GameEvents.LONG_SPIN_HINT_SHOW,     this._onLongSpinHintShow,     this);
        // Jackpot reveal: play spine cả 3 symbol cùng lúc trước khi popup hiện (mọi loại jackpot)
        bus.on(GameEvents.LONG_SPIN_JACKPOT_REVEAL, this._onLongSpinJackpotReveal, this);
        // Bonus reveal: highlight symbol Bonus trước khi FreeSpinPopup hiện
        bus.on(GameEvents.FREE_SPIN_BONUS_REVEAL, this._onBonusReveal, this);
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
    }

    // ── EVENT HANDLERS ────────────────────────────────────────────────────────

    /** Cycling từng line một → chỉ highlight cells của line đó */
    private _onLineHighlight(linePay: MatchedLinePay): void {
        const cells = this._getWinningCells(linePay);
        this._applyHighlight(cells);
        this._zoomCells(cells);
        this._activateSpinesForCells(cells, this.lineCycleHighlightDuration);
        this.paylineIndicator?.showWinLine(linePay.payLineIndex);
    }

    /** Hiện tất cả winning lines cùng lúc → highlight union của mọi cell thắng */
    private _onShowAllLines(lines: MatchedLinePay[], duration?: number): void {
        const allCells: CellPos[] = [];
        for (const line of lines) {
            for (const c of this._getWinningCells(line)) {
                if (!allCells.some(x => x.col === c.col && x.row === c.row)) {
                    allCells.push(c);
                }
            }
        }
        // Bonus symbol (cột 2) được xử lý riêng qua FREE_SPIN_BONUS_REVEAL —
        // KHÔNG đưa vào allCells để tránh fillBlack highlight cho nó.
        this._applyHighlight(allCells);
        // Dùng duration từ WinPresenter.spinEnableDelay nếu được truyền vào,
        // fallback sang property showAllHighlightDuration nếu không
        this._activateSpinesForCells(allCells, duration ?? this.showAllHighlightDuration);
        // Không zoom khi show all — quá nhiều node sẽ trông loạn
        this.paylineIndicator?.showMultipleWinLines(lines.map(l => l.payLineIndex));

        // Theo dõi khi nào tất cả spine hoàn tất để emit WIN_HIGHLIGHT_ANIM_DONE
        if (this._activeSpines.length > 0) {
            this._watchingHighlightDone = true;
        } else {
            // Không có spine nào được kích hoạt → báo xong ngay
            EventBus.instance.emit(GameEvents.WIN_HIGHLIGHT_ANIM_DONE);
        }
    }

    /**
     * Khi reel mới bắt đầu: chỉ reset fillBlack + zoom + sibling order.
     * Không force-clear spines — spine từ longspin hint và bonus reveal phải giữ nguyên
     * cho đến khi 'symbol-changed' fire (symbol scroll ra khỏi viewport mới xóa).
     */
    private _onReelsStartSpin(): void {
        this._watchingHighlightDone = false; // hủy theo dõi nếu spin mới bắt đầu trước khi anim xong
        this._stopJackpotCycle();
        this._resetHighlights();
    }

    /** Reset về trạng thái trung tính: fillBlack alpha=0, zoom trả về defaultScale, restore sibling order */
    private _resetHighlights(): void {
        this.paylineIndicator?.resetAllIndicators();
        // Spine không bị deactivate ở đây — chỉ symbol-changed mới được restore sprite
        // Dừng zoom và reset scale về defaultScale (không hardcode 1)
        for (const n of this._zoomedNodes) {
            Tween.stopAllByTarget(n);
            const baseScale = this._getDefaultScale(n);
            n.setScale(baseScale, baseScale, 1);
        }
        this._zoomedNodes = [];

        // Restore từng reel về trạng thái gốc
        for (let col = 0; col < 3; col++) {
            const fb = this.fillBlackNodes[col];
            if (!fb) continue;

            // 1. Ẩn fillBlack ngay lập tức
            this._setOpacity(fb, 0);

            // 2. Reparent fillBlack về parent gốc (nếu đã bị reparent vào symbolParent)
            const origParent = this._origFillBlackParents[col];
            if (origParent && fb.parent !== origParent) {
                fb.setParent(origParent, true); // giữ world position
            }

            // 3. Restore sibling index gốc của fillBlack
            fb.setSiblingIndex(this._origFillBlackSiblings[col]);

            // 4. Restore sibling indices gốc của tất cả symbolNodes trong reel
            const reel = this.reels[col];
            const origSibs = this._origSymbolSiblings[col];
            if (reel && origSibs) {
                for (let i = 0; i < reel.symbolNodes.length; i++) {
                    reel.symbolNodes[i]?.setSiblingIndex(origSibs[i]);
                }
            }
        }
    }

    // ── SPINE HIGHLIGHT (Pool 9 nodes, setCompleteListener per entry) ────────

    /**
     * Hard-reset: deactivate tất cả spine và restore sprite ngay lập tức.
     * Chỉ gọi khi cần force-clean (onDestroy, hoặc reset cứng).
     * Trong gameplay bình thường: spine tự deactivate qua symbol-changed.
     */
    private _deactivateAllSpines(): void {
        this._spineGen++;
        const all = [...this._activeSpines, ...this._pendingListeners];
        this._activeSpines = [];
        this._pendingListeners = [];
        for (const entry of all) {
            if (entry._onSymChanged) {
                entry.symbolNode.off('symbol-changed', entry._onSymChanged);
                entry._onSymChanged = null;
            }
            if (entry.skel && entry.spineNode.active) entry.skel.setCompleteListener(null);
            if (entry.view) entry.view.setSpriteVisible(true);
            entry.spineNode.active = false;
            if (entry.isClone) {
                if (entry.spineNode.isValid) entry.spineNode.destroy();
            } else {
                const origParent = this._origSpineParents[entry.poolIdx];
                if (origParent && entry.spineNode.parent !== origParent) {
                    entry.spineNode.setParent(origParent, false);
                }
            }
        }
    }

    /**
     * Với mỗi winning cell:
     *   - Nếu node đã có spine active (từ lần highlight trước) → bỏ qua, giữ frame hiện tại.
     *   - Nếu chưa có → reparent spine (pool hoặc clone nếu pool đã deploy chỗ khác).
     *   - Animation xong: move sang _pendingListeners, spine GIỮ frame cuối trên node.
     *   - symbol-changed: điều kiện DUY NHẤT để deactivate spine + restore sprite.
     */
    private _activateSpinesForCells(cells: CellPos[], highlightDuration: number): void {
        // KHÔNG gọi _deactivateAllSpines — spine từ cycle trước vẫn tiếp tục giữ frame cuối

        const BUFFER     = 0.05;
        const playWindow = Math.max(highlightDuration - BUFFER, 0.1);
        const timeScale  = 1;// Math.min(Math.max(this.spineAnimDuration / playWindow, 1.0), 10);

        for (const { col, row } of cells) {
            const reel = this.reels[col];
            if (!reel) continue;
            const symbolNode = reel.symbolNodes[row + 2];
            if (!symbolNode) continue;

            // Đã có spine trên node này → play lại animation (không tạo mới)
            const existing = this._findEntryOnNode(symbolNode);
            if (existing) {
                this._replayEntry(existing, timeScale);
                continue;
            }

            const view  = symbolNode.getComponent(SymbolView);
            const symId = view?.symbolId ?? -1;
            if (symId < 0) continue;

            const poolNode = this.spineEffectNodes[symId];
            if (!poolNode) continue;

            // Ẩn sprite — spine thay thế hoàn toàn
            if (view) view.setSpriteVisible(false);

            // Pool node đã deploy ở cell khác → clone
            const isClone = this._isPoolDeployed(symId);
            let spineNode: Node;
            if (!isClone) {
                spineNode = poolNode;
            } else {
                spineNode = instantiate(poolNode);
            }

            spineNode.setParent(symbolNode, false);
            const posX = this.spineLocalPosX[symId] ?? 0;
            spineNode.setPosition(posX, 0, 0);
            spineNode.active = true;

            const skel = spineNode.getComponent(sp.Skeleton);
            const entry: ActiveSpineEntry = {
                spineNode,
                skel:         skel ?? null,
                view:         view ?? null,
                isClone,
                poolIdx:      isClone ? -1 : symId,
                symbolNode,
                _onSymChanged: null,
            };
            this._activeSpines.push(entry);

            if (skel) {
                skel.timeScale = timeScale;
                skel.clearTrack(0);
                skel.setAnimation(0, this.spineAnimName, false); // play once

                // Animation xong: clear listener, GIỮ frame cuối, chuyển sang pending
                skel.setCompleteListener(() => {
                    if (entry.skel && entry.spineNode.active) entry.skel.setCompleteListener(null);
                    const idx = this._activeSpines.indexOf(entry);
                    if (idx >= 0) this._activeSpines.splice(idx, 1);
                    if (entry._onSymChanged) this._pendingListeners.push(entry);
                    // Kiểm tra nếu đang chờ các spine "show all" hoàn tất
                    if (this._watchingHighlightDone && this._activeSpines.length === 0) {
                        this._watchingHighlightDone = false;
                        EventBus.instance.emit(GameEvents.WIN_HIGHLIGHT_ANIM_DONE);
                    }
                });
            }

            const onSymChanged = () => this._onEntrySymbolChanged(entry);
            entry._onSymChanged = onSymChanged;
            symbolNode.on('symbol-changed', onSymChanged);
        }
    }

    /** Tìm entry đang giữ spine trên symbolNode (active hoặc pending). */
    private _findEntryOnNode(symbolNode: Node): ActiveSpineEntry | null {
        return this._activeSpines.find(e => e.symbolNode === symbolNode)
            ?? this._pendingListeners.find(e => e.symbolNode === symbolNode)
            ?? null;
    }

    /**
     * Play lại animation trên entry đã có (không tạo spine mới).
     * Đưa entry về _activeSpines nếu đang ở _pendingListeners.
     */
    private _replayEntry(entry: ActiveSpineEntry, timeScale: number): void {
        const skel = entry.skel;
        if (!skel) return;

        // Đảm bảo spine vẫn active (pending entries đã bị deactivate chưa? Không nữa)
        if (!entry.spineNode.active) entry.spineNode.active = true;

        skel.timeScale = timeScale;
        skel.clearTrack(0);
        skel.setAnimation(0, this.spineAnimName, false);

        // Đặt lại setCompleteListener
        skel.setCompleteListener(() => {
            if (entry.skel && entry.spineNode.active) entry.skel.setCompleteListener(null);
            const idx = this._activeSpines.indexOf(entry);
            if (idx >= 0) this._activeSpines.splice(idx, 1);
            if (entry._onSymChanged) this._pendingListeners.push(entry);
            // Kiểm tra nếu đang chờ các spine "show all" hoàn tất
            if (this._watchingHighlightDone && this._activeSpines.length === 0) {
                this._watchingHighlightDone = false;
                EventBus.instance.emit(GameEvents.WIN_HIGHLIGHT_ANIM_DONE);
            }
        });

        // Move từ pending → active nếu cần
        const pendIdx = this._pendingListeners.indexOf(entry);
        if (pendIdx >= 0) {
            this._pendingListeners.splice(pendIdx, 1);
            this._activeSpines.push(entry);
        }
    }

    /** Pool node của symId đã được reparent sang cell nào rồi chưa? */
    private _isPoolDeployed(symId: number): boolean {
        return this._activeSpines.some(e => !e.isClone && e.poolIdx === symId)
            || this._pendingListeners.some(e => !e.isClone && e.poolIdx === symId);
    }

    /**
     * Callback từ 'symbol-changed' trên symbolNode.
     * Node đã scroll ra ngoài vùng mask và được wrap lên đầu với symbol mới.
     * Đây là điều kiện DUY NHẤT để restore sprite và deactivate spine.
     * Không có gen check — luôn thực hiện bất kể cycle hiện tại là gì.
     */
    private _onEntrySymbolChanged(entry: ActiveSpineEntry): void {
        // Gỡ listener
        if (entry._onSymChanged) {
            entry.symbolNode.off('symbol-changed', entry._onSymChanged);
            entry._onSymChanged = null;
        }
        if (entry.skel && entry.spineNode.active) entry.skel.setCompleteListener(null);

        // Restore sprite
        if (entry.view) entry.view.setSpriteVisible(true);

        // Deactivate spine nếu vẫn còn active
        if (entry.spineNode.active) {
            entry.spineNode.active = false;
            if (entry.isClone) {
                if (entry.spineNode.isValid) entry.spineNode.destroy();
            } else {
                const origParent = this._origSpineParents[entry.poolIdx];
                if (origParent && entry.spineNode.parent !== origParent) {
                    entry.spineNode.setParent(origParent, false);
                }
            }
        }

        // Xóa khỏi cả 2 danh sách
        let idx = this._activeSpines.indexOf(entry);
        if (idx >= 0) this._activeSpines.splice(idx, 1);
        idx = this._pendingListeners.indexOf(entry);
        if (idx >= 0) this._pendingListeners.splice(idx, 1);
    }

    // ── CORE HIGHLIGHT LOGIC ─────────────────────────────────────────────────

    private _applyHighlight(winningCells: CellPos[]): void {
        for (let col = 0; col < 3; col++) {
            const reel      = this.reels[col];
            const fillBlack = this.fillBlackNodes[col];
            if (!reel || !fillBlack) continue;

            // Parent chứa tất cả symbol nodes (scroll container của reel)
            const symbolParent = reel.symbolNodes[2]?.parent;
            if (!symbolParent) continue;

            const winningRows = winningCells
                .filter(c => c.col === col)
                .map(c => c.row);

            // Reel này không có symbol nào thắng trong cycle hiện tại.
            // Không ẩn fillBlack đi — giữ nguyên alpha đang có (nếu đang hiện).
            // Chỉ ẩn khi reset toàn bộ (_resetHighlights).
            if (winningRows.length === 0) continue;

            // Reparent fillBlack vào symbolParent (chỉ reparent khi chưa ở đó)
            if (fillBlack.parent !== symbolParent) {
                fillBlack.setParent(symbolParent, true); // true = giữ nguyên world position
            }

            // Visible symbol nodes: index 2=row0(Top), 3=row1(Mid), 4=row2(Bot)
            const rowNodes: Node[] = [
                reel.symbolNodes[2],
                reel.symbolNodes[3],
                reel.symbolNodes[4],
            ];

            const nonWinningNodes = ([0, 1, 2] as const)
                .filter(r => !winningRows.includes(r))
                .map(r => rowNodes[r])
                .filter((n): n is Node => !!n);

            const winningNodes = winningRows
                .map(r => rowNodes[r])
                .filter((n): n is Node => !!n);

            // ── Sắp xếp sibling index ──
            // Bắt đầu từ idx=2 để tránh đụng ExtraTop2/1 (symbolNodes[0],[1]) ở idx=0,1
            // Thứ tự: non-winning → ExtraBot1/2 → fillBlack (dim) → winning (nổi bật)
            // ExtraBot1/2 phải được đặt TRƯỚC fillBlack — nếu để mặc định chúng sẽ bị
            // đẩy ra cuối (sibling index cao hơn fillBlack) và render lên trên lớp dim,
            // khiến các symbol buffer ngoài mask trông như đang được highlight.

            // ⚠ Guard: nếu winningNodes rỗng (ví dụ matchedSymbolsIndices chứa row > 2),
            // tất cả visible symbol sẽ được coi là non-winning và fillBlack sẽ ở cao nhất
            // → mọi symbol đều bị dim, không có gì sáng lên. Bỏ qua reel này để tránh.
            if (winningNodes.length === 0) {
                console.error(
                    `[SymbolHighlighter] col=${col} winningNodes=[] (winningRows=${JSON.stringify(winningRows)}) — skip fillBlack for this reel`
                );
                continue;
            }

            console.error(
                `[SymbolHighlighter] col=${col} winningRows=${JSON.stringify(winningRows)}` +
                ` nonWin=${nonWinningNodes.length} win=${winningNodes.length}`
            );

            let idx = 2;
            for (const n of nonWinningNodes) {
                n.setSiblingIndex(idx++);
            }
            // Đặt tường minh ExtraBot1/2 dưới fillBlack
            const extraBot1 = reel.symbolNodes[5];
            const extraBot2 = reel.symbolNodes[6];
            if (extraBot1) extraBot1.setSiblingIndex(idx++);
            if (extraBot2) extraBot2.setSiblingIndex(idx++);
            fillBlack.setSiblingIndex(idx++);
            for (const n of winningNodes) {
                n.setSiblingIndex(idx++);
            }

            // Chỉ fade in lần đầu tiên (khi alpha đang = 0).
            // Lần sau chỉ đổi sibling index — không fade lại để tránh flicker.
            const currentAlpha = this._getUIOpacity(fillBlack).opacity;
            if (currentAlpha < this.fillAlpha) {
                this._fadeOpacity(fillBlack, currentAlpha, this.fillAlpha, this.fadeDuration);
            }
        }
    }

    // ── ZOOM ANIMATION ────────────────────────────────────────────────────────

    private _zoomCells(cells: CellPos[]): void {
        // Dừng zoom cũ — reset về defaultScale
        for (const n of this._zoomedNodes) {
            Tween.stopAllByTarget(n);
            const baseScale = this._getDefaultScale(n);
            n.setScale(baseScale, baseScale, 1);
        }
        this._zoomedNodes = [];

        const s = this.cellZoomScale;
        const d = this.cellZoomDuration;

        for (const { col, row } of cells) {
            const reel = this.reels[col];
            if (!reel) continue;
            const node = reel.symbolNodes[row + 2] as Node | undefined;
            if (!node) continue;

            this._zoomedNodes.push(node);
            const baseScale = this._getDefaultScale(node);
            node.setScale(baseScale, baseScale, 1);
            tween(node)
                .to(d, { scale: new Vec3(s * baseScale, s * baseScale, 1) }, { easing: 'backOut' })
                .to(d, { scale: new Vec3(baseScale, baseScale, 1) }, { easing: 'sineOut' })
                .call(() => node.setScale(baseScale, baseScale, 1))
                .start();
        }
    }

    // ── FEATURE GAME MODE HANDLERS ────────────────────────────────────────────

    /** Vào Feature/Free Bonus game → cập nhật indicator highlight frame */
    private _onFeatureGameStart(): void {
        this.paylineIndicator?.setFeatureGameMode(true);
    }

    /** Thoát Feature/Free Bonus game → quay lại Base Game frame */
    private _onFeatureGameEnd(): void {
        this.paylineIndicator?.setFeatureGameMode(false);
    }

    // ── LONG SPIN HINT ────────────────────────────────────────────────────────

    /**
     * Khi 1 reel hint dừng: phát spine effect 1 lần (dừng ở frame cuối).
     * payload: [{reelIndex, rowIndex}] (luôn là 1 phần tử — emit per-reel)
     */
    private _onLongSpinHintShow(positions: { reelIndex: number; rowIndex: number }[]): void {
        const cells: CellPos[] = positions.map(p => ({ col: p.reelIndex, row: p.rowIndex }));
        if (cells.length === 0) return;
        // duration=10 → timeScale=1.0 (tốc độ animation bình thường)
        this._activateSpinesForCells(cells, 10.0);
    }

    /**
     * Jackpot xác nhận: replay spine trên 3 symbol cùng lúc.
     * Được emit cho mọi loại jackpot (long spin hoặc không) để đảm bảo spines luôn active.
     * payload: [{reel0}, {reel1}, {reel2}]
     */
    private _onLongSpinJackpotReveal(positions: { reelIndex: number; rowIndex: number }[], _jackpot?: number): void {
        const cells: CellPos[] = positions.map(p => ({ col: p.reelIndex, row: p.rowIndex }));
        // Lưu lại cells để dùng khi loop sau popup đóng
        this._jackpotCells = cells;
        if (cells.length === 0) return;
        this._applyHighlight(cells);
        this._activateSpinesForCells(cells, 10.0);
    }

    /**
     * Sau jackpot popup đóng: loop highlight 3 symbol jackpot liên tục cho đến khi spin mới.
     */
    private _onJackpotEndHighlight(): void {
        if (this._jackpotCells.length === 0) return;
        this._stopJackpotCycle();
        // Xóa stale effects từ PayOutDisplay và PaylineIndicatorManager
        EventBus.instance.emit(GameEvents.JACKPOT_LOOP_START);
        this.paylineIndicator?.resetAllIndicators();
        // Replay ngay lập tức
        this._applyHighlight(this._jackpotCells);
        this._activateSpinesForCells(this._jackpotCells, this.lineCycleHighlightDuration);
        // Lặp theo lineCycleHighlightDuration
        this._jackpotCycleCallback = () => {
            this._applyHighlight(this._jackpotCells);
            this._activateSpinesForCells(this._jackpotCells, this.lineCycleHighlightDuration);
        };
        this.schedule(this._jackpotCycleCallback, this.lineCycleHighlightDuration);
    }

    private _stopJackpotCycle(): void {
        if (this._jackpotCycleCallback) {
            this.unschedule(this._jackpotCycleCallback);
            this._jackpotCycleCallback = null;
        }
    }

    /**
     * Bonus trigger: phát spine highlight trên symbol Bonus (col 2) trước FreeSpinPopup.
     * Reset fillBlack/highlight win trước — để bonus animation hiển thị rõ không bị che.
     */
    private _onBonusReveal(positions: { reelIndex: number; rowIndex: number }[]): void {
        const cells: CellPos[] = positions.map(p => ({ col: p.reelIndex, row: p.rowIndex }));
        if (cells.length === 0) return;
        // Xóa highlight win (fillBlack) trước để bonus symbol không bị dim bởi các reel khác
        this._resetHighlights();
        this._activateSpinesForCells(cells, 2.0);
    }

    // ── HELPERS ──────────────────────────────────────────────────────────────

    /**
     * Lấy danh sách {col, row} của các ô thắng trong 1 payline.
     * Ưu tiên matchedSymbolsIndices từ server, fallback sang payline definition.
     */
    private _getWinningCells(linePay: MatchedLinePay): CellPos[] {
        const serverIdx = linePay.matchedSymbolsIndices;
        if (serverIdx && serverIdx.length >= 3) {
            // Validate: col phải trong [0, reels.length-1], row phải trong [0, 2]
            const maxCol = this.reels.length - 1;
            const valid = serverIdx.every(s =>
                s.Item1 >= 0 && s.Item1 <= maxCol &&
                s.Item2 >= 0 && s.Item2 <= 2
            );
            if (valid) {
                return serverIdx.map(s => ({ col: s.Item1, row: s.Item2 }));
            }
            // Indices out-of-range → log và dùng fallback payline
            console.error(
                `[SymbolHighlighter] line#${linePay.payLineIndex} matchedSymbolsIndices OUT OF RANGE:` +
                ` ${serverIdx.map(s => `(col=${s.Item1},row=${s.Item2})`).join(' ')}` +
                ` maxCol=${maxCol} — fallback to payline config`
            );
        }
        // Fallback: tính từ client payline config
        const paylines = GameData.instance.config.paylines;
        const payline  = paylines[linePay.payLineIndex];
        if (!payline) return [];
        return payline.map((row, col) => ({ col, row }));
    }

    /** Set opacity ngay lập tức (dừng tween đang chạy nếu có) */
    private _setOpacity(node: Node, opacity: number): void {
        const uiOp = this._getUIOpacity(node);
        Tween.stopAllByTarget(uiOp);
        uiOp.opacity = opacity;
    }

    /** Tween opacity từ `from` → `to` trong `duration` giây */
    private _fadeOpacity(node: Node, from: number, to: number, duration: number): void {
        const uiOp = this._getUIOpacity(node);
        Tween.stopAllByTarget(uiOp);
        uiOp.opacity = from;
        tween(uiOp)
            .to(duration, { opacity: to }, { easing: 'sineOut' })
            .start();
    }

    /** Lấy hoặc tạo UIOpacity component cho node */
    private _getUIOpacity(node: Node): UIOpacity {
        return node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    }

    /** Lấy defaultScale từ SymbolView component của symbol node. Mặc định = 1 nếu không tìm thấy. */
    private _getDefaultScale(symbolNode: Node): number {
        const view = symbolNode.getComponent(SymbolView);
        return view?.defaultScale ?? 1;
    }
}

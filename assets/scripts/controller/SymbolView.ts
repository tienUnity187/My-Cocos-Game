/**
 * SymbolView - Component gắn vào mỗi Symbol Node (Symbol_Top, Symbol_Mid, Symbol_Bot).
 *
 * ─── HƯỚNG DẪN ĐẶT ẢNH ───
 * Tạo thư mục: assets/textures/symbols/
 * Đặt các file PNG vào đó theo tên:
 *   symbol_0.png  →  7        (SEVEN_SINGLE)
 *   symbol_1.png  →  77       (SEVEN_DOUBLE)
 *   symbol_2.png  →  777      (SEVEN_TRIPLE)
 *   symbol_3.png  →  BAR      (BAR_SINGLE)
 *   symbol_4.png  →  BARBAR   (BAR_DOUBLE)
 *   symbol_5.png  →  3X Wild  (WILD_3X)
 *   symbol_6.png  →  Bonus    (BONUS)
 *   symbol_7.png  →  ⚡ Red   (RED_LIGHTNING)
 *   symbol_8.png  →  ⚡ Blue  (BLUE_LIGHTNING)
 *   symbol_blur.png → Blur khi spin
 *
 * ─── BINDING TRONG EDITOR ───
 * 1. Gắn component SymbolView vào mỗi Symbol_Top/Mid/Bot node.
 * 2. Kéo từng SpriteFrame vào mảng symbolFrames[0..8] đúng thứ tự SymbolId.
 * 3. Kéo SpriteFrame blur vào blurFrame.
 * 4. Node phải có Sprite component (add nếu chưa có).
 */

import { _decorator, Component, Sprite, SpriteFrame, Label, LabelOutline, Color, Node } from 'cc';
import { SymbolId } from '../data/SlotTypes';
import { GameData } from '../data/GameData';

const { ccclass, property } = _decorator;

@ccclass('SymbolView')
export class SymbolView extends Component {

    @property({
        type: [SpriteFrame],
        tooltip: 'SpriteFrame cho từng Symbol. Index = SymbolId.\n[0]=7  [1]=77  [2]=777  [3]=BAR  [4]=BARBAR  [5]=3X Wild  [6]=Bonus  [7]=Red Lightning  [8]=Blue Lightning',
    })
    symbolFrames: SpriteFrame[] = [];

    @property({
        type: [SpriteFrame],
        tooltip: 'SpriteFrame blur khi reel đang quay. Index = SymbolId (giống symbolFrames).\n[0]=7  [1]=77  [2]=777  [3]=BAR  [4]=BARBAR  [5]=3X Wild  [6]=Bonus  [7]=Red Lightning  [8]=Blue Lightning',
    })
    blurFrames: SpriteFrame[] = [];

    @property({ tooltip: 'Scale mặc định của symbol (base scale). Dùng cho cả win zoom effect.' })
    defaultScale: number = 1;

    @property({
        tooltip: 'Tên debug (tự động cập nhật trong Editor khi symbolId thay đổi)',
        readonly: true,
    })
    currentSymbolName: string = '-';

    // ─── INTERNAL ───

    private _sprite: Sprite | null = null;
    private _currentSymbolId: number = -1;
    private _isSpinning: boolean = false;
    private _debugLabel: Label | null = null;

    /** PS ID name helper */
    private static PS_NAME: Record<number,string> = {12:'7',13:'77',14:'777',2:'BAR',3:'BB',23:'3X',22:'R⚡',21:'B⚡',98:'BNS',99:'___'};

    // ─── LIFECYCLE ───

    onLoad(): void {
        this._sprite = this.getComponent(Sprite);
       // this._createDebugLabel();

        // Áp dụng defaultScale
        this.node.setScale(this.defaultScale, this.defaultScale, 1);

        // Lắng nghe event từ ReelController
        this.node.on('symbol-changed', this._onSymbolChanged, this);
        this.node.on('spin-start', this._onSpinStart, this);
        this.node.on('spin-fast',  this._onSpinFast,  this);
        this.node.on('spin-stop',  this._onSpinStop,  this);
    }

    onDestroy(): void {
        this.node.off('symbol-changed', this._onSymbolChanged, this);
        this.node.off('spin-start', this._onSpinStart, this);
        this.node.off('spin-fast',  this._onSpinFast,  this);
        this.node.off('spin-stop',  this._onSpinStop,  this);
    }

    // ─── PUBLIC API ───

    /** Hiển thị symbol theo ID (0-8), hoặc -1 = ô trống (blank) */
    setSymbol(symbolId: number): void {
        this._currentSymbolId = symbolId;
        this._isSpinning = false;

        // Empty slot (-1): xóa sprite, ẩn ô đi
        if (symbolId < 0) {
            this.currentSymbolName = 'Empty';
            this.node.name = '[Empty]';
            if (this._sprite) {
                this._sprite.spriteFrame = null;
            }
            this._updateDebugOverlay();
            return;
        }

        this.currentSymbolName = SymbolId[symbolId] ?? `Symbol_${symbolId}`;

        const frame = this.symbolFrames[symbolId];
        if (!frame) {
            this.node.name = `[${this.currentSymbolName}]`;
            return;
        }

        if (this._sprite) {
            this._sprite.spriteFrame = frame;
        }
        this._updateDebugOverlay();
    }

    /** Hiển thị blur tương ứng với symbolId hiện tại khi reel đang quay */
    showBlur(): void {
        this._isSpinning = true;
        if (!this._sprite) return;
        const blurFrame = this.blurFrames[this._currentSymbolId] ?? this.blurFrames[0] ?? null;
        if (blurFrame) {
            this._sprite.spriteFrame = blurFrame;
        }
    }

    get symbolId(): number { return this._currentSymbolId; }

    /**
     * Ẩn/hiện Sprite component (dùng khi spine effect đang phát để tránh chồng ảnh).
     * Chỉ toggle enabled — không xóa spriteFrame, restore ngay khi gọi lại true.
     */
    setSpriteVisible(visible: boolean): void {
        if (this._sprite) this._sprite.enabled = visible;
    }

    // ─── EVENT HANDLERS (từ ReelController) ───

    private _onSymbolChanged(symbolId: number): void {
        // Khi đang spinning: cập nhật blur tương ứng với symbol mới
        if (this._isSpinning) {
            if (symbolId < 0) {
                if (this._sprite) this._sprite.spriteFrame = null;
            } else {
                this._currentSymbolId = symbolId;
                const blurFrame = this.blurFrames[symbolId] ?? this.blurFrames[0] ?? null;
                if (this._sprite && blurFrame) {
                    this._sprite.spriteFrame = blurFrame;
                }
            }
            return;
        }
        this.setSymbol(symbolId);
    }

    private _onSpinStart(): void {
        // Đánh dấu đang trong chu kỳ spin nhưng chưa hiện blur
        // (reel đang bounce lên, chưa vào tốc độ nhanh)
        this._isSpinning = true;
    }

    private _onSpinFast(): void {
        // Reel đã vào tốc độ nhanh → hiện blur
        this.showBlur();
    }

    private _onSpinStop(): void {
        // Clear flag trước — symbol-changed sẽ fire ngay sau từ ReelController._doStop()
        this._isSpinning = false;
    }

    // ─── DEBUG OVERLAY ───

    private _createDebugLabel(): void {
        // Tạo child node chứa Label để overlay PS ID lên symbol
        const labelNode = new Node('DebugLabel');
        this.node.addChild(labelNode);
        const label = labelNode.addComponent(Label);
        label.string = '';
        label.fontSize = 20;
        label.lineHeight = 22;
        label.color = new Color(255, 255, 0, 255);  // yellow
        label.isBold = true;
        // Outline for readability
        const outline = labelNode.addComponent(LabelOutline);
        outline.color = new Color(0, 0, 0, 255);
        outline.width = 2;
        this._debugLabel = label;
    }

    /**
     * Cập nhật debug overlay hiển thị PS ID + Client ID.
     * Gọi sau khi setSymbol() để hiển thị thông tin mapping.
     */
    private _updateDebugOverlay(): void {
        if (!this._debugLabel) return;
        const clientId = this._currentSymbolId;
        // Tìm PS ID tương ứng từ dynMap
        const dynMap = GameData.instance.psToClientMap;
        let psId = -1;
        for (const [k, v] of Object.entries(dynMap)) {
            if (v === clientId) { psId = Number(k); break; }
        }
        const psName = SymbolView.PS_NAME[psId] ?? `ps${psId}`;
        const clName = clientId < 0 ? 'Empty' : (SymbolId[clientId] ?? `cl${clientId}`);
        this._debugLabel.string = `PS:${psId}(${psName})\nCL:${clientId}(${clName})`;
    }
}

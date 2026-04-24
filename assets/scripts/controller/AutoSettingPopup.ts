/**
 * AutoSettingPopup - Popup cài đặt Auto Spin và Speed Mode.
 *
 * ── SETUP TRONG EDITOR ──
 *   1. Tạo Node "AutoSettingPopup" (con của Canvas), đặt active=false.
 *   2. Gắn component AutoSettingPopup vào Node đó.
 *   3. Kéo các node con vào đúng slot bên dưới.
 *   4. Kéo Button mở popup (ví dụ nút Settings trên UI chính) → gọi open().
 *
 * ── NODE LAYOUT ──
 *   popupNode        : Node bọc toàn bộ popup (scale-in/out animation)
 *   autoSpinSlider   : Slider kéo số lần auto spin (10 → 1000)
 *   countLabel       : Label hiển thị số lượt hiện tại (ví dụ "50")
 *   btnQuick         : Button chọn/bỏ chọn Quick speed (toggle)
 *   btnTurbo         : Button chọn/bỏ chọn Turbo speed (toggle)
 *   closeButton      : Button chỉ đóng popup (không kích hoạt auto spin)
 *   confirmButton    : Button xác nhận bắt đầu auto spin (label động theo count)
 *   confirmLabel     : Label trên nút Confirm (dùng L('UI_POPUP_AUTOPLAY_START', count))
 *
 * ── SPEED MODE VISUAL ──
 *   - Quick được chọn  : quickSelected hiện, sprite của btnQuick ẩn;
 *                       turboSelected ẩn, sprite của btnTurbo hiện
 *   - Turbo được chọn  : turboSelected hiện, sprite của btnTurbo ẩn;
 *                       quickSelected ẩn, sprite của btnQuick hiện
 *   - Không có cái nào : cả hai selected ẩn, cả hai sprite hiện → Normal mode
 */

import { _decorator, Component, Node, Label, Button, Slider, Sprite, tween, Vec3, BlockInputEvents, UITransform } from 'cc';
import { AutoSpinManager, SpeedMode } from '../manager/AutoSpinManager';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { SoundManager } from '../manager/SoundManager';
import { L } from '../core/LocalizationManager';

const { ccclass, property } = _decorator;

@ccclass('AutoSettingPopup')
export class AutoSettingPopup extends Component {

    @property({ type: Node, tooltip: 'Node bọc toàn bộ popup (active=false ban đầu)' })
    popupNode: Node | null = null;

    @property({ type: Slider, tooltip: 'Slider kéo số lần auto spin (10 → 1000)' })
    autoSpinSlider: Slider | null = null;

    @property({ type: Label, tooltip: 'Label hiển thị số lượt auto spin hiện tại' })
    countLabel: Label | null = null;


    @property({ type: Button, tooltip: 'Nút toggle Quick speed (nhấn lần 2 để bỏ chọn)' })
    btnQuick: Button | null = null;

    @property({ type: Button, tooltip: 'Nút toggle Turbo speed (nhấn lần 2 để bỏ chọn)' })
    btnTurbo: Button | null = null;

    @property({ type: Node, tooltip: 'Indicator (tick/highlight) cho Quick button' })
    quickSelected: Node | null = null;

    @property({ type: Node, tooltip: 'Indicator (tick/highlight) cho Turbo button' })
    turboSelected: Node | null = null;

    @property({ type: Button, tooltip: 'Nút đóng popup (chỉ đóng, không bắt đầu auto spin)' })
    closeButton: Button | null = null;

    @property({ type: Button, tooltip: 'Nút xác nhận bắt đầu auto spin' })
    confirmButton: Button | null = null;

    @property({ type: Label, tooltip: 'Label trên nút Confirm — hiển thị L(\'UI_POPUP_AUTOPLAY_START\', count)' })
    confirmLabel: Label | null = null;

    @property({ type: Button, tooltip: '(Tuỳ chọn) Nút mở popup từ UI chính' })
    openButton: Button | null = null;

    @property({ type: Node, tooltip: 'Node overlay phủ nền (active/inactive ngay cùng popupNode, không animation)' })
    fillOverlay: Node | null = null;

    /**
     * Node sprite màu SÁNG nằm bên trái Handle, anchor phải là (0, 0.5).
     * Đặt nó là con của cùng track parent với Slider, căn trái track.
     * Width sẽ được scale theo progress để thể hiện phần đã fill.
     */
    @property({ type: Node, tooltip: 'Sprite fill sáng bên trái Handle — anchor (0,0.5), cùng chiều cao track' })
    sliderFill: Node | null = null;

    private _isOpen: boolean = false;

    // ─── LIFECYCLE ───

    onLoad(): void {
        // Đảm bảo AutoSpinManager được khởi tạo
        AutoSpinManager.instance;

        if (this.autoSpinSlider) {
            this.autoSpinSlider.node.on('slide', this._onSlide, this);
        }
        if (this.btnQuick) this.btnQuick.node.on('click', () => this._onToggleSpeed(SpeedMode.QUICK), this);
        if (this.btnTurbo) this.btnTurbo.node.on('click', () => this._onToggleSpeed(SpeedMode.TURBO), this);
        if (this.closeButton) this.closeButton.node.on('click', () => { SoundManager.instance?.playButtonClick(); this.close(); }, this);
        if (this.confirmButton) this.confirmButton.node.on('click', this._onConfirm, this);
        if (this.openButton)  this.openButton.node.on('click', () => { SoundManager.instance?.playButtonClick(); this.open(); }, this);

        // Lắng nghe update từ bên ngoài (khi auto spin đang chạy và count đổi)
        EventBus.instance.on(GameEvents.AUTO_SPIN_CHANGED, this._onAutoSpinChanged, this);

        if (this.popupNode) this.popupNode.active = false;
        if (this.fillOverlay) this.fillOverlay.active = false;
        // Chặn touch xuyên qua xuống các node bên dưới khi popup đang hiển thị
        if (!this.node.getComponent(BlockInputEvents)) {
            this.node.addComponent(BlockInputEvents);
        }
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
    }

    // ─── PUBLIC API ───

    open(): void {
        if (this._isOpen || !this.popupNode) return;
        this._isOpen = true;
        if (this.fillOverlay) this.fillOverlay.active = true;
        this.popupNode.active = true;
        this.popupNode.setScale(0.1, 0.1, 1);

        // Sync slider & UI từ AutoSpinManager
        // Slider range: 0 → 1000, công thức: progress = count / 1000
        if (this.autoSpinSlider) {
            const count = AutoSpinManager.instance.autoSpinCount;
            this.autoSpinSlider.progress = count / 1000;
            this._updateSliderFill(this.autoSpinSlider.progress);
        }
        this._refreshUI();

        tween(this.popupNode)
            .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
    }

    close(): void {
        if (!this._isOpen || !this.popupNode) return;
        this._isOpen = false;

        tween(this.popupNode)
            .to(0.15, { scale: new Vec3(0.1, 0.1, 1) }, { easing: 'quadIn' })
            .call(() => {
                if (this.popupNode) this.popupNode.active = false;
                if (this.fillOverlay) this.fillOverlay.active = false;
            })
            .start();
    }

    // ─── SLIDER HANDLER ───

    private _onConfirm(): void {
        SoundManager.instance?.playButtonClick();
        const count = AutoSpinManager.instance.autoSpinCount;
        AutoSpinManager.instance.resumeAutoSpin(); // xóa pause flag trước khi spin
        this.close();
        if (count > 0) {
            EventBus.instance.emit(GameEvents.SPIN_REQUEST);
        }
    }

    private _onSlide(slider: Slider): void {
        // Slider range: 0 → 1000, công thức: count = progress * 1000
        const count = Math.round(slider.progress * 1000);
        AutoSpinManager.instance.setAutoSpinCount(count);
        this._updateSliderFill(slider.progress);
        this._refreshCountUI(count);
    }

    /**
     * Cập nhật width của sliderFill theo progress (0→1).
     * sliderFill phải có anchor (0, 0.5) và cùng parent/vị trí với track.
     */
    private _updateSliderFill(progress: number): void {
        if (!this.sliderFill || !this.autoSpinSlider) return;
        const trackTransform = this.autoSpinSlider.node.getComponent(UITransform);
        const fillTransform = this.sliderFill.getComponent(UITransform);
        if (!trackTransform || !fillTransform) return;
        const totalWidth = trackTransform.contentSize.width;
        fillTransform.setContentSize(totalWidth * progress, fillTransform.contentSize.height);
    }

    /** Toggle Quick/Turbo: nếu đang chọn mode đó rồi thì bỏ chọn (về Normal), ngược lại thì chọn */
    private _onToggleSpeed(mode: SpeedMode): void {
        SoundManager.instance?.playButtonClick();
        const current = AutoSpinManager.instance.speedMode;
        const next = current === mode ? SpeedMode.NORMAL : mode;
        AutoSpinManager.instance.setSpeedMode(next);
        this._refreshSpeedUI(next);
    }

    private _onAutoSpinChanged(count: number): void {
        // Cập nhật UI nếu popup đang mở (khi auto spin đang chạy)
        if (!this._isOpen) return;
        this._refreshCountUI(count);
    }

    // ─── UI REFRESH ───

    private _refreshUI(): void {
        this._refreshCountUI(AutoSpinManager.instance.autoSpinCount);
        this._refreshSpeedUI(AutoSpinManager.instance.speedMode);
    }

    private _refreshCountUI(count: number): void {
        if (this.countLabel) {
            this.countLabel.string = String(count);
        }
        if (this.confirmLabel) {
            this.confirmLabel.string = L('UI_POPUP_AUTOPLAY_START', { Count: count });
        }
        if (this.confirmButton) {
            this.confirmButton.interactable = count > 0;
        }
    }

    private _refreshSpeedUI(mode: SpeedMode): void {
        const quickOn = mode === SpeedMode.QUICK;
        const turboOn = mode === SpeedMode.TURBO;

        // Quick button: ẩn sprite khi được chọn, hiện quickSelected
        if (this.quickSelected) this.quickSelected.active = quickOn;
        const quickSprite = this.btnQuick?.node.getComponent(Sprite);
        if (quickSprite) quickSprite.enabled = !quickOn;

        // Turbo button: ẩn sprite khi được chọn, hiện turboSelected
        if (this.turboSelected) this.turboSelected.active = turboOn;
        const turboSprite = this.btnTurbo?.node.getComponent(Sprite);
        if (turboSprite) turboSprite.enabled = !turboOn;
    }
}

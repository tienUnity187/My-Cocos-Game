/**
 * GuideController - Màn hình Hướng dẫn (Guide View).
 *
 * Setup trong Editor:
 *   1. Tạo Node "GuideView" (bắt đầu inactive).
 *   2. Gắn component này + UIOpacity component vào GuideView.
 *   3. Dưới GuideView tạo:
 *        - guidePanel  : Node chứa nội dung hướng dẫn (SPECIAL SYMBOLS hoặc BONUS FEATURE)
 *        - continueArea: Node / Label "CLICK TO CONTINUE" ở dưới cùng
 *   4. Kéo các node vào slot tương ứng.
 *
 * Flow:
 *   LOADING_COMPLETE → fade in → hiện guidePanel
 *   → click continueArea → fade out → emit GUIDE_COMPLETE → deactivate
 */

import { _decorator, Component, Node, UIOpacity, tween, Layout, screen, Label, Sprite, SpriteFrame, Vec3, CCString, Button } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { L } from '../core/LocalizationManager';
import { SoundManager } from '../manager/SoundManager';
import { SettingPopup } from './SettingPopup';

const { ccclass, property } = _decorator;

@ccclass('GuideController')
export class GuideController extends Component {

    @property({ type: SettingPopup, tooltip: '(Tuỳ chọn) SettingPopup để kiểm tra introEnabled — nếu tắt thì skip guide' })
    settingPopup: SettingPopup | null = null;

    @property({ type: Node, tooltip: 'Panel guide chứa nội dung hướng dẫn' })
    guidePanel: Node | null = null;


    @property({ type: Node, tooltip: 'Background'})
    background: Node | null = null;

    @property({ type: SpriteFrame, tooltip: 'Background'})
    backgroundSprite: SpriteFrame[]  = [];

    @property({ type: Button, tooltip: 'Button "CLICK TO CONTINUE" ở dưới cùng màn hình' })
    continueArea: Button | null = null;

    @property({ type: [Label], tooltip: '2 Label node để hiển thị hướng dẫn (liên tục cập nhật theo ngôn ngữ)' })
    guideLabels: Label[] = [];

    @property({
        type: [CCString],
        displayName: 'Guide Label Keys',
        tooltip: 'Localization key cho mỗi guideLabel (phải match index, tương ứng với mảng guideLabels)',
    })
    guideLabelKeys: string[] = [];

    @property({ type: UIOpacity, tooltip: 'UIOpacity của GuideView để fade in/out' })
    uiOpacity: UIOpacity | null = null;

    @property({ tooltip: 'Fade-in duration khi Guide xuất hiện (giây)' })
    fadeInDuration: number = 0.4;

    @property({ tooltip: 'Scale min cho zoom effect của continueArea' })
    zoomMinScale: number = 0.9;

    @property({ tooltip: 'Scale max cho zoom effect của continueArea' })
    zoomMaxScale: number = 1.08;

    @property({ tooltip: 'Thời gian một chu kỳ zoom in/out (giây)' })
    zoomDuration: number = 0.8;

    /** Guard: đã bị dismiss (người dùng click Continue) — từ chối mọi onEnable sau đó */
    private _dismissed: boolean = false;

    // ─── LIFECYCLE ───

    onLoad(): void {
        EventBus.instance.on(GameEvents.LANGUAGE_CHANGED, this._setGuideLabels, this);
        screen.on('window-resize', this._applyGuideLayout, this);
        screen.on('orientation-change', this._applyGuideLayout, this);
    }

    onEnable(): void {
        // Stack trace để debug: ai đang activate GuideView?
        const stack = new Error().stack ?? '(no stack)';
        console.log('[GuideController] onEnable called. Stack:\n' + stack);

        // Guard: nếu đã dismiss rồi thì từ chối — ai đó đang cố re-activate GuideView sai
        if (this._dismissed) {
            console.error('[GuideController] onEnable BLOCKED — GuideView đã được dismiss, force active=false!\nStack:\n' + stack);
            this.scheduleOnce(() => { this.node.active = false; }, 0);
            return;
        }

        // Được gọi khi GameEntryController set gameGuide.active = true
        // Lúc này nền đen đang hiện → FadeOut GuideView (0→255)
        console.log('[GuideController] onEnable — bắt đầu FadeOut GuideView (0→255)');
        if (this.uiOpacity) {
            tween(this.uiOpacity).stop();
            this.uiOpacity.opacity = 0;  // đảm bảo bắt đầu từ 0 (transparent)
        }
        if (this.guidePanel) this.guidePanel.active = true;
        this._setGuideLabels();
        this._applyGuideLayout();

        // Debug: kiểm tra trạng thái continueArea
        if (this.continueArea) {
            console.log('[GuideController] continueArea node active:', this.continueArea.node.active,
                '| interactable:', this.continueArea.interactable,
                '| node name:', this.continueArea.node.name);
        } else {
            console.warn('[GuideController] continueArea is NULL — chưa assign trong Editor!');
        }

        // FadeOut: opacity 0→255 (GuideView hiện ra từ đen)
        // Bind clicks SAU KHI fade xong
        if (this.uiOpacity) {
            tween(this.uiOpacity)
                .to(this.fadeInDuration, { opacity: 255 })
                .call(() => {
                    console.log('[GuideController] FadeOut complete → _bindClicks()');
                    this._bindClicks();
                })
                .start();
        } else {
            console.log('[GuideController] no uiOpacity → _bindClicks() immediately');
            this._bindClicks();
        }
    }

    onDisable(): void {
        console.log('[GuideController] onDisable — node deactivated. _dismissed=' + this._dismissed);
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
        screen.off('window-resize', this._applyGuideLayout, this);
        screen.off('orientation-change', this._applyGuideLayout, this);
    }

    // ─── LOCALIZATION ───

    /** Gán text cho guideLabels dựa trên guideLabelKeys */
    private _setGuideLabels(): void {
        if (!this.guideLabels || !this.guideLabelKeys) return;
        for (let i = 0; i < this.guideLabels.length; i++) {
            const label = this.guideLabels[i];
            const key = this.guideLabelKeys[i];
            if (label && key) {
                label.string = L(key);
            }
        }
    }

    // ─── ORIENTATION ───

    /** Điều chỉnh Layout của guidePanel theo hướng màn hình hiện tại */
    private _applyGuideLayout(): void {
        if (!this.guidePanel) return;
        const layout = this.guidePanel.getComponent(Layout);
        if (!layout) return;
        const size = screen.windowSize;
        const isPortrait = size.height > size.width;
        layout.type = isPortrait ? Layout.Type.VERTICAL : Layout.Type.HORIZONTAL;
        if (this.background && this.backgroundSprite.length >= 2) {
            const sprite = this.background.getComponent(Sprite);
            if (sprite) sprite.spriteFrame = isPortrait ? this.backgroundSprite[0] : this.backgroundSprite[1];
        }
    }

    // ─── CLICK HANDLERS ───

    private _startContinueAreaZoom(): void {
        if (!this.continueArea) return;
        const node = this.continueArea.node;
        const minScale = new Vec3(this.zoomMinScale, this.zoomMinScale, 1);
        const maxScale = new Vec3(this.zoomMaxScale, this.zoomMaxScale, 1);
        tween(node)
            .to(this.zoomDuration / 2, { scale: maxScale })
            .to(this.zoomDuration / 2, { scale: minScale })
            .union()
            .repeatForever()
            .start();
    }

    private _stopContinueAreaZoom(): void {
        if (!this.continueArea) return;
        tween(this.continueArea.node).stop();
        this.continueArea.node.scale = new Vec3(1, 1, 1);
    }

    private _bindClicks(): void {
        if (!this.continueArea) {
            console.warn('[GuideController] _bindClicks: continueArea is null!');
            return;
        }
        console.log('[GuideController] _bindClicks — interactable:', this.continueArea.interactable,
            '| node active:', this.continueArea.node.active,
            '| node parent active:', this.continueArea.node.parent?.active);
        this._startContinueAreaZoom();
        this.continueArea.node.on('click', this._onContinue, this);
    }
    

    private _unbindClicks(): void {
        if (!this.continueArea) return;
        console.log('[GuideController] _unbindClicks');
        this._stopContinueAreaZoom();
        this.continueArea.node.off('click', this._onContinue, this);
    }

    private _onContinue(): void {
        console.log('[GuideController] _onContinue FIRED! Setting _dismissed=true');
        SoundManager.instance?.playButtonClick();
        this._unbindClicks();
        this._dismissed = true;  // ★ Đánh dấu đã dismiss — từ chối mọi onEnable tiếp theo

        const finish = () => {
            // Đảm bảo node này inactive TRƯỚC khi emit — tránh render chồng lên GameRoot
            this.node.active = false;
            EventBus.instance.emit(GameEvents.GUIDE_COMPLETE);
        };

        if (this.uiOpacity) {
            tween(this.uiOpacity)
                .to(0.35, { opacity: 0 })
                .call(finish)
                .start();
        } else {
            finish();
        }
    }
}

/**
 * TransitionController - Hiệu ứng transition giữa các màn hình.
 *
 * Setup trong Editor:
 *   1. Tạo Node "TransitionOverlay" (overlay toàn màn hình, ban đầu inactive).
 *   2. Gắn component này vào node đó.
 *   3. Node phải có UIOpacity component (để fade in/out).
 *   4. Đặt node này trên cùng hierarchy (order cao nhất).
 *
 * Flow:
 *   GUIDE_COMPLETE → phát hiệu ứng transition → fade in/out → biến mất
 */

import { _decorator, Component, UIOpacity, tween, Node, Vec3, ParticleSystem } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';

const { ccclass, property } = _decorator;

@ccclass('TransitionController')
export class TransitionController extends Component {

    @property({ type: UIOpacity, tooltip: 'UIOpacity của TransitionOverlay để fade in/out' })
    uiOpacity: UIOpacity | null = null;

    @property({ type: Node, tooltip: 'Icon node để hiển thị hiệu ứng bay' })
    iconNode: Node | null = null;

    @property({ type: Node, tooltip: 'Target node - nơi icon bay vào' })
    targetNode: Node | null = null;

    @property({ type: ParticleSystem, tooltip: 'Effect node - hiển thị khi iconNode zoom tới max (mặc định inactive)' })
    effectNode: ParticleSystem | null = null;

    @property({ tooltip: 'Thời gian zoom in của icon (giây)' })
    iconZoomInDuration: number = 0.3;

    @property({ tooltip: 'Độ trễ trước khi icon bay đi (giây)' })
    iconFlyDelay: number = 1.0;

    @property({ tooltip: 'Thời gian icon bay vào target (giây)' })
    iconFlyDuration: number = 0.8;

    @property({ tooltip: 'Thời gian zoom out của icon (giây)' })
    iconZoomOutDuration: number = 0.3;

    @property({ tooltip: 'Thời gian fade in nhanh (giây)' })
    fadeInDuration: number = 0.2;

    @property({ tooltip: 'Thời gian giữ màn chắn (giây)' })
    holdDuration: number = 1.0;

    @property({ tooltip: 'Thời gian fade out nhanh (giây)' })
    fadeOutDuration: number = 0.2;

    // ─── LIFECYCLE ───

    onLoad(): void {
        this.node.active = false; // ẩn cho đến khi event trigger
        EventBus.instance.on(GameEvents.GUIDE_COMPLETE, this._onGuideComplete, this);
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
    }

    // ─── TRANSITION EFFECT ───

    private _onGuideComplete(): void {
        this.node.active = true;
        this.playIconFlyAnimation();
    }

    /**
     * Flow: delay 1s → iconNode xuất hiện → zoom 0→1.3→1 (bounce) → giữ 1s → thu nhỏ 0.5 + bay vào target → targetNode hiện
     * effectNode active khi iconNode zoom max (1.3), deactive khi bounce về 1
     */
    playIconFlyAnimation(): void {
        if (!this.iconNode || !this.targetNode) return;

        // targetNode ẩn đi, iconNode active nhưng scale=0 để ẩn (tween cần node active mới chạy)
        this.targetNode.active = false;
        this.iconNode.active = true;
        this.iconNode.setScale(new Vec3(0, 0, 0));
     //   if (this.effectNode) this.effectNode.node.active = false;

        const uiOpacity = this.iconNode.getComponent(UIOpacity);
        if (uiOpacity) uiOpacity.opacity = 255;

        // Tính vị trí target trong local space của parent iconNode
        const targetWorldPos = this.targetNode.getWorldPosition();
        const targetLocalPos = new Vec3();
        if (this.iconNode.parent) {
            this.iconNode.parent.inverseTransformPoint(targetLocalPos, targetWorldPos);
        } else {
            Vec3.copy(targetLocalPos, targetWorldPos);
        }

        tween(this.iconNode)
            // Delay 1 giây trước khi xuất hiện (scale=0 trong thời gian này)
            .delay(1.0)
            // Zoom nhanh ra 0 → 1.3
            .to(this.iconZoomInDuration, { scale: new Vec3(1.3, 1.3, 1.3) })
            // Active effect khi icon zoom max
            .call(() => {
                if (this.effectNode) {
                    this.effectNode.node.active = true;
                    this.effectNode.play();
                }
            })
            // Bounce nhẹ nhảy về 1
            .to(this.iconZoomOutDuration, { scale: new Vec3(1, 1, 1) })
            // Giữ yên 1 giây
            .delay(this.iconFlyDelay)
            // Stop effect khi iconNode bắt đầu bay vào target
            .call(() => { if (this.effectNode) this.effectNode.stop(); })
            // Thu nhỏ về 0.5 và bay nhanh vào vị trí target
            .to(this.iconFlyDuration, { scale: new Vec3(0.5, 0.5, 0.5), position: targetLocalPos })
            .call(() => {
                this.iconNode!.active = false;
                this.targetNode!.active = true;
                this.node.active = false; // Ẩn overlay sau animation
            })
            .start();

        // Mờ dần khi bay (bắt đầu từ lúc zoom in + bounce + hold delay)
        if (uiOpacity) {
            tween(uiOpacity)
                .delay(1.0 + this.iconZoomInDuration + this.iconZoomOutDuration + this.iconFlyDelay)
                .to(this.iconFlyDuration, { opacity: 0 })
                .start();
        }
    }
}

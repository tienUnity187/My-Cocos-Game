/**
 * GameEntryController - Điều phối luồng vào game.
 *
 * Setup trong Editor:
 *   1. Gắn component này vào bất kỳ node nào trong game prefab.
 *   2. Kéo GameGuide node vào slot gameGuide (để active=false trong Editor).
 *   3. Kéo GameRoot node vào slot gameRoot (để active=false trong Editor).
 *      - Gắn UIOpacity vào cả hai node.
 *
 * Flow (SkipIntro OFF):
 *   LOADING_COMPLETE
 *   → [FadeOut GuideView: 0→255]  (GuideController.onEnable handles this)
 *   → User click Continue
 *   → [FadeIn GuideView: 255→0]   (GuideController._onContinue handles this)
 *   → GUIDE_COMPLETE
 *   → [FadeOut GameRoot: 0→255]
 *
 * Flow (SkipIntro ON):
 *   LOADING_COMPLETE → [FadeOut GameRoot: 0→255] ngay
 *
 * Lưu ý: Tại mọi thời điểm chỉ 1 fade animation chạy.
 *         Node chưa tới lượt phải active=false.
 */

import { _decorator, Component, Node, UIOpacity, tween } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { GameData } from '../data/GameData';

const { ccclass, property } = _decorator;

@ccclass('GameEntryController')
export class GameEntryController extends Component {

    @property({ type: Node, tooltip: 'Node màn hình Guide (có GuideController)' })
    gameGuide: Node | null = null;

    @property({ type: Node, tooltip: 'Node GameRoot chứa toàn bộ game — luôn active=true, opacity=0 ban đầu' })
    gameRoot: Node | null = null;

    @property({ tooltip: 'Thời gian fade GameRoot xuất hiện (giây)' })
    fadeDuration: number = 0.4;

    private _rootOpacity: UIOpacity | null = null;
    /** Guard: chỉ xử lý LOADING_COMPLETE lần đầu tiên — GameManager có thể emit lại */
    private _loadingHandled: boolean = false;
    /** Guard: chỉ xử lý GUIDE_COMPLETE lần đầu tiên */
    private _guideHandled: boolean = false;

    // ─── LIFECYCLE ───

    onLoad(): void {
        // Cả hai view đều ẩn ngay khi game node được activate.
        // Chỉ 1 view được visible tại 1 thời điểm (xem flow trong header).
        if (this.gameGuide) this.gameGuide.active = false;
        if (this.gameRoot) this.gameRoot.active = false;

        // Lấy UIOpacity của GameRoot
        if (this.gameRoot) {
            this._rootOpacity = this.gameRoot.getComponent(UIOpacity);
        }

        EventBus.instance.on(GameEvents.LOADING_COMPLETE, this._onLoadingComplete, this);
        EventBus.instance.on(GameEvents.GUIDE_COMPLETE, this._onGuideComplete, this);
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
    }

    // ─── HANDLERS ───

    private _onLoadingComplete(): void {
        if (this._loadingHandled) {
            console.warn('[GameEntryController] LOADING_COMPLETE fired again — ignored (already handled by LoadingController)');
            return;
        }
        this._loadingHandled = true;
        console.log('[GameEntryController] LOADING_COMPLETE → handling (first time)');

        const isResuming = GameData.instance.isResumingFreeSpin;
        console.error(`[RESUME-DEBUG] GameEntryController._onLoadingComplete — isResumingFreeSpin=${isResuming}`);

        if (isResuming) {
            // Resume path: không hiện guide, vào game ngay, rồi emit GAME_READY
            // Không emit GUIDE_COMPLETE — tránh làm hỏng _guideHandled guard cho flow bình thường
            console.error('[RESUME-DEBUG] GameEntryController → resume path: _showGameRoot() → GAME_READY sau 0.1s');
            this._guideHandled = true; // block user-click GUIDE_COMPLETE không liên quan
            this._showGameRoot();
            // Delay đủ để fade gameRoot hoàn tất (fadeDuration=0.4s) + buffer,
            // rồi mới emit GAME_READY để popup resume hiện khi màn hình đã hiện rõ.
            this.scheduleOnce(() => {
                console.error('[RESUME-DEBUG] GameEntryController resume → emit GAME_READY');
                EventBus.instance.emit(GameEvents.GAME_READY);
            }, this.fadeDuration + 0.15);
            return;
        }

        let skipIntro = false;
        try {
            const saved = localStorage.getItem('setting_intro_on');
            if (saved !== null) skipIntro = saved === 'false';
        } catch (_) {}

        if (skipIntro) {
            console.log('[GameEntryController] skipIntro=true → _showGameRoot() và emit GUIDE_COMPLETE');
            // Không có guide, nhưng vẫn emit GUIDE_COMPLETE cho GameManager._onGuideComplete()
            EventBus.instance.emit(GameEvents.GUIDE_COMPLETE);
        } else {
            // Hiện guide: GuideView active=true, opacity=0 → GuideController.onEnable()
            // → FadeOut GuideView (0→255) → bind clicks
            console.log('[GameEntryController] skipIntro=false → gameGuide.active = true');
            if (this.gameGuide) this.gameGuide.active = true;
        }
    }

    private _onGuideComplete(): void {
        if (this._guideHandled) {
            console.warn('[GameEntryController] GUIDE_COMPLETE fired again — ignored');
            return;
        }
        this._guideHandled = true;
        console.log('[GameEntryController] GUIDE_COMPLETE → gameGuide.active=false → _showGameRoot()');
        // Đảm bảo GuideView ẩn hoàn toàn trước khi GameRoot hiện ra.
        if (this.gameGuide) this.gameGuide.active = false;
        // Tại đây nền đen đang hiển thị → FadeOut GameRoot (0→255)
        this._showGameRoot();
    }

    private _showGameRoot(): void {
        // GameRoot active=false → activate → opacity=0 → FadeOut (0→255)
        if (!this.gameRoot) return;
        this.gameRoot.active = true;
        const opacity = this.gameRoot.getComponent(UIOpacity);
        if (opacity) {
            opacity.opacity = 0;
            tween(opacity)
                .to(this.fadeDuration, { opacity: 255 })
                .start();
        }
    }
}

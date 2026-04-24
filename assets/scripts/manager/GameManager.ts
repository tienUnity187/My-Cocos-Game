/**
 * GameManager - State Machine điều phối toàn bộ flow game.
 * Component gắn vào root node, quản lý SlotStageType.
 */

import { _decorator, Component, Node, Sprite, SpriteFrame, screen, Color } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { GameData } from '../data/GameData';
import { SlotStageType, SpinResponse, MatchedLinePay, JackpotType, SymbolId, GameState, CLIENT_TO_PS, PS_TO_CLIENT, FeatureItem } from '../data/SlotTypes';
import { NetworkManager } from './NetworkManager';
import { WalletManager } from './WalletManager';
import { BetManager } from './BetManager';
import { SoundManager } from './SoundManager';
import { DebugManager } from './DebugManager';
import { PROGRESSIVE_WIN_THRESHOLDS, ProgressiveWinTier } from '../controller/ProgressiveWinPopup';
import { USE_REAL_API } from '../data/ServerConfig';
import { MockDataProvider } from '../data/MockDataProvider';
import { LocalizationManager } from '../core/LocalizationManager';
import { AutoSpinManager } from './AutoSpinManager';
import { PopUpMessage, PopupCase } from '../core/PopUpMessage';
import { ServerApiError } from './NetworkManager';

const { ccclass, property } = _decorator;

@ccclass('GameManager')
export class GameManager extends Component {
    @property({ tooltip: 'Bỏ qua Loading + Guide để vào game ngay (chỉ dùng khi dev/debug)' })
    skipIntroScreens: boolean = false;

    @property({
        tooltip: '[Two-scene mode] Set TRUE trong game.scene.\n' +
                 'Login đã được xử lý bởi LoadingController ở loading.scene.\n' +
                 'GameManager sẽ bỏ qua login flow, đọc data từ GameData và bắt đầu game ngay.'
    })
    isGameScene: boolean = false;

    @property({ tooltip: 'Delay trước khi hiện FreeSpinEndPopup (giây) — để cho highlight vòng cuối diễn xong' })
    freeSpinEndPopupDelay: number = 1.0;

    @property({ type: Node, tooltip: 'Background node để thay đổi sprite theo orientation' })
    backgroundNode: Node | null = null;

    @property({ type: SpriteFrame, tooltip: 'Background sprites NORMAL SPIN — [0]=portrait, [1]=landscape' })
    backgroundSprites: SpriteFrame[] = [];

    @property({ type: SpriteFrame, tooltip: 'Background sprites FREE SPIN — [0]=portrait, [1]=landscape' })
    freeSpinBackgroundSprites: SpriteFrame[] = [];

    @property({ type: Node, tooltip: 'PayOut Display - hiển thị khi Normal Spin' })
    payOutDisplay: Node | null = null;

    @property({ type: Node, tooltip: 'Multiplier Display - hiển thị khi Free Spin' })
    multiplierDisplay: Node | null = null;

    @property({ type: Node, tooltip: 'Multiplier Effect node - active cùng với Multiplier Display' })
    multiplierEffect: Node | null = null;

    private _currentStage: SlotStageType = SlotStageType.SPIN;
    /** State machine — kiểm soát luồng xử lý và block input */
    private _gameState: GameState = GameState.IDLE;
    private _isSpinning: boolean = false;
    /** True nếu spin hiện tại là long spin — dùng để delay jackpot popup */
    private _hadLongSpin: boolean = false;
    /** Tất cả 3 vị trí hint khi long spin (reel0, reel1, reel2) — dùng cho jackpot reveal */
    private _longSpinHintPositions: { reelIndex: number; rowIndex: number }[] = [];
    /** Đếm số lần free spin đã thực sự chạy (để hiển thị trong FreeSpinEndPopup) */
    private _freeSpinActualCount: number = 0;
    /** Fallback đảm bảo spin cycle LUÔN kết thúc dù WinPresenter/JackpotPresenter chưa có trong scene */
    private _spinCycleFallback = () => {
        if (!this._isSpinning) return; // Guard: tránh fire stale timer từ spin trước
        this._afterWinProcessed();
    };
    /** Cờ chờ FLY_DONE trước khi auto-spin; fallback timer sẽ hủy nếu FLY_DONE đến trước */
    private _waitingForFlyDone: boolean = false;
    /** FLY_DONE đã fire trong spin hiện tại — dùng khi popup (Jackpot/Progressive) delay flow */
    private _flyDoneReceived: boolean = false;
    /** Callback auto-spin (giữ reference để unschedule được) */
    private _autoSpinCallback = () => {
        this._waitingForFlyDone = false;
        EventBus.instance.emit(GameEvents.SPIN_REQUEST);
    };
    /** Pending resume data khi Enter trả về lastSpinResponse đang dở Free Spin */
    private _pendingResume: {
        nextStage: number;
        remainFreeSpinCount: number;
        featureSpinTotalWin: number;
        lastSpinRands?: number[];
    } | null = null;
    /** Pending resume sau khi jackpot popup đóng (resume interrupted by jackpot) */
    private _pendingResumeAfterJackpot: {
        nextStage: number;
        remainFreeSpinCount: number;
        featureSpinTotalWin: number;
        lastSpinRands?: number[];
    } | null = null;

    // ─── LIFECYCLE ───

    onLoad(): void {
        // Khởi tạo DebugManager sớm để keyboard shortcuts (F1-F7) hoạt động ngay từ đầu
        DebugManager.instance;
        // Khởi tạo AutoSpinManager sớm để GAME_READY listener được đăng ký trước khi GAME_READY emit
        AutoSpinManager.instance;

        this._bindEvents();

        // 🎯 Lắng nghe screen resize/orientation để cập nhật background sprite
        screen.on('window-resize', this._updateBackgroundSprite, this);
        screen.on('orientation-change', this._updateBackgroundSprite, this);
        this._updateBackgroundSprite();
    }

    start(): void {
        const data = GameData.instance;
        // Two-scene mode: LoadingController set isFromLoadingScene=true trước director.loadScene()
        // → không cần tick isGameScene hay isEntered trong Inspector.
        if (data.isFromLoadingScene || data.isEntered || this.isGameScene) {
            console.log(`[GameManager] start() → path: _startFromGameScene (isFromLoadingScene=${data.isFromLoadingScene}, isEntered=${data.isEntered}, isGameScene=${this.isGameScene})`);
            this._startFromGameScene();
            return;
        }
        if (this.skipIntroScreens) {
            // Chế độ dev: bỏ qua Loading + Guide, khởi động game ngay
            if (USE_REAL_API) {
                console.log('[GameManager] start() → path: _startWithServerLogin (skipIntroScreens=true, real API)');
                this._startWithServerLogin();
            } else {
                console.log('[GameManager] start() → path: _startWithMockInit (skipIntroScreens=true, mock)');
                this._startWithMockInit();
            }
            return;
        }
        console.log('[GameManager] start() → path: waiting for LOADING_GATE_REACHED (single-scene mode)');
        // Single-scene mode: chờ LOADING_GATE_REACHED (bar được 90%)
        // rồi mới bắt đầu login/init — được lắng nghe trong _bindEvents()
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
        NetworkManager.instance.dispose();
        // Hủy listener screen events
        screen.off('window-resize', this._updateBackgroundSprite, this);
        screen.off('orientation-change', this._updateBackgroundSprite, this);
    }

    // ─── SERVER LOGIN + ENTER FLOW ───

    /**
     * Quy trình Login → Enter khi USE_REAL_API = true:
     *
     * 1. Lấy gp token từ URL (nếu production) hoặc dùng test login (dev)
     * 2. Gọi Login API → nhận SessionKey, MemberIdx, Seq, Aky
     * 3. Gọi Enter API → nhận ParSheet, balance, initial state
     * 4. Cập nhật GameData, WalletManager
     * 5. Bắt đầu HeartBeat + Jackpot polling
     * 6. Emit GAME_READY
     */
    private async _startWithServerLogin(): Promise<void> {
        const net = NetworkManager.instance;
        const data = GameData.instance;

        EventBus.instance.emit(GameEvents.LOGIN_START);
        // console.log('[GameManager] Bắt đầu Login Server...');

        try {
            // ─── Step 1: Login ───
            // Production: lấy gp token từ URL query params
            // Dev: dùng test login (không cần gp)
            const urlParams = new (window.URLSearchParams)(window.location.search);
            const gpToken = urlParams.get('gp');
            const loginParams = gpToken ? { gp: gpToken } : undefined;

            const session = await net.login(loginParams);
            // console.log(`[GameManager] Login OK — Nick: ${session.nick}, Cash: ${session.cash}`);

            // Cập nhật balance từ server
            WalletManager.instance.balance = session.cash;

            EventBus.instance.emit(GameEvents.LOGIN_SUCCESS, session);

            // ─── Step 2: Enter Game ───
            const enterResp = await net.enterGame();
            // console.log(`[GameManager] Enter OK — Slot: ${enterResp.slotName}, Cash: ${enterResp.cash}`);

            // Cập nhật balance từ Enter response (có thể khác login)
            WalletManager.instance.balance = enterResp.cash;

            // Cập nhật bet settings từ server
            data.player.betIndex = enterResp.betIndex;
            // TODO: Parse PS (ParSheet) để cập nhật reelStrips, paylines, etc.
            // data.config = parseParSheet(enterResp.ps);

            EventBus.instance.emit(GameEvents.ENTER_SUCCESS, enterResp);

            // ─── Step 3: Bắt đầu background tasks ───
            net.startHeartBeat();
            net.startJackpotPolling();

            // ─── Step 4: Kiểm tra LastSpinResponse — resume Free Spin nếu đang dở ───
            if (enterResp.lastSpinResponse) {
                const raw = enterResp.lastSpinResponse;
                console.error(`[RESUME-DEBUG] _startWithServerLogin lastSpinResponse: ${JSON.stringify(raw)}`);
                // API doc 5.1: field có thể là stageType (camelCase) hoặc NextStage (PascalCase)
                const lastStage: number = raw.NextStage ?? raw.stageType ?? 0;
                const remainFS: number  = raw.RemainFreeSpinCount ?? raw.remainFreeSpinCount ?? 0;
                const featureTotalWin: number = raw.FeatureSpinTotalWin ?? raw.featureSpinTotalWin ?? 0;
                const lastRands: number[] = raw.Rands ?? raw.rands ?? [];
                
                // ★ Log ALL cases, không chỉ resume
                const stageNames = {
                    0: 'SPIN', 3: 'FREE_SPIN_START', 4: 'FREE_SPIN', 5: 'FREE_SPIN_RE_TRIGGER',
                    8: 'BUY_FREE_SPIN_START', 9: 'BUY_FREE_SPIN',
                    100: 'NEED_CLAIM', 101: 'FREE_SPIN_END', 107: 'BUY_FREE_SPIN_END'
                };
                const stageName = (stageNames as any)[lastStage] || `UNKNOWN(${lastStage})`;
                console.error(`[GAME-ENTER] _startWithServerLogin → lastStage=${lastStage}(${stageName}), remainFS=${remainFS}, featureTotalWin=${featureTotalWin}`);

                if (lastStage === SlotStageType.FREE_SPIN
                    || lastStage === SlotStageType.BUY_FREE_SPIN
                    || lastStage === SlotStageType.FREE_SPIN_START
                    || lastStage === SlotStageType.FREE_SPIN_RE_TRIGGER
                    || lastStage === SlotStageType.BUY_FREE_SPIN_START) {
                    // Người chơi tắt game giữa chừng Free Spin → cần quay tiếp
                    if (remainFS > 0) {
                        console.log(`[GameManager] Resume Free Spin — NextStage=${lastStage}, remain=${remainFS}, featureTotalWin=${featureTotalWin}`);
                        this._pendingResume = {
                            nextStage: lastStage,
                            remainFreeSpinCount: remainFS,
                            featureSpinTotalWin: featureTotalWin,
                            lastSpinRands: lastRands.length >= 3 ? lastRands : undefined,
                        };
                    }
                } else if (lastStage >= 100) {
                    // Người chơi tắt game sau khi quay xong nhưng chưa Claim → Claim ngay
                    console.log(`[GameManager] Resume — NextStage=${lastStage} >= 100 → cần Claim, featureTotalWin=${featureTotalWin}`);
                    this._pendingResume = {
                        nextStage: lastStage,
                        remainFreeSpinCount: 0,
                        featureSpinTotalWin: featureTotalWin,
                        lastSpinRands: lastRands.length >= 3 ? lastRands : undefined,
                    };
                } else {
                    // stage=SPIN(0): ván cuối bị gián đoạn → khôi phục màn hình kết quả
                    if (lastStage === SlotStageType.SPIN && lastRands.length >= 3) {
                        console.error(`[GAME-ENTER] → NORMAL SPIN interrupted, rands=${JSON.stringify(lastRands)} → set _pendingResume NORMAL_SPIN`);
                        this._pendingResume = {
                            nextStage: SlotStageType.SPIN,
                            remainFreeSpinCount: 0,
                            featureSpinTotalWin: 0,
                            lastSpinRands: lastRands,
                        };
                    } else {
                        console.error(`[GAME-ENTER] → stage=${stageName} không cần resume, chơi game bình thường`);
                    }
                }
            } else {
                console.error(`[GAME-ENTER] _startWithServerLogin → NO lastSpinResponse, chơi game mới`);
            }

            // ★ Flag resume để GameEntryController skip guide
            // Chỉ skip guide khi FreeSpin/Claim cần xử lý ngay — Normal Spin resume không cần skip
            if (this._pendingResume && this._pendingResume.nextStage !== SlotStageType.SPIN) {
                data.isResumingFreeSpin = true;
                console.log(`[GameManager] Resume detected → set isResumingFreeSpin=true`);
            }

            // ─── Step 5: Emit initial data + Game Ready ───
            this._emitInitialData();

            if (this.skipIntroScreens) {
                EventBus.instance.emit(GameEvents.GAME_READY);
            }
            // Nếu không skip: chờ GUIDE_COMPLETE → _onGuideComplete → GAME_READY

        } catch (err: any) {
            console.error('[GameManager] ❌ Login/Enter Failed:', err.message || err);
            EventBus.instance.emit(GameEvents.LOGIN_FAILED, err.message || 'Login failed');
            // Nếu NetworkManager đã emit popup (ServerApiError.alreadyHandled), không emit lại
            if (!(err instanceof ServerApiError && err.alreadyHandled)) {
                const popupCase = PopUpMessage.popupCaseFromError(err);
                EventBus.instance.emit(GameEvents.SHOW_SYSTEM_POPUP, { popupCase });
            }
        }
    }

    // ─── GAME SCENE START (two-scene mode) ───

    /**
     * Được gọi khi isGameScene = true.
     * Login + Enter đã hoàn tất ở loading.scene bởi LoadingController.
     * GameData đã có đầy đủ: serverSession, balance, betIndex, isLoggedIn, isEntered.
     *
     * Flow:
     *   1. Emit LOADING_COMPLETE → GuideController hiển thị guide (hoặc skip nếu tắt)
     *   2. Sau GUIDE_COMPLETE → GAME_ENTRY_EFFECT → GAME_READY (đã bind trong _bindEvents)
     */
    private _startFromGameScene(): void {
        const data = GameData.instance;
        const net = NetworkManager.instance;

        if (!data.isEntered) {
            // Dữ liệu chưa được load (vào thẳng game scene mà không qua loading scene)
            // Fallback: chạy login ngay tại đây
            console.warn('[GameManager] isGameScene=true nhưng GameData chưa có dữ liệu — fallback login');
            if (USE_REAL_API) {
                console.warn('[GameManager] isGameScene=true nhưng GameData chưa có dữ liệu — fallback login (real API)');
                this._startWithServerLogin();
            } else {
                console.warn('[GameManager] isGameScene=true nhưng GameData chưa có dữ liệu — fallback mock init');
                // Dùng async _startWithMockInit để đọc lastSpinResponse + set _pendingResume.
                // LOADING_COMPLETE sẽ được emit bên trong _startWithMockInit sau khi data đã sẵn sàng.
                this._startWithMockInit(true); // true = emit LOADING_COMPLETE sau enterGame
            }
            return;
        }

        // HeartBeat + Jackpot polling (real API only, not yet started by LoadingController)
        if (USE_REAL_API) {
            net.startHeartBeat();
            net.startJackpotPolling();
            // Re-emit ENTER_SUCCESS để SlotMachineController trong game scene init reels
            // (ENTER_SUCCESS đã emit ở loading scene nhưng SlotMachineController chưa tồn tại)
            EventBus.instance.emit(GameEvents.ENTER_SUCCESS, {
                cash: WalletManager.instance.balance,
                slotName: 'SuperNova',
                ps: '',
                betIndex: data.player.betIndex,
                coinValueIndex: 0,
                lastSpinResponse: data.lastSpinResponse,
                isPractice: false,
                memberIdx: data.serverSession?.memberIdx ?? 0,
                smm: null,
            });
        } else {
            // Mock mode: gọi _startWithMockInit để emit ENTER_SUCCESS + xử lý lastSpinResponse
            // từ MOCK_RESUME_SCENARIO (giống luồng real API).
            // LOADING_COMPLETE được emit bên trong _startWithMockInit sau khi enterGame() hoàn tất.
            // ★ RETURN NGAY — tránh scheduleOnce(0) bên dưới emit LOADING_COMPLETE trước enterGame xong.
            this._startWithMockInit(true);
            return;
        }

        // Kiểm tra Free Spin resume (chỉ cho real API path — mock xử lý trong _startWithMockInit)
        if (USE_REAL_API) {
            const rawLast = data.rawEnterLastSpinResponse;
            console.error(`[RESUME-DEBUG] _startFromGameScene rawEnterLastSpinResponse: ${rawLast ? JSON.stringify(rawLast) : 'null'}`);
            if (rawLast) {
                // API doc 5.1: stageType (camelCase) hoặc NextStage (PascalCase)
                const lastStage: number = rawLast.NextStage ?? rawLast.stageType ?? 0;
                const remainFS: number  = rawLast.RemainFreeSpinCount ?? rawLast.remainFreeSpinCount ?? 0;
                const featureTotalWin: number = rawLast.FeatureSpinTotalWin ?? rawLast.featureSpinTotalWin ?? 0;
                const lastRands: number[] = rawLast.Rands ?? rawLast.rands ?? [];
                
                // ★ Log ALL cases
                const stageNames = {
                    0: 'SPIN', 3: 'FREE_SPIN_START', 4: 'FREE_SPIN', 5: 'FREE_SPIN_RE_TRIGGER',
                    8: 'BUY_FREE_SPIN_START', 9: 'BUY_FREE_SPIN',
                    100: 'NEED_CLAIM', 101: 'FREE_SPIN_END', 107: 'BUY_FREE_SPIN_END'
                };
                const stageName = (stageNames as any)[lastStage] || `UNKNOWN(${lastStage})`;
                console.error(`[GAME-ENTER] _startFromGameScene → lastStage=${lastStage}(${stageName}), remainFS=${remainFS}, featureTotalWin=${featureTotalWin}`);

                if (lastStage === SlotStageType.FREE_SPIN
                    || lastStage === SlotStageType.BUY_FREE_SPIN
                    || lastStage === SlotStageType.FREE_SPIN_START
                    || lastStage === SlotStageType.FREE_SPIN_RE_TRIGGER
                    || lastStage === SlotStageType.BUY_FREE_SPIN_START) {
                    if (remainFS > 0) {
                        console.error(`[RESUME-DEBUG] → set _pendingResume FREE_SPIN stage=${lastStage}, remain=${remainFS}`);
                        this._pendingResume = {
                            nextStage: lastStage,
                            remainFreeSpinCount: remainFS,
                            featureSpinTotalWin: featureTotalWin,
                            lastSpinRands: lastRands.length >= 3 ? lastRands : undefined,
                        };
                    } else {
                        console.error(`[RESUME-DEBUG] → remainFS=0, không resume`);
                    }
                } else if (lastStage >= 100) {
                    console.error(`[RESUME-DEBUG] → set _pendingResume NEED_CLAIM stage=${lastStage}`);
                    this._pendingResume = {
                        nextStage: lastStage,
                        remainFreeSpinCount: 0,
                        featureSpinTotalWin: featureTotalWin,
                        lastSpinRands: lastRands.length >= 3 ? lastRands : undefined,
                    };
                } else {
                    // stage=SPIN(0): ván cuối bị gián đoạn giữa chừng → khôi phục màn hình kết quả
                    if (lastStage === SlotStageType.SPIN && lastRands.length >= 3) {
                        console.error(`[GAME-ENTER] _startFromGameScene → NORMAL SPIN interrupted, rands=${JSON.stringify(lastRands)}, totalWin=${featureTotalWin} → set _pendingResume NORMAL_SPIN`);
                        this._pendingResume = {
                            nextStage: SlotStageType.SPIN,
                            remainFreeSpinCount: 0,
                            featureSpinTotalWin: featureTotalWin,
                            lastSpinRands: lastRands,
                        };
                    } else {
                        console.error(`[GAME-ENTER] _startFromGameScene → stage=${stageName} không cần resume`);
                    }
                }
            } else {
                console.error(`[GAME-ENTER] _startFromGameScene → NO rawEnterLastSpinResponse`);
            }

            // ★ Flag resume để GameEntryController skip guide
            // Chỉ skip guide khi FreeSpin/Claim cần xử lý ngay — Normal Spin resume không cần skip
            if (this._pendingResume && this._pendingResume.nextStage !== SlotStageType.SPIN) {
                data.isResumingFreeSpin = true;
                console.error(`[RESUME-DEBUG] → set isResumingFreeSpin=true`);
            }
        }

        // Dùng scheduleOnce(0) để defer sang frame tiếp theo:
        // đảm bảo TẤT CẢ start() trong scene đã chạy xong trước khi emit LOADING_COMPLETE.
        this.scheduleOnce(() => {
            this._emitInitialData();
            EventBus.instance.emit(GameEvents.LOADING_COMPLETE);
            console.error(`[RESUME-DEBUG] LOADING_COMPLETE emitted (skipIntroScreens=${this.skipIntroScreens}, hasPendingResume=${!!this._pendingResume})`);
            // Sau đó: GuideController show → GUIDE_COMPLETE → GAME_ENTRY_EFFECT → GAME_READY
        }, 0);

        // ★ skipIntroScreens: không có guide → emit GAME_READY trực tiếp (giống _startWithServerLogin).
        // Đảm bảo resume flow chạy ngay cả khi GameEntryController không có trong scene.
        if (this.skipIntroScreens) {
            this.scheduleOnce(() => {
                console.error(`[RESUME-DEBUG] _startFromGameScene → skipIntroScreens=true → emit GAME_READY`);
                EventBus.instance.emit(GameEvents.GAME_READY);
            }, 0.1);
        }

        // Trong super-html build, FontFace có thể chưa hoàn toàn sẵn sàng khi scene render lần đầu.
        // Emit LANGUAGE_CHANGED sau 1 frame để các LocaleFont/LanguageChange components re-apply font.
        this.scheduleOnce(() => {
            EventBus.instance.emit(GameEvents.LANGUAGE_CHANGED,
                LocalizationManager.instance.currentLanguage);
        }, 0.1);
    }

    // ─── EVENT BINDING ───

    private _bindEvents(): void {
        const bus = EventBus.instance;
        bus.on(GameEvents.LOADING_GATE_REACHED,            this._onLoadingGateReached,     this);
        bus.on(GameEvents.GUIDE_COMPLETE,                  this._onGuideComplete,          this);
        bus.on(GameEvents.SPIN_REQUEST,                    this._onSpinRequest,            this);
        bus.on(GameEvents.REELS_STOPPED,                   this._onReelsStopped,           this);
        bus.on(GameEvents.WIN_PRESENT_END,                 this._onWinPresentEnd,          this);
        bus.on(GameEvents.JACKPOT_END,                     this._onJackpotEnd,             this);
        bus.on(GameEvents.PROGRESSIVE_WIN_END,             this._onProgressiveWinEnd,      this);
        bus.on(GameEvents.FREE_SPIN_START,                 this._onFreeSpinStart,          this);
        bus.on(GameEvents.FREE_SPIN_END,                   this._onFreeSpinEnd,            this);
        bus.on(GameEvents.FREE_SPIN_END_POPUP_CLOSED,      this._onFreeSpinEndPopupClosed, this);
        bus.on(GameEvents.FREE_SPIN_MULTIPLIER_FLY_DONE,   this._onMultiplierFlyDone,      this);
        bus.on(GameEvents.FREE_SPIN_MULTIPLIER_SPIN,       this._onMultiplierSpinStart,    this);
        bus.on(GameEvents.BUY_BONUS_REQUEST,               this._onBuyBonusRequest,        this);
        bus.on(GameEvents.BUY_BONUS_CONFIRM,               this._onBuyBonusConfirm,        this);
        bus.on(GameEvents.BUY_BONUS_ACTIVATE,              this._onBuyBonusActivate,       this);
        bus.on(GameEvents.BUY_BONUS_DEACTIVATE,            this._onBuyBonusDeactivate,     this);
        bus.on(GameEvents.GAME_READY,                      this._onGameReady,              this);
    }

    // ─── LOADING GATE (90%) → BẮĐẦU TẢI DỮ LIỆU ───

    /** Bar đạt 90% — bộ độc login+enter (real) hoặc mock init */
    private _onLoadingGateReached(): void {
        if (this.skipIntroScreens) return; // đã xử lý trong start()
        if (USE_REAL_API) {
            this._startWithServerLogin();
        } else {
            this._startWithMockInit();
        }
    }

    // ─── GUIDE COMPLETE → KHỚI ĐỘNG GAME ───

    private _onGuideComplete(): void {
        console.error(`[RESUME-DEBUG] GameManager._onGuideComplete() fired — scheduling GAME_READY in 0.8s`);
        const sm = SoundManager.instance;
        console.warn('[GameManager] _onGuideComplete — SoundManager.instance:', sm ? 'EXISTS' : 'NULL',
            '| hasBgmSource:', sm ? !!sm.bgmSource : 'N/A',
            '| hasBgmMain:', sm ? !!sm.bgmMain : 'N/A');
        this._emitInitialData();
        EventBus.instance.emit(GameEvents.GAME_ENTRY_EFFECT);
        this.scheduleOnce(() => {
            const smAtFire = SoundManager.instance;
            console.warn('[GameManager] Emitting GAME_READY — SoundManager.instance:', smAtFire ? 'EXISTS' : 'NULL',
                '| hasBgmSource:', smAtFire ? !!smAtFire.bgmSource : 'N/A',
                '| hasBgmMain:', smAtFire ? !!smAtFire.bgmMain : 'N/A',
                '| timestamp:', Date.now());
            console.error(`[RESUME-DEBUG] GameManager._onGuideComplete → emit GAME_READY`);
            EventBus.instance.emit(GameEvents.GAME_READY);
        }, 0.8);
    }

    private _emitInitialData(): void {
        this._updateDisplayVisibility();
        EventBus.instance.emit(GameEvents.BALANCE_UPDATED, WalletManager.instance.balance);
        EventBus.instance.emit(GameEvents.BET_CHANGED, {
            betIndex: BetManager.instance.betIndex,
            currentBet: BetManager.instance.currentBet,
            coinValue: BetManager.instance.coinValue,
            totalBet: BetManager.instance.totalBet,
        });
    }

    /**
     * Async mock init — tương đương _startWithServerLogin() nhưng dùng MockNetworkAdapter.
     * Gọi enterGame() để lấy lastSpinResponse (bao gồm MOCK_RESUME_SCENARIO),
     * rồi set _pendingResume trước khi GAME_READY fire.
     *
     * @param emitLoadingComplete  Nếu true, emit LOADING_COMPLETE sau khi enterGame() xong
     *                             (dùng cho _startFromGameScene path — cần đợi _pendingResume set trước)
     */
    private async _startWithMockInit(emitLoadingComplete: boolean = false): Promise<void> {
        // Bước 1: init strips, psToClientMap, emit ENTER_SUCCESS cho SlotMachineController
        this._initMockMode();

        // Bước 2: gọi MockNetworkAdapter.enterGame() để lấy lastSpinResponse
        // (sẽ chứa dữ liệu từ MOCK_RESUME_SCENARIO nếu khác 'none')
        const enterResp = await NetworkManager.instance.enterGame();
        console.log(`[GameManager] Mock enterGame → lastSpinResponse: ${enterResp.lastSpinResponse ? JSON.stringify(enterResp.lastSpinResponse) : 'null'}`);

        // Bước 3: parse lastSpinResponse giống _startWithServerLogin
        if (enterResp.lastSpinResponse) {
            const lastStage: number = enterResp.lastSpinResponse.NextStage ?? 0;
            const remainFS: number  = enterResp.lastSpinResponse.RemainFreeSpinCount ?? 0;
            const featureTotalWin: number = enterResp.lastSpinResponse.FeatureSpinTotalWin ?? 0;
            const lastRands: number[] = enterResp.lastSpinResponse.Rands ?? [];

            // ★ Log ALL cases
            const stageNames = {
                0: 'SPIN', 3: 'FREE_SPIN_START', 4: 'FREE_SPIN', 5: 'FREE_SPIN_RE_TRIGGER',
                8: 'BUY_FREE_SPIN_START', 9: 'BUY_FREE_SPIN',
                100: 'NEED_CLAIM', 101: 'FREE_SPIN_END', 107: 'BUY_FREE_SPIN_END'
            };
            const stageName = (stageNames as any)[lastStage] || `UNKNOWN(${lastStage})`;
            console.error(`[GAME-ENTER] _startWithMockInit → lastStage=${lastStage}(${stageName}), remainFS=${remainFS}, featureTotalWin=${featureTotalWin}`);

            if (lastStage === SlotStageType.FREE_SPIN
                || lastStage === SlotStageType.BUY_FREE_SPIN
                || lastStage === SlotStageType.FREE_SPIN_START
                || lastStage === SlotStageType.FREE_SPIN_RE_TRIGGER
                || lastStage === SlotStageType.BUY_FREE_SPIN_START) {
                if (remainFS > 0) {
                    console.log(`[GameManager] Mock Resume: Free Spin — stage=${lastStage}, remain=${remainFS}, totalWin=${featureTotalWin}`);
                    this._pendingResume = {
                        nextStage: lastStage,
                        remainFreeSpinCount: remainFS,
                        featureSpinTotalWin: featureTotalWin,
                        lastSpinRands: lastRands.length >= 3 ? lastRands : undefined,
                    };
                }
            } else if (lastStage >= 100) {
                console.log(`[GameManager] Mock Resume: Need Claim — stage=${lastStage}, totalWin=${featureTotalWin}`);
                this._pendingResume = {
                    nextStage: lastStage,
                    remainFreeSpinCount: 0,
                    featureSpinTotalWin: featureTotalWin,
                    lastSpinRands: lastRands.length >= 3 ? lastRands : undefined,
                };
            } else {
                console.error(`[GAME-ENTER] _startWithMockInit → stage=${stageName} không cần resume (Normal Spin interrupted)`);
            }
        } else {
            console.error(`[GAME-ENTER] _startWithMockInit → NO lastSpinResponse`);
        }

        // ★ Flag resume để GameEntryController skip guide
        if (this._pendingResume) {
            GameData.instance.isResumingFreeSpin = true;
            console.log(`[GameManager] Mock Resume detected → set isResumingFreeSpin=true`);
        }

        // Bước 4a: emit LOADING_COMPLETE nếu được yêu cầu (isGameScene path)
        if (emitLoadingComplete) {
            console.log('[GameManager] _startWithMockInit → emit LOADING_COMPLETE');
            this._emitInitialData();
            EventBus.instance.emit(GameEvents.LOADING_COMPLETE);
            // Sau đó: GuideController chạy xong → GUIDE_COMPLETE → _onGuideComplete → GAME_READY
            return;
        }

        // Bước 4b: emit GAME_READY nếu skipIntroScreens (không có Guide)
        if (this.skipIntroScreens) {
            console.log('[GameManager] _startWithMockInit → emit GAME_READY (skipIntroScreens=true)');
            EventBus.instance.emit(GameEvents.GAME_READY);
        }
        // Nếu không skip: GuideController chạy xong → GUIDE_COMPLETE → _onGuideComplete → GAME_READY
    }

    /** Khởi tạo mock mode — giả lập Enter + PS data để các component như real API */
    private _initMockMode(): void {
        const data = GameData.instance;

        // Populate rawPsStrips từ default reelStrips (convert client ID → PS ID)
        data.rawPsStrips = data.config.reelStrips.map(strip =>
            strip.map(clientId => CLIENT_TO_PS[clientId] ?? 12)
        );

        // Populate psToClientMap từ PS_TO_CLIENT static mapping
        data.psToClientMap = { ...PS_TO_CLIENT };

        this._emitInitialData();

        // Emit ENTER_SUCCESS để SlotMachineController._onEnterSuccess() chạy
        // (init reel symbols từ PS strips trước khi quay)
        EventBus.instance.emit(GameEvents.ENTER_SUCCESS, {
            cash: WalletManager.instance.balance,
            slotName: 'SuperNova (Mock)',
            ps: '',
            betIndex: 0,
            coinValueIndex: 0,
            lastSpinResponse: null,
            isPractice: false,
            memberIdx: 0,
            smm: null,
        });
    }

    /** Clone bay xong (hoặc no-win skip) → bắt đầu auto-spin ngay */
    private _onMultiplierFlyDone(): void {
        this._flyDoneReceived = true;
        if (!this._waitingForFlyDone) return;
        this._waitingForFlyDone = false;
        this.unschedule(this._autoSpinCallback);
        // Pause nhỏ để label hiển thị trước khi spin mới bắt đầu
        this.scheduleOnce(this._autoSpinCallback, 0.4);
    }

    /** FREE_SPIN_START event → cập nhật background sprite sang FreeSpin + gọi popup logic */
    private _onFreeSpinStart(): void {
        this._updateBackgroundSprite();
        // Gọi logic cũ của popup closed: chuyển stage + emit events
        this._onFreeSpinPopupClosed();
    }

    /** FREE_SPIN_END event → cập nhật background sprite về Normal */
    private _onFreeSpinEnd(): void {
        this._updateDisplayVisibility();
        this._updateBackgroundSprite();
        // multiplierEffect ẩn cùng với kết thúc rolling
        if (this.multiplierEffect) this.multiplierEffect.active = false;
    }

    /** FREE_SPIN_MULTIPLIER_SPIN event → bật multiplierEffect cùng lúc rolling bắt đầu */
    private _onMultiplierSpinStart(): void {
        if (this.multiplierEffect) this.multiplierEffect.active = true;
    }

    private _onFreeSpinPopupClosed(): void {
        const data = GameData.instance;
        // Chỉ chuyển sang FREE_SPIN khi đang ở các stage START (không phải đang spin rồi)
        const isFreeSpinStartStage = (
            this._currentStage === SlotStageType.FREE_SPIN_START ||
            this._currentStage === SlotStageType.FREE_SPIN_RE_TRIGGER ||
            this._currentStage === SlotStageType.BUY_FREE_SPIN_START
        );
        if (data.freeSpinRemaining > 0 && isFreeSpinStartStage) {
            // Xác định stage phù hợp: nếu đang ở BUY_FREE_SPIN_START → BUY_FREE_SPIN, ngược lại → FREE_SPIN
            const targetStage = (this._currentStage === SlotStageType.BUY_FREE_SPIN_START)
                ? SlotStageType.BUY_FREE_SPIN
                : SlotStageType.FREE_SPIN;
            this._currentStage = targetStage;
            this._updateDisplayVisibility(); // ← chuyển sang FS display đúng lúc popup đóng và vòng quay bắt đầu
            console.log(`[GameManager] FreeSpinPopup đóng → stage chuyển sang ${targetStage}, remain=${data.freeSpinRemaining}`);
            EventBus.instance.emit(GameEvents.STAGE_CHANGED, targetStage);
            EventBus.instance.emit(GameEvents.UI_SPIN_BUTTON_STATE, true);
            this._gameState = GameState.IDLE;
            // Auto spin ngay sau popup đóng
            this.scheduleOnce(() => {
                EventBus.instance.emit(GameEvents.SPIN_REQUEST);
            }, 0.2);
        } else {
            console.warn(`[GameManager] FreeSpinPopup đóng nhưng điều kiện không hợp lệ: remain=${data.freeSpinRemaining}, stage=${this._currentStage}`);
        }
    }

    // ─── SPIN REQUEST ───

    private async _onSpinRequest(): Promise<void> {
        if (this._isSpinning) {
            return;
        }
        // Block spin khi đang xử lý result hoặc popup
        if (this._gameState === GameState.RESULT || this._gameState === GameState.POPUP) {
            return;
        }

        // console.log(`[SPIN] NHẤN SPIN`);

        const data = GameData.instance;
        const wallet = WalletManager.instance;
        const isFreeSpin = this._isFreeSpin();

        // Free Spin không trừ tiền
        if (!isFreeSpin) {
            const totalBet = BetManager.instance.totalBet;
            if (!wallet.canAfford(totalBet)) {
                // Thử refresh balance từ partner (e.g. player đã top-up bên ngoài)
                if (USE_REAL_API) {
                    try {
                        const result = await NetworkManager.instance.sendBalanceGet();
                        WalletManager.instance.balance = result.balance;
                        console.log(`%c[BalanceGet] Refreshed balance=${result.balance} ${result.currency}`, 'color:#0af;font-weight:bold');
                    } catch (err) {
                        console.warn('[BalanceGet] Failed to refresh balance:', err);
                    }
                }
                if (!wallet.canAfford(totalBet)) {
                    EventBus.instance.emit(GameEvents.SHOW_SYSTEM_POPUP, {
                        popupCase: PopupCase.INSUFFICIENT_BALANCE,
                        onConfirm: async () => {
                            try {
                                const result = await NetworkManager.instance.sendBalanceGet();
                                WalletManager.instance.balance = result.balance;
                            } catch (e) {
                                console.warn('[Spin] Refresh balance failed:', e);
                            }
                        },
                    });
                    return;
                }
            }
            // Real API: server tự trừ bet → không deduct locally
            // Mock: deduct locally để UI phản hồi ngay
            if (!USE_REAL_API) {
                wallet.deduct(totalBet);
            }
        }

        this._isSpinning = true;
        this._flyDoneReceived = false;
        this._hadLongSpin = false;
        this._longSpinHintPositions = [];
        this._gameState = GameState.SPINNING;
        // Clear stale fallback từ spin trước (Cocos scheduleOnce không replace delay đúng)
        this.unschedule(this._spinCycleFallback);
        EventBus.instance.emit(GameEvents.UI_SPIN_BUTTON_STATE, false);

        // ★ PHASE 1: Quay reel NGAY LẬP TỨC (không chờ server)
        EventBus.instance.emit(GameEvents.REELS_START_SPIN);

        // Multiplier Phase 1: bắt đầu rolling (chỉ trong Free Spin)
        if (isFreeSpin) {
            EventBus.instance.emit(GameEvents.FREE_SPIN_MULTIPLIER_SPIN);
        }

        // ★ PHASE 2: Gửi request (mock/real) — reel đang quay trong lúc chờ
        try {
            const response = await NetworkManager.instance.sendSpinRequest(isFreeSpin);
            data.lastSpinResponse = response;

            // Multiplier Phase 2: chốt hệ số khi biết kết quả từ server
            // Emit LOCK nếu server trả featureMultiple > 1 (bất kể có win hay không)
            const fm = response.featureMultiple;
            const willLock = isFreeSpin && fm != null && fm > 1;
            console.log(
                `%c[MULTIPLIER] isFS=${isFreeSpin} | featureMultiple=${fm ?? 'null'} | totalWin=${response.totalWin} | → ${willLock ? 'EMIT LOCK ✓' : 'no lock (mult=' + fm + ')'}`,
                willLock ? 'color:#0f0;font-weight:bold' : 'color:#888;'
            );
            if (willLock) {
                EventBus.instance.emit(GameEvents.FREE_SPIN_MULTIPLIER_LOCK, fm);
            }

            // Detect Long Spin — trả về danh sách vị trí hint nếu có
            const longSpinHints = this._getLongSpinHints(response);
            if (longSpinHints.length > 0) {
                this._hadLongSpin = true;
                this._longSpinHintPositions = longSpinHints;
                EventBus.instance.emit(GameEvents.LONG_SPIN_TRIGGERED);
                // Emit hint positions ngay để SlotMachineController lưu lại
                // (spine effect bắt đầu sau khi cột 2 dừng)
                EventBus.instance.emit(GameEvents.LONG_SPIN_SYMBOL_HINT, longSpinHints);
            }

            // ★ PHASE 2: Ra lệnh dừng reel với kết quả
            EventBus.instance.emit(GameEvents.SPIN_RESPONSE, response);
        } catch (err: any) {
            if (!isFreeSpin) {
                wallet.add(BetManager.instance.totalBet);
            }
            this._isSpinning = false;
            EventBus.instance.emit(GameEvents.UI_SPIN_BUTTON_STATE, true);
            // Nếu NetworkManager đã emit popup (ServerApiError.alreadyHandled), không emit lại
            if (!(err instanceof ServerApiError && err.alreadyHandled)) {
                const popupCase = PopUpMessage.popupCaseFromError(err);
                EventBus.instance.emit(GameEvents.SHOW_SYSTEM_POPUP, { popupCase });
            }
        }
    }

    // ─── REELS STOPPED → Evaluate Result ───

    private _onReelsStopped(): void {
        const data = GameData.instance;
        const resp = data.lastSpinResponse;
        if (!resp) {
            return;
        }

        this._gameState = GameState.RESULT;

        // Build grid string cho log (dùng lại ở các path bên dưới)
        const S = ['7','77','777','BAR','BB','3X','BNS','R⚡','B⚡'];
        const isFS = this._isFreeSpin();
        const g = [0,1,2].map(c => data.getVisibleSymbols(c, resp.rands[c], isFS).map(id => S[id]??`?${id}`));
        const gridStr = `[${g[0][0]}-${g[1][0]}-${g[2][0]}] [${g[0][1]}-${g[1][1]}-${g[2][1]}] [${g[0][2]}-${g[1][2]}-${g[2][2]}]`;

        // Check jackpot trước — jackpot KHÔNG áp dụng featureMultiple
        // Detect từ rawPsStrips (PS IDs gốc) cho cả real API lẫn mock.
        // Server KHÔNG trả winGrade='Grand' — jackpot phải detect từ symbols.
        const jackpot: JackpotType = this._detectJackpot(resp);
        if (jackpot !== JackpotType.NONE) {
            this._gameState = GameState.POPUP;
            // jackpotPrize = giá trị jackpot pool tương ứng (GRAND=idx3, MAJOR=idx2, MINOR=idx1, MINI=idx0)
            // Dùng pool value thay vì totalWin để popup hiển thị đúng tiền thưởng jackpot.
            const jackpotPrize = data.jackpotValues[jackpot - 1] ?? resp.totalWin;
            const names: Record<number,string> = {1:'MINI',2:'MINOR',3:'MAJOR',4:'GRAND'};

            if (this._isFreeSpin()) {
                // Trong free spin: tích lũy vào freeSpinTotalWin, KHÔNG cập nhật wallet ngay.
                // Wallet sẽ được cập nhật sau Claim (FREE_SPIN_END).
                if (resp.totalWin > 0) {
                    data.freeSpinTotalWin += resp.totalWin;
                }
                // Giảm free spin counter như các vòng thường
                this._freeSpinActualCount++;
                const remaining = data.freeSpinRemaining - 1;
                data.freeSpinRemaining = Math.max(0, remaining);
                EventBus.instance.emit(GameEvents.FREE_SPIN_COUNT_UPDATED, data.freeSpinRemaining);
                console.log(`[SPIN RESULT] ${gridStr} | 🏆 JACKPOT (FreeSpin) ${names[jackpot]} prize=$${jackpotPrize.toFixed(2)} totalWin=$${resp.totalWin.toFixed(2)} | freeSpinTotalWin=${data.freeSpinTotalWin.toFixed(2)}`);
            } else {
                // Normal spin: cập nhật wallet ngay
                if (USE_REAL_API && resp.remainCash != null) {
                    WalletManager.instance.balance = resp.remainCash;
                } else {
                    WalletManager.instance.add(resp.totalWin);
                }
                EventBus.instance.emit(GameEvents.BALANCE_UPDATED, WalletManager.instance.balance);
                console.log(`[SPIN RESULT] ${gridStr} | 🏆 JACKPOT ${names[jackpot]} prize=$${jackpotPrize.toFixed(2)} totalWin=$${resp.totalWin.toFixed(2)} | Balance: $${WalletManager.instance.balance.toFixed(2)}`);
            }

            // Delay jackpot popup nếu là long spin để player kịp thấy highlight
            // Trước khi delay: emit JACKPOT_REVEAL để SymbolHighlighter phát spine 3 symbol cùng lúc
            // Với mọi jackpot (kể cả không phải long spin) — để SymbolHighlighter có entries cho loop sau popup
            let jackpotPositions = this._longSpinHintPositions;
            if (jackpotPositions.length < 3) {
                jackpotPositions = this._getLongSpinHints(resp);
            }
            if (jackpotPositions.length >= 3) {
                EventBus.instance.emit(GameEvents.LONG_SPIN_JACKPOT_REVEAL, jackpotPositions, jackpot);
            }
            const jackpotDelay = this._hadLongSpin ? 0.5 : 0;
            this.scheduleOnce(() => {
                EventBus.instance.emit(GameEvents.JACKPOT_TRIGGER, jackpot, jackpotPrize);
                // Fallback: nếu không có JackpotPresenter thì tự complete sau 8s
                this.scheduleOnce(this._spinCycleFallback, 8.0);
            }, jackpotDelay);
            return;
        }

        // Cộng tiền thắng khi reel dừng
        // Trong free spin: server trả updateCash=false → chỉ tích lũy freeSpinTotalWin,
        // KHÔNG cập nhật wallet ngay. Balance sẽ được cập nhật sau Claim (FREE_SPIN_END).
        if (resp.totalWin > 0) {
            if (this._isFreeSpin()) {
                // Chỉ tích lũy — KHÔNG cập nhật wallet
                GameData.instance.freeSpinTotalWin += resp.totalWin;
            } else {
                // Normal spin: cập nhật wallet ngay
                if (USE_REAL_API && resp.remainCash != null) {
                    WalletManager.instance.balance = resp.remainCash;
                } else {
                    WalletManager.instance.add(resp.totalWin);
                }
            }
        } else if (!this._isFreeSpin() && USE_REAL_API && resp.remainCash != null) {
            // Không thắng, không phải free spin: sync balance từ server (đã trừ bet)
            WalletManager.instance.balance = resp.remainCash;
        }
        // Cập nhật số lần free spin còn lại
        if (this._isFreeSpin()) {
            this._freeSpinActualCount++;
            const remaining = GameData.instance.freeSpinRemaining - 1;
            GameData.instance.freeSpinRemaining = Math.max(0, remaining);
            EventBus.instance.emit(GameEvents.FREE_SPIN_COUNT_UPDATED, GameData.instance.freeSpinRemaining);
        }

        // Schedule fallback TRƯỚC khi emit WIN_PRESENT_START.
        // Lý do: WinPresenter có thể emit WIN_PRESENT_END đồng bộ (sync) khi totalWin=0,
        // khi đó _onWinPresentEnd.unschedule() cần fallback đã được đăng ký sẵn để hủy.
        // Nếu schedule SAU emit → fallback trở thành zombie timer → double-process spin sau.
        const _hasWinForFallback = resp.matchedLinePays.length > 0 || resp.totalWin > 0;
        if (_hasWinForFallback) {
            this.unschedule(this._spinCycleFallback);
            this.scheduleOnce(this._spinCycleFallback, 2.0);
        }

        // Luôn emit WIN_PRESENT_START để UI cập nhật label (cả win lẫn no-win)
        EventBus.instance.emit(GameEvents.WIN_PRESENT_START, resp);

        {
            const lines = resp.matchedLinePays;
            if (lines.length > 0 || resp.totalWin > 0) {
                const data = GameData.instance;
                const PS_NAME: Record<number,string> = {12:'7',13:'77',14:'777',2:'BAR',3:'BB',23:'3X',22:'R⚡',21:'B⚡',98:'BNS',99:'___'};
                const fmtPs = (id: number) => PS_NAME[id] ?? `ps${id}`;
                const SYM_NAME = ['7','77','777','BAR','BB','3X','BNS','R⚡','B⚡'];
                const fmtCl = (id: number) => id < 0 ? '___' : (SYM_NAME[id] ?? `?${id}`);

                // Chi tiết từng line thắng
                const lineDetails = lines.map((l: any) => {
                    const payLineIdx = l.payLineIndex;
                    const payline = data.config.paylines[payLineIdx] || [1, 1, 1];  // [row0, row1, row2]
                    const rawRands = resp.rands;  // [rand0, rand1, rand2]
                    // FreeSpin dùng rawFsStrips (PS IDs) nếu có, không thì rawPsStrips
                    const rawStrips = isFS && data.rawPsFreeSpinStrips.length > 0
                        ? data.rawPsFreeSpinStrips
                        : data.rawPsStrips;

                    // Lấy 3 symbol thực tế (server gốc) từ payline + rands
                    // step=1 no snap — khớp với visual đang hiển thị
                    const paylineSymbols: number[] = [];
                    for (let c = 0; c < 3; c++) {
                        const row = payline[c];  // row index (0=top, 1=mid, 2=bot)
                        const rand = rawRands[c];
                        const strip = rawStrips[c] || [];
                        const len = strip.length;
                        const centerIdx = ((rand % len) + len) % len;
                        // row 0=top(center-1), row 1=mid(center), row 2=bot(center+1)
                        const symbolIdx = ((centerIdx + (row - 1)) % len + len) % len;
                        paylineSymbols.push(strip[symbolIdx] ?? 99);
                    }

                    const psSyms = paylineSymbols.map(fmtPs).join('-');
                    const clSyms = paylineSymbols.map((psId: number) => fmtCl(data.psToClientMap[psId] ?? -1)).join('-');

                    // Detect win type từ payline symbols
                    let winType = 'Normal';
                    const sevenIds = [12, 13, 14];
                    const barIds = [2, 3];
                    const wildIds = [21, 22, 23];

                    if (paylineSymbols.some((id: number) => wildIds.includes(id))) {
                        winType = 'Wild';
                    } else if (paylineSymbols.every((id: number) => sevenIds.includes(id))) {
                        winType = paylineSymbols[0] === paylineSymbols[1] && paylineSymbols[1] === paylineSymbols[2] ? '777' : 'Any-7';
                    } else if (paylineSymbols.every((id: number) => barIds.includes(id))) {
                        winType = paylineSymbols[0] === paylineSymbols[1] && paylineSymbols[1] === paylineSymbols[2] ? 'BAR×3' : 'Any-Bar';
                    } else if (paylineSymbols.includes(98)) {
                        winType = 'Scatter';
                    }

                    // So sánh với matchedSymbols từ server (giúp verify logic detect)
                    const matched = (l.matchedSymbols || []).map(fmtPs).join('-');
                    const matchedCL = (l.matchedSymbols || []).map((psId: number) => fmtCl(data.psToClientMap[psId] ?? -1)).join('-');

                    return `[Line${payLineIdx}] Payline: ${psSyms}(${clSyms}) | Matched: ${matched}(${matchedCL}) | ${winType} | +$${l.payout.toFixed(2)}`;
                }).join('\n  ');

                let detail = `💰 WIN +$${resp.totalWin.toFixed(2)}`;
                if (lines.length > 0) detail += ` (${lines.length}L)`;
                if (resp.featureMultiple && resp.featureMultiple > 1) detail += ` ×${resp.featureMultiple}`;
                console.log(
                    `[SPIN RESULT] ${gridStr} | ${detail} | Balance: $${WalletManager.instance.balance.toFixed(2)}\n` +
                    `  ${lineDetails}`
                );
                // (Fallback đã được schedule ở trên, trước WIN_PRESENT_START)
            } else {
                console.log(`[SPIN RESULT] ${gridStr} | — Không trúng | Balance: $${WalletManager.instance.balance.toFixed(2)}`);
            }
        }
    }

    // ─── SAU KHI WIN PRESENTATION XONG ───

    private _onWinPresentEnd(): void {
        this.unschedule(this._spinCycleFallback);
        this._checkProgressiveWin(() => {
            this._afterWinProcessed();
        });
    }

    private _onJackpotEnd(): void {
        this.unschedule(this._spinCycleFallback);

        // Resume path: jackpot popup vừa đóng sau khi resume → tiếp tục resume flow
        if (this._pendingResumeAfterJackpot) {
            const resume = this._pendingResumeAfterJackpot;
            this._pendingResumeAfterJackpot = null;
            this._executeResume(resume);
            return;
        }

        this._gameState = GameState.RESULT;
        const resp = GameData.instance.lastSpinResponse;

        if (this._isFreeSpin()) {
            // Trong free spin: sau jackpot popup đóng, hiện WIN animation trước rồi mới auto-spin.
            // Emit WIN_PRESENT_START để UIController highlight symbol và animate tổng tiền tích lũy.
            // KHÔNG gọi _afterWinProcessed() ngay — chờ WIN_PRESENT_END để highlight xong rồi mới spin tiếp.
            if (resp) {
                EventBus.instance.emit(GameEvents.WIN_PRESENT_START, resp);
                // Fallback nếu WinPresenter không emit WIN_PRESENT_END (ví dụ: totalWin=0)
                if (resp.totalWin > 0 || resp.matchedLinePays.length > 0) {
                    this.unschedule(this._spinCycleFallback);
                    this.scheduleOnce(this._spinCycleFallback, 3.0);
                } else {
                    this._afterWinProcessed();
                }
            } else {
                this._afterWinProcessed();
            }
            return;
        }

        // Sau jackpot popup (Normal spin): kiểm tra winGrade → hiện Progressive Win nếu đủ ngưỡng.
        if (resp && resp.winGrade) {
            const tier = this._winGradeToTier(resp.winGrade);
            if (tier) {
                this._gameState = GameState.POPUP;
                EventBus.instance.emit(GameEvents.PROGRESSIVE_WIN_SHOW, tier, resp.totalWin);
                return; // PROGRESSIVE_WIN_END → _onProgressiveWinEnd → _afterWinProcessed
            }
        }
        this._afterWinProcessed();
    }

    /** Progressive Win đóng xong → tiếp tục flow */
    private _onProgressiveWinEnd(): void {
        if (this._isSpinning) {
            // Normal spin path: _afterWinProcessed chưa chạy → để nó hoàn tất cycle
            this._gameState = GameState.RESULT;
            this._afterWinProcessed();
        } else {
            // FreeSpinEnd path hoặc fallback đã clear _isSpinning → reset trực tiếp
            this._gameState = GameState.IDLE;
            EventBus.instance.emit(GameEvents.UI_SPIN_BUTTON_STATE, true);
        }
    }

    /** FreeSpinEndPopup đóng xong → emit FREE_SPIN_END thật sự + check progressive win */
    private _onFreeSpinEndPopupClosed(): void {
        const data = GameData.instance;
        const totalWin = data.freeSpinTotalWin;

        // Mock mode: cộng tổng tiền free spin vào balance ngay tại đây.
        // Real API: balance đã được sync từ server trong _handleClaim() trước khi popup hiện.
        // ★ Nếu freeSpinTotalWin được restore từ server (resume), MockNetworkAdapter.sendClaimRequest
        //   đã xử lý đúng balance rồi — không add thêm ở đây nữa.
        if (!USE_REAL_API && totalWin > 0 && !data.freeSpinTotalWinRestoredFromServer) {
            WalletManager.instance.add(totalWin);
        }

        EventBus.instance.emit(GameEvents.FREE_SPIN_END, totalWin);

        data.freeSpinRemaining = 0;
        data.freeSpinTotalWin = 0;
        data.freeSpinTotalWinRestoredFromServer = false;
        data.isResumingFreeSpin = false;
        this._currentStage = SlotStageType.SPIN;
        this._gameState = GameState.IDLE;

        // Check progressive win cho tổng tiền free spin
        const totalBet = BetManager.instance.totalBet;
        const tier = this._getProgressiveTier(totalWin, totalBet);
        if (tier) {
            this._gameState = GameState.POPUP;
            EventBus.instance.emit(GameEvents.PROGRESSIVE_WIN_SHOW, tier, totalWin);
            // PROGRESSIVE_WIN_END → _onProgressiveWinEnd sẽ tiếp tục
        } else {
            // Không có progressive win → enable spin button ngay
            EventBus.instance.emit(GameEvents.UI_SPIN_BUTTON_STATE, true);
        }
    }

    /**
     * Kiểm tra ngưỡng Progressive Win sau khi spin xong.
     * KHÔNG check nếu là vòng free spin (tích lũy đến cuối mới check tổng).
     */
    private _checkProgressiveWin(onNone: () => void): void {
        const data = GameData.instance;
        const resp = data.lastSpinResponse;
        if (!resp || resp.totalWin <= 0) { onNone(); return; }

        // Trong free spin hoặc vừa kết thúc free spin (FREE_SPIN_END):
        // KHÔNG hiện progressive each round, chờ đến cuối (xử lý trong _onFreeSpinEndPopupClosed)
        if (this._isFreeSpin() ||
            this._currentStage === SlotStageType.FREE_SPIN_END ||
            this._currentStage === SlotStageType.BUY_FREE_SPIN_END) {
            onNone(); return;
        }

        let tier: ProgressiveWinTier | null = null;
        if (USE_REAL_API && resp.winGrade) {
            // Real API: dùng winGrade từ server — tránh tính lại không chính xác
            tier = this._winGradeToTier(resp.winGrade);
        } else {
            // Mock: tính từ ratio totalWin / totalBet
            const totalBet = BetManager.instance.totalBet;
            tier = this._getProgressiveTier(resp.totalWin, totalBet);
        }
        if (!tier) { onNone(); return; }

        this._gameState = GameState.POPUP;
        EventBus.instance.emit(GameEvents.PROGRESSIVE_WIN_SHOW, tier, resp.totalWin);
        // PROGRESSIVE_WIN_END → _onProgressiveWinEnd → onNone đã được gọi từ đó riêng
    }

    /** Map server winGrade string → ProgressiveWinTier */
    private _winGradeToTier(winGrade: string): ProgressiveWinTier | null {
        switch (winGrade.toLowerCase()) {
            case 'mega':  return ProgressiveWinTier.MEGA;
            case 'super': return ProgressiveWinTier.SUPER;
            case 'big':   return ProgressiveWinTier.BIG;
            default:      return null; // "Normal" = không hiện popup
        }
    }

    /** Map server winGrade string → JackpotType (cho real API jackpot detection) */
    private _winGradeToJackpotType(winGrade?: string): JackpotType {
        if (!winGrade) return JackpotType.NONE;
        switch (winGrade.toLowerCase()) {
            case 'grand': return JackpotType.GRAND;
            case 'major': return JackpotType.MAJOR;
            case 'minor': return JackpotType.MINOR;
            case 'mini':  return JackpotType.MINI;
            default:      return JackpotType.NONE; // 'Invalid', 'Normal', ''
        }
    }

    private _getProgressiveTier(win: number, totalBet: number): ProgressiveWinTier | null {
        for (const entry of PROGRESSIVE_WIN_THRESHOLDS) {
            if (win >= totalBet * entry.multiplier) {
                return entry.tier;
            }
        }
        return null;
    }

    private _afterWinProcessed(): void {
        if (!this._isSpinning) return; // guard: tránh gọi 2 lần
        const data = GameData.instance;
        const resp = data.lastSpinResponse;
        if (!resp) return;

        // Kiểm tra trước khi chuyển stage: spin hiện tại có phải Normal không?
        const wasNormalSpin = !this._isFreeSpin();

        // Chuyển stage
        this._transitionStage(resp.nextStage as SlotStageType);

        this._isSpinning = false;
        // Nếu _transitionStage đặt state POPUP (ví dụ FREE_SPIN_END → popup tổng kết),
        // không override → chờ popup đóng rồi mới reset
        if (this._gameState !== GameState.POPUP) {
            this._gameState = GameState.IDLE;
            EventBus.instance.emit(GameEvents.UI_SPIN_BUTTON_STATE, true);

            // Emit NORMAL_SPIN_DONE để AutoSpinManager có thể trigger auto spin tiếp theo.
            // Chỉ emit khi spin vừa rồi là Normal và stage tiếp theo vẫn là SPIN bình thường
            // (không emit nếu vừa vào FREE_SPIN_START, hoặc FREE_SPIN_END, v.v.)
            if (wasNormalSpin && (resp.nextStage as SlotStageType) === SlotStageType.SPIN) {
                EventBus.instance.emit(GameEvents.NORMAL_SPIN_DONE);
            }
        }
    }

    // ─── STATE TRANSITIONS ───

    private _transitionStage(nextStage: SlotStageType): void {
        const prevStage = this._currentStage;
        this._currentStage = nextStage;

        EventBus.instance.emit(GameEvents.STAGE_CHANGED, nextStage, prevStage);

        switch (nextStage) {
            case SlotStageType.FREE_SPIN_START:
            case SlotStageType.BUY_FREE_SPIN_START: {
                // Initial trigger: Real API dùng RemainFreeSpinCount; Mock mặc định 3
                const spinResp = GameData.instance.lastSpinResponse;
                const fsCount = (USE_REAL_API && spinResp?.remainFreeSpinCount != null && spinResp.remainFreeSpinCount > 0)
                    ? spinResp.remainFreeSpinCount
                    : 3;
                this._enterFreeSpin(fsCount, false);
                break;
            }
            case SlotStageType.FREE_SPIN_RE_TRIGGER: {
                // Retrigger TRONG free spin:
                // Real API: remainFreeSpinCount = TỔNG còn lại (server cộng dồn, đã trừ lượt vừa quay) → SET
                // Mock: remainFreeSpinCount = remaining trước lượt này + 5 (chưa trừ) → SET
                // → Dùng remainFreeSpinCount từ response cho cả 2 trường hợp
                const spinResp = GameData.instance.lastSpinResponse;
                const fsCount = (spinResp?.remainFreeSpinCount != null && spinResp.remainFreeSpinCount > 0)
                    ? spinResp.remainFreeSpinCount
                    : GameData.instance.freeSpinRemaining + 5; // fallback: giữ remaining hiện tại + 5
                this._enterFreeSpin(fsCount, true);
                break;
            }

            case SlotStageType.FREE_SPIN:
            case SlotStageType.BUY_FREE_SPIN:
                // Đợi clone animation bay xong (FLY_DONE) rồi mới auto-spin.
                // Đảm bảo multiplierLabel hiển thị đúng hệ số hiện tại khi clone hạ cánh.
                if (this._flyDoneReceived) {
                    // FLY_DONE đã fire trước đó (ví dụ: JackpotPopup/ProgressiveWin popup
                    // hiện ra và đóng sau khi clone bay xong) → auto-spin ngay
                    this.scheduleOnce(this._autoSpinCallback, 0.4);
                } else {
                    // Clone vẫn đang bay → chờ FLY_DONE, fallback 2.5s
                    this._waitingForFlyDone = true;
                    this.scheduleOnce(this._autoSpinCallback, 2.5);
                }
                break;

            case SlotStageType.FREE_SPIN_END:
            case SlotStageType.BUY_FREE_SPIN_END:
                // Set POPUP immediately so _afterWinProcessed() won't override to IDLE
                // and spin button won't be enabled during the delay before popup shows.
                this._gameState = GameState.POPUP;
                // Delay để cho highlight vòng quay cuối diễn xong trước khi hiện popup tổng kết.
                // WIN_PRESENT_END fire sau spinEnableDelay (1s), thêm delay này để user thấy highlight.
                // Tuỳ chỉnh từ Inspector: freeSpinEndPopupDelay (default=2.0)
                console.log(`[GameManager] FREE_SPIN_END transition — scheduling FreeSpinEndPopup display after ${this.freeSpinEndPopupDelay}s`);
                this.scheduleOnce(() => {
                    if (USE_REAL_API) {
                        this._handleClaim();
                    } else {
                        this._endFreeSpin();
                    }
                }, this.freeSpinEndPopupDelay);
                break;

            case SlotStageType.NEED_CLAIM:
                this._handleClaim();
                break;

            case SlotStageType.SPIN:
                // Quay bình thường, chờ người chơi nhấn Spin
                break;
        }
    }

    // ─── GAME READY → RESUME FREE SPIN NẾU CÓ ───

    private _onGameReady(): void {
        console.error(`[RESUME-DEBUG] _onGameReady() — _pendingResume: ${this._pendingResume ? 'SET stage=' + this._pendingResume.nextStage + ' win=' + this._pendingResume.featureSpinTotalWin : 'null'}`);
        
        // ★ Fallback: Ensure SoundManager starts BGM if not already started
        // (Handles timing issues where GAME_READY fires before SoundManager fully initialized)
        if (SoundManager.instance) {
            console.error(`[GameManager] _onGameReady → SoundManager status:`, SoundManager.instance.getStatus?.());
            SoundManager.instance.initBGM?.();
        }

        if (!this._pendingResume) return;
        const resume = this._pendingResume;
        this._pendingResume = null;

        // Khôi phục freeSpinTotalWin từ server (FeatureSpinTotalWin)
        if (resume.featureSpinTotalWin > 0) {
            GameData.instance.freeSpinTotalWin = resume.featureSpinTotalWin;
            // Đánh dấu: tổng này đã được server tính sẵn (bao gồm cả jackpot/win trước đó)
            // → mock sendClaimRequest sẽ KHÔNG add thêm lần nữa vào balance (tránh double-add)
            GameData.instance.freeSpinTotalWinRestoredFromServer = true;
            console.log(`[GameManager] Resume: Restored freeSpinTotalWin=${resume.featureSpinTotalWin} (flagged as server-restored)`);
        }

        // Detect jackpot từ lastSpinResponse → hiện popup jackpot trước khi resume
        // (spec: "Pot Win: bắt đầu từ hiệu ứng trúng Pot")
        if (resume.lastSpinRands && resume.lastSpinRands.length >= 3) {
            const jackpotCheckResp: SpinResponse = {
                rands: resume.lastSpinRands,
                matchedLinePays: [],
                totalBet: 0,
                totalWin: 0,
                updateCash: false,
                nextStage: resume.nextStage,
            };
            const jackpot = this._detectJackpot(jackpotCheckResp);
            console.log(`[GameManager] Resume: _detectJackpot(rands=${JSON.stringify(resume.lastSpinRands)}) → ${jackpot} (NONE=0,MINI=1,MINOR=2,MAJOR=3,GRAND=4)`);
            if (jackpot !== JackpotType.NONE) {
                const data = GameData.instance;
                const jackpotPrize = data.jackpotValues[jackpot - 1] ?? 0;
                console.log(`[GameManager] Resume: Jackpot ${jackpot} detected (prize=${jackpotPrize}) → emit JACKPOT_TRIGGER`);
                this._pendingResumeAfterJackpot = {
                    nextStage: resume.nextStage,
                    remainFreeSpinCount: resume.remainFreeSpinCount,
                    featureSpinTotalWin: resume.featureSpinTotalWin,
                    lastSpinRands: resume.lastSpinRands,
                };
                this._gameState = GameState.POPUP;
                EventBus.instance.emit(GameEvents.JACKPOT_TRIGGER, jackpot, jackpotPrize);
                return;
            }
        }

        this._executeResume(resume);
    }

    /**
     * Thực thi resume flow: vào Free Spin hoặc Claim.
     * Tách riêng để gọi được từ _onGameReady (no jackpot) và _onJackpotEnd (after jackpot popup).
     */
    private _executeResume(resume: { nextStage: number; remainFreeSpinCount: number; featureSpinTotalWin: number; lastSpinRands?: number[] }): void {
        console.error(`[RESUME-DEBUG] _executeResume() — nextStage=${resume.nextStage}, remainFS=${resume.remainFreeSpinCount}`);

        // NextStage = SPIN(0): vòng quay thường bị gián đoạn → khôi phục màn hình kết quả cuối
        if (resume.nextStage === SlotStageType.SPIN) {
            const rawLast = GameData.instance.rawEnterLastSpinResponse;
            if (rawLast && (rawLast.Rands ?? rawLast.rands ?? []).length >= 3) {
                console.error(`[RESUME-DEBUG] _executeResume → NORMAL_SPIN resume`);
                const resp = this._buildSpinResponseFromRaw(rawLast);
                GameData.instance.lastSpinResponse = resp;
                // Set spinning=true trước khi REELS_STOPPED — _afterWinProcessed cần guard này
                this._isSpinning = true;
                this._gameState = GameState.SPINNING;
                EventBus.instance.emit(GameEvents.RESUME_NORMAL_SPIN, resp.rands);
            } else {
                console.error(`[RESUME-DEBUG] _executeResume → SPIN resume nhưng thiếu rands, bỏ qua`);
            }
            return;
        }

        // NextStage >= 100 → Free Spin đã kết thúc nhưng chưa Claim
        // Không cần switch visual sang freespin mode — chỉ cần Claim và hiện end popup.
        if (resume.nextStage >= 100) {
            console.error(`[RESUME-DEBUG] _executeResume → _handleClaim() (stage=${resume.nextStage})`);
            // ★ Đặt _currentStage phù hợp để _endFreeSpin / _onFreeSpinEndPopupClosed xử lý đúng
            this._currentStage = resume.nextStage as SlotStageType;
            this._handleClaim();
            return;
        }

        // NextStage = FREE_SPIN/BUY_FREE_SPIN → resume quay tiếp
        if (resume.remainFreeSpinCount > 0) {
            const isBuyVariant = (resume.nextStage === SlotStageType.BUY_FREE_SPIN
                               || resume.nextStage === SlotStageType.BUY_FREE_SPIN_START);

            if (resume.nextStage === SlotStageType.FREE_SPIN
             || resume.nextStage === SlotStageType.BUY_FREE_SPIN) {
                // Stage 4 / 9 (mid-session): đang giữa phiên → skip popup, vào thẳng free spin
                console.error(`[RESUME-DEBUG] _executeResume → stage=${resume.nextStage} MID-SESSION resume, skip popup, remain=${resume.remainFreeSpinCount}`);
                const data = GameData.instance;
                data.freeSpinRemaining = resume.remainFreeSpinCount;
                data.freeSpinTotalWin = resume.featureSpinTotalWin;  // ★ Khôi phục tổng tiền đã kiếm được
                data.freeSpinTotalWinRestoredFromServer = true;  // ★ Mark as restored
                this._freeSpinActualCount = 0;
                const targetStage = isBuyVariant ? SlotStageType.BUY_FREE_SPIN : SlotStageType.FREE_SPIN;
                this._currentStage = targetStage;
                EventBus.instance.emit(GameEvents.FREE_SPIN_COUNT_UPDATED, data.freeSpinRemaining);
                this._updateDisplayVisibility();
                EventBus.instance.emit(GameEvents.STAGE_CHANGED, targetStage);
                // ★ Emit FREE_SPIN_START để SoundManager chuyển bgmFreeSpin và UIController
                //   khôi phục label. _currentStage đã là FREE_SPIN nên _onFreeSpinPopupClosed
                //   sẽ không trigger auto-spin thêm lần nữa (guard isFreeSpinStartStage=false).
                EventBus.instance.emit(GameEvents.FREE_SPIN_START);
                EventBus.instance.emit(GameEvents.UI_SPIN_BUTTON_STATE, true);
                this._gameState = GameState.IDLE;
                this.scheduleOnce(() => {
                    EventBus.instance.emit(GameEvents.SPIN_REQUEST);
                }, 0.2);
            } else {
                // Stage 3 (FREE_SPIN_START), 5 (FREE_SPIN_RE_TRIGGER), 8 (BUY_FREE_SPIN_START):
                // hiện popup thông báo → đóng → auto-spin
                const startStage = isBuyVariant
                    ? SlotStageType.BUY_FREE_SPIN_START
                    : (resume.nextStage === SlotStageType.FREE_SPIN_RE_TRIGGER
                        ? SlotStageType.FREE_SPIN_RE_TRIGGER
                        : SlotStageType.FREE_SPIN_START);
                console.error(`[RESUME-DEBUG] _executeResume → stage=${resume.nextStage} START/RETRIGGER resume, show popup (currentStage→${startStage}), remain=${resume.remainFreeSpinCount}`);
                this._currentStage = startStage;
                this._gameState = GameState.POPUP;  // ★ Block spin ngay — tránh player nhấn Spin trong lúc chờ popup
                EventBus.instance.emit(GameEvents.UI_SPIN_BUTTON_STATE, false);
                const isRetrigger = (resume.nextStage === SlotStageType.FREE_SPIN_RE_TRIGGER);
                // ★ Delay 0.5s để gameRoot fade-in hoàn tất (fadeDuration=0.4s) trước khi hiện popup
                // tránh popup xuất hiện khi gameRoot đang ở opacity thấp
                this.scheduleOnce(() => {
                    this._enterFreeSpin(resume.remainFreeSpinCount, isRetrigger);
                }, 0.5);
            }
        }
    }

    // ─── BUY BONUS ───

    /**
     * Chuyển đổi raw LastSpinResponse (PascalCase hoặc camelCase) từ Enter API
     * thành SpinResponse client format để dùng trong resume normal spin.
     * Balance đã đúng (server đã cộng win vào Cash khi Enter) → remainCash = balance hiện tại.
     */
    private _buildSpinResponseFromRaw(raw: any): SpinResponse {
        const rands: number[]  = raw.Rands ?? raw.rands ?? [];
        const totalWin: number = raw.TotalWin ?? raw.totalWin ?? 0;
        const totalBet: number = raw.TotalBet ?? raw.totalBet ?? 0;
        const winGrade: string = raw.WinGrade ?? raw.winGrade ?? '';

        const rawLines: any[] = raw.MatchedLinePays ?? raw.matchedLinePays ?? [];
        const matchedLinePays: MatchedLinePay[] = rawLines.map((l: any) => ({
            payLineIndex:          l.PayLineIndex          ?? l.payLineIndex          ?? 0,
            payout:                l.Payout                ?? l.payout                ?? 0,
            matchedSymbols:        l.MatchedSymbols        ?? l.matchedSymbols        ?? [],
            containsWild:          l.ContainsWild          ?? l.containsWild          ?? false,
            reelCnt:               l.ReelCnt               ?? l.reelCnt               ?? 0,
            matchedSymbolsIndices: l.MatchedSymbolsIndices ?? l.matchedSymbolsIndices ?? null,
        }));

        return {
            rands,
            matchedLinePays,
            totalBet,
            totalWin,
            updateCash: false,          // Balance đã đúng từ Enter.Cash — không cộng thêm
            nextStage: SlotStageType.SPIN,
            winGrade:    winGrade || undefined,
            remainCash:  WalletManager.instance.balance,  // Sync về balance hiện tại (no-op)
        };
    }

    /** Người chơi bấm nút Buy Bonus → gọi API lấy danh sách gói */
    private async _onBuyBonusRequest(): Promise<void> {
        if (this._isSpinning || this._gameState !== GameState.IDLE) {
            console.warn(`[BuyBonus] Request bị bỏ qua — isSpinning=${this._isSpinning}, gameState=${this._gameState}`);
            return;
        }
        if (this._isFreeSpin()) {
            console.warn(`[BuyBonus] Không cho mua khi đang Free Spin (stage=${this._currentStage})`);
            return;
        }

        console.log('[BuyBonus] Đang tải danh sách gói mua bonus...');
        try {
            const items = await NetworkManager.instance.sendFeatureItemGet();
            console.log(`[BuyBonus] Tải xong ${items.length} gói — emit BUY_BONUS_ITEMS_LOADED`);
            EventBus.instance.emit(GameEvents.BUY_BONUS_ITEMS_LOADED, items);
        } catch (err: any) {
            console.error('[BuyBonus] FeatureItemGet failed:', err.message || err);
            EventBus.instance.emit(GameEvents.BUY_BONUS_FAILED, err.message || 'Failed to load items');
        }
    }

    /** Người chơi xác nhận mua gói Feature */
    private async _onBuyBonusConfirm(item: FeatureItem): Promise<void> {
        if (this._isSpinning || this._isFreeSpin()) return;

        // Giá tuyệt đối = priceRatio × totalBet
        const cost = item.priceRatio * BetManager.instance.totalBet;

        console.log(`[BuyBonus] Xác nhận mua: "${item.title}" | itemId=${item.itemId} | cost=${cost}`);

        // Kiểm tra balance
        const wallet = WalletManager.instance;
        if (!wallet.canAfford(cost)) {
            console.warn(`[BuyBonus] Không đủ số dư: balance=${wallet.balance} < cost=${cost}`);
            EventBus.instance.emit(GameEvents.BUY_BONUS_FAILED, 'Insufficient balance');
            EventBus.instance.emit(GameEvents.SHOW_SYSTEM_POPUP, {
                popupCase: PopupCase.INSUFFICIENT_BALANCE,
                onConfirm: async () => {
                    try {
                        const result = await NetworkManager.instance.sendBalanceGet();
                        WalletManager.instance.balance = result.balance;
                    } catch (e) {
                        console.warn('[BuyBonus] Refresh balance failed:', e);
                    }
                },
            });
            return;
        }

        this._gameState = GameState.POPUP;
        EventBus.instance.emit(GameEvents.UI_SPIN_BUTTON_STATE, false);

        try {
            console.log(`[BuyBonus] Gửi FeatureItemBuy(itemId=${item.itemId})...`);
            const result = await NetworkManager.instance.sendFeatureItemBuy(item.itemId, false);
            console.log(`[BuyBonus] FeatureItemBuy response: isSuccess=${result.isSuccess}, remainCash=${result.remainCash}, hasRes=${!!result.res}`);

            if (!result.isSuccess) {
                this._gameState = GameState.IDLE;
                EventBus.instance.emit(GameEvents.UI_SPIN_BUTTON_STATE, true);
                EventBus.instance.emit(GameEvents.BUY_BONUS_FAILED, 'Purchase rejected by server');
                return;
            }

            // Cập nhật balance sau khi trừ tiền mua
            WalletManager.instance.balance = result.remainCash;
            EventBus.instance.emit(GameEvents.BALANCE_UPDATED, result.remainCash);
            console.log(`[BuyBonus] Balance cập nhật → ${result.remainCash}`);

            // Lấy số lượt free spin từ server Res, item.addSpinValue, hoặc mặc định 10
            const freeSpinCount = result.res?.RemainFreeSpinCount
                ?? result.res?.remainFreeSpinCount
                ?? item.addSpinValue
                ?? 10;
            console.log(`[BuyBonus] Số Free Spin sẽ nhận: ${freeSpinCount} (từ res=${result.res?.RemainFreeSpinCount ?? result.res?.remainFreeSpinCount}, item.addSpinValue=${item.addSpinValue})`);

            // 1. Chuyển stage sang BUY_FREE_SPIN_START để popup biết dùng path BUY
            this._currentStage = SlotStageType.BUY_FREE_SPIN_START;
            // Không gọi _updateDisplayVisibility() ở đây — display sẽ chuyển sang FS mode
            // đúng lúc FreeSpinPopup đóng trong _onFreeSpinPopupClosed()

            // 2. Emit SUCCESS để BuyBonusPopup đóng cửa
            EventBus.instance.emit(GameEvents.BUY_BONUS_SUCCESS, { remainCash: result.remainCash });

            // 3. Gọi _enterFreeSpin → set data.freeSpinRemaining, emit FREE_SPIN_COUNT_UPDATED, FREE_SPIN_POPUP
            //    FreeSpinPopup sẽ hiện lên → đóng → emit FREE_SPIN_START → _onFreeSpinPopupClosed → auto-spin
            console.log(`[BuyBonus] Bắt đầu _enterFreeSpin(${freeSpinCount}) — giống luồng trúng bonus tự nhiên`);
            this._gameState = GameState.POPUP; // Giữ POPUP trong khi popup hiện
            this._enterFreeSpin(freeSpinCount);

        } catch (err: any) {
            console.error('[BuyBonus] FeatureItemBuy failed:', err.message || err);
            this._gameState = GameState.IDLE;
            EventBus.instance.emit(GameEvents.UI_SPIN_BUTTON_STATE, true);
            EventBus.instance.emit(GameEvents.BUY_BONUS_FAILED, err.message || 'Purchase failed');
            // Nếu NetworkManager đã emit popup (ServerApiError.alreadyHandled), không emit lại
            if (!(err instanceof ServerApiError && err.alreadyHandled)) {
                EventBus.instance.emit(GameEvents.SHOW_SYSTEM_POPUP, { popupCase: PopupCase.DISCONNECTED });
            }
        }
    }

    /** Activate item (EffectType 2/3): gọi FeatureItemBuy, không vào FreeSpin */
    private async _onBuyBonusActivate(item: FeatureItem): Promise<void> {
        if (this._isSpinning || this._isFreeSpin()) return;

        console.log(`[BuyBonus] Activate: "${item.title}" | itemId=${item.itemId} | priceRatio=${item.priceRatio}`);
        try {
            const result = await NetworkManager.instance.sendFeatureItemBuy(item.itemId, true);
            console.log(`[BuyBonus] Activate response: isSuccess=${result.isSuccess}, remainCash=${result.remainCash}`);

            if (!result.isSuccess) {
                EventBus.instance.emit(GameEvents.BUY_BONUS_FAILED, 'Activate rejected by server');
                return;
            }

            WalletManager.instance.balance = result.remainCash;
            EventBus.instance.emit(GameEvents.BALANCE_UPDATED, result.remainCash);

            // Nếu server trả RemainCash=0 (behaviour bất thường với activate) → refresh từ server
            if (result.remainCash <= 0) {
                try {
                    const balanceResult = await NetworkManager.instance.sendBalanceGet();
                    WalletManager.instance.balance = balanceResult.balance;
                    EventBus.instance.emit(GameEvents.BALANCE_UPDATED, balanceResult.balance);
                } catch { /* ignore balance refresh error */ }
            }

            // Thông báo UIController cập nhật Total Bet display (x1+ratio, đổi màu)
            const adjustedBet = BetManager.instance.totalBet * (1 + item.priceRatio);
            EventBus.instance.emit(GameEvents.BUY_BONUS_TOTAL_BET_CHANGED, { displayBet: adjustedBet, isActive: true });

            EventBus.instance.emit(GameEvents.BUY_BONUS_ACTIVATE_SUCCESS, {
                itemId: item.itemId,
                priceRatio: item.priceRatio,
                remainCash: result.remainCash,
            });
        } catch (err: any) {
            console.error('[BuyBonus] Activate failed:', err.message || err);
            EventBus.instance.emit(GameEvents.BUY_BONUS_FAILED, err.message || 'Activate failed');
        }
    }

    /** Deactivate item: gọi FeatureItemBuy với ItemId=0 (cancellation) */
    private async _onBuyBonusDeactivate(): Promise<void> {
        console.log('[BuyBonus] Deactivate — gọi FeatureItemBuy(0) for cancellation');
        try {
            const result = await NetworkManager.instance.sendFeatureItemBuy(0, false);
            console.log(`[BuyBonus] Deactivate response: isSuccess=${result.isSuccess}`);
            if (!result.isSuccess) {
                EventBus.instance.emit(GameEvents.BUY_BONUS_FAILED, 'Deactivate rejected by server');
                return;
            }

            // Doc: On cancellation RemainCash is always 0 — refresh balance from server
            const balanceResult = await NetworkManager.instance.sendBalanceGet();
            WalletManager.instance.balance = balanceResult.balance;
            EventBus.instance.emit(GameEvents.BALANCE_UPDATED, balanceResult.balance);

            // Khôi phục Total Bet display về bình thường
            EventBus.instance.emit(GameEvents.BUY_BONUS_TOTAL_BET_CHANGED, { displayBet: BetManager.instance.totalBet, isActive: false });

            EventBus.instance.emit(GameEvents.BUY_BONUS_DEACTIVATE_SUCCESS);
        } catch (err: any) {
            console.error('[BuyBonus] Deactivate failed:', err.message || err);
            EventBus.instance.emit(GameEvents.BUY_BONUS_FAILED, err.message || 'Deactivate failed');
        }
    }

    // ─── FREE SPIN MANAGEMENT ───

    private _enterFreeSpin(count: number, isRetrigger: boolean = false): void {
        const data = GameData.instance;

        if (isRetrigger) {
            // Retrigger: count = TỔNG remaining sau khi cộng lượt mới
            // Real API: server tính sẵn (đã trừ lượt vừa quay + cộng mới)
            // Mock: remaining trước lượt này + 5 (chưa trừ, GameManager SET trực tiếp)
            // → Luôn SET (không cộng) để đảm bảo hiển thị đúng
            data.freeSpinRemaining = count;
        } else {
            // Initial trigger: freeSpinRemaining = 0 trước đó → += = SET
            data.freeSpinRemaining += count;
            // Reset flag retrigger mock để cho phép retrigger trong session mới
            if (!USE_REAL_API) {
                MockDataProvider.resetFreeSpinState();
            }
        }

        // BUG FIX: đặt state POPUP để _afterWinProcessed không set về IDLE,
        // tránh auto-spin kích hoạt trong khi popup retrigger đang hiện.
        this._gameState = GameState.POPUP;

        // Chỉ reset counter khi trigger lần đầu, KHÔNG reset khi retrigger
        if (!isRetrigger) {
            this._freeSpinActualCount = 0;
        }
        EventBus.instance.emit(GameEvents.FREE_SPIN_COUNT_UPDATED, data.freeSpinRemaining);

        // Highlight spine trên symbol Bonus (cả initial trigger lẫn retrigger)
        // → tạo cảm giác kịch tính trước khi hiện popup
        const spinResp = data.lastSpinResponse;
        if (spinResp && spinResp.rands.length >= 3) {
            const col2Symbols = data.getVisibleSymbols(2, spinResp.rands[2]);
            const bonusRow = col2Symbols.indexOf(SymbolId.BONUS);
            if (bonusRow >= 0) {
                EventBus.instance.emit(GameEvents.FREE_SPIN_BONUS_REVEAL, [{ reelIndex: 2, rowIndex: bonusRow }]);
                // Delay popup 0.5s để spine effect phát trước
                this.scheduleOnce(() => {
                    EventBus.instance.emit(GameEvents.FREE_SPIN_POPUP, data.freeSpinRemaining);
                }, 0.5);
                return;
            }
        }

        // Hiện popup thông báo → popup sẽ tự emit FREE_SPIN_START khi đóng
        EventBus.instance.emit(GameEvents.FREE_SPIN_POPUP, data.freeSpinRemaining);
    }

    private _endFreeSpin(): void {
        const data = GameData.instance;
        const totalWin = data.freeSpinTotalWin;
        const spinCount = this._freeSpinActualCount;
        this._gameState = GameState.POPUP;

        console.error(`[RESUME-DEBUG] _endFreeSpin() → emit FREE_SPIN_END_POPUP totalWin=${totalWin}, spinCount=${spinCount}`);
        // Hiện popup tổng kết → _onFreeSpinEndPopupClosed sẽ emit FREE_SPIN_END + check progressive
        EventBus.instance.emit(GameEvents.FREE_SPIN_END_POPUP, totalWin, spinCount);
    }

    private async _handleClaim(): Promise<void> {
        console.error(`[RESUME-DEBUG] _handleClaim() START — freeSpinTotalWin=${GameData.instance.freeSpinTotalWin}`);
        // Set POPUP ngay (sync) để _afterWinProcessed không enable spin button trong lúc await
        this._gameState = GameState.POPUP;
        try {
            const result = await NetworkManager.instance.sendClaimRequest();
            WalletManager.instance.balance = result.balance;
            // Cập nhật freeSpinTotalWin từ server để FreeSpinEndPopup hiển thị đúng số tiền
            if (result.winCash != null) {
                GameData.instance.freeSpinTotalWin = result.winCash;
            }
            console.error(`[RESUME-DEBUG] _handleClaim SUCCESS — balance=${result.balance}, winCash=${result.winCash}, freeSpinTotalWin=${GameData.instance.freeSpinTotalWin}`);
            // Hiện popup tổng kết Free Spin (sẽ reset stage khi đóng)
            this._endFreeSpin();
        } catch (err) {
            console.error('[Claim] Error:', err);
            // ★ Resume fallback: nếu freeSpinTotalWin đã được restore từ server (resume path),
            // vẫn hiện popup tổng kết để user claim — tránh kẹt game.
            const data = GameData.instance;
            if (data.freeSpinTotalWin > 0) {
                console.warn(`[Claim] Claim API failed nhưng freeSpinTotalWin=${data.freeSpinTotalWin} > 0 → vẫn hiện FreeSpinEndPopup`);
                this._endFreeSpin();
            } else {
                this._gameState = GameState.IDLE;
                this._currentStage = SlotStageType.SPIN;
                EventBus.instance.emit(GameEvents.UI_SPIN_BUTTON_STATE, true);
            }
        }
    }

    // ─── HELPERS ───

    private _isFreeSpin(): boolean {
        return (
            this._currentStage === SlotStageType.FREE_SPIN ||
            this._currentStage === SlotStageType.FREE_SPIN_START ||
            this._currentStage === SlotStageType.FREE_SPIN_RE_TRIGGER ||
            this._currentStage === SlotStageType.BUY_FREE_SPIN_START ||
            this._currentStage === SlotStageType.BUY_FREE_SPIN
        );
    }

    /**
     * Cập nhật background sprite theo orientation + spin mode (Normal/Free Spin).
     * Normal Spin: backgroundSprites[0=portrait/1=landscape]
     * Free Spin: freeSpinBackgroundSprites[0=portrait/1=landscape]
     */
    private _updateBackgroundSprite(): void {
        if (!this.backgroundNode) return;

        const isFreeSpin = this._isFreeSpin();
        const sprites = isFreeSpin ? this.freeSpinBackgroundSprites : this.backgroundSprites;
        if (sprites.length < 2) return;

        const size = screen.windowSize;
        const isPortrait = size.height > size.width;
        const spriteComponent = this.backgroundNode.getComponent(Sprite);

        if (spriteComponent) {
            spriteComponent.spriteFrame = isPortrait ? sprites[0] : sprites[1];
            //spriteComponent.color= !isFreeSpin ? new Color(83, 120, 145) : new Color(207,124,124); // Ví dụ: đổi màu hồng nhạt khi free spin
        }
    }

    /**
     * Cập nhật visibility của PayOutDisplay và MultiplierDisplay dựa vào spin mode.
     * Normal Spin: hiện PayOutDisplay, ẩn MultiplierDisplay
     * Free Spin: ẩn PayOutDisplay, hiện MultiplierDisplay
     */
    private _updateDisplayVisibility(): void {
        const isFreeSpin = this._isFreeSpin();

        if (this.payOutDisplay) {
            this.payOutDisplay.active = !isFreeSpin;
        }

        if (this.multiplierDisplay) {
            this.multiplierDisplay.active = isFreeSpin;
        }

        // multiplierEffect được điều khiển riêng bằng FREE_SPIN_MULTIPLIER_SPIN / FREE_SPIN_END
        // để đảm bảo active cùng lúc với MultiplierDisplay rolling bắt đầu
    }

    /**
     * Kiểm tra Long Spin: reel 0 VÀ reel 1 đều có jackpot symbol trên CÙNG 1 payline.
     * Trả về mảng {reelIndex, rowIndex} của 2 symbol đó (để bounce hint).
     * Nếu không có → trả về [] (không trigger long spin).
     */
    private _getLongSpinHints(resp: SpinResponse): { reelIndex: number; rowIndex: number }[] {
        const data = GameData.instance;
        const specialSymbols = [SymbolId.WILD_3X, SymbolId.RED_LIGHTNING, SymbolId.BLUE_LIGHTNING];
        const paylines = data.config.paylines;

        const col0 = data.getVisibleSymbols(0, resp.rands[0]);
        const col1 = data.getVisibleSymbols(1, resp.rands[1]);

        for (const line of paylines) {
            const sym0 = col0[line[0]];
            const sym1 = col1[line[1]];
            if (specialSymbols.indexOf(sym0) >= 0 && specialSymbols.indexOf(sym1) >= 0) {
                return [
                    { reelIndex: 0, rowIndex: line[0] },
                    { reelIndex: 1, rowIndex: line[1] },
                    { reelIndex: 2, rowIndex: line[2] }, // reel2 row trên cùng payline — dùng cho jackpot reveal
                ];
            }
        }
        return [];
    }

    /**
     * Detect jackpot từ rawPsStrips (PS IDs gốc từ server) + jackpotPsIds từ PS JSON.
     *
     * Server dùng jackpot symbol IDs riêng (MiniJackpotID/MinorJackpotID/MajorJackpotID/GrandJackpotID)
     * thay vì winGrade để biểu thị jackpot — client phải tự detect từ symbols.
     *
     * Ưu tiên kiểm tra theo thứ tự: GRAND > MAJOR > MINOR > MINI.
     * Nếu rawPsStrips chưa có (mock mode) → fallback sang client SymbolId.
     */
    private _detectJackpot(resp: SpinResponse): JackpotType {
        const data = GameData.instance;
        const paylines = data.config.paylines;
        const rawStrips = data.rawPsStrips;
        const jpIds = data.jackpotPsIds;

        for (const line of paylines) {
            // ── Ưu tiên: dùng rawPsStrips (PS IDs gốc) ──────────────────────
            if (rawStrips.length === 3) {
                const psSyms: number[] = [];
                for (let col = 0; col < 3; col++) {
                    const strip = rawStrips[col];
                    const L = strip.length;
                    const center = ((resp.rands[col] % L) + L) % L;
                    // row 0=top(center-1), 1=mid(center), 2=bot(center+1)
                    const offset = line[col] - 1;
                    const idx = ((center + offset) % L + L) % L;
                    psSyms.push(strip[idx] ?? -1);
                }
                if (psSyms.every(id => id === jpIds.GRAND))  return JackpotType.GRAND;
                if (psSyms.every(id => id === jpIds.MAJOR))  return JackpotType.MAJOR;
                if (psSyms.every(id => id === jpIds.MINOR))  return JackpotType.MINOR;
                if (psSyms.every(id => id === jpIds.MINI))   return JackpotType.MINI;
            }

            // ── Fallback: client SymbolId (mock mode, rawPsStrips chưa có) ──
            const symbols: number[] = [];
            for (let col = 0; col < 3; col++) {
                const visible = data.getVisibleSymbols(col, resp.rands[col]);
                symbols.push(visible[line[col]]);
            }
            if (symbols.every(s => s === SymbolId.WILD_3X))          return JackpotType.GRAND;
            if (symbols.every(s => s === SymbolId.RED_LIGHTNING))     return JackpotType.MAJOR;
            if (symbols.every(s => s === SymbolId.BLUE_LIGHTNING))    return JackpotType.MINOR;
            const specials = [SymbolId.WILD_3X, SymbolId.RED_LIGHTNING, SymbolId.BLUE_LIGHTNING];
            if (symbols.every(s => specials.includes(s)) && !symbols.every(s => s === symbols[0])) {
                return JackpotType.MINI;
            }
        }

        return JackpotType.NONE;
    }

    // ─── PUBLIC GETTERS ───

    get currentStage(): SlotStageType { return this._currentStage; }
    get isSpinning(): boolean { return this._isSpinning; }
    get gameState(): GameState { return this._gameState; }
}

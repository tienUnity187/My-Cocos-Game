/**
 * LoadingController - Màn hình tải game (Loading View).
 *
 * ★ PREFAB MODE (khuyến nghị cho super-html build — tránh mất font khi chuyển scene):
 *   1. Trong Cocos Editor, mở scene.scene → chọn tất cả children của Canvas
 *      (KHÔNG bao gồm Canvas node chính) → chuột phải → "Create Prefab from Selection"
 *      → lưu vào assets/prefabs/GameScene.prefab (trong assets folder để dùng resources.load)
 *   2. Điền "gamePrefabPath" = "prefabs/GameScene" (không cần .prefab extension)
 *   3. (Tuỳ chọn) Gắn Canvas node của loading.scene vào slot "Game Container"
 *   4. Bật handleServerLogin = true, xoá targetScene, tắt useScenePreload
 *   
 *   LỢI THẾ: Prefab KHÔNG được preload khi mở scene, chỉ load khi cần
 *           → tránh loading lâu ở lúc mở scene, và font không bị mất.
 *
 * ★ TWO-SCENE MODE (legacy):
 *   - Điền targetScene, bật useScenePreload, bật handleServerLogin
 *
 * Flow:
 *   start() → animate loading bar song song với Login+Enter server
 *   Khi bar ĐẦY và login xong → fade out → load + instantiate gamePrefab (prefab mode)
 *                                         HOẶC director.loadScene (two-scene mode)
 *                                         HOẶC emit LOADING_COMPLETE (single-scene mode)
 */

import { _decorator, Component, Node, ProgressBar, UIOpacity, tween, Vec3, Label, director, instantiate, assetManager, AssetManager, Prefab } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { L } from '../core/LocalizationManager';
import { NetworkManager } from '../manager/NetworkManager';
import { WalletManager } from '../manager/WalletManager';
import { GameData } from '../data/GameData';
import { USE_REAL_API, ServerConfig } from '../data/ServerConfig';
import { CdnAssetManager } from '../core/CdnAssetManager';
import { LocalizationManager } from '../core/LocalizationManager';
import { FontManager } from '../manager/FontManager';

const { ccclass, property } = _decorator;

@ccclass('LoadingController')
export class LoadingController extends Component {

    @property({ type: Node, tooltip: 'Logo node của nhà phát triển (sẽ có hiệu ứng nhịp thở)' })
    logoNode: Node | null = null;

    @property({ type: ProgressBar, tooltip: 'Thanh loading bar (ProgressBar component)' })
    loadingBar: ProgressBar | null = null;

    @property({ type: UIOpacity, tooltip: 'UIOpacity của LoadingView để fade-out khi xong' })
    uiOpacity: UIOpacity | null = null;

    @property({ tooltip: 'Thời gian loading bar animation (giây) — chỉ dùng khi useScenePreload = false' })
    loadingDuration: number = 2.5;

    @property({ type: Label, tooltip: 'Note' })
    noteLabel: Label | null = null;

    // ─── TWO-SCENE LOADING MODE ───

    @property({
        tooltip: '[Two-scene mode] Tên scene game sẽ preload và chuyển sang (vd: "game").\n' +
                 'Để trống = chế độ một scene (LoadingController chỉ fade-out rồi emit LOADING_COMPLETE).'
    })
    targetScene: string = '';

    @property({
        tooltip: '[Two-scene mode] Khi true: dùng director.preloadScene() thay vì fake timer.\n' +
                 'Thanh loading sẽ phản ánh tiến độ tải asset thực tế (0→90%).\n' +
                 'Yêu cầu targetScene được điền.'
    })
    useScenePreload: boolean = false;

    @property({
        tooltip: '[Two-scene mode] Khi true: LoadingController tự gọi Login+Enter ở đây,\n' +
                 'không cần GameManager. Kết quả được lưu vào GameData để game scene đọc.\n' +
                 'Dùng khi loading.scene không có GameManager component.'
    })
    handleServerLogin: boolean = false;

    // ─── PREFAB MODE ───

    @property({
        tooltip: '[Prefab mode] Tên AssetBundle chứa prefab (vd: "prefabs").\n' +
                 'Phải khớp với tên bundle được đánh dấu isBundle trong Cocos Editor.',
    })
    gameBundleName: string = 'prefabs';

    @property({
        tooltip: '[Prefab mode] Tên prefab bên trong bundle (vd: "GameScene", không cần .prefab extension).\n' +
                 'Nếu set, LoadingController load bundle rồi instantiate prefab vào cùng scene.\n' +
                 'Hoạt động ở cả editor preview lẫn web build.\n' +
                 'Font sẽ không bị mất khi game start.\n' +
                 'Ưu tiên cao hơn targetScene khi cả hai đều được set.',
    })
    gamePrefabPath: string = '';

    @property({
        type: Node,
        tooltip: '[Prefab mode] Node parent để gắn gamePrefab vào.\n' +
                 'Thường là Canvas của loading.scene.\n' +
                 'Để trống = dùng scene root (director.getScene()).'
    })
    gameContainer: Node | null = null;

    private _elapsed: number = 0;
    private _loadCb: (() => void) | null = null;
    /** Bar đã đạt 80% (sau khi bundle load xong trong prefab mode, hoặc fake timer xong trong các mode khác) */
    private _barDone: boolean = false;
    /** Server đã trả ENTER_SUCCESS hoặc login done internally chưa */
    private _serverReady: boolean = false;
    /** 0→90% preload đã xong, đang chờ server */
    private _preloadDone: boolean = false;
    /** Prefab đã load xong từ resources (prefab mode) */
    private _prefabReady: boolean = false;
    /** Prefab asset đã load — dùng để instantiate ngay lập tức khi bar 100% */
    private _loadedPrefab: any = null;
    /** Node đã instantiate và ẩn sẵn — chỉ cần active=true khi bar 100% */
    private _instantiatedGameNode: Node | null = null;


    /** Guard: _onLoadComplete đã chạy một lần rồi, không chạy lại */
    private _completed: boolean = false;

    // ─── LIFECYCLE ───

    onLoad(): void {
        // ★ Khởi tạo ngôn ngữ sớm nhất có thể — trước khi bất kỳ Label nào render.
        //   Đọc DEV_FORCE_LANG (từ ServerConfig) hoặc localStorage 'supernova_lang'.
        LocalizationManager.instance.loadSavedLanguage();

        // Lắng nghe ENTER_SUCCESS từ server (hoặc mock) — điều kiện để unlock LOADING_COMPLETE
        EventBus.instance.on(GameEvents.ENTER_SUCCESS, this._onServerReady, this);
        if (this.noteLabel) {
          //  this.noteLabel.string = L('UI_START_LOADING_1');
        }
    }

    start(): void {
        // Two-scene mode: nếu đã login xong ở loading.scene thì bỏ qua toàn bộ.
        // GameManager (isGameScene=true) sẽ emit LOADING_COMPLETE sau khi guide.
        if (GameData.instance.isEntered) {
            this.node.active = false;
            return;
        }

        if (this.loadingBar) this.loadingBar.progress = 0;
        if (this.uiOpacity) this.uiOpacity.opacity = 255;

        // Logo: hiệu ứng nhịp thở nhẹ
        if (this.logoNode) {
            tween(this.logoNode)
                .to(0.9, { scale: new Vec3(1.06, 1.06, 1) }, { easing: 'sineInOut' })
                .to(0.9, { scale: new Vec3(1.00, 1.00, 1) }, { easing: 'sineInOut' })
                .union()
                .repeatForever()
                .start();
        }

        this._startLoadingBar();
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
        if (this._loadCb) {
            this.unschedule(this._loadCb);
            this._loadCb = null;
        }
    }

    // ─── SERVER READY (single-scene mode) ───

    private _onServerReady(): void {
        this._serverReady = true;
        if (this._barDone) {
            this._tryFillToFull();
        }
    }

    // ─── LOADING BAR ───

    private _startLoadingBar(): void {
        // Prefab mode không cần preloadScene — prefab đã bundled trong main bundle
        if (this.useScenePreload && this.targetScene && !this.gamePrefabPath) {
            this._startScenePreload();
        } else {
            this._startFakeTimer();
        }
    }

    // ─── SCENE PRELOAD (two-scene mode) ───

    private _startScenePreload(): void {
        director.preloadScene(
            this.targetScene,
            (finished: number, total: number) => {
                // Map preload progress → 0 to 85% (leave buffer for server + fill animation)
                const p = total > 0 ? (finished / total) * 0.85 : 0;
                if (this.loadingBar) {
                    this.loadingBar.progress = Math.max(this.loadingBar.progress, p);
                }
            },
            (err) => {
                if (err) console.error('[LoadingController] Preload scene error:', err);
                this._onPreloadComplete();
            }
        );
    }

    private _onPreloadComplete(): void {
        this._preloadDone = true;
        if (this.loadingBar) this.loadingBar.progress = 0.9;

        if (this.handleServerLogin) {
            // Two-scene: handle login ourselves, no GameManager in loading scene
            this._doServerLogin();
        } else {
            // Single-scene or GameManager present: emit gate event as usual
            EventBus.instance.emit(GameEvents.LOADING_GATE_REACHED);
            if (this._serverReady) {
                this._fillToFull();
            } else {
                this._barDone = true;
            }
        }
    }

    // ─── SERVER LOGIN (two-scene mode, handleServerLogin = true) ───

    private async _doServerLogin(): Promise<void> {
        const net  = NetworkManager.instance;
        const data = GameData.instance;

        try {
            if (USE_REAL_API) {
                const urlParams  = new (window.URLSearchParams)(window.location.search);
                const gpToken    = urlParams.get('gp');
                const loginParams = gpToken ? { gp: gpToken } : undefined;

                await net.login(loginParams);
                const enterResp = await net.enterGame();

                WalletManager.instance.balance = enterResp.cash;
                data.player.betIndex = enterResp.betIndex;

                net.startHeartBeat();
                net.startJackpotPolling();
            } else {
                // Mock mode in loading scene — seed GameData with defaults
                data.isLoggedIn = true;
                data.isEntered  = true;
            }
        } catch (err) {
            console.error('[LoadingController] Server error during login:', err);
        }

        // Load CDN assets (locale + fonts) song song với login
        await this._loadCdnAssets();

        this._serverReady = true;
        this._tryFillToFull();
    }

    // ─── CDN ASSETS ───

    /**
     * Tải locale-online.json và font TTF từ CDN.
     * - Nếu CDN_BASE = null → bỏ qua, dùng local data.
     * - Nếu fetch lỗi → fallback local, không block game.
     */
    private async _loadCdnAssets(): Promise<void> {
        const cdnBase = ServerConfig.CDN_BASE;
        if (!cdnBase) {
            console.log('[CDN] CDN_BASE không được set — dùng local bundled assets.');
            return;
        }

        console.log(`[CDN] Bắt đầu tải từ: ${cdnBase}`);
        const cdn = CdnAssetManager.instance;
        cdn.init(cdnBase);

        // 1. Fetch manifest
        const manifest = await cdn.fetchManifest();
        if (!manifest) {
            console.warn('[CDN] Không lấy được manifest — thử load locale trực tiếp (không version check).');
        }

        // 2. Load locale + fonts song song
        const [locale, fonts] = await Promise.all([
            cdn.loadLocale(),
            cdn.loadAllFonts(['en', 'ko', 'zh-cn', 'zh-tw', 'fil', 'ja', 'th']),
        ]);

        // 3. Apply locale
        if (locale) {
            LocalizationManager.instance.loadOnlineLocalesFromData(locale);
            const langCount   = Object.keys(locale).length;
            const sampleKey   = Object.keys(locale)[0];
            const keyCount    = sampleKey ? Object.keys(locale[sampleKey]).length : 0;
            console.log(`[CDN] ✅ Locale loaded: ${langCount} ngôn ngữ, ~${keyCount} keys/lang`);
        } else {
            console.log('[CDN] ⚠️ Locale không tải được — dùng local bundled locale.');
        }

        // 4. Apply fonts
        const loadedLangs = Object.keys(fonts);
        if (loadedLangs.length > 0) {
            FontManager.instance?.applyRemoteFonts(fonts);
            console.log(`[CDN] ✅ Fonts loaded: ${loadedLangs.join(', ')}`);
        } else {
            console.log('[CDN] ⚠️ Fonts không tải được — dùng fonts bundled trong build.');
        }

        console.log('[CDN] Hoàn tất.');
    }

    // ─── FAKE TIMER (single-scene mode, useScenePreload = false) ───

    private _startFakeTimer(): void {
        this._elapsed = 0;
        const interval = 1 / 30;
        // Prefab mode: fake timer chỉ fill tới 50%.
        // 50→80%: bundle load thực tế (thời gian tải trên web phản ánh ở đây).
        // 80→100%: fill sau khi server login xong.
        const BAR_GATE = this.gamePrefabPath ? 0.5 : 0.9;

        this._loadCb = () => {
            this._elapsed += interval;
            const t = Math.min(this._elapsed / this.loadingDuration, 1);
            const eased = t * t * (3 - 2 * t);
            const progress = eased * BAR_GATE;
            if (this.loadingBar) this.loadingBar.progress = progress;

            if (t >= 1.0) {
                this.unschedule(this._loadCb!);
                this._loadCb = null;
                this._onBarReachedLimit();
            }
        };

        this.schedule(this._loadCb, interval);
    }

    /** Bar đã tới ngưỡng (50% prefab mode / 90% các mode khác) */
    private _onBarReachedLimit(): void {
        if (this.handleServerLogin) {
            if (this.gamePrefabPath) {
                // Prefab mode: khởi chạy song song server login + bundle load
                // Server login chạy trong lúc bundle download (tiết kiệm thời gian)
                // _barDone sẽ được set khi bundle load xong (bar đạt 80%)
                this._doServerLogin();
                this._startPrefabLoadWithProgress();
            } else {
                this._barDone = true;
                this._doServerLogin();
            }
        } else {
            this._barDone = true;
            EventBus.instance.emit(GameEvents.LOADING_GATE_REACHED);
            if (this._serverReady) {
                this._tryFillToFull();
            }
        }
    }

    /**
     * Load prefab từ AssetBundle với progress tracking.
     * Bar di chuyển từ 50% → 80% theo tiến độ download thực tế trên web.
     * Khi xong: _prefabReady=true, _barDone=true, rồi gọi _tryFillToFull().
     */
    private _startPrefabLoadWithProgress(): void {
        const BAR_START = 0.5;
        const BAR_END   = 0.8;
        console.log(`[LoadingController] Bundle load start (50→80%): ${this.gameBundleName}/${this.gamePrefabPath}`);

        const onBundleReady = (bundle: AssetManager.Bundle) => {
            bundle.load(
                this.gamePrefabPath,
                Prefab,
                (finished: number, total: number) => {
                    // Phản ánh tiến độ tải thực tế từ 50% → 80%
                    const p = total > 0 ? finished / total : 0;
                    const barVal = BAR_START + p * (BAR_END - BAR_START);
                    if (this.loadingBar) {
                        this.loadingBar.progress = Math.max(this.loadingBar.progress, barVal);
                    }
                },
                (err, prefab) => {
                    // Đảm bảo bar đúng 80% khi bundle xong
                    if (this.loadingBar) this.loadingBar.progress = BAR_END;

                    if (err) {
                        console.error(`[LoadingController] Prefab load failed: ${this.gameBundleName}/${this.gamePrefabPath}`, err);
                    } else {
                        this._loadedPrefab = prefab;
                        // Instantiate và GIỮ ẨN — active=true chỉ sau khi LoadingView fade xong
                        const gameNode = instantiate(prefab);
                        gameNode.active = false;
                        const parent = this.gameContainer ?? director.getScene()!;
                        parent.addChild(gameNode);
                        this._instantiatedGameNode = gameNode;
                        console.log(`[LoadingController] Prefab instantiated (hidden, active=false): ${this.gameBundleName}/${this.gamePrefabPath}`);
                    }
                    // Bar đã ở 80% — mở gate fill 80→100%
                    this._prefabReady = true;
                    this._barDone = true;
                    this._tryFillToFull();
                }
            );
        };

        const existing = assetManager.getBundle(this.gameBundleName);
        if (existing) {
            onBundleReady(existing);
        } else {
            assetManager.loadBundle(this.gameBundleName, (err, bundle) => {
                if (err) {
                    console.error(`[LoadingController] Bundle load failed: ${this.gameBundleName}`, err);
                    if (this.loadingBar) this.loadingBar.progress = BAR_END;
                    this._prefabReady = true;
                    this._barDone = true;
                    this._tryFillToFull();
                    return;
                }
                onBundleReady(bundle!);
            });
        }
    }

    /**
     * Gate kiểm tra cả server VÀ prefab đều sẵn sàng trước khi fill 100%.
     * Hàm này được gọi từ cả _doServerLogin() và _startPrefabLoad().
     */
    private _tryFillToFull(): void {
        const prefabDone = !this.gamePrefabPath || this._prefabReady;
        if (this._serverReady && prefabDone) {
            this._fillToFull();
        }
    }

    /** Fill bar từ 80% → 100% rồi complete */
    private _fillToFull(): void {
        if (!this.loadingBar) {
            this._onLoadComplete();
            return;
        }
        tween(this.loadingBar)
            .to(0.3, { progress: 1.0 })
            .call(() => this._onLoadComplete())
            .start();
    }

    private _onLoadComplete(): void {
        // Guard: chỉ chạy 1 lần duy nhất — tránh GameManager re-emit ENTER_SUCCESS kích hoạt lại
        if (this._completed) {
            console.warn('[LoadingController] _onLoadComplete called again — ignored (already completed)');
            return;
        }
        this._completed = true;
        // Hủy listener ENTER_SUCCESS ngay — GameManager sẽ re-emit nó cho SlotMachineController
        EventBus.instance.off(GameEvents.ENTER_SUCCESS, this._onServerReady, this);

        const doComplete = () => {
            if (this.gamePrefabPath) {
                // ★ PREFAB MODE
                // Bước 0 (USE_REAL_API only): Pre-detect resume state TRƯỚC KHI activate game node.
                // Lý do: _instantiatedGameNode.active = true kích hoạt GameEntryController.onLoad()
                // đồng bộ, và ngay sau đó LOADING_COMPLETE fire. Nếu isResumingFreeSpin chưa được
                // set lúc đó, GameEntryController sẽ show guide thay vì skip ngay vào game.
                if (USE_REAL_API) {
                    const rawLast = GameData.instance.rawEnterLastSpinResponse;
                    if (rawLast) {
                        const lastStage: number = rawLast.NextStage ?? rawLast.stageType ?? 0;
                        const remainFS: number  = rawLast.RemainFreeSpinCount ?? rawLast.remainFreeSpinCount ?? 0;
                        
                        // ★ Log ALL cases
                        const stageNames = {
                            0: 'SPIN', 3: 'FREE_SPIN_START', 4: 'FREE_SPIN', 5: 'FREE_SPIN_RE_TRIGGER',
                            8: 'BUY_FREE_SPIN_START', 9: 'BUY_FREE_SPIN',
                            100: 'NEED_CLAIM', 101: 'FREE_SPIN_END', 107: 'BUY_FREE_SPIN_END'
                        };
                        const stageName = (stageNames as any)[lastStage] || `UNKNOWN(${lastStage})`;
                        console.error(`[GAME-ENTER] LoadingController prefab mode → stage=${lastStage}(${stageName}), remainFS=${remainFS}`);
                        
                        // FREE_SPIN stages: 3-9 (còn lượt), NEED_CLAIM: >= 100
                        const isFreeSpin = (lastStage >= 3 && lastStage <= 9) && remainFS > 0;
                        const isNeedClaim = lastStage >= 100;
                        if (isFreeSpin || isNeedClaim) {
                            GameData.instance.isResumingFreeSpin = true;
                            console.error(`[RESUME-DEBUG] LoadingController → isResumingFreeSpin=true (stage=${stageName})`);
                        } else {
                            console.error(`[GAME-ENTER] LoadingController → stage=${stageName} không cần resume`);
                        }
                    } else {
                        console.error(`[GAME-ENTER] LoadingController → NO rawEnterLastSpinResponse`);
                    }
                }
                // Bước 1: Ẩn LoadingView (đã fade xong, nền đen hiện ra)
                GameData.instance.isFromLoadingScene = true;
                this.node.active = false;
                // Bước 2: Activate game node (GameEntryController.onLoad() chạy ngay:
                //          gameGuide.active=false, gameRoot.active=false)
                if (this._instantiatedGameNode) {
                    this._instantiatedGameNode.active = true;
                }
                // Bước 3: Emit LOADING_COMPLETE → GameEntryController kích hoạt GuideView fade-in
                //         (hoặc skip guide nếu isResumingFreeSpin=true)
                EventBus.instance.emit(GameEvents.LOADING_COMPLETE);
                if (!this._instantiatedGameNode) {
                    console.error('[LoadingController] Prefab not available — game may not display correctly');
                }
            } else if (this.targetScene) {
                // TWO-SCENE MODE: chuyển sang scene khác
                GameData.instance.isFromLoadingScene = true;
                const doLoad = () => director.loadScene(this.targetScene!);
                if (typeof document !== 'undefined' && document.fonts?.ready) {
                    document.fonts.ready.then(doLoad);
                } else {
                    doLoad();
                }
            } else {
                // SINGLE-SCENE MODE: ẩn loading view, game view hiện ra trên cùng scene.
                this.node.active = false;
                EventBus.instance.emit(GameEvents.LOADING_COMPLETE);
            }
        };

        if (this.uiOpacity) {
            tween(this.uiOpacity)
                .to(0.5, { opacity: 0 })
                .call(doComplete)
                .start();
        } else {
            this.scheduleOnce(doComplete, 0.2);
        }
    }
}

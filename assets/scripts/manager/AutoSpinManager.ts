/**
 * AutoSpinManager - Quản lý Auto Spin count và Speed Mode.
 *
 * ── SINGLETON ──
 *   Không cần gắn vào Node. Khởi tạo qua AutoSpinManager.instance.
 *   Gọi AutoSpinManager.instance trong GameManager.onLoad() để khởi tạo sớm.
 *
 * ── AUTO SPIN FLOW ──
 *   User chọn count N → đóng AutoSettingPopup → spin thủ công lần đầu.
 *   Sau mỗi Normal Spin kết thúc (NORMAL_SPIN_DONE):
 *     count > 0 → decrement → delay nhỏ → emit SPIN_REQUEST.
 *     count = 0 → dừng.
 *   Free Spin KHÔNG ảnh hưởng count (chỉ Normal Spin mới decrement).
 *
 * ── SPEED MODE ──
 *   Normal: tốc độ mặc định.
 *   Quick: 2× nhanh hơn.
 *   Turbo: gần như dừng ngay khi có kết quả từ server.
 *
 * ── PERSIST ──
 *   Lưu vào localStorage: count còn lại + speed mode.
 *   Tải lại khi khởi động → tiếp tục auto spin nếu còn count.
 */

import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';

const LS_AUTO_COUNT  = 'sn_auto_spin_count';
const LS_AUTO_ACTIVE = 'sn_auto_spin_active';
const LS_SPEED_MODE  = 'sn_speed_mode';
const AUTO_SPIN_DELAY_MS = 300; // ms delay giữa các vòng auto spin

export enum SpeedMode {
    NORMAL = 'normal',
    QUICK  = 'quick',
    TURBO  = 'turbo',
}

export class AutoSpinManager {
    private static _instance: AutoSpinManager | null = null;

    private _autoSpinCount: number = 0;
    private _isAutoSpinActive: boolean = false;
    private _speedMode: SpeedMode = SpeedMode.NORMAL;
    private _isFreeSpinMode: boolean = false;
    private _isPaused: boolean = false;
    /** Flag để chỉ trigger auto spin resume 1 lần duy nhất sau khi game khởi tạo */
    private _gameInitDone: boolean = false;

    private constructor() {
        console.log('[AutoSpinManager] 🔧 constructor() — bắt đầu khởi tạo');
        this._load();
        this._bindEvents();
        // Fallback: chỉ resume nếu _isAutoSpinActive được load từ localStorage
        if (this._autoSpinCount > 0 && this._isAutoSpinActive) {
            console.log(`[AutoSpinManager] ⚠️ autoSpinCount=${this._autoSpinCount} > 0 ngay sau _load — đặt fallback resume sau 2s`);
            setTimeout(() => {
                if (!this._gameInitDone && this._isAutoSpinActive && this._autoSpinCount > 0 && !this._isFreeSpinMode) {
                    console.log(`[AutoSpinManager] 🟡 Fallback resume khởi động (GAME_READY chưa bắt kịp) — emit SPIN_REQUEST`);
                    this._gameInitDone = true;
                    EventBus.instance.emit(GameEvents.SPIN_REQUEST);
                } else {
                    console.log(`[AutoSpinManager] 🔵 Fallback: không cần resume (gameInitDone=${this._gameInitDone}, count=${this._autoSpinCount}, freeSpin=${this._isFreeSpinMode})`);
                }
            }, 2000);
        }
    }

    static get instance(): AutoSpinManager {
        if (!AutoSpinManager._instance) {
            AutoSpinManager._instance = new AutoSpinManager();
        }
        return AutoSpinManager._instance;
    }

    // ─── GETTERS ───

    get autoSpinCount(): number { return this._autoSpinCount; }
    get isAutoSpinActive(): boolean { return this._isAutoSpinActive; }
    get speedMode(): SpeedMode { return this._speedMode; }
    get isFreeSpinMode(): boolean { return this._isFreeSpinMode; }
    get isPaused(): boolean { return this._isPaused; }

    /**
     * Trả về multiplier để điều chỉnh thời gian animation theo speed mode.
     * NORMAL: 1.0 (không thay đổi)
     * QUICK: 0.5 (2x nhanh hơn - tất cả thời gian giảm 50%)
     * TURBO: 0.33 (3x nhanh hơn - tất cả thời gian giảm 67%)
     */
    getTimingMultiplier(): number {
        switch (this._speedMode) {
            case SpeedMode.QUICK: return 0.5;
            case SpeedMode.TURBO: return 0.33;
            default: return 1.0;
        }
    }

    // ─── SETTERS (gọi từ AutoSettingPopup) ───

    setAutoSpinCount(count: number): void {
        this._isPaused = false;
        this._autoSpinCount = Math.max(0, Math.min(1000, Math.round(count)));
        // KHÔNG set _isAutoSpinActive ở đây — chỉ lưu số đếm.
        // _isAutoSpinActive chỉ được bật khi resumeAutoSpin() (tức là nhấn Confirm).
        // Nếu count = 0 thì cũng tắt active để đồng bộ (trường hợp stopAutoSpin).
        if (this._autoSpinCount === 0) this._isAutoSpinActive = false;
        this._save();
        EventBus.instance.emit(GameEvents.AUTO_SPIN_CHANGED, this._autoSpinCount);
    }

    setSpeedMode(mode: SpeedMode): void {
        this._speedMode = mode;
        this._save();
        EventBus.instance.emit(GameEvents.SPEED_MODE_CHANGED, mode);
    }

    stopAutoSpin(): void {
        this.setAutoSpinCount(0);
    }

    /**
     * Tạm dừng auto spin nhưng giữ nguyên count (cho popup hiển thị lại).
     * _isAutoSpinActive = false được save → reload game sẽ không tự resume.
     */
    pauseAutoSpin(): void {
        if (this._autoSpinCount <= 0) return;
        this._isPaused = true;
        this._isAutoSpinActive = false;
        this._save();
        EventBus.instance.emit(GameEvents.AUTO_SPIN_CHANGED, 0);
    }

    resumeAutoSpin(): void {
        this._isPaused = false;
        this._isAutoSpinActive = this._autoSpinCount > 0;
        this._save();
    }

    // ─── EVENTS ───

    private _bindEvents(): void {
        const bus = EventBus.instance;
        console.log('[AutoSpinManager] 📡 _bindEvents() — đăng ký GAME_READY, UI_SPIN_BUTTON_STATE, NORMAL_SPIN_DONE, FREE_SPIN_*');
        bus.on(GameEvents.FREE_SPIN_START,      this._onFreeSpinStart,    this);
        bus.on(GameEvents.FREE_SPIN_END,        this._onFreeSpinEnd,      this);
        bus.on(GameEvents.NORMAL_SPIN_DONE,     this._onNormalSpinDone,   this);
        bus.on(GameEvents.GAME_READY,           this._onGameReady,        this);
        bus.on(GameEvents.UI_SPIN_BUTTON_STATE, this._onSpinButtonState,  this);
    }

    private _onFreeSpinStart(): void {
        this._isFreeSpinMode = true;
    }

    private _onFreeSpinEnd(): void {
        this._isFreeSpinMode = false;
        // Tiếp tục normal spin nếu đang active và còn count
        if (this._isAutoSpinActive && this._autoSpinCount > 0) {
            setTimeout(() => {
                EventBus.instance.emit(GameEvents.SPIN_REQUEST);
            }, AUTO_SPIN_DELAY_MS);
        }
    }

    private _onGameReady(): void {
        console.log(`[AutoSpinManager] 🎟️ _onGameReady — autoSpinCount=${this._autoSpinCount}, gameInitDone=${this._gameInitDone}, isFreeSpinMode=${this._isFreeSpinMode}`);
        // Auto spin resume được xử lý bởi _onSpinButtonState (lần đầu UI_SPIN_BUTTON_STATE=true sau init)
    }

    /**
     * Lần đầu spin button được enable sau khi game khởi tạo hoàn toàn:
     * nếu còn count từ localStorage → tiếp tục auto spin.
     */
    private _onSpinButtonState(enabled: boolean): void {
        console.log(`[AutoSpinManager] 🔘 _onSpinButtonState(${enabled}) — gameInitDone=${this._gameInitDone}, isAutoSpinActive=${this._isAutoSpinActive}, autoSpinCount=${this._autoSpinCount}, isFreeSpinMode=${this._isFreeSpinMode}`);
        if (!enabled || this._gameInitDone) return;
        this._gameInitDone = true;
        if (this._isAutoSpinActive && this._autoSpinCount > 0 && !this._isFreeSpinMode) {
            console.log(`[AutoSpinManager] ▶️ Resume auto spin sau reload — count=${this._autoSpinCount}, scheduling SPIN_REQUEST in ${AUTO_SPIN_DELAY_MS}ms`);
            setTimeout(() => {
                console.log(`[AutoSpinManager] 🟢 emit SPIN_REQUEST (auto spin resume)`);
                EventBus.instance.emit(GameEvents.SPIN_REQUEST);
            }, AUTO_SPIN_DELAY_MS);
        } else {
            console.log(`[AutoSpinManager] ⏹️ Không resume auto spin — isActive=${this._isAutoSpinActive}, count=${this._autoSpinCount}, isFreeSpinMode=${this._isFreeSpinMode}`);
        }
    }

    private _onNormalSpinDone(): void {
        // Chỉ trigger khi đang active và đang Normal spin
        if (this._isFreeSpinMode) return;
        if (!this._isAutoSpinActive) return;
        if (this._autoSpinCount <= 0) return;

        this._autoSpinCount--;
        if (this._autoSpinCount === 0) {
            this._isAutoSpinActive = false;
        }
        this._save();
        EventBus.instance.emit(GameEvents.AUTO_SPIN_CHANGED, this._autoSpinCount);

        if (this._autoSpinCount > 0) {
            setTimeout(() => {
                EventBus.instance.emit(GameEvents.SPIN_REQUEST);
            }, AUTO_SPIN_DELAY_MS);
        }
    }

    // ─── PERSIST ───

    private _save(): void {
        try {
            localStorage.setItem(LS_AUTO_COUNT,  String(this._autoSpinCount));
            localStorage.setItem(LS_AUTO_ACTIVE, String(this._isAutoSpinActive));
            localStorage.setItem(LS_SPEED_MODE,  this._speedMode);
        } catch (_) {}
    }

    private _load(): void {
        try {
            const count = localStorage.getItem(LS_AUTO_COUNT);
            const mode  = localStorage.getItem(LS_SPEED_MODE);
            console.log(`[AutoSpinManager] 💾 _load() — localStorage: count=${count ?? 'null'}, mode=${mode ?? 'null'}`);
            if (count !== null) {
                this._autoSpinCount = Math.max(0, Math.min(1000, parseInt(count, 10) || 0));
            }
            const active = localStorage.getItem(LS_AUTO_ACTIVE);
            if (active !== null) {
                this._isAutoSpinActive = active === 'true';
            }
            if (mode !== null && Object.values(SpeedMode).includes(mode as SpeedMode)) {
                this._speedMode = mode as SpeedMode;
            }
            console.log(`[AutoSpinManager] ✅ _load() done — autoSpinCount=${this._autoSpinCount}, speedMode=${this._speedMode}`);
        } catch (_) {}
    }
}

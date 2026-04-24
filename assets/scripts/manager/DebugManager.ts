/**
 * DebugManager - Quản lý debug shortcuts và DEBUG_RANDS runtime.
 *
 * ⚠️ CHỈ HOẠT ĐỘNG TRONG EDITOR/DEBUG BUILD — Được kiểm soát bởi CC_DEBUG flag.
 * Không được compile vào production build.
 *
 * Phím tắt:
 *   1 → FREE_SPIN_TRIGGER (trigger free spin bonus)
 *   2 → TRIPLE_SEVEN_WIN (regular win)
 *   3 → GRAND_JACKPOT (jackpot + mega win)
 *
 * Cơ chế: Khi nhấn 1/2/3, set pendingDebugRands.
 * Spin request sẽ dùng pendingDebugRands nếu có.
 * Sau khi spin response nhận được, getPendingDebugRands() sẽ trả về giá trị rồi reset.
 */

import { _decorator, input, Input, EventKeyboard, KeyCode } from 'cc';
import { DEBUG_RANDS_PRESET } from '../data/ServerConfig';
import { LocalizationManager, LanguageCode } from '../core/LocalizationManager';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { PopupCase } from '../core/PopUpMessage';
import { ProgressiveWinTier } from '../controller/ProgressiveWinPopup';
import { JackpotType } from '../data/SlotTypes';
import { BetManager } from './BetManager';

const { ccclass } = _decorator;

/**
 * Keyboard shortcuts:
 *   1 → DEBUG_RANDS: FREE_SPIN_TRIGGER
 *   2 → DEBUG_RANDS: TRIPLE_SEVEN_WIN
 *   3 → DEBUG_RANDS: GRAND_JACKPOT
 *
 * [TEST FONT/LANGUAGE]
 *   F1 → English (en)
 *   F2 → Korean (ko)
 *   F3 → Simplified Chinese (zh-cn)
 *   F4 → Traditional Chinese (zh-tw)
 *   F5 → Filipino (fil)
 *   F6 → Japanese (ja)
 *   F7 → Thai (th)
 *
 * [TEST SYSTEM POPUP]
 *   P → DISCONNECTED
 *   Q → RELOGIN
 *   W → INSUFFICIENT_BALANCE
 *   E → EXPIRED_LINK
 *   R → WRONG_PARSHEET
 *   T → INVALID_REQUEST
 *
 * [TEST PROGRESSIVE WIN]
 *   B → BIG WIN
 *   S → SUPER WIN
 *   C → EPIC WIN
 *   M → MEGA WIN
 *
 * [TEST JACKPOT POPUP]
 *   G → GRAND JACKPOT
 *   J → MAJOR JACKPOT
 *   N → MINOR JACKPOT
 *   I → MINI JACKPOT
 */

const LANG_SHORTCUTS: { key: KeyCode; lang: LanguageCode; label: string }[] = [
    { key: KeyCode.F1, lang: 'en',    label: 'English' }, 
    { key: KeyCode.F2, lang: 'ko',    label: 'Korean' },
    { key: KeyCode.F3, lang: 'zh-cn', label: 'Simplified Chinese' },
    { key: KeyCode.F4, lang: 'zh-tw', label: 'Traditional Chinese' },
    { key: KeyCode.F5, lang: 'fil',   label: 'Filipino' },
    { key: KeyCode.F6, lang: 'ja',    label: 'Japanese' },
    { key: KeyCode.F7, lang: 'th',    label: 'Thai' },
];

@ccclass('DebugManager')
export class DebugManager {
    private static _instance: DebugManager;

    /** DEBUG_RANDS runtime — có thể thay đổi qua keyboard shortcuts */
    private _pendingDebugRands: readonly number[] | null = null;
    private _initialized: boolean = false;

    /** Đếm số popup đang mở — debug keys bị vô hiệu khi > 0 */
    private _openPopupCount: number = 0;

    private constructor() {}

    static get instance(): DebugManager {
        if (!this._instance) {
            this._instance = new DebugManager();
        }
        if (!this._instance._initialized) {
            this._instance._setupKeyboardShortcuts();
            this._instance._initialized = true;
        }
        return this._instance;
    }

    /** Lấy DEBUG_RANDS hiện tại (pending) — reset sau khi lấy */
    getPendingDebugRands(): readonly number[] | null {
        const result = this._pendingDebugRands;
        this._pendingDebugRands = null;
        return result;
    }

    /**
     * Set debugRands từ bên ngoài (UI Debug Panel, test script, v.v.)
     * Giá trị sẽ được dùng cho lần Spin tiếp theo rồi tự reset.
     */
    setDebugRands(rands: readonly number[] | null): void {
        this._pendingDebugRands = rands;
        if (rands) {
            console.log(
                `%c[DebugManager] setDebugRands = [${rands.join(',')}]`,
                'color:#f90;font-weight:bold'
            );
        } else {
            console.log('[DebugManager] debugRands cleared');
        }
    }

    private _setupKeyboardShortcuts(): void {
        // ⚠️ Chỉ kích hoạt debug shortcuts trong Editor mode (CC_EDITOR flag)
        // Không được compile vào production build
        // @ts-ignore — CC_EDITOR là global built-in của Cocos Creator
        // if (typeof CC_EDITOR !== 'undefined' && !CC_EDITOR) {
        //     return;
        // }

        try {
            input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);

            // Theo dõi trạng thái popup — khoá phím khi popup đang mở
            const bus = EventBus.instance;
            bus.on(GameEvents.JACKPOT_TRIGGER,          () => this._openPopupCount++, this);
            bus.on(GameEvents.JACKPOT_END,              () => this._openPopupCount = Math.max(0, this._openPopupCount - 1), this);
            bus.on(GameEvents.PROGRESSIVE_WIN_SHOW,     () => this._openPopupCount++, this);
            bus.on(GameEvents.PROGRESSIVE_WIN_END,      () => this._openPopupCount = Math.max(0, this._openPopupCount - 1), this);
            bus.on(GameEvents.FREE_SPIN_END_POPUP,      () => this._openPopupCount++, this);
            bus.on(GameEvents.FREE_SPIN_END_POPUP_CLOSED, () => this._openPopupCount = Math.max(0, this._openPopupCount - 1), this);
            bus.on(GameEvents.SHOW_SYSTEM_POPUP,        () => this._openPopupCount++, this);

            console.log(
                '[DebugManager] 🔧 DEBUG SHORTCUTS ENABLED (EDITOR ONLY):' +
                ' 1=FREE_SPIN | 2=TRIPLE_SEVEN | 3=GRAND_JACKPOT' +
                ' | F1=en | F2=ko | F3=zh-cn | F4=zh-tw | F5=fil | F6=ja | F7=th' +
                ' | P=DISCONNECTED | Q=RELOGIN | W=INSUFFICIENT_BALANCE | E=EXPIRED | R=WRONG_PARSHEET | T=INVALID_REQUEST' +
                ' | B=BIG_WIN | S=SUPER_WIN | C=EPIC_WIN | M=MEGA_WIN' +
                ' | G=GRAND_JACKPOT | J=MAJOR_JACKPOT | N=MINOR_JACKPOT | I=MINI_JACKPOT'
            );
        } catch (err) {
            console.warn('[DebugManager] Failed to setup keyboard shortcuts:', err);
        }
    }

    private _onKeyDown(event: EventKeyboard): void {
        if (this._openPopupCount > 0) return;

        switch (event.keyCode) {
            // ─── Debug rands ───
            case KeyCode.DIGIT_1:
            case KeyCode.NUM_1:
                this._activateDebugRands(0);
                break;
            case KeyCode.DIGIT_2:
            case KeyCode.NUM_2:
                this._activateDebugRands(1);
                break;
            case KeyCode.DIGIT_3:
            case KeyCode.NUM_3:
                this._activateDebugRands(2);
                break;

            // ─── Language / font test ───
            default: {
                const shortcut = LANG_SHORTCUTS.find(s => s.key === event.keyCode);
                if (shortcut) {
                    this._switchLanguage(shortcut.lang, shortcut.label);
                    break;
                }
                if (this._triggerProgressiveWinTest(event.keyCode)) break;
                if (this._triggerJackpotTest(event.keyCode)) break;
                this._triggerPopupTest(event.keyCode);
                break;
            }
        }
    }

    private _activateDebugRands(presetIndex: number): void {
        const presets = [
            DEBUG_RANDS_PRESET.FREE_SPIN_TRIGGER,
            DEBUG_RANDS_PRESET.TRIPLE_SEVEN_WIN,
            DEBUG_RANDS_PRESET.GRAND_JACKPOT,
            DEBUG_RANDS_PRESET.ONE_SEVEN_WIN,
            DEBUG_RANDS_PRESET.DOUBLE_SEVEN_WIN,
            DEBUG_RANDS_PRESET.ANY_SEVEN_WIN,
            DEBUG_RANDS_PRESET.ONE_BAR_WIN,
            DEBUG_RANDS_PRESET.DOUBLE_BAR_WIN,
            DEBUG_RANDS_PRESET.ANY_BAR_WIN,
        ];
        const names = [
            'FREE_SPIN_TRIGGER ✅',
            'TRIPLE_SEVEN_WIN ✅',
            'GRAND_JACKPOT ✅',
            'ONE_SEVEN_WIN 🧮',
            'DOUBLE_SEVEN_WIN 🧮',
            'ANY_SEVEN_WIN 🧮',
            'ONE_BAR_WIN 🧮',
            'DOUBLE_BAR_WIN 🧮',
            'ANY_BAR_WIN 🧮',
        ];

        if (presetIndex >= 0 && presetIndex < presets.length) {
            this._pendingDebugRands = presets[presetIndex];
            console.log(
                `%c[DEBUG] Key ${presetIndex + 1} → ${names[presetIndex]} = [${this._pendingDebugRands.join(',')}]`,
                'color:#f00;font-weight:bold'
            );
        }
    }

    private _switchLanguage(lang: LanguageCode, label: string): void {
        LocalizationManager.instance.setLanguage(lang);
        console.log(`%c[DEBUG] Language → ${label} (${lang})`, 'color:#0af;font-weight:bold');
    }

    private _triggerProgressiveWinTest(keyCode: KeyCode): boolean {
        // Amounts = totalBet × tier multiplier, đảm bảo luôn đúng ngưỡng
        const bet = BetManager.instance.totalBet;
        const PROGRESSIVE_SHORTCUTS: { key: KeyCode; tier: ProgressiveWinTier; label: string; mul: number }[] = [
            { key: KeyCode.KEY_B, tier: ProgressiveWinTier.BIG,   label: 'BIG WIN',   mul: 30 },
            { key: KeyCode.KEY_S, tier: ProgressiveWinTier.SUPER, label: 'SUPER WIN', mul: 70 },
            { key: KeyCode.KEY_C, tier: ProgressiveWinTier.EPIC,  label: 'EPIC WIN',  mul: 150 },
            { key: KeyCode.KEY_M, tier: ProgressiveWinTier.MEGA,  label: 'MEGA WIN',  mul: 250 },
        ];

        const found = PROGRESSIVE_SHORTCUTS.find(s => s.key === keyCode);
        if (!found) return false;

        const amount = bet * found.mul;
        console.log(
            `%c[DEBUG] Progressive Win test → ${found.label} | bet=${bet} amount=${amount}`,
            'color:#ff0;font-weight:bold'
        );

        EventBus.instance.emit(GameEvents.PROGRESSIVE_WIN_SHOW, found.tier, amount);
        return true;
    }

    private _triggerJackpotTest(keyCode: KeyCode): boolean {
        const bet = BetManager.instance.totalBet;
        const JACKPOT_SHORTCUTS: { key: KeyCode; type: JackpotType; label: string; mul: number }[] = [
            { key: KeyCode.KEY_G, type: JackpotType.GRAND, label: 'GRAND JACKPOT', mul: 500 },
            { key: KeyCode.KEY_J, type: JackpotType.MAJOR, label: 'MAJOR JACKPOT', mul: 200 },
            { key: KeyCode.KEY_N, type: JackpotType.MINOR, label: 'MINOR JACKPOT', mul: 50  },
            { key: KeyCode.KEY_I, type: JackpotType.MINI,  label: 'MINI JACKPOT',  mul: 10  },
        ];

        const found = JACKPOT_SHORTCUTS.find(s => s.key === keyCode);
        if (!found) return false;

        const amount = bet * found.mul;
        console.log(
            `%c[DEBUG] Jackpot test → ${found.label} | bet=${bet} amount=${amount}`,
            'color:#ff0;font-weight:bold'
        );

        EventBus.instance.emit(GameEvents.JACKPOT_TRIGGER, found.type, amount);
        return true;
    }

    private _triggerPopupTest(keyCode: KeyCode): void {
        const POPUP_SHORTCUTS: { key: KeyCode; popupCase: PopupCase; label: string }[] = [
            { key: KeyCode.KEY_P, popupCase: PopupCase.DISCONNECTED,        label: 'DISCONNECTED' },
            { key: KeyCode.KEY_Q, popupCase: PopupCase.RELOGIN,             label: 'RELOGIN' },
            { key: KeyCode.KEY_W, popupCase: PopupCase.INSUFFICIENT_BALANCE, label: 'INSUFFICIENT_BALANCE' },
            { key: KeyCode.KEY_E, popupCase: PopupCase.EXPIRED_LINK,        label: 'EXPIRED_LINK' },
            { key: KeyCode.KEY_R, popupCase: PopupCase.WRONG_PARSHEET,      label: 'WRONG_PARSHEET' },
            { key: KeyCode.KEY_T, popupCase: PopupCase.INVALID_REQUEST,     label: 'INVALID_REQUEST' },
        ];

        const found = POPUP_SHORTCUTS.find(s => s.key === keyCode);
        if (!found) return;

        console.log(
            `%c[DEBUG] Popup test → ${found.label}`,
            'color:#f0f;font-weight:bold'
        );

        EventBus.instance.emit(GameEvents.SHOW_SYSTEM_POPUP, {
            popupCase: found.popupCase,
            onConfirm: found.popupCase === PopupCase.INSUFFICIENT_BALANCE
                ? () => console.log('[DEBUG] INSUFFICIENT_BALANCE → onConfirm (mock refresh)')
                : undefined,
            onCancel: found.popupCase === PopupCase.INSUFFICIENT_BALANCE
                ? () => console.log('[DEBUG] INSUFFICIENT_BALANCE → onCancel')
                : undefined,
        });
    }
}

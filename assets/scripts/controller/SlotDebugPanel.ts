/**
 * SlotDebugPanel - UI Debug Panel Ä‘áº§y Ä‘á»§ cho QA test RNG Override.
 *
 * Cho phÃ©p nháº­p máº£ng debugArray (3 sá»‘) vÃ  gá»­i lÃªn Server qua API Spin.
 * TÃ­ch há»£p vá»›i DebugManager Ä‘á»ƒ set pendingDebugRands trÆ°á»›c khi gá»i Spin.
 *
 * â”€â”€â”€ CÃ¡ch gáº¯n vÃ o scene â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *   1. Gáº¯n component nÃ y vÃ o má»™t Node trong scene.
 *   2. KÃ©o cÃ¡c Node con vÃ o property tÆ°Æ¡ng á»©ng trong Inspector.
 *   3. Nháº¥n nÃºt "Open Debug" (bÃªn ngoÃ i panel) Ä‘á»ƒ má»Ÿ, nháº¥n preset hoáº·c nháº­p tay.
 *
 * â”€â”€â”€ Tráº¡ng thÃ¡i preset â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *   âœ… Confirmed  â€” Ä‘Ã£ test thÃ nh cÃ´ng vá»›i Server
 *   ðŸ§® Calculated â€” tÃ­nh tá»« PS, chÆ°a cÃ³ server test
 *   â“ Unconfirmed â€” chÆ°a rÃµ trigger condition, cáº§n server xÃ¡c nháº­n
 *
 * â”€â”€â”€ Symbol IDs (tá»« PS thá»±c táº¿) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *   12=7(OneSeven)  13=77(DoubleSeven)  14=777(TripleSeven)
 *   2=BAR(OneBar)   3=BARBAR(DoubleBar)
 *   21=BlueWild     22=RedWild           23=TripleWild
 *   98=Scatter      JackpotIDs(81-84) = áº£o, khÃ´ng cÃ³ trÃªn reel strip
 */

import { _decorator, Component, Node, EditBox, Label, Button } from 'cc';
import { DebugManager } from '../manager/DebugManager';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { DEBUG_RANDS_PRESET } from '../data/ServerConfig';

const { ccclass, property } = _decorator;

/** Sá»‘ lÆ°á»£ng Reel cá»§a game â€” dÃ¹ng Ä‘á»ƒ validate debugArray */
const REQUIRED_REEL_COUNT = 3;

@ccclass('SlotDebugPanel')
export class SlotDebugPanel extends Component {

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  PROPERTIES â€” KÃ©o vÃ o tá»« Inspector
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** Khung UI chÃ­nh cá»§a Debug Panel â€” máº·c Ä‘á»‹nh áº©n */
    @property(Node)
    debugPanelNode: Node = null!;

    /** Ã” nháº­p liá»‡u â€” nháº­p dáº¡ng "2,5,16" (phÃ¢n cÃ¡ch báº±ng dáº¥u pháº©y) */
    @property(EditBox)
    inputReelIndices: EditBox = null!;

    /** Label hiá»ƒn thá»‹ tráº¡ng thÃ¡i / káº¿t quáº£ (tuá»³ chá»n) */
    @property(Label)
    statusLabel: Label = null!;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GROUP 1: CONFIRMED BY SERVER âœ…
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** âœ… Free Spin Trigger â€” [2, 5, 16] (Scatter á»Ÿ Reel 2) */
    @property(Button)
    btnFreeSpin: Button = null!;

    /** âœ… 777-777-777 (TripleSeven Ã— 3) â€” [2, 5, 12] */
    @property(Button)
    btnTripleSeven: Button = null!;

    /** âœ… Grand Jackpot (TripleWild Ã— 3) â€” [6, 1, 58] */
    @property(Button)
    btnGrandJackpot: Button = null!;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GROUP 2: SEVEN WINS ðŸ§® (Calculated from PS)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** ðŸ§® 7-7-7 (OneSeven Ã— 3, ID=12) â€” [4, 23, 26] */
    @property(Button)
    btnOneSeven: Button = null!;

    /** ðŸ§® 77-77-77 (DoubleSeven Ã— 3, ID=13) â€” [20, 9, 8] */
    @property(Button)
    btnDoubleSeven: Button = null!;

    /** ðŸ§® Any-7 (mix: 7+77+777) â€” [4, 9, 12] */
    @property(Button)
    btnAnySeven: Button = null!;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GROUP 3: BAR WINS ðŸ§® (Calculated from PS)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** ðŸ§® BAR-BAR-BAR (OneBar Ã— 3, ID=2) â€” [10, 3, 2] */
    @property(Button)
    btnOneBar: Button = null!;

    /** ðŸ§® BARBAR-BARBAR-BARBAR (DoubleBar Ã— 3, ID=3) â€” [16, 19, 0] */
    @property(Button)
    btnDoubleBar: Button = null!;

    /** ðŸ§® Any-BAR (mix: BAR+BARBAR+BAR) â€” [10, 19, 2] */
    @property(Button)
    btnAnyBar: Button = null!;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GROUP 4: JACKPOTS â“ (Needs server confirmation)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /**
     * â“ Major Jackpot? (RedWild Ã— 3, ID=22) â€” [12, 13, 10]
     * Giáº£ thuyáº¿t tá»« PS: symbol 22 (RedWild) cÃ³ thá»ƒ trigger Major Jackpot.
     * Cáº¦N server xÃ¡c nháº­n vÃ¬ jackpot IDs (81-84) khÃ´ng xuáº¥t hiá»‡n trÃªn reel strip.
     */
    @property(Button)
    btnMajorJackpot: Button = null!;

    /**
     * â“ Minor Jackpot? (BlueWild Ã— 3, ID=21) â€” [0, 7, 4]
     * Giáº£ thuyáº¿t tá»« PS: symbol 21 (BlueWild) cÃ³ thá»ƒ trigger Minor Jackpot.
     * Cáº¦N server xÃ¡c nháº­n.
     */
    @property(Button)
    btnMinorJackpot: Button = null!;

    /**
     * â“ Mini Jackpot â€” UNKNOWN
     * KhÃ´ng thá»ƒ tÃ­nh tá»« PS vÃ¬ symbol 81 (MiniJackpotID) khÃ´ng cÃ³ trÃªn reel strip.
     * NÃºt nÃ y sáº½ log warning vÃ  yÃªu cáº§u giÃ¡ trá»‹ tá»« server.
     */
    @property(Button)
    btnMiniJackpot: Button = null!;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GROUP 5: CUSTOM & TEST
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** Gá»­i spin vá»›i giÃ¡ trá»‹ tá»± nháº­p tá»« EditBox */
    @property(Button)
    btnSendCustom: Button = null!;

    /** Test tÃ­ch há»£p server: gá»­i [0, 0, 0] */
    @property(Button)
    btnTestIntegration: Button = null!;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  LIFECYCLE
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    onLoad(): void {
        // áº¨n panel máº·c Ä‘á»‹nh khi game báº¯t Ä‘áº§u
        if (this.debugPanelNode) {
            this.debugPanelNode.active = false;
        }
        this._bindButtons();
        console.log(
            '%c[SlotDebugPanel] Loaded â€” 10 presets ready (3âœ… confirmed / 6ðŸ§® calculated / 1â“ unknown)',
            'color:#0af;font-weight:bold'
        );
    }

    private _bindButtons(): void {
        try {
            // Group 1 â€” Confirmed
            this._bind(this.btnFreeSpin,       this._onPresetFreeSpin);
            this._bind(this.btnTripleSeven,    this._onPresetTripleSeven);
            this._bind(this.btnGrandJackpot,   this._onPresetGrandJackpot);
            // Group 2 â€” Seven wins
            this._bind(this.btnOneSeven,       this._onPresetOneSeven);
            this._bind(this.btnDoubleSeven,    this._onPresetDoubleSeven);
            this._bind(this.btnAnySeven,       this._onPresetAnySeven);
            // Group 3 â€” Bar wins
            this._bind(this.btnOneBar,         this._onPresetOneBar);
            this._bind(this.btnDoubleBar,      this._onPresetDoubleBar);
            this._bind(this.btnAnyBar,         this._onPresetAnyBar);
            // Group 4 â€” Jackpots
            this._bind(this.btnMajorJackpot,   this._onPresetMajorJackpot);
            this._bind(this.btnMinorJackpot,   this._onPresetMinorJackpot);
            this._bind(this.btnMiniJackpot,    this._onPresetMiniJackpot);
            // Group 5 â€” Custom & test
            this._bind(this.btnSendCustom,     this.onSendDebugSpin);
            this._bind(this.btnTestIntegration,this._onTestIntegration);
        } catch (err) {
            console.warn('[SlotDebugPanel] Lá»—i khi bind buttons:', err);
        }
    }

    /** Helper bind an toÃ n â€” bá» qua náº¿u button chÆ°a gáº¯n trong Inspector */
    private _bind(btn: Button | null, handler: () => void): void {
        if (btn) {
            btn.node.on(Button.EventType.CLICK, handler, this);
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  Má»ž / ÄÃ“NG PANEL
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** Hiá»ƒn thá»‹ Debug Panel */
    onOpenDebug(): void {
        if (this.debugPanelNode) {
            this.debugPanelNode.active = true;
            this._setStatus('Panel open â€” chá»n preset hoáº·c nháº­p tay.');
        }
    }

    /** áº¨n Debug Panel */
    onCloseDebug(): void {
        if (this.debugPanelNode) {
            this.debugPanelNode.active = false;
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  Gá»¬I SPIN Vá»šI GIÃ TRá»Š Tá»° NHáº¬P
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /**
     * Äá»c chuá»—i tá»« EditBox â†’ parse â†’ validate 3 pháº§n tá»­ â†’ gá»­i spin.
     * VÃ­ dá»¥ input há»£p lá»‡: "2,5,16" hoáº·c "2, 5, 16"
     */
    onSendDebugSpin(): void {
        try {
            if (!this.inputReelIndices) {
                this._setStatus('âš  EditBox inputReelIndices chÆ°a gáº¯n trong Inspector!');
                return;
            }
            const rawInput = this.inputReelIndices.string?.trim();
            if (!rawInput) {
                this._setStatus('âš  Ã” nháº­p liá»‡u trá»‘ng! VÃ­ dá»¥: 2, 5, 16');
                return;
            }
            const debugArray = this._parseInput(rawInput);
            if (!debugArray) return;
            if (!this._validateDebugArray(debugArray)) return;
            this._sendSpinWithDebugArray(debugArray, 'Custom Input');
        } catch (err) {
            console.error('[SlotDebugPanel] Lá»—i khÃ´ng mong Ä‘á»£i:', err);
            this._setStatus('âŒ Lá»—i: ' + String(err));
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GROUP 1 HANDLERS â€” CONFIRMED âœ…
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** âœ… Free Spin Trigger: Scatter xuáº¥t hiá»‡n á»Ÿ Reel 2 mid */
    private _onPresetFreeSpin(): void {
        const arr = [...DEBUG_RANDS_PRESET.FREE_SPIN_TRIGGER];
        this._firePreset(arr, 'âœ… Free Spin Trigger');
    }

    /** âœ… 777-777-777: TripleSeven (ID=14) trÃªn cáº£ 3 reels */
    private _onPresetTripleSeven(): void {
        const arr = [...DEBUG_RANDS_PRESET.TRIPLE_SEVEN_WIN];
        this._firePreset(arr, 'âœ… 777-777-777 (TripleSevenÃ—3)');
    }

    /** âœ… Grand Jackpot: TripleWild (ID=23) trÃªn cáº£ 3 reels */
    private _onPresetGrandJackpot(): void {
        const arr = [...DEBUG_RANDS_PRESET.GRAND_JACKPOT];
        this._firePreset(arr, 'âœ… Grand Jackpot (TripleWildÃ—3)');
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GROUP 2 HANDLERS â€” SEVEN WINS ðŸ§®
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** ðŸ§® 7-7-7: OneSeven (ID=12) Ã— 3. TÃ­nh tá»« PS: strip0[4]=12, strip1[23]=12, strip2[26]=12 */
    private _onPresetOneSeven(): void {
        const arr = [...DEBUG_RANDS_PRESET.ONE_SEVEN_WIN];
        this._firePreset(arr, 'ðŸ§® 7-7-7 (OneSevenÃ—3)');
    }

    /** ðŸ§® 77-77-77: DoubleSeven (ID=13) Ã— 3. TÃ­nh tá»« PS: strip0[20]=13, strip1[9]=13, strip2[8]=13 */
    private _onPresetDoubleSeven(): void {
        const arr = [...DEBUG_RANDS_PRESET.DOUBLE_SEVEN_WIN];
        this._firePreset(arr, 'ðŸ§® 77-77-77 (DoubleSevenÃ—3)');
    }

    /**
     * ðŸ§® Any-7: Mix 7+77+777 trÃªn 3 reels.
     * strip0[4]=12(7), strip1[9]=13(77), strip2[12]=14(777)
     * â†’ Server nháº­n AnySevenGroupID=11 match náº¿u logic "any 7 type" Ä‘Æ°á»£c báº­t.
     */
    private _onPresetAnySeven(): void {
        const arr = [...DEBUG_RANDS_PRESET.ANY_SEVEN_WIN];
        this._firePreset(arr, 'ðŸ§® Any-7 (7+77+777 mix)');
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GROUP 3 HANDLERS â€” BAR WINS ðŸ§®
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** ðŸ§® BAR-BAR-BAR: OneBar (ID=2) Ã— 3. strip0[10]=2, strip1[3]=2, strip2[2]=2 */
    private _onPresetOneBar(): void {
        const arr = [...DEBUG_RANDS_PRESET.ONE_BAR_WIN];
        this._firePreset(arr, 'ðŸ§® BAR-BAR-BAR (OneBarÃ—3)');
    }

    /** ðŸ§® BARBARÃ—3: DoubleBar (ID=3) Ã— 3. strip0[16]=3, strip1[19]=3, strip2[0]=3 */
    private _onPresetDoubleBar(): void {
        const arr = [...DEBUG_RANDS_PRESET.DOUBLE_BAR_WIN];
        this._firePreset(arr, 'ðŸ§® BARBAR-BARBAR-BARBAR (DoubleBarÃ—3)');
    }

    /**
     * ðŸ§® Any-BAR: Mix BAR+BARBAR+BAR.
     * strip0[10]=2(BAR), strip1[19]=3(BARBAR), strip2[2]=2(BAR)
     * â†’ Kiá»ƒm tra AnyBarGroupID=1 match.
     */
    private _onPresetAnyBar(): void {
        const arr = [...DEBUG_RANDS_PRESET.ANY_BAR_WIN];
        this._firePreset(arr, 'ðŸ§® Any-BAR (BAR+BARBAR mix)');
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GROUP 4 HANDLERS â€” JACKPOTS â“
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /**
     * â“ Major Jackpot (giáº£ thuyáº¿t): RedWild (ID=22) Ã— 3.
     * strip0[12]=22, strip1[13]=22, strip2[10]=22
     *
     * CÆ¡ sá»Ÿ: Grand=TripleWild(23)âœ… â†’ giáº£ sá»­ Major=RedWild(22), Minor=BlueWild(21).
     * Cáº¦N SERVER XÃC NHáº¬N â€” jackpot IDs 81/82/83/84 khÃ´ng cÃ³ trÃªn reel strip thá»±c táº¿.
     */
    private _onPresetMajorJackpot(): void {
        const arr = [...DEBUG_RANDS_PRESET.MAJOR_JACKPOT_GUESS];
        this._firePreset(arr, 'â“ Major Jackpot? (RedWildÃ—3) â€” cáº§n server confirm');
    }

    /**
     * â“ Minor Jackpot (giáº£ thuyáº¿t): BlueWild (ID=21) Ã— 3.
     * strip0[0]=21, strip1[7]=21, strip2[4]=21
     *
     * Cáº¦N SERVER XÃC NHáº¬N.
     */
    private _onPresetMinorJackpot(): void {
        const arr = [...DEBUG_RANDS_PRESET.MINOR_JACKPOT_GUESS];
        this._firePreset(arr, 'â“ Minor Jackpot? (BlueWildÃ—3) â€” cáº§n server confirm');
    }

    /**
     * â“ Mini Jackpot â€” KHÃ”NG THá»‚ TÃNH Tá»ª PS.
     *
     * LÃ½ do: MiniJackpotID=81, MinorJackpotID=82, MajorJackpotID=83, GrandJackpotID=84
     * lÃ  cÃ¡c ID áº£o trong payout table, KHÃ”NG xuáº¥t hiá»‡n trÃªn reel strip nÃ o.
     * Trigger condition lÃ  server-side logic, khÃ´ng readable tá»« PS.json.
     *
     * HÃ nh Ä‘á»™ng: log warning vÃ  hÆ°á»›ng dáº«n QA liÃªn há»‡ server team.
     */
    private _onPresetMiniJackpot(): void {
        const msg = 'â“ Mini Jackpot: KHÃ”NG THá»‚ tÃ­nh tá»« PS. Symbol 81 khÃ´ng cÃ³ trÃªn reel strip. Cáº§n server cung cáº¥p DebugArray!';
        console.warn(
            `%c[SlotDebugPanel] ${msg}`,
            'color:#f80;font-weight:bold'
        );
        console.warn('[SlotDebugPanel] LiÃªn há»‡ server team Ä‘á»ƒ láº¥y DebugArray cho Mini/Minor/Major Jackpot tÆ°Æ¡ng tá»± Grand=[6,1,58].');
        this._setStatus(msg);
        // KHÃ”NG gá»­i spin â€” khÃ´ng cÃ³ giÃ¡ trá»‹ há»£p lá»‡ Ä‘á»ƒ gá»­i
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  TEST TÃCH Há»¢P SERVER (Integration Check)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /**
     * Gá»­i spin vá»›i debugArray = [0, 0, 0] Ä‘á»ƒ kiá»ƒm tra server nháº­n DebugArray.
     *
     * CÃ¡ch Ä‘á»c káº¿t quáº£:
     *   1. Má»Ÿ Console â†’ tÃ¬m log "[SERVER] Rands=[...]"
     *   2. Náº¿u server nháº­n debugArray: Rands tráº£ vá» sáº½ lÃ  [0, 0, 0] (hoáº·c
     *      giÃ¡ trá»‹ nháº¥t quÃ¡n má»—i láº§n test vá»›i cÃ¹ng input).
     *   3. strip0[0]=BlueWild(21), strip1[0]=Empty(99), strip2[0]=DoubleBar(3)
     *      â†’ Náº¿u mid row hiá»ƒn thá»‹ Ä‘Ãºng symbols nÃ y, server Ä‘Ã£ nháº­n thÃ nh cÃ´ng.
     */
    testServerDebugIntegration(): void {
        console.log(
            '%c[SlotDebugPanel] â•â•â• TEST INTEGRATION: debugArray=[0,0,0] â•â•â•',
            'color:#ff0;font-weight:bold;background:#333;padding:2px 8px'
        );
        this._setStatus('ðŸ§ª Testing: debugArray = [0, 0, 0]...');
        this._sendSpinWithDebugArray([0, 0, 0], 'Integration Test');
    }

    private _onTestIntegration(): void {
        this.testServerDebugIntegration();
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  HELPER â€” Parse, Validate, Send, UI
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** Shortcut: fill EditBox + send spin (dÃ¹ng cho táº¥t cáº£ preset buttons) */
    private _firePreset(arr: number[], label: string): void {
        this._setInputText(arr.join(', '));
        this._sendSpinWithDebugArray(arr, label);
    }

    /**
     * Parse chuá»—i input thÃ nh máº£ng sá»‘ nguyÃªn.
     * VÃ­ dá»¥: "2,5,16" hoáº·c "2, 5, 16" â†’ [2, 5, 16]
     */
    private _parseInput(rawInput: string): number[] | null {
        const parts = rawInput.split(/[,\s]+/).filter(s => s.length > 0);
        const result: number[] = [];
        for (let i = 0; i < parts.length; i++) {
            const num = parseInt(parts[i], 10);
            if (isNaN(num)) {
                this._setStatus(`âš  GiÃ¡ trá»‹ "${parts[i]}" khÃ´ng pháº£i sá»‘ nguyÃªn!`);
                console.warn(`[SlotDebugPanel] Parse lá»—i táº¡i vá»‹ trÃ­ ${i + 1}: "${parts[i]}"`);
                return null;
            }
            result.push(num);
        }
        return result;
    }

    /**
     * Validate: pháº£i cÃ³ CHÃNH XÃC 3 pháº§n tá»­ (= sá»‘ Reels).
     */
    private _validateDebugArray(arr: number[]): boolean {
        if (arr.length !== REQUIRED_REEL_COUNT) {
            const msg = `âš  debugArray cáº§n CHÃNH XÃC ${REQUIRED_REEL_COUNT} sá»‘ (hiá»‡n cÃ³: ${arr.length}). VÃ­ dá»¥: "2, 5, 16"`;
            this._setStatus(msg);
            console.warn(`[SlotDebugPanel] ${msg}`);
            return false;
        }
        return true;
    }

    /**
     * Set debugRands vÃ o DebugManager â†’ trigger SPIN_REQUEST.
     * Log "Sending Debug Array:" trÆ°á»›c khi mÃ£ hoÃ¡ AES (theo yÃªu cáº§u).
     */
    private _sendSpinWithDebugArray(debugArray: number[], label: string = ''): void {
        // In log trÆ°á»›c khi AES encrypt (NetworkManager sáº½ encrypt sau bÆ°á»›c nÃ y)
        console.log(
            `%c[SlotDebugPanel] Sending Debug Array: [${debugArray.join(', ')}]${label ? ' â€” ' + label : ''}`,
            'color:#0f0;font-weight:bold'
        );
        console.log('Sending Debug Array:', debugArray);

        // Gáº¯n vÃ o DebugManager â€” sáº½ Ä‘Æ°á»£c NetworkManager láº¥y ra táº¡i bÆ°á»›c sendSpinRequest()
        DebugManager.instance.setDebugRands(debugArray);

        // Trigger spin qua EventBus (flow giá»‘ng nÃºt Spin chÃ­nh)
        EventBus.instance.emit(GameEvents.SPIN_REQUEST);

        this._setStatus(`âœ… Sent [${debugArray.join(', ')}]${label ? ' â€” ' + label : ''}`);
    }

    private _setInputText(text: string): void {
        if (this.inputReelIndices) {
            this.inputReelIndices.string = text;
        }
    }

    private _setStatus(msg: string): void {
        if (this.statusLabel) {
            this.statusLabel.string = msg;
        }
        console.log(`[SlotDebugPanel] ${msg}`);
    }
}

/**
 * MockScenariosData - Dữ liệu SpinResponse mẫu cho từng kịch bản test.
 *
 * ★ Dữ liệu này khớp 100% với 14 file JSON trong thư mục này — dùng
 *   cho Cocos runtime (tránh import JSON trong TypeScript).
 *
 * ★ Các file .json dùng cho Node.js validator (tools/validate-mock-data.js).
 *
 * Sử dụng qua MockNetworkAdapter khi USE_REAL_API = false.
 */

import { SpinResponse, SlotStageType, CLIENT_TO_PS, PS_TO_CLIENT, MatchedLinePay } from '../SlotTypes';

// ─── HELPER: tạo SpinResponse nhanh ───────────────────────

// totalBet mặc định = betOptions[0](1) × coinValues[0](0.01) × paylines(9) = 0.09
const DEFAULT_TOTAL_BET = 0.09;

/**
 * Client-side payline definitions — copy của DEFAULT_PAYLINES trong GameData.
 * Dùng để compute matchedSymbolsIndices cho mock data.
 */
const MOCK_PAYLINES: number[][] = [
    [1, 1, 1], // Line 0: Middle
    [0, 0, 0], // Line 1: Top
    [2, 2, 2], // Line 2: Bottom
    [0, 1, 2], // Line 3: Diagonal ↘
    [2, 1, 0], // Line 4: Diagonal ↗
    [1, 0, 1], // Line 5: V shape top
    [1, 2, 1], // Line 6: V shape bottom
    [2, 1, 2], // Line 7
    [0, 1, 0], // Line 8
];

/**
 * Tính matchedSymbolsIndices từ payLineIndex.
 * Format: [{Item1: reelCol, Item2: row (0=top,1=mid,2=bot)}, ...]
 */
function makeIndices(payLineIndex: number): Array<{Item1: number; Item2: number}> {
    const payline = MOCK_PAYLINES[payLineIndex] || [1, 1, 1];
    return payline.map((row, col) => ({ Item1: col, Item2: row }));
}

function spin(
    rands: number[],
    nextStage: number,
    totalWin: number,
    remainFreeSpinCount: number,
    remainCash: number,
    updateCash: boolean,
    winGrade: string | null,
    linePays: Array<{ payLineIndex: number; payout: number; matchedSymbols: number[]; containsWild: boolean }>,
    featureMultiple?: number,
): SpinResponse {
    return {
        rands,
        nextStage,
        totalBet: DEFAULT_TOTAL_BET,
        totalWin,
        updateCash,
        remainCash,
        remainFreeSpinCount,
        winGrade: winGrade ?? undefined,
        featureMultiple,
        matchedLinePays: linePays.map(l => ({
            ...l,
            reelCnt: 3,
            matchedSymbolsIndices: makeIndices(l.payLineIndex),
        })),
    };
}

// ════════════════════════════════════════════════════════════
//  NORMAL SPIN SCENARIOS   (3 reels × 3 rows)
//
//  CÁCH ĐỌC RANDS: rands[col] = center index của reel strip đó
//    top = strip[(rand - 1 + 20) % 20]
//    mid = strip[rand]          ← ô giữa, payline chính
//    bot = strip[(rand + 1) % 20]
//
//  STRIP TÓM TẮT (SymbolId: 0=7, 1=77, 2=777, 3=BAR, 4=BARBAR,
//                            5=WILD_3X, 6=BONUS, 7=RED⚡, 8=BLUE⚡)
//  Reel 0: [0,3,1,7,4,2,5,0,3,8, 1,4,0,7,3,2,5,1,4,8]
//  Reel 1: [4,0,7,1,3,5,2,8,0,4, 1,3,7,0,5,4,2,3,8,1]
//  Reel 2: [0,3,6,1,7,4,2,5,0,8, 3,1,4,7,0,6,3,5,2,8]
// ════════════════════════════════════════════════════════════

/** Spin không trúng
 *  rands=[12,3,9]
 *  Grid: top[BARBAR, RED⚡, 7] / mid[7, 77, BLUE⚡] / bot[RED⚡, BAR, BAR]
 *  → Không có 3-of-a-kind trên bất kỳ payline nào. Không jackpot.
 */
export const SCENARIO_NO_WIN = spin(
    [12, 3, 9], SlotStageType.SPIN, 0, -1, 9999.91, true, null, [],
);

/** Trúng 3 payline — BAR × 3 trên mid + Line 6 BAR+Wild + Any Seven trên top
 *  rands=[1,4,1]
 *  Grid: top[7, 77, 7] / mid[BAR, BAR, BAR] / bot[77, WILD_3X, BONUS]
 *  → Payline 0 [mid,mid,mid]: BAR×3 ✓
 *  → Payline 1 [top,top,top]: 7-77-7 = Any Seven ✓ (highest=77 → multiplier 25)
 *  → Payline 6 [mid,bot,mid]: BAR-WILD_3X-BAR = BAR×3 with Wild ✓
 */
export const SCENARIO_NORMAL_WIN = spin(
    [1, 4, 1], SlotStageType.SPIN, 0.61, -1, 10000.52, true, 'Normal',
    [
        { payLineIndex: 0, payout: 0.27, matchedSymbols: [3, 3, 3], containsWild: false },
        { payLineIndex: 1, payout: 0.25, matchedSymbols: [0, 1, 0], containsWild: false },
        { payLineIndex: 6, payout: 0.09, matchedSymbols: [3, 5, 3], containsWild: true },
    ],
);

/** Trúng 3 payline — BAR×3 trên mid + 77+Wild trên bot + BAR+Wild trên Line 6
 *  rands=[1,4,10]
 *  Grid: top[7, 77, BLUE⚡] / mid[BAR, BAR, BAR] / bot[77, WILD_3X, 77]
 *  → Payline 0 [mid,mid,mid]: BAR×3 ✓
 *  → Payline 2 [bot,bot,bot]: 77-WILD-77 = 77 with Wild ✓
 *  → Payline 6 [mid,bot,mid]: BAR-WILD-BAR = BAR with Wild ✓
 */
export const SCENARIO_MULTI_LINE = spin(
    [1, 4, 10], SlotStageType.SPIN, 0.54, -1, 10000.45, true, 'Normal',
    [
        { payLineIndex: 0, payout: 0.20, matchedSymbols: [3, 3, 3], containsWild: false },
        { payLineIndex: 2, payout: 0.25, matchedSymbols: [1, 5, 1], containsWild: true },
        { payLineIndex: 6, payout: 0.09, matchedSymbols: [3, 5, 3], containsWild: true },
    ],
);

/** Mega Win — BARBAR × 3 trên mid + Any Seven trên bot
 *  rands=[4,9,5]
 *  Grid: top[RED⚡, 7, RED⚡] / mid[BARBAR, BARBAR, BARBAR] / bot[777, 77, 777]
 *  → Payline 0 (mid): BARBAR×3 ✓  |  totalWin/totalBet ≈ 65× → 'Mega'
 *  → Payline 2 (bot): 777-77-777 = Any Seven ✓
 */
export const SCENARIO_BIG_WIN = spin(
    [4, 9, 5], SlotStageType.SPIN, 500, -1, 10499.91, true, 'Mega',
    [
        { payLineIndex: 0, payout: 450, matchedSymbols: [4, 4, 4], containsWild: false },
        { payLineIndex: 2, payout: 50, matchedSymbols: [2, 1, 2], containsWild: false },
    ],
);

/** Long Spin (near-miss) — cột 0 + cột 1 cùng payline đều có special symbol → trigger long spin reel 3
 *
 *  Reel 0: strip[9]=8 (BLUE⚡) → rand=9
 *  Reel 1: strip[2]=7 (RED⚡)  → rand=2
 *  Reel 2: strip[0]=0 (7)     → rand=0  (không complete jackpot)
 *
 *  Grid: top[BAR, 7, BLUE⚡] / mid[BLUE⚡, RED⚡, 7] / bot[77, 77, BAR]
 *  → Payline 0 [mid,mid,mid]: BLUE⚡ + RED⚡ → cả 2 special → LONG_SPIN triggered ✓
 *  → Reel 2 = 7 → KHÔNG complete jackpot → near-miss ✓
 *  → No win (symbols khác group)
 */
export const SCENARIO_LONG_SPIN = spin(
    [9, 2, 0], SlotStageType.SPIN, 0, -1, 9999.91, true, null, [],
);

/** Grand Jackpot — WILD_3X × 3 cột giữa
 *
 *  rands[col] = index mà strip[rand] = WILD_3X:
 *    Reel 0: strip[6]  = WILD_3X  → rand=6
 *    Reel 1: strip[5]  = WILD_3X  → rand=5
 *    Reel 2: strip[7]  = WILD_3X  → rand=7
 *
 *  Grid: top[777, BAR, 777] / mid[WILD_3X, WILD_3X, WILD_3X] / bot[7, 777, 7]
 *  → Payline 0 [mid,mid,mid]: WILD_3X×3 → _detectJackpot() → GRAND ✓
 */
export const SCENARIO_JACKPOT = spin(
    [6, 5, 7], SlotStageType.SPIN, 25000, -1, 34999.91, true, 'Mega',
    [{ payLineIndex: 0, payout: 25000, matchedSymbols: [5], containsWild: false }],
);

// ════════════════════════════════════════════════════════════
//  FREE SPIN FLOW  (trigger → spin × N → end)
// ════════════════════════════════════════════════════════════

/** Trigger Free Spin — BONUS xuất hiện ở mid Reel 2 → cấp 3 vòng
 *  rands=[12,8,2]
 *  Grid: top[BARBAR, BLUE⚡, BAR] / mid[7, 7, BONUS] / bot[RED⚡, BARBAR, 77]
 *  → nextStage=FREE_SPIN_START, remainFSC=3
 */
export const SCENARIO_TRIGGER_FREE = spin(
    [12, 8, 2], SlotStageType.FREE_SPIN_START, 0, 3, 9999.91, true, null,
    [{ payLineIndex: 0, payout: 0, matchedSymbols: [6], containsWild: false }],
);

/** Free Spin vòng 3 (remaining=3→2) — 7×3 trên mid, 2× featureMultiple
 *  rands=[12,8,8]
 *  Grid: top[BARBAR, BLUE⚡, WILD_3X] / mid[7, 7, 7] / bot[RED⚡, BARBAR, BLUE⚡]
 *  → Payline 0 (mid): 7×3 ✓
 */
export const SCENARIO_FREESPIN_3 = spin(
    [12, 8, 8], SlotStageType.FREE_SPIN, 0.20, 2, 9999.91, false, 'Normal',
    [
        { payLineIndex: 0, payout: 0.20, matchedSymbols: [0, 0, 0], containsWild: false },
    ],
    2,
);

/** Free Spin vòng 2 (remaining=2→1) — BAR×3 trên mid, 2× featureMultiple
 *  rands=[8,11,10]
 *  Grid: top[7, 77, BLUE⚡] / mid[BAR, BAR, BAR] / bot[BLUE⚡, RED⚡, 77]
 *  → Payline 0 (mid): BAR×3 ✓
 */
export const SCENARIO_FREESPIN_2 = spin(
    [8, 11, 10], SlotStageType.FREE_SPIN, 0.10, 1, 9999.91, false, 'Normal',
    [{ payLineIndex: 0, payout: 0.10, matchedSymbols: [3, 3, 3], containsWild: false }],
    2,
);

/** Free Spin vòng cuối (remaining=1→0) — BARBAR×3 trên mid, 5× featureMultiple
 *  rands=[18,9,5]
 *  Grid: top[77, 7, RED⚡] / mid[BARBAR, BARBAR, BARBAR] / bot[BLUE⚡, 77, 777]
 *  → Payline 0 (mid): BARBAR×3 ✓ | nextStage=FREE_SPIN_END
 */
export const SCENARIO_FREESPIN_END = spin(
    [18, 9, 5], SlotStageType.FREE_SPIN_END, 0.80, 0, 9999.91, false, 'Normal',
    [{ payLineIndex: 0, payout: 0.80, matchedSymbols: [4, 4, 4], containsWild: false }],
    5,
);

/** Re-trigger FreeSpin — BONUS xuất hiện trong lúc free spin → +5 vòng
 *  rands=[12,8,15]
 *  Grid: top[BARBAR, BLUE⚡, 7] / mid[7, 7, BONUS] / bot[RED⚡, BARBAR, BAR]
 *  → nextStage=FREE_SPIN_RE_TRIGGER
 *  → remainFSC = (current_remaining_trước_lượt_này) + 5 (GameManager sẽ SET trực tiếp)
 *  → Scenario này chỉ được dùng trong queue normal spin; free spin dùng generateSpinResponse
 */
export const SCENARIO_RETRIGGER_FREE = spin(
    [12, 8, 15], SlotStageType.FREE_SPIN_RE_TRIGGER, 0, 0, 9999.91, false, null,
    [{ payLineIndex: 0, payout: 0, matchedSymbols: [6], containsWild: false }],
);

/** Free Spin vòng BigWin (replacing vòng 3) — BARBAR × 3 trên mid, 2× featureMultiple, winGrade='Mega'
 *  rands=[4,9,5] — khớp với SCENARIO_BIG_WIN nhưng nextStage=FREE_SPIN, updateCash=false
 *  Grid: top[RED⚡, 7, RED⚡] / mid[BARBAR, BARBAR, BARBAR] / bot[777, 77, 777]
 *  → Payline 0 (mid): BARBAR×3 ✓ | winGrade='Mega' nhưng progressive win SẼ KHÔNG hiện (đang freespin)
 *  → totalWin sẽ được cộng vào freeSpinTotalWin, không update wallet ngay
 */
export const SCENARIO_FREESPIN_BIGWIN = spin(
    [4, 9, 5], SlotStageType.FREE_SPIN, 500, 2, 9999.91, false, 'Mega',
    [
        { payLineIndex: 0, payout: 450, matchedSymbols: [4, 4, 4], containsWild: false },
        { payLineIndex: 2, payout: 50, matchedSymbols: [2, 1, 2], containsWild: false },
    ],
    2,
);

/** Free Spin vòng Jackpot — WILD_3X × 3 cột giữa, nextStage=FREE_SPIN (vẫn còn lượt)
 *  rands=[6,5,7] — khớp với SCENARIO_JACKPOT nhưng nextStage=FREE_SPIN, updateCash=false
 *  Grid: top[777, BAR, 777] / mid[WILD_3X, WILD_3X, WILD_3X] / bot[7, 777, 7]
 *  → _detectJackpot() → GRAND ✓
 *  → totalWin sẽ được cộng vào freeSpinTotalWin, không update wallet ngay
 *  → Jackpot popup hiện ra, đóng → tiếp tục vòng freespin tiếp theo
 */
export const SCENARIO_FREESPIN_JACKPOT = spin(
    [6, 5, 7], SlotStageType.FREE_SPIN, 25000, 2, 9999.91, false, 'Mega',
    [{ payLineIndex: 0, payout: 25000, matchedSymbols: [5], containsWild: false }],
);

// ════════════════════════════════════════════════════════════
//  BUY FREE SPIN SCENARIOS (Buy Bonus mock data)
// ════════════════════════════════════════════════════════════

/** Buy Free Spin — vòng 1 (remaining=10→9) — 7×3 trên mid, 2× featureMultiple */
export const SCENARIO_BUY_FS_1 = spin(
    [12, 8, 8], SlotStageType.BUY_FREE_SPIN, 0.20, 9, 9999.91, false, 'Normal',
    [{ payLineIndex: 0, payout: 0.20, matchedSymbols: [0, 0, 0], containsWild: false }],
    2,
);

/** Buy Free Spin — vòng 2 (remaining=9→8) — no win, 1× */
export const SCENARIO_BUY_FS_2 = spin(
    [12, 3, 9], SlotStageType.BUY_FREE_SPIN, 0, 8, 9999.91, false, null, [],
    1,
);

/** Buy Free Spin — vòng 3 (remaining=8→7) — BAR×3, 2× */
export const SCENARIO_BUY_FS_3 = spin(
    [8, 11, 10], SlotStageType.BUY_FREE_SPIN, 0.10, 7, 9999.91, false, 'Normal',
    [{ payLineIndex: 0, payout: 0.10, matchedSymbols: [3, 3, 3], containsWild: false }],
    2,
);

/** Buy Free Spin — vòng 4 (remaining=7→6) — no win */
export const SCENARIO_BUY_FS_4 = spin(
    [3, 7, 13], SlotStageType.BUY_FREE_SPIN, 0, 6, 9999.91, false, null, [],
    1,
);

/** Buy Free Spin — vòng 5 (remaining=6→5) — 77×3, 3× */
export const SCENARIO_BUY_FS_5 = spin(
    [2, 3, 3], SlotStageType.BUY_FREE_SPIN, 0.30, 5, 9999.91, false, 'Normal',
    [{ payLineIndex: 0, payout: 0.30, matchedSymbols: [1, 1, 1], containsWild: false }],
    3,
);

/** Buy Free Spin — vòng 6 (remaining=5→4) — no win */
export const SCENARIO_BUY_FS_6 = spin(
    [9, 2, 7], SlotStageType.BUY_FREE_SPIN, 0, 4, 9999.91, false, null, [],
    1,
);

/** Buy Free Spin — vòng 7 (remaining=4→3) — 7×3, 2× */
export const SCENARIO_BUY_FS_7 = spin(
    [7, 8, 8], SlotStageType.BUY_FREE_SPIN, 0.20, 3, 9999.91, false, 'Normal',
    [{ payLineIndex: 0, payout: 0.20, matchedSymbols: [0, 0, 0], containsWild: false }],
    2,
);

/** Buy Free Spin — vòng 8 (remaining=3→2) — no win */
export const SCENARIO_BUY_FS_8 = spin(
    [4, 6, 12], SlotStageType.BUY_FREE_SPIN, 0, 2, 9999.91, false, null, [],
    1,
);

/** Buy Free Spin — vòng 9 (remaining=2→1) — BARBAR×3, 5× */
export const SCENARIO_BUY_FS_9 = spin(
    [18, 9, 5], SlotStageType.BUY_FREE_SPIN, 0.80, 1, 9999.91, false, 'Normal',
    [{ payLineIndex: 0, payout: 0.80, matchedSymbols: [4, 4, 4], containsWild: false }],
    5,
);

/** Buy Free Spin — vòng cuối (remaining=1→0) — 7×3, 3× → BUY_FREE_SPIN_END */
export const SCENARIO_BUY_FS_END = spin(
    [12, 8, 8], SlotStageType.BUY_FREE_SPIN_END, 0.40, 0, 9999.91, false, 'Normal',
    [{ payLineIndex: 0, payout: 0.40, matchedSymbols: [0, 0, 0], containsWild: false }],
    3,
);

/** Chuỗi Buy Free Spin hoàn chỉnh: 10 vòng spin mua bonus */
export const BUY_FREE_SPIN_SEQUENCE: SpinResponse[] = [
    SCENARIO_BUY_FS_1,
    SCENARIO_BUY_FS_2,
    SCENARIO_BUY_FS_3,
    SCENARIO_BUY_FS_4,
    SCENARIO_BUY_FS_5,
    SCENARIO_BUY_FS_6,
    SCENARIO_BUY_FS_7,
    SCENARIO_BUY_FS_8,
    SCENARIO_BUY_FS_9,
    SCENARIO_BUY_FS_END,
];

// ════════════════════════════════════════════════════════════
//  PRESET SEQUENCES (dùng cho MOCK_SPIN_SCENARIO = 'sequence')
// ════════════════════════════════════════════════════════════

/**
 * Chuỗi spin cho kịch bản 'full_free':
 *  Trigger → BigWin spin → 2 vòng FreeSpin → End
 *  → Dùng để test BigWin (winGrade='Mega') xảy ra TRONG freespin:
 *    progressive win popup KHÔNG hiện, tiền (5.90) cộng vào freeSpinTotalWin
 *  → freeSpinTotalWin kỳ vọng sau claim = 5.90 + 0.10 + 0.80 = 6.80
 */
export const FULL_FREE_SEQUENCE: SpinResponse[] = [
    SCENARIO_TRIGGER_FREE,
    SCENARIO_FREESPIN_BIGWIN,   // ← spin 1: BigWin (Mega) trong freespin
    SCENARIO_FREESPIN_2,
    SCENARIO_FREESPIN_END,
];

/**
 * Chuỗi spin cho kịch bản 'full_free_jackpot':
 *  Trigger → Jackpot spin → 2 vòng FreeSpin → End
 *  → Dùng để test Jackpot xảy ra TRONG freespin:
 *    jackpot popup hiện, đóng → tiếp tục freespin tiếp theo
 *    tiền jackpot (25000) cộng vào freeSpinTotalWin
 *  → freeSpinTotalWin kỳ vọng sau claim = 25000 + 0.10 + 0.80 = 25000.90
 */
export const FULL_FREE_JACKPOT_SEQUENCE: SpinResponse[] = [
    SCENARIO_TRIGGER_FREE,
    SCENARIO_FREESPIN_JACKPOT,  // ← spin 1: Jackpot (Grand) trong freespin
    SCENARIO_FREESPIN_2,
    SCENARIO_FREESPIN_END,
];

/**
 * Chuỗi spin cho kịch bản 'full_free_retrigger':
 *  Trigger → 1 vòng FreeSpin → Re-trigger (BONUS lại giữa chừng) → 4 vòng FreeSpin → End
 *
 *  Flow thực tế:
 *    TRIGGER_FREE        → FREE_SPIN_START (remain=3)  FreeSpinPopup hiện
 *    FREESPIN_3          → spin #1 (remain 3→2)
 *    RETRIGGER_FREE      → spin #2 (remain 2→1, nextStage=FREE_SPIN_RE_TRIGGER)
 *                            Mock: _enterFreeSpin(3, true) → remain 1+3=4
 *                            FreeSpinPopup hiện lại thông báo +lượt
 *    FREESPIN_3          → retrigger spin #1 (remain 4→3)
 *    FREESPIN_2          → retrigger spin #2 (remain 3→2)
 *    FREESPIN_3          → retrigger spin #3 (remain 2→1)
 *    FREESPIN_END        → retrigger spin #4 (remain 1→0, nextStage=FREE_SPIN_END)
 *                            FreeSpinEndPopup hiện tổng kết
 */
export const FULL_FREE_RETRIGGER_SEQUENCE: SpinResponse[] = [
    SCENARIO_TRIGGER_FREE,       // Normal spin → FREE_SPIN_START (remain=3)
    SCENARIO_FREESPIN_3,         // Free spin #1 (remain 3→2)
    SCENARIO_RETRIGGER_FREE,     // Free spin #2 — BONUS hit lại! (remain 2→1 → +3 = 4)
    SCENARIO_FREESPIN_3,         // Retrigger spin #1 (remain 4→3)
    SCENARIO_FREESPIN_2,         // Retrigger spin #2 (remain 3→2)
    SCENARIO_FREESPIN_3,         // Retrigger spin #3 (remain 2→1)
    SCENARIO_FREESPIN_END,       // Retrigger spin #4 (remain 1→0, FREE_SPIN_END)
];

/**
 * Chuỗi tổng hợp cho kịch bản 'sequence':
 *  no_win → normal_win → multi_line → trigger_free → 3× free → end → big_win → jackpot → lặp lại
 */
export const DEFAULT_SEQUENCE: SpinResponse[] = [
    SCENARIO_NO_WIN,
    SCENARIO_NORMAL_WIN,
    SCENARIO_MULTI_LINE,
    SCENARIO_TRIGGER_FREE,
    SCENARIO_FREESPIN_3,
    SCENARIO_FREESPIN_2,
    SCENARIO_FREESPIN_END,
    SCENARIO_BIG_WIN,
    SCENARIO_JACKPOT,
];

// ════════════════════════════════════════════════════════════
//  MOCK RESUME DATA — Giả lập lastSpinResponse từ Enter API
//
//  Dùng với MOCK_RESUME_SCENARIO trong ServerConfig.ts.
//
//  Format: PascalCase theo AckSpin server thật:
//    NextStage, RemainFreeSpinCount, FeatureSpinTotalWin, Rands
//  Resume logic đọc các field này bằng dấu ?? (optional).
// ════════════════════════════════════════════════════════════

/**
 * 'normal_spin' — Tắt game TRONG lúc Normal Spin đang chờ kết quả.
 * Spec: không resume, start từ đầu.
 * → NextStage=SPIN (0) → _pendingResume KHÔNG được set → vào game bình thường.
 */
export const MOCK_RESUME_NORMAL_SPIN = {
    NextStage: SlotStageType.SPIN,
    RemainFreeSpinCount: 0,
    FeatureSpinTotalWin: 0,
    Rands: [12, 3, 9],   // Spin không trúng — rands từ SCENARIO_NO_WIN
};

/**
 * 'free_spin_mid' — Tắt game GIỮA Free Spin, còn 5 lượt.
 * → Resume: vào lại Free Spin screen với 5 lượt còn lại, auto-spin.
 */
export const MOCK_RESUME_FREE_SPIN_MID = {
    NextStage: SlotStageType.FREE_SPIN,
    RemainFreeSpinCount: 5,
    FeatureSpinTotalWin: 0.30,   // Đã thắng 0.30 trong 2 vòng đầu
    Rands: [8, 11, 10],          // Rands vòng cuối đã quay (SCENARIO_FREESPIN_2)
};

/**
 * 'free_spin_need_claim' — Free Spin đã hết lượt (NextStage=FREE_SPIN_END=101),
 * nhưng chưa kịp Claim trước khi tắt.
 * → Resume: Claim ngay, hiện FreeSpinEndPopup với tổng tiền thắng.
 */
export const MOCK_RESUME_FREE_SPIN_NEED_CLAIM = {
    NextStage: SlotStageType.FREE_SPIN_END,   // 101
    RemainFreeSpinCount: 0,
    FeatureSpinTotalWin: 1.10,   // Tổng thắng trong cả chuỗi free spin
    Rands: [18, 9, 5],           // Rands vòng cuối (SCENARIO_FREESPIN_END)
};

/**
 * 'free_spin_jackpot_mid' — Tắt game SAU KHI trúng Jackpot (Grand) trong Free Spin,
 * còn 3 lượt chưa quay.
 * → Resume: hiện JackpotPopup trước, đóng popup → tiếp tục Free Spin với 3 lượt.
 *
 * Rands=[6,5,7] khớp với SCENARIO_JACKPOT → _detectJackpot() → GRAND ✓
 */
export const MOCK_RESUME_FREE_SPIN_JACKPOT_MID = {
    NextStage: SlotStageType.FREE_SPIN,
    RemainFreeSpinCount: 3,
    FeatureSpinTotalWin: 25000,   // Jackpot Grand đã được tính vào tổng
    Rands: [6, 5, 7],             // Grand Jackpot rands — WILD_3X×3 ở cột giữa
};

/**
 * 'buy_free_spin_mid' — Tắt game GIỮA Buy Free Spin, còn 5 lượt.
 * → Resume: vào lại Buy Free Spin screen với 5 lượt còn lại, auto-spin.
 */
export const MOCK_RESUME_BUY_FREE_SPIN_MID = {
    NextStage: SlotStageType.BUY_FREE_SPIN,
    RemainFreeSpinCount: 5,
    FeatureSpinTotalWin: 0.60,   // Đã thắng 0.60 trong 5 vòng đầu
    Rands: [9, 2, 7],            // Rands vòng cuối đã quay (SCENARIO_BUY_FS_6 — no win)
};

/**
 * 'buy_free_spin_need_claim' — Buy Free Spin đã hết lượt (NextStage=BUY_FREE_SPIN_END=107),
 * nhưng chưa kịp Claim trước khi tắt.
 * → Resume: Claim ngay, hiện FreeSpinEndPopup.
 */
export const MOCK_RESUME_BUY_FREE_SPIN_NEED_CLAIM = {
    NextStage: SlotStageType.BUY_FREE_SPIN_END,   // 107
    RemainFreeSpinCount: 0,
    FeatureSpinTotalWin: 1.70,   // Tổng thắng trong cả chuỗi buy free spin
    Rands: [12, 8, 8],           // Rands vòng cuối (SCENARIO_BUY_FS_END)
};

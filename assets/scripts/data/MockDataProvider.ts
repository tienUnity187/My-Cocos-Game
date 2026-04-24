/**
 * MockDataProvider - Tạo mock SpinResponse cho dev/test.
 * Sau này sẽ được thay bằng NetworkManager gọi API thật.
 */

import { SpinResponse, SlotStageType, SymbolId, JackpotType } from './SlotTypes';
import { GameData } from './GameData';

export class MockDataProvider {

    /**
     * Flag: đã xảy ra retrigger trong chuỗi free spin hiện tại.
     * Đặt true khi retrigger xảy ra → ngăn retrigger thứ 2 trong cùng session.
     * Reset bằng resetFreeSpinState() khi free spin bắt đầu từ đầu.
     */
    static _freeSpinRetriggered: boolean = false;

    /** Gọi khi bắt đầu free spin mới (initial trigger) để reset flag retrigger. */
    static resetFreeSpinState(): void {
        MockDataProvider._freeSpinRetriggered = false;
    }

    /**
     * Tạo 1 SpinResponse ngẫu nhiên (mock).
     * Có xác suất nhỏ trigger Free Spin, Jackpot, v.v.
     */
    static generateSpinResponse(isFreeSpin: boolean = false): SpinResponse {
        const data = GameData.instance;
        const strips = data.config.reelStrips;

        // Random center index cho mỗi reel
        const rands = strips.map((strip) => Math.floor(Math.random() * strip.length));

        // Xây dựng grid 3x3 để check win
        const grid: number[][] = []; // grid[col][row]
        for (let col = 0; col < 3; col++) {
            const symbols = data.getVisibleSymbols(col, rands[col]);
            grid.push(symbols);
        }

        // Check paylines
        const matchedLinePays: SpinResponse['matchedLinePays'] = [];
        let totalWin = 0;
        const paylines = data.config.paylines;
        const totalBet = data.totalBet;
        const lineBet = totalBet / paylines.length;

        for (let i = 0; i < paylines.length; i++) {
            const line = paylines[i];
            const symbols = [grid[0][line[0]], grid[1][line[1]], grid[2][line[2]]];

            const payout = MockDataProvider._evaluateLine(symbols, lineBet);
            if (payout > 0) {
                const containsWild = symbols.some((s) => s === SymbolId.WILD_3X);
                // 3X Wild trong line → nhân 3 payout (trừ jackpot — jackpot handle riêng)
                // _evaluateLine đã tính multiplier ×3 khi hasWild, nên không nhân lại ở đây
                matchedLinePays.push({
                    payLineIndex: i,
                    payout,
                    matchedSymbols: symbols,
                    containsWild,
                    reelCnt: 3,
                    matchedSymbolsIndices: [
                        { Item1: 0, Item2: line[0] },
                        { Item1: 1, Item2: line[1] },
                        { Item1: 2, Item2: line[2] },
                    ],
                });
                totalWin += payout;
            }
        }

        // Xác định nextStage
        let nextStage = SlotStageType.SPIN;
        const hasBonus = grid[2].indexOf(SymbolId.BONUS) >= 0;

        if (isFreeSpin) {
            const remaining = data.freeSpinRemaining - 1;
            // Chỉ cho phép retrigger 1 lần trong 1 chuỗi free spin
            if (hasBonus && !MockDataProvider._freeSpinRetriggered) {
                nextStage = SlotStageType.FREE_SPIN_RE_TRIGGER;
                MockDataProvider._freeSpinRetriggered = true;
            } else if (remaining <= 0) {
                nextStage = SlotStageType.FREE_SPIN_END;
            } else {
                nextStage = SlotStageType.FREE_SPIN;
            }
        } else if (hasBonus) {
            nextStage = SlotStageType.FREE_SPIN_START;
        }

        // Feature multiple cho free spin — CHỈ áp dụng cho payline win, KHÔNG áp dụng jackpot
        let featureMultiple: number | undefined = undefined;
        if (isFreeSpin && totalWin > 0) {
            featureMultiple = MockDataProvider._randomMultiplier();
            totalWin *= featureMultiple;
            // Cập nhật từng payout trong matchedLinePays theo multiplier
            for (const lp of matchedLinePays) {
                lp.payout *= featureMultiple;
            }
        }

        // Tính remainCash giống server: balance hiện tại - bet (nếu updateCash) + win
        const currentBalance = data.player.balance;
        const updateCash = !isFreeSpin;
        const remainCash = updateCash
            ? currentBalance - totalBet + totalWin
            : currentBalance + totalWin;

        // winGrade giống server: dựa trên tỉ lệ totalWin / totalBet
        let winGrade: string | undefined = undefined;
        if (totalWin > 0) {
            const ratio = totalWin / totalBet;
            if (ratio >= data.config.superWinThreshold) winGrade = 'Super';
            else if (ratio >= data.config.megaWinThreshold) winGrade = 'Mega';
            else if (ratio >= data.config.bigWinThreshold) winGrade = 'Big';
            else winGrade = 'Normal';
        }

        // remainFreeSpinCount: số free spin còn lại (giống server)
        let remainFreeSpinCount: number | undefined = undefined;
        if (isFreeSpin && nextStage === SlotStageType.FREE_SPIN_RE_TRIGGER) {
            // Retrigger: current remaining (TRƯỚC khi -1 lần này) + 5 lượt thưởng mới
            // → GameManager sẽ SET trực tiếp vào freeSpinRemaining (không cộng thêm)
            remainFreeSpinCount = data.freeSpinRemaining + 5;
        } else if (isFreeSpin) {
            remainFreeSpinCount = Math.max(0, data.freeSpinRemaining - 1);
        } else if (nextStage === SlotStageType.FREE_SPIN_START) {
            remainFreeSpinCount = 3; // Mặc định 3 free spins khi trigger
        }

        return {
            rands,
            matchedLinePays,
            totalBet,
            totalWin,
            updateCash,
            nextStage,
            featureMultiple,
            remainCash,
            remainFreeSpinCount,
            winGrade,
        };
    }

    /** Mock simple paytable evaluation */
    private static _evaluateLine(symbols: number[], lineBet: number): number {
        const sevens = [SymbolId.SEVEN_SINGLE, SymbolId.SEVEN_DOUBLE, SymbolId.SEVEN_TRIPLE];
        const bars   = [SymbolId.BAR_SINGLE, SymbolId.BAR_DOUBLE];

        // Wild (3X) substitute cho tất cả trừ Bonus
        const resolved = symbols.map((s) => (s === SymbolId.WILD_3X ? -1 : s));
        const hasWild  = resolved.indexOf(-1) >= 0;
        const nonWild  = resolved.filter((s) => s !== -1);

        // Bonus không tính win qua payline
        if (nonWild.some((s) => s === SymbolId.BONUS)) return 0;

        // Tất cả Wild → giá trị Grand
        if (nonWild.length === 0) {
            return lineBet * MockDataProvider._getPayMultiplier(SymbolId.WILD_3X) * 3;
        }

        // Kiểm tra nhóm: all-same, all-7 (any combo), all-BAR (any combo)
        // Áp dụng cho TẤT CẢ 9 paylines — hàng ngang, chéo, V, zigzag
        const allSame   = nonWild.every((s) => s === nonWild[0]);
        const allSevens = nonWild.every((s) => sevens.indexOf(s) >= 0);
        const allBars   = nonWild.every((s) => bars.indexOf(s) >= 0);

        if (!allSame && !allSevens && !allBars) return 0;

        // Lấy multiplier CAO NHẤT trong các symbol (777 > 77 > 7, BARBAR > BAR)
        let bestMult = 0;
        for (const s of nonWild) {
            const m = MockDataProvider._getPayMultiplier(s);
            if (m > bestMult) bestMult = m;
        }
        if (bestMult === 0) return 0;

        return lineBet * bestMult * (hasWild ? 3 : 1);
    }

    private static _isSameGroup(a: number, b: number): boolean {
        if (a === b) return true;
        const sevens = [SymbolId.SEVEN_SINGLE, SymbolId.SEVEN_DOUBLE, SymbolId.SEVEN_TRIPLE];
        if (sevens.indexOf(a) >= 0 && sevens.indexOf(b) >= 0) return true;
        const bars = [SymbolId.BAR_SINGLE, SymbolId.BAR_DOUBLE];
        if (bars.indexOf(a) >= 0 && bars.indexOf(b) >= 0) return true;
        return false;
    }

    private static _getPayMultiplier(symbolId: number): number {
        switch (symbolId) {
            case SymbolId.SEVEN_TRIPLE: return 50;
            case SymbolId.SEVEN_DOUBLE: return 25;
            case SymbolId.SEVEN_SINGLE: return 10;
            case SymbolId.BAR_DOUBLE: return 8;
            case SymbolId.BAR_SINGLE: return 5;
            case SymbolId.RED_LIGHTNING: return 100;
            case SymbolId.BLUE_LIGHTNING: return 40;
            case SymbolId.WILD_3X: return 200; // 3x Wild = Grand Jackpot value
            default: return 0;
        }
    }

    /** Random multiplier cho Free Spin: 2x / 3x / 5x / 7x / 10x / 20x */
    private static _randomMultiplier(): number {
        const options = [2, 2, 2, 3, 3, 3, 5, 5, 7, 7, 10, 20];
        return options[Math.floor(Math.random() * options.length)];
    }

    /** Lấy random symbol không phải BONUS (cho Free Spin) */
    private static _getRandomNonBonusSymbol(): number {
        const symbols = [
            SymbolId.SEVEN_SINGLE, SymbolId.SEVEN_DOUBLE, SymbolId.SEVEN_TRIPLE,
            SymbolId.BAR_SINGLE, SymbolId.BAR_DOUBLE,
            SymbolId.WILD_3X,
            SymbolId.RED_LIGHTNING, SymbolId.BLUE_LIGHTNING,
        ];
        return symbols[Math.floor(Math.random() * symbols.length)];
    }

    // ─── FORCED SCENARIOS (dùng để test UI/animation) ───

    /**
     * Tạo SpinResponse với kịch bản được chọn sẵn.
     * Dùng trong NetworkManager hoặc GameManager.start() để test.
     *
     * Ví dụ sử dụng:
     *   NetworkManager.instance.setAdapter(new ForcedMockAdapter(TestScenario.GRAND_JACKPOT));
     */
    static buildScenario(scenario: TestScenario): SpinResponse {
        const data = GameData.instance;
        const totalBet = data.totalBet;
        const lineBet = totalBet / data.config.paylines.length;
        const mults = data.config.jackpotMultipliers || { GRAND: 500, MAJOR: 250, MINOR: 100, MINI: 25 };

        // Helper: thêm remainCash, winGrade cho scenario results (giống server)
        const enrichResponse = (resp: SpinResponse): SpinResponse => {
            const currentBalance = data.player.balance;
            resp.remainCash = resp.updateCash
                ? currentBalance - resp.totalBet + resp.totalWin
                : currentBalance + resp.totalWin;
            if (resp.totalWin > 0) {
                const ratio = resp.totalWin / resp.totalBet;
                if (ratio >= data.config.superWinThreshold) resp.winGrade = 'Super';
                else if (ratio >= data.config.megaWinThreshold) resp.winGrade = 'Mega';
                else if (ratio >= data.config.bigWinThreshold) resp.winGrade = 'Big';
                else resp.winGrade = 'Normal';
            }
            return resp;
        };

        switch (scenario) {

            case TestScenario.GRAND_JACKPOT:
                // 3 cột giữa đều là WILD_3X → Grand Jackpot
                return enrichResponse({
                    rands: [6, 5, 7],   // index strip trỏ vào WILD_3X mid-row
                    matchedLinePays: [{
                        payLineIndex: 0,
                        payout: totalBet * mults.GRAND,
                        matchedSymbols: [SymbolId.WILD_3X, SymbolId.WILD_3X, SymbolId.WILD_3X],
                        containsWild: true,
                        reelCnt: 3,
                        matchedSymbolsIndices: [{Item1: 0, Item2: 1}, {Item1: 1, Item2: 1}, {Item1: 2, Item2: 1}],
                    }],
                    totalBet,
                    totalWin: totalBet * mults.GRAND,
                    updateCash: true,
                    nextStage: SlotStageType.SPIN,
                });

            case TestScenario.MAJOR_JACKPOT:
                // 3 Red Lightning giữa → Major Jackpot
                return enrichResponse({
                    rands: [3, 2, 4],
                    matchedLinePays: [{
                        payLineIndex: 0,
                        payout: totalBet * mults.MAJOR,
                        matchedSymbols: [SymbolId.RED_LIGHTNING, SymbolId.RED_LIGHTNING, SymbolId.RED_LIGHTNING],
                        containsWild: false,
                        reelCnt: 3,
                        matchedSymbolsIndices: [{Item1: 0, Item2: 1}, {Item1: 1, Item2: 1}, {Item1: 2, Item2: 1}],
                    }],
                    totalBet,
                    totalWin: totalBet * mults.MAJOR,
                    updateCash: true,
                    nextStage: SlotStageType.SPIN,
                });

            case TestScenario.MINOR_JACKPOT:
                // 3 Blue Lightning giữa → Minor Jackpot
                return enrichResponse({
                    rands: [9, 7, 9],
                    matchedLinePays: [{
                        payLineIndex: 0,
                        payout: totalBet * mults.MINOR,
                        matchedSymbols: [SymbolId.BLUE_LIGHTNING, SymbolId.BLUE_LIGHTNING, SymbolId.BLUE_LIGHTNING],
                        containsWild: false,
                        reelCnt: 3,
                        matchedSymbolsIndices: [{Item1: 0, Item2: 1}, {Item1: 1, Item2: 1}, {Item1: 2, Item2: 1}],
                    }],
                    totalBet,
                    totalWin: totalBet * mults.MINOR,
                    updateCash: true,
                    nextStage: SlotStageType.SPIN,
                });

            case TestScenario.ANY_SEVEN:
                // Payline 1 (middle): 7-77-777 mixed sevens
                return enrichResponse({
                    rands: [0, 3, 8],   // Reel 0 idx 0=7, Reel 1 idx 3=77, Reel 2 idx 8=777
                    matchedLinePays: [{
                        payLineIndex: 0, // Middle line
                        payout: lineBet * 25, // 77 multiplier
                        matchedSymbols: [SymbolId.SEVEN_SINGLE, SymbolId.SEVEN_DOUBLE, SymbolId.SEVEN_TRIPLE],
                        containsWild: false,
                        reelCnt: 3,
                        matchedSymbolsIndices: [{Item1: 0, Item2: 1}, {Item1: 1, Item2: 1}, {Item1: 2, Item2: 1}],
                    }],
                    totalBet,
                    totalWin: lineBet * 25,
                    updateCash: true,
                    nextStage: SlotStageType.SPIN,
                });

            case TestScenario.PURE_SEVEN_TRIPLE:
                // Payline 1 (middle): 777-777-777 pure
                return enrichResponse({
                    rands: [5, 6, 6],   // Reel 0 idx 5=777, Reel 1 idx 6=777, Reel 2 idx 6=777
                    matchedLinePays: [{
                        payLineIndex: 0, // Middle line
                        payout: lineBet * 50, // 777 multiplier
                        matchedSymbols: [SymbolId.SEVEN_TRIPLE, SymbolId.SEVEN_TRIPLE, SymbolId.SEVEN_TRIPLE],
                        containsWild: false,
                        reelCnt: 3,
                        matchedSymbolsIndices: [{Item1: 0, Item2: 1}, {Item1: 1, Item2: 1}, {Item1: 2, Item2: 1}],
                    }],
                    totalBet,
                    totalWin: lineBet * 50,
                    updateCash: true,
                    nextStage: SlotStageType.SPIN,
                });

            case TestScenario.ANY_BAR:
                // Payline 1 (middle): BAR-BARBAR mixed
                return enrichResponse({
                    rands: [1, 4, 10],  // Reel 0 idx 1=BAR, Reel 1 idx 4=BARBAR, Reel 2 idx 10=BAR
                    matchedLinePays: [{
                        payLineIndex: 0,
                        payout: lineBet * 8, // BARBAR multiplier
                        matchedSymbols: [SymbolId.BAR_SINGLE, SymbolId.BAR_DOUBLE, SymbolId.BAR_SINGLE],
                        containsWild: false,
                        reelCnt: 3,
                        matchedSymbolsIndices: [{Item1: 0, Item2: 1}, {Item1: 1, Item2: 1}, {Item1: 2, Item2: 1}],
                    }],
                    totalBet,
                    totalWin: lineBet * 8,
                    updateCash: true,
                    nextStage: SlotStageType.SPIN,
                });

            case TestScenario.PURE_BAR_DOUBLE:
                // Payline 1 (middle): BARBAR-BARBAR-BARBAR pure
                return enrichResponse({
                    rands: [4, 9, 12],  // All BARBAR
                    matchedLinePays: [{
                        payLineIndex: 0,
                        payout: lineBet * 8, // BARBAR multiplier
                        matchedSymbols: [SymbolId.BAR_DOUBLE, SymbolId.BAR_DOUBLE, SymbolId.BAR_DOUBLE],
                        containsWild: false,
                        reelCnt: 3,
                        matchedSymbolsIndices: [{Item1: 0, Item2: 1}, {Item1: 1, Item2: 1}, {Item1: 2, Item2: 1}],
                    }],
                    totalBet,
                    totalWin: lineBet * 8,
                    updateCash: true,
                    nextStage: SlotStageType.SPIN,
                });

            case TestScenario.FREE_SPIN_TRIGGER:
                // Cột 3 có BONUS → kích hoạt 10 Free Spins
                return enrichResponse({
                    rands: [0, 0, 2],   // reel 2 index 2 = BONUS (strip reel2[2])
                    matchedLinePays: [],
                    totalBet,
                    totalWin: 0,
                    updateCash: true,
                    nextStage: SlotStageType.FREE_SPIN_START,
                    remainFreeSpinCount: 3,
                });

            case TestScenario.BIG_WIN:
                // 3 × 777 (SEVEN_TRIPLE) trên line giữa → Big Win
                return enrichResponse({
                    rands: [5, 6, 6],
                    matchedLinePays: [{
                        payLineIndex: 0,
                        payout: lineBet * 50,
                        matchedSymbols: [SymbolId.SEVEN_TRIPLE, SymbolId.SEVEN_TRIPLE, SymbolId.SEVEN_TRIPLE],
                        containsWild: false,
                        reelCnt: 3,
                        matchedSymbolsIndices: [{Item1: 0, Item2: 1}, {Item1: 1, Item2: 1}, {Item1: 2, Item2: 1}],
                    }],
                    totalBet,
                    totalWin: lineBet * 50,
                    updateCash: true,
                    nextStage: SlotStageType.SPIN,
                });

            case TestScenario.NO_WIN:
            default:
                // Không thắng gì
                return enrichResponse({
                    rands: [0, 1, 3],
                    matchedLinePays: [],
                    totalBet,
                    totalWin: 0,
                    updateCash: true,
                    nextStage: SlotStageType.SPIN,
                });
        }
    }
}

// ─── TEST SCENARIO ENUM ───

export enum TestScenario {
    NO_WIN = 'no_win',
    ANY_SEVEN = 'any_seven',           // Test: 7-77-777 mixed
    PURE_SEVEN_TRIPLE = 'pure_seven_triple', // Test: 777-777-777 pure
    ANY_BAR = 'any_bar',               // Test: BAR-BARBAR mixed
    PURE_BAR_DOUBLE = 'pure_bar_double', // Test: BARBAR-BARBAR-BARBAR pure
    BIG_WIN = 'big_win',
    GRAND_JACKPOT = 'grand_jackpot',
    MAJOR_JACKPOT = 'major_jackpot',
    MINOR_JACKPOT = 'minor_jackpot',
    FREE_SPIN_TRIGGER = 'free_spin_trigger',
}

// ─── FORCED MOCK ADAPTER ───
// Dùng khi muốn lock 1 kịch bản cụ thể để test animation/UI.
//
// Cách dùng trong GameManager.onLoad():
//   import { ForcedMockAdapter, TestScenario } from '../data/MockDataProvider';
//   NetworkManager.instance.setAdapter(new ForcedMockAdapter(TestScenario.GRAND_JACKPOT));
//
// Sau khi test xong chỉ cần xóa 2 dòng trên là game về chế độ random bình thường.

import { INetworkAdapter } from '../manager/NetworkManager';
import { ServerSession, ServerEnterResponse, ServerJackpotResponse } from './SlotTypes';

export class ForcedMockAdapter implements INetworkAdapter {
    private _scenario: TestScenario;
    private _playCount: number = 0;

    /** @param scenario Kịch bản muốn force
     *  @param repeatTimes Số lần force rồi trở về random (-1 = mãi mãi)
     */
    constructor(scenario: TestScenario, private _repeatTimes: number = -1) {
        this._scenario = scenario;
    }

    async login(_params?: any): Promise<ServerSession> {
        await this._delay(100);
        return {
            nick: 'ForcedMockPlayer', serverTime: new Date().toISOString(),
            clientIp: '127.0.0.1', sessionKey: 0n, sessionUpdateSec: 300,
            memberIdx: 0, seq: 100, uid: 'forced-mock',
            cash: GameData.instance.player.balance, aky: '', currency: 'USD',
            country: 'US', isNewAccount: false, useBroadcast: false, smm: null,
        };
    }

    async enterGame(): Promise<ServerEnterResponse> {
        await this._delay(100);
        return {
            cash: GameData.instance.player.balance, slotName: 'SuperNova', ps: '',
            betIndex: 0, coinValueIndex: 0, lastSpinResponse: null,
            isPractice: false, memberIdx: 0, smm: null,
        };
    }

    async sendSpinRequest(_isFreeSpin: boolean): Promise<SpinResponse> {
        await this._delay(300);

        if (this._repeatTimes === -1 || this._playCount < this._repeatTimes) {
            this._playCount++;
            return MockDataProvider.buildScenario(this._scenario);
        }

        // Hết số lần force → trả về random
        return MockDataProvider.generateSpinResponse(_isFreeSpin);
    }

    async sendClaimRequest(): Promise<{ balance: number; winCash?: number }> {
        await this._delay(100);
        const data = GameData.instance;
        const winCash = data.freeSpinTotalWin;
        return { balance: data.player.balance + winCash, winCash };
    }

    async pollJackpot(): Promise<ServerJackpotResponse> {
        const vals = GameData.instance.jackpotValues;
        return {
            Wins: vals,
            WinMsgs: [],
            ReqRace: false,
            CR: null,
            UTC: new Date().toISOString(),
        };
    }

    async sendHeartBeat(): Promise<void> {}

    async sendGameOptChange(_betIndex: number, _coinValueIndex: number): Promise<void> {}

    async sendFeatureItemGet(): Promise<any[]> {
        return [];
    }

    async sendFeatureItemBuy(_itemId: number): Promise<{ isSuccess: boolean; remainCash: number; res: any | null }> {
        return { isSuccess: true, remainCash: GameData.instance.player.balance, res: null };
    }

    async sendBalanceGet(): Promise<{ balance: number; currency: string }> {
        return { balance: GameData.instance.player.balance, currency: 'USD' };
    }

    private _delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

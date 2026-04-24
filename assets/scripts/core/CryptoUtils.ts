/**
 * CryptoUtils - Các hàm mã hóa/giải mã và giải nén dùng chung.
 *
 * Được tách riêng để:
 *  1. NetworkManager.ts dùng cho request/response thật.
 *  2. NetworkDebugger.ts dùng để kiểm tra (unit test) trực tiếp.
 *
 * ★ AES-128-CBC (pre-login, Login request/response):
 *   Key = AES_LOGIN_KEY (16 bytes Base64)
 *   IV  = Random 16 bytes, prepend vào ciphertext
 *   Format: Base64( IV[16] ‖ CipherText )
 *
 * ★ AES-128-CBC (post-login, Aky):
 *   Aky = Base64( Key[16] ‖ IV[16] ) — tách Key và IV
 *   Input/Output format giống trên: Base64( IV[16] ‖ CipherText )
 *   (Tài liệu ghi AES-256 nhưng server xác nhận thực tế dùng AES-128)
 *
 * ★ PS (ParSheet) decode:
 *   Base64 string → Uint8Array → msgpackr.unpack() → JS object
 */

import CryptoJS from 'crypto-js';
import { Packr } from 'msgpackr';
import { ServerConfig } from '../data/ServerConfig';

// Packr instance dùng riêng cho CryptoUtils (độc lập với NetworkManager)
export const cryptoPackr = new Packr({ useRecords: false, bundleStrings: false });

// ═══════════════════════════════════════════════════════════
//  AES-128 PRE-LOGIN (fixed key)
// ═══════════════════════════════════════════════════════════

/**
 * AES-128-CBC encrypt cho Login request.
 * Key  = Base64.decode(AES_LOGIN_KEY) — 16 bytes.
 * IV   = Random 16 bytes mỗi lần gọi.
 * Output: Base64( IV[16] ‖ CipherText ).
 */
export function encryptAES128(plainText: string): string {
    const key = CryptoJS.enc.Base64.parse(ServerConfig.AES_LOGIN_KEY);
    const iv  = CryptoJS.lib.WordArray.random(16);
    const encrypted = CryptoJS.AES.encrypt(plainText, key, {
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
        iv: iv,
    });
    return CryptoJS.enc.Base64.stringify(iv.concat(encrypted.ciphertext));
}

/**
 * AES-128-CBC decrypt cho Login response.
 * Key  = Base64.decode(AES_LOGIN_KEY) — 16 bytes.
 * Input: Base64( IV[16] ‖ CipherText ) — tách 16 byte đầu làm IV.
 */
export function decryptAES128(cipherText: string): string {
    const key = CryptoJS.enc.Base64.parse(ServerConfig.AES_LOGIN_KEY);
    const raw = CryptoJS.enc.Base64.parse(cipherText);
    const iv  = CryptoJS.lib.WordArray.create(raw.words.slice(0, 4), 16);
    const ct  = CryptoJS.lib.WordArray.create(raw.words.slice(4), raw.sigBytes - 16);
    const decrypted = CryptoJS.AES.decrypt(
        CryptoJS.lib.CipherParams.create({ ciphertext: ct }),
        key,
        { mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7, iv: iv },
    );
    return decrypted.toString(CryptoJS.enc.Utf8);
}

// ═══════════════════════════════════════════════════════════
//  AES-128 POST-LOGIN (Aky session key)
// ═══════════════════════════════════════════════════════════

/**
 * AES-128-CBC encrypt cho request sau login.
 * Aky  = Base64( Key[16] ‖ IV[16] ) — tách Key và IV từ Aky.
 * Output: Base64( IV[16] ‖ CipherText ).
 */
export function encryptAES256(plainText: string, aky: string): string {
    const akyBytes = CryptoJS.enc.Base64.parse(aky);
    const key = CryptoJS.lib.WordArray.create(akyBytes.words.slice(0, 4), 16);
    const iv  = CryptoJS.lib.WordArray.create(akyBytes.words.slice(4, 8), 16);
    const encrypted = CryptoJS.AES.encrypt(plainText, key, {
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
        iv: iv,
    });
    return CryptoJS.enc.Base64.stringify(iv.concat(encrypted.ciphertext));
}

/**
 * AES-128-CBC decrypt cho response sau login.
 * Aky  = Base64( Key[16] ‖ IV_aky[16] ) — chỉ dùng Key (bytes 0-15).
 * Input: Base64( IV[16] ‖ CipherText ) — tách 16 byte đầu làm IV.
 */
export function decryptAES256(cipherText: string, aky: string): string {
    const akyBytes = CryptoJS.enc.Base64.parse(aky);
    const key = CryptoJS.lib.WordArray.create(akyBytes.words.slice(0, 4), 16);
    const raw = CryptoJS.enc.Base64.parse(cipherText);
    const iv  = CryptoJS.lib.WordArray.create(raw.words.slice(0, 4), 16);
    const ct  = CryptoJS.lib.WordArray.create(raw.words.slice(4), raw.sigBytes - 16);
    const decrypted = CryptoJS.AES.decrypt(
        CryptoJS.lib.CipherParams.create({ ciphertext: ct }),
        key,
        { mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7, iv: iv },
    );
    return decrypted.toString(CryptoJS.enc.Utf8);
}

// ═══════════════════════════════════════════════════════════
//  PS (PARSHEET) DECRYPTION
// ═══════════════════════════════════════════════════════════

/**
 * Giải nén trường PS từ AckEnter response.
 *
 * Luồng:
 *   Base64 string → atob() → Uint8Array → msgpackr.unpack() → JS object
 *
 * @param psBase64  Chuỗi Base64 từ AckEnter.PS
 * @returns         ParSheet object (Reel, FreeSpinReel, Bet, CoinValue, WinPopup...)
 */
export function decryptPS(psBase64: string): any {
    const binaryStr = atob(psBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }

    // Detect format: JSON (starts with '{') vs msgpack
    if (bytes[0] === 0x7b) {
        // Plain JSON text
        try {
            const text = binaryStr; // ASCII/UTF-8 safe for JSON
            const ps = JSON.parse(text);
            console.log(`[PS:Decoded] format=JSON | keys: ${Object.keys(ps).join(', ')}`);
            return ps;
        } catch (e: any) {
            console.error(`[PS] JSON.parse failed: ${e.message}`);
            return {};
        }
    }

    // msgpack multi-value stream
    try {
        const results = cryptoPackr.unpackMultiple(bytes) as any[];
        const ps = results[0];
        console.log(`[PS:Decoded] format=msgpack | keys: ${ps && typeof ps === 'object' ? Object.keys(ps).join(', ') : typeof ps}`);
        return ps;
    } catch (e: any) {
        console.error(`[PS] unpackMultiple failed: ${e.message}`);
        try {
            return cryptoPackr.unpack(bytes);
        } catch (e2: any) {
            console.error(`[PS] single unpack also failed: ${e2.message}`);
            return {};
        }
    }
}

/**
 * Tạo PS Base64 giả (chỉ dùng cho test/debug).
 * Pack một object mẫu bằng msgpackr rồi chuyển sang Base64.
 */
export function makeFakePS(obj: any): string {
    const bytes: Uint8Array = cryptoPackr.pack(obj);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

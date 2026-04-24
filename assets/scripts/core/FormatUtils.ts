/**
 * FormatUtils - Các hàm tiện ích định dạng hiển thị.
 */

/**
 * Định dạng số thành chuỗi tiền tệ chuẩn Mỹ.
 * - Dấu phẩy phân cách hàng nghìn
 * - Dấu chấm cho phần thập phân (tối đa 2 chữ số)
 * - Số nguyên: không hiển thị phần thập phân
 *
 * Ví dụ:
 *   formatCurrency(1234567.89)  → '1,234,567.89'
 *   formatCurrency(1000)        → '1,000'
 *   formatCurrency(0.5)         → '0.50'
 *   formatCurrency(9.1)         → '9.10'
 */
export function formatCurrency(value: number): string {
    const isInteger = Number.isInteger(value) || Math.abs(value - Math.round(value)) < 0.005;
    if (isInteger) {
        return Math.round(value).toLocaleString('en-US');
    }
    // Làm tròn đến 2 chữ số thập phân rồi format
    const fixed = value.toFixed(2);
    const [intPart, decPart] = fixed.split('.');
    const formattedInt = parseInt(intPart, 10).toLocaleString('en-US');
    return `${formattedInt}.${decPart}`;
}

import { _decorator, Component, SpriteAtlas } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('CheckAtlas')
export class CheckAtlas extends Component {

    @property({ type: SpriteAtlas, tooltip: 'Kéo file Atlas của bạn vào đây' })
    myAtlas: SpriteAtlas = null;

    start() {
        if (!this.myAtlas) {
            console.error("❌ Bạn chưa gắn file Atlas vào script này!");
            return;
        }

        // Lấy toàn bộ các khung hình (SpriteFrame) có trong Atlas
        const frames = this.myAtlas.getSpriteFrames();
        
        console.log(`🔍 Đang kiểm tra Atlas... Tìm thấy tổng cộng ${frames.length} hình:`);
        console.log("--------------------------------------------------");
        
        // Vòng lặp in ra tên thật của từng hình
        frames.forEach((frame, index) => {
            console.log(`Hình thứ ${index + 1}: ${frame.name}`);
        });

        console.log("--------------------------------------------------");
        console.log("👉 Hãy copy đúng cái tên in ra ở trên để bỏ vào thẻ <img src='...' />");
    }
}
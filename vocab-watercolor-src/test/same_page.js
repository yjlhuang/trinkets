// 點擊後還在不在測試頁：兩邊都先正規化再比。
// 瀏覽器回報的網址是正規化過的（http://localhost:80/… 會變成 http://localhost/…、主機名稱轉小寫），
// 直接拿 BASE 字串比會誤判成跳頁。
const samePage = (actual, expected) => new URL(actual).href === new URL(expected).href;
module.exports = { samePage };

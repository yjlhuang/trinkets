Markdown
# 🚀 Gym Booking Sniper | 健身房搶課自動化工具

這是一個基於 Python 與 Streamlit 開發的現代化網頁工具，專為解決熱門健身房課程「一秒額滿」的痛點所設計。透過攔截 API 封包並結合自動化高頻併發請求，實現精準的毫秒級預約。

## ✨ 核心特色 (Features)

*   **GUI 圖形化介面**：告別黑底白字的終端機，使用 Streamlit 打造優雅的參數輸入面板。
*   **精準對時與併發**：內建毫秒級系統時鐘對齊，時間抵達瞬間自動啟動高頻 POST 請求。
*   **安全防護機制**：內建最大轟炸時間限制（預設 80 秒），避免發送無效請求導致帳號被封鎖。
*   **機密配置分離**：Cookie 與 HashCode 等敏感身分驗證資訊皆透過 UI 暫存傳遞，不寫死於程式碼中，確保絕對安全。

## 🛠️ 技術棧 (Tech Stack)

*   **Python 3.x**
*   **Requests** (HTTP 請求處理)
*   **Streamlit** (Web UI 渲染)
*   封包分析工具 (推薦搭配 Proxyman 或 Fiddler 抓取驗證參數)

## 🚀 快速啟動 (How to Run)

1. 安裝必要套件：
```bash
   pip install streamlit requests
啟動 Web 介面：
```Bash

   streamlit run app.py

(Windows 用戶可直接雙擊專案內的 run.bat 一鍵啟動)
2. 輸入參數：
於自動彈出的瀏覽器畫面中，填入從 Proxyman 攔截到的 Cookie、ClientID 與 HashCode 等機密參數。

3. 發射核彈：
設定預計搶課的開炸時間，點擊「🔥 發動攻擊！」按鈕，即可放開雙手等待勝利的氣球。

⚠️ 免責聲明 (Disclaimer)
僅供學術研究： 本專案之程式碼僅供 Python 網路爬蟲技術、API 封包分析與自動化流程之學習與技術交流。

請勿惡意濫用： 請合理使用本工具，切勿設定極端高頻的請求以進行 DDoS 攻擊，或惡意干擾伺服器之正常運作。

後果自負： 使用本工具所產生之任何帳號風險（如遭到系統封鎖或停權）及法律責任，皆由使用者自行承擔，本專案作者概不負責。
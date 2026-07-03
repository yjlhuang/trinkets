import streamlit as st
import requests
import time
from datetime import datetime
import urllib3

# 隱藏 SSL 警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

st.set_page_config(page_title="健身房搶課機器人", page_icon="🚀", layout="centered")

st.title("🚀 健身房搶課機器人 Web 版")
st.markdown("請將抓包工具 (如 Proxyman) 取得的最新武器參數填入下方：")

# 建立輸入表單 (預設值全數清空，保護大王個資)
with st.form("sniper_form"):
    cookie_input = st.text_area("🍪 Cookie (ASPSESSIONID 等完整字串)", height=100)
    
    col1, col2 = st.columns(2)
    with col1:
        client_id = st.text_input("👤 客戶 ID (ClientID)")
        course_id = st.text_input("📅 課號 (AerobicScheDateSno)")
        max_booking = st.text_input("👥 人數上限 (Max_Booking)", value="20")
    with col2:
        hash_code = st.text_input("🔑 專屬防偽碼 (HashCode)")
        sche_date = st.text_input("📆 預約日期 (ScheDate, 例: 20260620)")
        
    start_time = st.text_input("⏰ 開炸時間 (格式 HH:MM:SS)", value="12:59:50")
    
    submit_btn = st.form_submit_button("🔥 發動攻擊！", type="primary")

if submit_btn:
    if not cookie_input or not hash_code or not course_id or not client_id:
        st.error("⚠️ 欄位請務必填寫完整，不可有空缺！")
        st.stop()

    TARGET_URL = "https://infapp.eip.tw/apis/_appinf3/AscheBooking"
    MAX_BOMB_DURATION = 80 
    
    headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_7_1 like Mac OS X) AppleWebKit/605.1.15",
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": cookie_input
    }

    payload = {
        "ClientID": client_id,
        "HashCode": hash_code,
        "Max_Booking": max_booking,
        "AerobicScheDateSno": course_id,
        "BookingAction": "Booking",
        "ScheDate": sche_date
    }

    st.info(f"📡 正在監聽系統時間... 預計於 {start_time} 發動安全轟炸！")
    
    status_text = st.empty()
    log_area = st.empty()
    bombing_start_time = None

    while True:
        now_dt = datetime.now()
        now_str = now_dt.strftime("%H:%M:%S")
        
        if now_str < start_time:
            status_text.warning(f"⏳ 目前時間 {now_dt.strftime('%H:%M:%S.%f')[:-3]}，精準對時中...")
            time.sleep(0.2)
        else:
            if bombing_start_time is None:
                st.error("🔥 [時間抵達] 進入狂爆模式，安全計時開始！")
                bombing_start_time = time.time()
            
            elapsed_time = time.time() - bombing_start_time
            if elapsed_time > MAX_BOMB_DURATION:
                st.warning(f"🛑 [安全防護] 已經轟炸超過 {MAX_BOMB_DURATION} 秒，系統自動關閉以防封號。")
                break
                
            status_text.error(f"🚀 [轟炸中] 耗時: {elapsed_time:.1f}秒 | 目前時間: {now_dt.strftime('%H:%M:%S.%f')[:-3]}")
            
            try:
                response = requests.post(TARGET_URL, headers=headers, data=payload, verify=False)
                log_area.code(f"狀態碼: {response.status_code}\n伺服器回應: {response.text}")
                
                if "success" in response.text.lower() or "成功" in response.text:
                    st.success("🎉 搶課成功！可以準備去運動了！課表財富自由！")
                    st.balloons()
                    break
                else:
                    st.toast("❌ 失敗，繼續下一發子彈...")
                    
            except Exception as e:
                st.error(f"⚠️ 發生錯誤: {e}")
                
            time.sleep(0.2)
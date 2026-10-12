const crypto = require('crypto');
const admin = require('firebase-admin');
const axios = require('axios');

const https = require('https'); 
const { HttpsProxyAgent } = require('https-proxy-agent');

// =======================================================
// ⚙️ إعدادات البوت 
// =======================================================
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || ""; 
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || ""; 
const PORT = process.env.PORT || 3000;

// 🔥 البروكسي الجزائري المدفوع 
const proxyUrl = process.env.DJEZZY_PROXY_URL || '';
const djezzyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl, { keepAlive: true, timeout: 30000 }) : undefined;

// اتصال فيسبوك المباشر 
const fbAgent = new https.Agent({ keepAlive: true });

// =======================================================
// 🔑 مفاتيح Djezzy API 
// =======================================================
const CLIENT_ID = process.env.CLIENT_ID || "";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "";
const DATA_FILE = "messenger_sessions.json";

const OFFERS_LIST = {
    "BTL500MBHOUR": { "name": "⚡ 1GB ساعة (40دج)", "price": "40 DA", "desc": "ساعة إنترنت بلا حدود" },
    "BTLINTSPEEDDAY2Go": { "name": "📅 4GB يومي (70دج)", "price": "70 DA", "desc": "24 ساعة إنترنت" },
    "DOVINTSPEEDDAY1GoPRE": { "name": "🔥 1GB يومي (100دج)", "price": "100 DA", "desc": "عرض خاص 24 ساعة" },
    "BTL500MBDAY": { "name": "🌊 عرض 90دج 5GB", "price": "90 DA", "desc": "5 جيجابايت يومي" },
    "BTL1GBDAY": { "name": "🚀 4GB سوبر (140دج)", "price": "140 DA", "desc": "عرض السرعة القصوى" },
    "BTL4GBDAY": { "name": "💎 عرض 190دج 10Go", "price": "190 DA", "desc": "10 جيجابايت لمدة 72 ساعة" },
    "ImtiyazSurpriseData2hfbPRE": { "name": "💙 فيسبوك (50دج)", "price": "50 DA", "desc": "4 ساعات فيسبوك" },
    "1GBFB3DAYInternet": { "name": "🔵 1GB فيسبوك (70دج)", "price": "70 DA", "desc": "صالح لمدة 3 أيام" },
    "2GBMONTH": { "name": "📆 3GB شهري (250دج)", "price": "250 DA", "desc": "باقة الشهر الاقتصادية" },
    "BTLDATA2WEEKS": { "name": "⏳ 4GB أسبوعين (400دج)", "price": "400 DA", "desc": "صالحة لمدة 15 يوم" }
};

// =======================================================
// 🧠 Djezzy API Client
// =======================================================
class DjezzyClient {
    constructor(userData = null) {
        this.headers = { 
            'Host': 'apim.djezzy.dz', 
            'User-Agent': 'MobileApp/3.0.0', 
            'Accept': 'application/json',
            'Connection': 'Keep-Alive'
        };
        this.accessToken = userData ? userData.token : null;
        this.refreshToken = userData ? userData.refreshToken : null;
        
        this.axios = axios.create({ baseURL: 'https://apim.djezzy.dz', timeout: 30000, headers: this.headers, validateStatus: () => true, httpsAgent: djezzyAgent });
        
        this.axios.interceptors.request.use(config => {
            if (this.accessToken) config.headers['Authorization'] = `Bearer ${this.accessToken}`;
            return config;
        });
    }

    normalizePhone(p) { p = p.toString().replace(/\D/g, ''); if (p.startsWith("213")) return p; if (p.startsWith("0")) return "213" + p.substring(1); return "213" + p; }
    
    async sendOtp(p) { 
        p = this.normalizePhone(p);
        try {
            const payload = `msisdn=${p}&scope=smsotp&client_id=${CLIENT_ID}`;
            const r = await this.axios.post("/mobile-api/oauth2/registration", payload, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            return [200, 201, 204].includes(r.status);
        } catch (e) { return false; }
    }

    async login(p, o) {
        p = this.normalizePhone(p);
        const payload = `grant_type=mobile&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&scope=openid&mobileNumber=${p}&otp=${o}`;
        const r = await this.axios.post("/mobile-api/oauth2/token", payload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return r.status === 200 ? { success: true, data: r.data } : { success: false };
    }

    async refreshAuthToken() {
        if (!this.refreshToken) return false;
        const payload = `scope=openid&client_secret=${CLIENT_SECRET}&client_id=${CLIENT_ID}&grant_type=refresh_token&refresh_token=${this.refreshToken}`;
        try {
            const r = await this.axios.post("/mobile-api/oauth2/token", payload, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            if (r.status === 200 && r.data.access_token) {
                this.accessToken = r.data.access_token;
                if (r.data.refresh_token) this.refreshToken = r.data.refresh_token;
                return { success: true, token: this.accessToken, refreshToken: this.refreshToken };
            }
        } catch (e) {}
        return { success: false };
    }

    async getDetails(phone, retry = true) {
        const msisdn = this.normalizePhone(phone);
        
        try {
            const balanceUrl = `/mobile-api/api/v1/subscribers/main-balance/${msisdn}?include=surprise-products,subscription-type-illegibility,connected-products,subscription-history,flash-products,supplementary-informations,available-services`;
            const balRes = await this.axios.get(balanceUrl);

            if (balRes.status === 401 && retry) {
                let refreshed = await this.refreshAuthToken();
                if (refreshed.success) return await this.getDetails(phone, false); 
            }

            if (balRes.status === 200) {
                const data = balRes.data;
                let mainBalance = "0";
                let due = "0";
                let simType = "";
                
                if (data.data) {
                    mainBalance = data.data.mainBalance || "0";
                    due = data.data.due || "0";
                    
                    if (data.data.customerInformations && data.data.customerInformations.subscriptionType) {
                        let subTypeObj = data.data.customerInformations.subscriptionType;
                        if (subTypeObj.name) {
                            simType = subTypeObj.name.ar || subTypeObj.name.fr || subTypeObj.name.en || "";
                        }
                    }
                }

                let msg = `📱 الشريحة: ${simType}\n💰 الرصيد الأساسي: ${parseFloat(mainBalance).toFixed(2)} دج\n`;
                if (parseFloat(due) > 0) {
                    msg += `💸 التسبيق (دين): ${parseFloat(due).toFixed(2)} دج\n`;
                }
                msg += `\n📦 باقاتك الفعالة:\n`;

                const subsUrl = `/mobile-api/api/v1/subscribers/connected-products-balances/${msisdn}`;
                const subsRes = await this.axios.get(subsUrl);

                let foundBundles = false;
                if (subsRes.status === 200 && Array.isArray(subsRes.data)) {
                    subsRes.data.forEach(sub => {
                        let name = "";
                        if (sub.commercialName) name = sub.commercialName.ar || sub.commercialName.fr || sub.commercialName.en || sub.code;
                        else name = sub.code;
                        
                        msg += `🔹 ${name}\n`;
                        
                        if (sub.balances && Array.isArray(sub.balances)) {
                            sub.balances.forEach(bal => {
                                let remaining = bal.remaining || 0;
                                let unit = bal.usageUnit || "";
                                let uType = bal.usageType || "";
                                let unlimited = bal.unlimited || false;
                                
                                if (unlimited) {
                                    msg += `  📈 ${uType}: غير محدود\n`;
                                    foundBundles = true;
                                } else if (remaining > 0) {
                                    if (unit === "MB" || unit === "GB" || uType === "DATA") {
                                        let sizeStr = unit === "MB" ? `${(remaining/1024).toFixed(2)} جيجا` : `${remaining.toFixed(2)} ${unit}`;
                                        msg += `  🌐 إنترنت: ${sizeStr}\n`;
                                    } else if (uType === "VOICE") {
                                        msg += `  📞 مكالمات: ${Math.floor(remaining)} دقيقة\n`;
                                    } else if (uType === "SMS") {
                                        msg += `  ✉️ رسائل: ${Math.floor(remaining)} رسالة\n`;
                                    } else {
                                        msg += `  📉 باقي: ${remaining} ${unit}\n`;
                                    }
                                    foundBundles = true;
                                }
                            });
                        }
                        
                        let expiry = (sub.expiryAt || "").replace('T', ' ').split('.')[0];
                        if (expiry) msg += `  ⏳ تنتهي: ${expiry}\n`;
                        msg += `➖\n`;
                    });
                }

                if (!foundBundles) msg += "🔸 لا توجد باقات مفعلة حالياً.";
                return { success: true, msg: msg, newTokens: { t: this.accessToken, rt: this.refreshToken } };
            }
            return { success: false, msg: "⚠️ تعذر جلب البيانات. يرجى تسجيل الدخول مجدداً." };
        } catch (e) {
            return { success: false, msg: "⛔ خطأ في الاتصال بخوادم جازي." };
        }
    }

    async activateInternetOffer(phone, code, retry = true) {
        const msisdn = this.normalizePhone(phone);
        const info = OFFERS_LIST[code] || { name: code, price: "???" };

        try {
            await this.axios.get(`/mobile-api/api/v1/services/shake/${msisdn}`);
            
            let url = `/mobile-api/api/v1/subscribers/activate-product/${msisdn}`;
            let payload = JSON.stringify({ packageCode: code });
            
            let res = await this.axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } });

            if (res.status === 401 && retry) {
                let refreshed = await this.refreshAuthToken();
                if (refreshed.success) return await this.activateInternetOffer(phone, code, false);
            }

            const msgStr = String(res.data.message || "").toLowerCase();

            if (res.status === 200 || res.status === 201 || msgStr.includes("success")) {
                return { msg: `✅ تم!\n📦 ${info.name}\n💰 خُصم: ${info.price}`, newTokens: { t: this.accessToken, rt: this.refreshToken } };
            }

            if (res.status === 402 || msgStr.includes("insuffisant") || msgStr.includes("balance")) {
                return { msg: `⚠️ رصيد غير كافٍ لتفعيل العرض.\nالمطلوب: ${info.price}`, newTokens: { t: this.accessToken, rt: this.refreshToken } };
            }

            return { msg: `❌ فشل التفعيل.\nالرد: ${res.status}\nالسبب: ${msgStr || "غير معروف"}`, newTokens: { t: this.accessToken, rt: this.refreshToken } };

        } catch (error) { 
            return { msg: `⛔ خطأ في الاتصال بالسيرفر.`, newTokens: null }; 
        }
    }

    async getWalkWinRemainingTime(phone) {
        const msisdn = this.normalizePhone(phone);
        try {
            const res = await this.axios.get(`/mobile-api/api/v1/subscribers/subscription-history/${msisdn}`, {
                headers: { 'Accept': 'application/json' }
            });
            if (res.status === 200 && res.data && Array.isArray(res.data.data)) {
                let latestTime = 0;
                for (let pkg of res.data.data) {
                    let pCode = String(pkg.packageCode || "").toUpperCase();
                    if (pCode.includes("WALK") && pkg.subscriptionDateTime) {
                        let time = new Date(pkg.subscriptionDateTime).getTime();
                        if (!isNaN(time) && time > latestTime) {
                            latestTime = time;
                        }
                    }
                }
                if (latestTime > 0) {
                    const WEEK_MS = 604800000; 
                    let remaining = (latestTime + WEEK_MS) - Date.now();
                    
                    if (remaining > 0) {
                        let days = Math.floor(remaining / 86400000);
                        let hours = Math.floor((remaining % 86400000) / 3600000);
                        let mins = Math.floor((remaining % 3600000) / 60000);
                        let secs = Math.floor((remaining % 60000) / 1000);
                        
                        let timeStr = "";
                        if (days > 0) timeStr = `${days}ي و ${hours}س`;
                        else if (hours > 0) timeStr = `${hours}س و ${mins}د`;
                        else if (mins > 0) timeStr = `${mins}د و ${secs}ث`;
                        else timeStr = `${secs}ث`;

                        return `⏳ لم يمر أسبوع بعد.\nالوقت المتبقي: ${timeStr}`;
                    }
                }
            }
            return null; 
        } catch (e) { return null; }
    }

    async activateWalkWin(phone, retry = true) {
        const msisdn = this.normalizePhone(phone);
        const url = `/mobile-api/api/v1/services/walk/activate-reward/${msisdn}`;
        const payloadStr = JSON.stringify({ packageCode: "GIFTWALKWIN2GO" });
        
        try {
            const res = await this.axios.post(url, payloadStr, { headers: { 'Content-Type': 'application/json' } });
            const msgStr = String(res.data.message || "").toLowerCase();

            if (res.status === 401) {
                if (!msgStr.includes("unauthorized product") && retry) {
                    let refreshed = await this.refreshAuthToken();
                    if (refreshed.success) return await this.activateWalkWin(phone, false);
                }
            }

            if (res.status === 200 || res.status === 201 || msgStr.includes("success")) {
                return { msg: "🎉 تم تفعيل (2GB) بنجاح!", newTokens: { t: this.accessToken, rt: this.refreshToken } };
            }

            if (res.status === 402 || msgStr.includes("not enough") || msgStr.includes("balance")) {
                 return { msg: "⚠️ غير مؤهل (يجب استهلاك 100 دج).", newTokens: { t: this.accessToken, rt: this.refreshToken } };
            }

            let historyMsg = await this.getWalkWinRemainingTime(phone);
            if (historyMsg) return { msg: historyMsg, newTokens: { t: this.accessToken, rt: this.refreshToken } };

            return { msg: "⚠️ غير مؤهل للتفعيل حالياً.\n(تلميح: يجب استهلاك 100 دج على الأقل).", newTokens: { t: this.accessToken, rt: this.refreshToken } };

        } catch (error) {
            return { msg: "⛔ خطأ في الاتصال بخوادم جازي.", newTokens: null };
        }
    }

    // 🔥 دالة الدعوة الجديدة (MGM - Member Get Member)
    async activateMgmReward(sender) {
        const senderP = this.normalizePhone(sender);
        const url = `/mobile-api/api/v1/services/mgm/activate-reward/${senderP}`;
        const payload = JSON.stringify({ packageCode: "MGMBONUS1Go" });
        
        try {
            const res = await this.axios.post(url, payload, { headers: { 'Content-Type': 'application/json', 'accept-language': 'ar' } });
            if (res.status === 200 || res.status === 201) return "🎉 تم تفعيل مكافأة الدعوة بنجاح (1GB) لك!";
            return "⚠️ تعذّر تفعيل مكافأتك الآن.";
        } catch (e) {
            return "⚠️ تعذّر تفعيل مكافأتك الآن (خطأ في الاتصال).";
        }
    }

    async sendInvitation(sender, receiver, retry = true) {
        const senderP = this.normalizePhone(sender);
        const receiverP = this.normalizePhone(receiver);
        const url = `/mobile-api/api/v1/services/mgm/send-invitation/${senderP}`;
        const payload = JSON.stringify({ msisdnReciever: receiverP }); // مكتوبة هكذا في سيرفر جازي
        
        try {
            const res = await this.axios.post(url, payload, { headers: { 'Content-Type': 'application/json', 'accept-language': 'ar' } });
            
            if (res.status === 401 && retry) {
                let refreshed = await this.refreshAuthToken();
                if (refreshed.success) return await this.sendInvitation(sender, receiver, false);
            }
            
            const msgObj = res.data.message || (res.data.fault && res.data.fault.message) || "";
            const msgStr = (typeof msgObj === 'object') ? (msgObj.ar || msgObj.en || msgObj.fr || "") : String(msgObj);
            const msgUpper = msgStr.toUpperCase();
            
            if (res.status === 200 && msgUpper === "OK") {
                let rewardRes = await this.activateMgmReward(senderP);
                return { msg: `✅ تم إرسال الدعوة بنجاح لـ ${receiver} 📩\n\n${rewardRes}`, newTokens: { t: this.accessToken, rt: this.refreshToken } };
            }
            
            if (msgUpper.includes("LIMIT") || msgUpper.includes("INVITATIONS_LIMIT_REACHED")) {
                return { msg: "🚫 وصلت للحد الأقصى!\nلقد بلغت الحد الأقصى لعدد الدعوات الممكنة وهو 5 دعوات.", newTokens: { t: this.accessToken, rt: this.refreshToken } };
            }
            
            if (msgUpper.includes("CUSTOMER_NOT_EXIST")) {
                return { msg: "❌ رقم غير صحيح!\nالرقم المدخل غير مسجل في شبكة جيزي.", newTokens: { t: this.accessToken, rt: this.refreshToken } };
            }
            
            if (res.status === 419 || msgUpper === "ACCEPTED" || msgUpper.includes("B_NUMBER_ACCEPTED_INVITATION")) {
                return { msg: "⏳ دعوة مسبقة!\nلقد تمت دعوة هذا الرقم من قبل.", newTokens: { t: this.accessToken, rt: this.refreshToken } };
            }
            
            return { msg: `⚠️ حدث خطأ.\nالرد: ${msgStr}`, newTokens: { t: this.accessToken, rt: this.refreshToken } };
            
        } catch (error) {
            return { msg: "⛔ خطأ في الاتصال بخوادم جازي.", newTokens: null };
        }
    }
}

// =======================================================
// 🌐 خادم الويب
// =======================================================
// Server-only Firestore access; never expose service account credentials to browsers.
function firestore() {
    if (!admin.apps.length) {
        const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
        if (!encoded) throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 missing');
        const credentials = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        admin.initializeApp({ credential: admin.credential.cert(credentials) });
    }
    return admin.firestore();
}
const userSteps = {};
const docFor = id => firestore().collection('messenger_users').doc(String(id));
const key = () => {
    const value = Buffer.from(process.env.SESSION_ENCRYPTION_KEY || '', 'base64');
    if (value.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must be 32 random bytes in base64');
    return value;
};
function encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
}
function decrypt(value) {
    const bytes = Buffer.from(value,'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));
    decipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
}
async function loadData(sender_psid) {
    const snap = await docFor(sender_psid).get();
    const record = snap.data();
    return record?.session ? { [sender_psid]: decrypt(record.session) } : {};
}
async function saveData(d, sender_psid) {
    if (d[sender_psid]) await docFor(sender_psid).set({session: encrypt(d[sender_psid])},{merge:true});
    else await docFor(sender_psid).delete();
}
async function loadStep(id) {
    const snap = await docFor(id).get();
    const data = snap.data();
    userSteps[id] = data?.stepExpiresAt?.toMillis() > Date.now() ? data.step : undefined;
}
async function saveStep(id) {
    if (userSteps[id]) await docFor(id).set({
        step: userSteps[id],
        stepExpiresAt: admin.firestore.Timestamp.fromMillis(Date.now()+15*60*1000)
    },{merge:true});
    else await docFor(id).update({step: admin.firestore.FieldValue.delete(),stepExpiresAt: admin.firestore.FieldValue.delete()}).catch(e => { if (e.code !== 5) throw e; });
}
async function processEvent(event) {
    if (!event.sender?.id || event.message?.is_echo) return;
    const id = String(event.sender.id);
    await loadStep(id);
    try {
        if (event.message) await handleMessage(id, event.message);
        else if (event.postback) await handlePostback(id, event.postback);
    } finally { await saveStep(id); }
}
async function sendTypingOn(sender_psid) {
    if (!PAGE_ACCESS_TOKEN) return;
    try { await axios.post(`https://graph.facebook.com/v20.0/me/messages`, { recipient: { id: sender_psid }, sender_action: 'typing_on' }, { headers: { Authorization: `Bearer ${PAGE_ACCESS_TOKEN}` }, httpsAgent: fbAgent }); } catch(e) { console.error('Messenger typing failed', e.response?.status || e.message); }
}
async function callSendAPI(sender_psid, response) {
    if (!PAGE_ACCESS_TOKEN) throw new Error('PAGE_ACCESS_TOKEN missing');
    await axios.post(`https://graph.facebook.com/v20.0/me/messages`, { recipient: { id: sender_psid }, message: response }, { headers: { Authorization: `Bearer ${PAGE_ACCESS_TOKEN}` }, httpsAgent: fbAgent });
}
const mainMenuQR = [
    { "content_type": "text", "title": "💰 الرصيد", "payload": "BALANCE" },
    { "content_type": "text", "title": "🌐 العروض", "payload": "OFFERS" },
    { "content_type": "text", "title": "🎁 الهدية", "payload": "WALK" },
    { "content_type": "text", "title": "📩 دعوة", "payload": "INVITE" },
    { "content_type": "text", "title": "🚪 خروج", "payload": "LOGOUT" }
];

async function handleMessage(sender_psid, received_message) {
    let text = received_message.text ? received_message.text.trim() : "";
    let lowerText = text.toLowerCase();
    let db = await loadData(sender_psid);
    let payloadQR = received_message.quick_reply ? received_message.quick_reply.payload : "";

    if (lowerText === "إلغاء" || lowerText === "cancel" || lowerText === "0") {
        delete userSteps[sender_psid];
        await callSendAPI(sender_psid, { "text": "❌ تم الإلغاء." });
        return;
    }

    if (!db[sender_psid]) {
        if (userSteps[sender_psid] === "PHONE") {
            if (/^\d{9,10}$/.test(text)) {
                let client = new DjezzyClient();
                let res = await client.sendOtp(text);
                if (res) {
                    userSteps[sender_psid] = `OTP|${text}`;
                    await callSendAPI(sender_psid, { "text": "📩 تم، أرسل الكود:" });
                } else await callSendAPI(sender_psid, { "text": "❌ فشل، تأكد من الرقم." });
            } else await callSendAPI(sender_psid, { "text": "⚠️ رقم خاطئ." });

        } else if (userSteps[sender_psid] && userSteps[sender_psid].startsWith("OTP|")) {
            let phone = userSteps[sender_psid].split("|")[1];
            let client = new DjezzyClient();
            let res = await client.login(phone, text);
            if (res.success) {
                db[sender_psid] = { phone: phone, token: res.data.access_token, refreshToken: res.data.refresh_token };
                await saveData(db, sender_psid);
                delete userSteps[sender_psid];
                await callSendAPI(sender_psid, { "text": "✅ تم الدخول." });
                await callSendAPI(sender_psid, { "text": "👇 القائمة:", "quick_replies": mainMenuQR });
            } else await callSendAPI(sender_psid, { "text": "❌ كود خاطئ." });

        } else {
            userSteps[sender_psid] = "PHONE";
            await callSendAPI(sender_psid, { "text": "📱 أدخل رقمك:" });
        }
    } else {
        
        // 🔥 التحقق من استقبال رقم الهاتف من أجل الدعوة
        if (userSteps[sender_psid] === "INVITE_PHONE") {
            let receiverPhone = text;
            let senderPhone = db[sender_psid].phone;
            let clientObj = new DjezzyClient(db[sender_psid]);

            if (clientObj.normalizePhone(receiverPhone) === clientObj.normalizePhone(senderPhone)) {
                await callSendAPI(sender_psid, { "text": "❌ لا يمكنك دعوة رقمك الخاص." });
                delete userSteps[sender_psid];
                await callSendAPI(sender_psid, { "text": "👇 القائمة:", "quick_replies": mainMenuQR });
                return;
            }

            if (/^\d{9,10}$/.test(receiverPhone)) {
                await callSendAPI(sender_psid, { "text": "⏳ جاري إرسال الدعوة وتفعيل المكافأة..." });
                let res = await clientObj.sendInvitation(senderPhone, receiverPhone);
                if (res.newTokens) { db[sender_psid].token = res.newTokens.t; db[sender_psid].refreshToken = res.newTokens.rt; await saveData(db, sender_psid); }
                delete userSteps[sender_psid];
                await callSendAPI(sender_psid, { "text": res.msg, "quick_replies": mainMenuQR });
            } else {
                await callSendAPI(sender_psid, { "text": "⚠️ الرقم غير صحيح. يجب أن يتكون من 10 أرقام.\nأدخل الرقم مجدداً أو اكتب 'إلغاء':" });
            }
            return;
        }

        let matchedOfferCode = null;

        if (lowerText === "1" || lowerText.includes("رصيد") || payloadQR === "BALANCE") {
            await callSendAPI(sender_psid, { "text": "⏳ جاري التحديث..." });
            let client = new DjezzyClient(db[sender_psid]);
            let res = await client.getDetails(db[sender_psid].phone);
            if (res.newTokens) { db[sender_psid].token = res.newTokens.t; db[sender_psid].refreshToken = res.newTokens.rt; await saveData(db, sender_psid); }
            await callSendAPI(sender_psid, { "text": res.msg, "quick_replies": mainMenuQR });
        }
        else if (lowerText === "2" || lowerText.includes("عروض") || payloadQR === "OFFERS") {
            await sendOffersCarousel(sender_psid);
        }
        else if (lowerText === "3" || lowerText.includes("مشي") || lowerText.includes("هدية") || payloadQR === "WALK") {
            await callSendAPI(sender_psid, { "text": "⏳ جاري التفعيل..." });
            let client = new DjezzyClient(db[sender_psid]);
            let res = await client.activateWalkWin(db[sender_psid].phone);
            if (res.newTokens) { db[sender_psid].token = res.newTokens.t; db[sender_psid].refreshToken = res.newTokens.rt; await saveData(db, sender_psid); }
            await callSendAPI(sender_psid, { "text": res.msg, "quick_replies": mainMenuQR });
        }
        // 🔥 إضافة خيار الدعوة
        else if (lowerText === "5" || lowerText.includes("دعوة") || payloadQR === "INVITE") {
            userSteps[sender_psid] = "INVITE_PHONE";
            await callSendAPI(sender_psid, { "text": "📞 أدخل رقم جازي الذي تريد دعوته للحصول على 1GB (مثال: 0770123456):" });
        }
        else if (lowerText === "4" || lowerText.includes("خروج") || payloadQR === "LOGOUT") {
            delete db[sender_psid];
            await saveData(db, sender_psid);
            delete userSteps[sender_psid]; 
            await callSendAPI(sender_psid, { "text": "🔒 تم الخروج." });
        }
        else {
            if (lowerText === "70") {
                matchedOfferCode = "BTLINTSPEEDDAY2Go";
            } else if (lowerText === "90") {
                matchedOfferCode = "BTL500MBDAY";
            } else if (lowerText === "100") {
                matchedOfferCode = "DOVINTSPEEDDAY1GoPRE";
            } else if (lowerText === "190") {
                matchedOfferCode = "BTL4GBDAY";
            } else {
                for (let code in OFFERS_LIST) {
                    if (lowerText === code.toLowerCase()) { matchedOfferCode = code; break; }
                }
            }

            if (matchedOfferCode) {
                let offer = OFFERS_LIST[matchedOfferCode];
                await callSendAPI(sender_psid, { "text": `⏳ تفعيل: ${offer.name}...` });
                let client = new DjezzyClient(db[sender_psid]);
                let res = await client.activateInternetOffer(db[sender_psid].phone, matchedOfferCode);
                if (res.newTokens) { db[sender_psid].token = res.newTokens.t; db[sender_psid].refreshToken = res.newTokens.rt; await saveData(db, sender_psid); }
                await callSendAPI(sender_psid, { "text": res.msg, "quick_replies": mainMenuQR });
            } else {
                await callSendAPI(sender_psid, { "text": "👇 القائمة:", "quick_replies": mainMenuQR });
            }
        }
    }
}

async function sendOffersCarousel(sender_psid) {
    const offerKeys = Object.keys(OFFERS_LIST);
    for (let i = 0; i < offerKeys.length; i += 3) {
        const chunk = offerKeys.slice(i, i + 3);
        const buttons = chunk.map(code => {
            return { "type": "postback", "title": OFFERS_LIST[code].name, "payload": `BUY_${code}` };
        });
        await callSendAPI(sender_psid, {
            "attachment": {
                "type": "template",
                "payload": { "template_type": "button", "text": "👇 العروض:", "buttons": buttons }
            }
        });
    }
}

async function handlePostback(sender_psid, received_postback) {
    let payload = received_postback.payload;
    let db = await loadData(sender_psid);
    if (payload === "START_LOGIN" || payload === "LOGIN") {
        userSteps[sender_psid] = "PHONE";
        await callSendAPI(sender_psid, { "text": "📱 أدخل رقمك:" });
        return;
    }
    if (!db[sender_psid]) {
        await callSendAPI(sender_psid, { "text": "⚠️ سجل دخولك أولاً." });
        return;
    }
    if (payload === "GET_BALANCE" || payload === "BALANCE") {
        await callSendAPI(sender_psid, { "text": "⏳ جاري التحديث..." });
        let client = new DjezzyClient(db[sender_psid]);
        let res = await client.getDetails(db[sender_psid].phone);
        if (res.newTokens) { db[sender_psid].token = res.newTokens.t; db[sender_psid].refreshToken = res.newTokens.rt; await saveData(db, sender_psid); }
        await callSendAPI(sender_psid, { "text": res.msg, "quick_replies": mainMenuQR });
    } else if (payload === "GET_OFFERS" || payload === "OFFERS") {
        await sendOffersCarousel(sender_psid);
    } else if (payload === "WALK") {
        await callSendAPI(sender_psid, { "text": "⏳ جاري التفعيل..." });
        let client = new DjezzyClient(db[sender_psid]);
        let res = await client.activateWalkWin(db[sender_psid].phone);
        if (res.newTokens) { db[sender_psid].token = res.newTokens.t; db[sender_psid].refreshToken = res.newTokens.rt; await saveData(db, sender_psid); }
        await callSendAPI(sender_psid, { "text": res.msg, "quick_replies": mainMenuQR });
    } else if (payload === "INVITE") {
        userSteps[sender_psid] = "INVITE_PHONE";
        await callSendAPI(sender_psid, { "text": "📞 أدخل رقم جازي الذي تريد دعوته للحصول على 1GB (مثال: 0770123456):" });
    } else if (payload === "LOGOUT") {
        delete db[sender_psid];
        await saveData(db, sender_psid);
        delete userSteps[sender_psid]; 
        await callSendAPI(sender_psid, { "text": "🔒 تم الخروج." });
    } else if (payload.startsWith("BUY_")) {
        try {
            let code = payload.split("BUY_")[1].trim();
            let offer = OFFERS_LIST[code];
            if (!offer) return;
            await callSendAPI(sender_psid, { "text": `⏳ تفعيل: ${offer.name}...` });
            let client = new DjezzyClient(db[sender_psid]);
            let res = await client.activateInternetOffer(db[sender_psid].phone, code);
            if (res.newTokens) { db[sender_psid].token = res.newTokens.t; db[sender_psid].refreshToken = res.newTokens.rt; await saveData(db, sender_psid); }
            await callSendAPI(sender_psid, { "text": res.msg, "quick_replies": mainMenuQR });
        } catch (err) {
            await callSendAPI(sender_psid, { "text": "❌ حدث خطأ.", "quick_replies": mainMenuQR });
        }
    }
}



exports.handler = async (event) => {
  const method = event.httpMethod;
  if (method === 'GET') {
    const p = event.queryStringParameters || {};
    const valid = VERIFY_TOKEN && p['hub.mode'] === 'subscribe' && p['hub.verify_token'] === VERIFY_TOKEN;
    return valid ? {statusCode:200, body:String(p['hub.challenge'] || '')} : {statusCode:403,body:'Forbidden'};
  }
  if (method !== 'POST') return {statusCode:405,body:'Method Not Allowed'};
  if (!process.env.META_APP_SECRET) return {statusCode:503,body:'App secret not configured'};
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'utf8');
  const signature = event.headers?.['x-hub-signature-256'] || event.headers?.['X-Hub-Signature-256'] || '';
  const expected = 'sha256=' + crypto.createHmac('sha256',process.env.META_APP_SECRET).update(raw).digest('hex');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) return {statusCode:403,body:'Invalid signature'};
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return {statusCode:400,body:'Invalid JSON'}; }
  if (body.object !== 'page') return {statusCode:404,body:'Not Found'};
  try {
    for (const entry of body.entry || []) for (const message of entry.messaging || []) await processEvent(message);
    return {statusCode:200,body:'EVENT_RECEIVED'};
  } catch(e) {
    console.error('Webhook processing error:',e.message);
    return {statusCode:500,body:'Processing failed'};
  }
};

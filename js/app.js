// =============================================
//  时间觉察 App - 核心逻辑
// =============================================

;(() => {
"use strict";

// ===== CONSTANTS =====
const STATES = [
  { id:"study", name:"学习", emoji:"📖", color:"var(--state-study)" },
  { id:"work",  name:"工作", emoji:"💼", color:"var(--state-work)" },
  { id:"entertain", name:"娱乐", emoji:"🎮", color:"var(--state-entertain)" },
  { id:"sport",    name:"运动", emoji:"🏃", color:"var(--state-sport)" },
  { id:"social",   name:"社交", emoji:"💬", color:"var(--state-social)" },
  { id:"sleep",    name:"睡眠", emoji:"😴", color:"var(--state-sleep)" },
  { id:"other",    name:"其他", emoji:"📌", color:"var(--state-other)" },
];
const STATE_MAP = Object.fromEntries(STATES.map(s=>[s.id,s]));
const DEFAULT_FRICTION = "longpress";
const DEFAULT_GOAL_MS = 4*3600000;
const DEFAULT_REMINDER_MS = 30*60000;
const LAZY_THRESHOLD_MS = 60*60000;
const LAZY_ALERT_INTERVAL_MS = 10*60000;
const DB_NAME = "TimeAwareDB";
const DB_VER = 1;
const STORE_NAME = "records";

// ===== STATE =====
let db = null;
let records = [];
let currentRecord = null;
let settings = {};
let timerInterval = null;
let reminderInterval = null;
let currentView = "today";
let pressingState = null;
let longPressTimer = null;
let longPressStarted = false;
let microTimer = null;
let microRemaining = 300;

// ===== DOM REFS =====
const $ = s=>document.querySelector(s);
// const  shortcut not needed - using querySelectorAll directly

// ===== INDEXEDDB =====
function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME,DB_VER);
    req.onupgradeneeded = e=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains(STORE_NAME)){
        const store = d.createObjectStore(STORE_NAME,{keyPath:"id"});
        store.createIndex("date","date",{unique:false});
        store.createIndex("state","state",{unique:false});
        store.createIndex("startTime","startTime",{unique:false});
      }
    };
    req.onsuccess = e=>resolve(e.target.result);
    req.onerror = e=>reject(e.target.error);
  });
}

async function loadRecords(){
  if(!db) return [];
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_NAME,"readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.index("startTime").openCursor(null,"prev");
    const result = [];
    req.onsuccess = e=>{
      const c = e.target.result;
      if(c){ result.push(c.value); c.continue(); }
      else resolve(result);
    };
    req.onerror = e=>reject(e.target.error);
  });
}

async function saveRecord(rec){
  if(!db) return;
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_NAME,"readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(rec);
    tx.oncomplete = ()=>resolve();
    tx.onerror = e=>reject(e.target.error);
  });
}

async function getAllRecords(){
  if(!db) return [];
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_NAME,"readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = e=>reject(e.target.error);
  });
}

async function clearAllRecords(){
  if(!db) return;
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_NAME,"readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = ()=>resolve();
    tx.onerror = e=>reject(e.target.error);
  });
}

// ===== SETTINGS =====
function loadSettings(){
  try{
    const raw = localStorage.getItem("timeAwareSettings");
    if(raw){ settings = JSON.parse(raw); }
    else{
      settings = { goalMs: DEFAULT_GOAL_MS, reminderMs: DEFAULT_REMINDER_MS, friction: DEFAULT_FRICTION, inertiaEnabled: true, notificationEnabled: true, lazinessEnabled: true };
    }
  }catch(e){
    settings = { goalMs:DEFAULT_GOAL_MS, reminderMs:DEFAULT_REMINDER_MS, friction:DEFAULT_FRICTION, inertiaEnabled:true, notificationEnabled:true, lazinessEnabled:true };
  }
  if(!settings.goalMs) settings.goalMs = DEFAULT_GOAL_MS;
  if(!settings.reminderMs) settings.reminderMs = DEFAULT_REMINDER_MS;
  if(!settings.friction) settings.friction = DEFAULT_FRICTION;
  if(settings.inertiaEnabled===undefined) settings.inertiaEnabled = true;
  if(settings.notificationEnabled===undefined) settings.notificationEnabled = true;
  if(settings.lazinessEnabled===undefined) settings.lazinessEnabled = true;
  saveSettings();
}

function saveSettings(){
  try{ localStorage.setItem("timeAwareSettings",JSON.stringify(settings)); }catch(e){}
}

// ===== UTILITY FUNCTIONS =====
function getTodayStr(){
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}

function now(){ return Date.now(); }

function findCurrentRecord(){
  return records.find(r=>!r.endTime) || null;
}

function formatDurationShort(ms){
  if(ms < 0) ms = 0;
  const h = Math.floor(ms/3600000);
  const m = Math.floor((ms%3600000)/60000);
  if(h>0) return h+"h "+m+"m";
  return m+"m";
}

function formatDurationFull(ms){
  if(ms < 0) ms = 0;
  const h = Math.floor(ms/3600000);
  const m = Math.floor((ms%3600000)/60000);
  const s = Math.floor((ms%60000)/1000);
  return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
}

function getStateDurationForDate(stateId,recs,dateStr){
  let total = 0;
  const dayStart = new Date(dateStr+"T00:00:00").getTime();
  const dayEnd = dayStart + 86400000;
  const n = now();
  for(const r of recs){
    if(r.state !== stateId) continue;
    const end = r.endTime ? Math.min(r.endTime,dayEnd) : Math.min(n,dayEnd);
    const start = Math.max(r.startTime, dayStart);
    if(end > start) total += (end - start);
  }
  return total;
}

function getTodayDurations(recs){
  const today = getTodayStr();
  const result = {};
  for(const s of STATES) result[s.id] = 0;
  let total = 0;
  for(const r of recs){
    if(r.date !== today) continue;
    const dayStart = new Date(today+"T00:00:00").getTime();
    const dayEnd = dayStart + 86400000;
    const end = r.endTime ? Math.min(r.endTime,dayEnd) : Math.min(now(),dayEnd);
    const start = Math.max(r.startTime, dayStart);
    if(end > start){
      const dur = end - start;
      result[r.state] = (result[r.state]||0) + dur;
      total += dur;
    }
  }
  return { durations: result, total };
}

function calcDebt(){
  const learned = getStateDurationForDate("study",records,getTodayStr());
  return Math.max(0, settings.goalMs - learned);
}

// ===== INERTIA =====
function getInertiaData(stateId){
  const sessions = [];
  const nowT = now();
  const thirtyDaysAgo = nowT - 30*86400000;
  for(const r of records){
    if(r.state !== stateId) continue;
    if(r.startTime < thirtyDaysAgo) continue;
    if(r.endTime){
      const dur = r.endTime - r.startTime;
      if(dur > 60000) sessions.push(dur);
    }
  }
  if(sessions.length < 2) return null;
  const total = sessions.reduce((a,b)=>a+b,0);
  return { avg: total/sessions.length, max: Math.max(...sessions), count: sessions.length };
}

// ===== FRICTION CHECK =====
function needsFriction(fromId,toId){
  if(fromId === toId) return false;
  if(toId === "entertain" && (fromId==="study"||fromId==="work")) return true;
  return false;
}

// ===== NOTIFICATIONS =====
async function requestNotifPermission(){
  if(!("Notification" in window)) return false;
  if(Notification.permission === "granted") return true;
  if(Notification.permission === "denied") return false;
  const perm = await Notification.requestPermission();
  return perm === "granted";
}

function sendNotification(body){
  if(!settings.notificationEnabled) return;
  if("Notification" in window && Notification.permission === "granted"){
    try{ new Notification("时间觉察",{body,tag:"time-reminder",requireInteraction:true}); }catch(e){}
  }
}

// Show a brief inertia toast as a notification
function showInertiaToast(msg){
  if("Notification" in window && Notification.permission === "granted"){
    try{ new Notification("时间觉察",{body:msg,tag:"inertia"}); }catch(e){}
  }
}
// ===== REMINDER INTERVAL =====

function startReminderInterval(){
  stopReminderInterval();
  if(!settings.notificationEnabled || settings.reminderMs < 60000) return;
  reminderInterval = setInterval(()=>{
    const cur = findCurrentRecord();
    if(cur){
      const dur = now() - cur.startTime;
      const state = STATE_MAP[cur.state];
      const name = state ? state.name : cur.state;
      sendNotification("你已经在【"+name+"】状态"+formatDurationShort(dur)+"了，现在在干什么？");
    }
  }, settings.reminderMs);
}

function stopReminderInterval(){
  if(reminderInterval){ clearInterval(reminderInterval); reminderInterval = null; }
}

// ===== MICRO-START =====
function startMicroMode(){
  const modal = document.getElementById("micro-modal");
  microRemaining = 300;
  updateMicroDisplay();
  modal.classList.remove("hidden");
  if(microTimer) clearInterval(microTimer);
  microTimer = setInterval(()=>{
    microRemaining--;
    updateMicroDisplay();
    if(microRemaining <= 0){
      clearInterval(microTimer);
      microTimer = null;
      endMicroMode(true);
    }
  }, 1000);
}

function updateMicroDisplay(){
  const m = Math.floor(microRemaining/60);
  const s = microRemaining%60;
  const el = document.getElementById("micro-timer");
  if(el) el.textContent = String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
}

function endMicroMode(askContinue){
  if(microTimer){ clearInterval(microTimer); microTimer=null; }
  document.getElementById("micro-modal").classList.add("hidden");
  if(askContinue){
    setTimeout(()=>{
      if(confirm("5分钟到了，要继续吗？")){
        sendNotification("👍 继续加油！");
      }else{
        sendNotification("好的，休息一下～");
      }
    },300);
  }
}

// ===== LAZINESS DETECTION =====
let lastLazyCheck = 0;
let lazyAlertCount = 0;

function checkLaziness(curRecord){
  if(!settings.lazinessEnabled){
    document.getElementById("laziness-banner").classList.add("hidden");
    return;
  }
  if(!curRecord || curRecord.state !== "entertain") {
    document.getElementById("laziness-banner").classList.add("hidden");
    lazyAlertCount = 0;
    return;
  }
  const dur = now() - curRecord.startTime;
  if(dur >= LAZY_THRESHOLD_MS && dur - lastLazyCheck >= LAZY_ALERT_INTERVAL_MS){
    lastLazyCheck = dur - (dur % LAZY_ALERT_INTERVAL_MS);
    lazyAlertCount++;
    const banner = document.getElementById("laziness-banner");
    const text = document.getElementById("laziness-text");
    const m = Math.floor(dur/60000);
    text.textContent = "已经娱乐 "+formatDurationShort(dur)+" 了，第 "+lazyAlertCount+" 次提醒";
    banner.classList.remove("hidden");
    if(navigator.vibrate) navigator.vibrate(200);
    sendNotification("已经娱乐 "+formatDurationShort(dur)+" 了，该动一动了！");
  }
}

// ===== DONUT CHART =====
function renderDonutChart(){
  const svg = document.getElementById("donut-chart");
  const legend = document.getElementById("chart-legend");
  const center = document.getElementById("chart-total-hours");
  if(!svg) return;
  const { durations, total } = getTodayDurations(records);
  if(total === 0){
    svg.innerHTML = "";
    legend.innerHTML = "";
    if(center) center.innerHTML = "今日<br><span>--</span>";
    return;
  }
  if(center) center.innerHTML = "今日<br><span>"+formatDurationShort(total)+"</span>";

  const activeStates = STATES.filter(s => (durations[s.id]||0) > 10000);
  if(activeStates.length === 0){
    svg.innerHTML = "";
    legend.innerHTML = "";
    return;
  }

  const cx=100, cy=100, r=78, sw=22;
  const circ = 2*Math.PI*r;
  let offset = 0;
  let paths = "";
  for(const s of activeStates){
    const dur = durations[s.id];
    const fraction = dur/total;
    const len = Math.max(fraction * circ, 1);
    const root = document.documentElement;
    const color = getComputedStyle(root).getPropertyValue(s.color).trim() || "#fff";
    paths += "<circle cx=\""+cx+"\" cy=\""+cy+"\" r=\""+r+"\" fill=\"none\" stroke=\""+color+"\" stroke-width=\""+sw+"\" stroke-dasharray=\""+len+" "+(circ-len)+"\" stroke-dashoffset=\""+(-offset)+"\" stroke-linecap=\"butt\" transform=\"rotate(-90 "+cx+" "+cy+")\" style=\"transition:stroke-dasharray 0.5s\"/>";
    offset += len;
  }
  svg.innerHTML = paths;

  legend.innerHTML = activeStates.map(s=>{
    const root = document.documentElement;
    const color = getComputedStyle(root).getPropertyValue(s.color).trim() || "#fff";
    return "<span class=\"legend-item\"><span class=\"legend-dot\" style=\"background:"+color+"\"></span>"+s.name+" "+formatDurationShort(durations[s.id])+"</span>";
  }).join("");
}

// ===== UI UPDATE =====
function updateCurrentStateUI(){
  const rec = findCurrentRecord();
  currentRecord = rec;
  const card = document.getElementById("current-state-card");
  const emoji = document.getElementById("current-emoji");
  const name = document.getElementById("current-name");
  const dur = document.getElementById("current-duration");
  const since = document.getElementById("current-since");

  if(!rec){
    card.style.borderColor = "var(--text3)";
    emoji.textContent = "⏳";
    name.textContent = "未开始";
    dur.textContent = "--:--:--";
    since.textContent = "点击下方按钮开始记录";
    document.querySelectorAll(".state-btn").forEach(btn=>btn.classList.remove("active"));
    renderDonutChart();
    updateDailySummary();
    return;
  }

  const state = STATE_MAP[rec.state];
  if(!state) return;
  const elapsed = now() - rec.startTime;
  const root = document.documentElement;
  const color = getComputedStyle(root).getPropertyValue(state.color).trim() || "#fff";
  card.style.borderColor = color;
  emoji.textContent = state.emoji;
  name.textContent = state.name;
  name.style.color = color;
  dur.textContent = formatDurationFull(elapsed);
  const startDate = new Date(rec.startTime);
  since.textContent = "始于 "+String(startDate.getHours()).padStart(2,"0")+":"+String(startDate.getMinutes()).padStart(2,"0");
  card.dataset.state = state.id;

  // Update grid buttons
  document.querySelectorAll(".state-btn").forEach(btn=>{
    const id = btn.dataset.state;
    btn.classList.toggle("active", id===state.id);
    const durEl = btn.querySelector(".sbtn-current");
    if(id===state.id && durEl){
      durEl.textContent = formatDurationShort(elapsed);
    }else if(durEl){
      durEl.textContent = "";
    }
  });

  checkLaziness(rec);
  updateDailySummary();
  renderDonutChart();
}

function updateDailySummary(){
  const learned = getStateDurationForDate("study",records,getTodayStr());
  const debt = calcDebt();
  const debtCap = settings.goalMs*2;
  const displayDebt = Math.min(debt, debtCap);
  const goalEl = document.getElementById("goal-display");
  const learnedEl = document.getElementById("learned-display");
  const debtEl = document.getElementById("debt-display");
  if(goalEl) goalEl.textContent = formatDurationShort(settings.goalMs);
  if(learnedEl) learnedEl.textContent = formatDurationShort(learned);
  if(debtEl){
    debtEl.textContent = formatDurationShort(displayDebt);
    if(displayDebt > settings.goalMs*0.5){
      debtEl.className = "summary-value debt-danger";
    }else{
      debtEl.className = "summary-value";
    }
  }
}

function startTimer(){
  if(timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(()=>{ updateCurrentStateUI(); }, 1000);
  updateCurrentStateUI();
}

function stopTimer(){
  if(timerInterval){ clearInterval(timerInterval); timerInterval = null; }
}
// ===== SWITCH STATE =====
async function switchToState(stateId, note, review){
  const nowT = now();
  const today = getTodayStr();
  const current = findCurrentRecord();

  if(current){
    current.endTime = nowT;
    await saveRecord(current);
    const idx = records.findIndex(r=>r.id===current.id);
    if(idx>=0) records[idx] = current;
  }

  const newRec = {
    id: nowT,
    state: stateId,
    startTime: nowT,
    endTime: null,
    date: today,
    note: note || null,
    review: review || null,
    triggerType: "manual"
  };
  records.unshift(newRec);
  await saveRecord(newRec);
  currentRecord = newRec;

  // Show inertia toast
  if(settings.inertiaEnabled && current && current.state !== stateId){
    const inertia = getInertiaData(stateId);
    if(inertia && inertia.count >= 2){
      const state = STATE_MAP[stateId];
      const s = state ? state.name : stateId;
      const msg = "你上次"+s+"平均持续 "+formatDurationShort(inertia.avg)+"，最长 "+formatDurationShort(inertia.max)+"（近30天共"+inertia.count+"次）";
      showInertiaToast(msg);
    }
  }

  updateCurrentStateUI();
  // Vibrate feedback
  if(navigator.vibrate) navigator.vibrate(50);
}

// ===== FRICTION HANDLING =====
function showSwitchDialog(stateId){
  const modal = document.getElementById("switch-modal");
  const title = document.getElementById("modal-title");
  const switchInfo = document.getElementById("switch-info");
  const reviewSection = document.getElementById("review-section");
  const reviewInput = document.getElementById("review-input");
  const noteInput = document.getElementById("switch-note");
  const current = findCurrentRecord();
  const state = STATE_MAP[stateId];
  if(!state) return;
  const curState = current ? STATE_MAP[current.state] : null;

  title.textContent = curState ? "从 "+curState.name+" 切换到 "+state.name+"？" : "切换到 "+state.name;
  if(switchInfo){
      const fromName = curState ? curState.name : '无'
    const color = getComputedStyle(document.documentElement).getPropertyValue(state.color).trim() || "#fff";
      switchInfo.innerHTML = '<span class="from-state">'+fromName+'</span> → <span class="to-state" style="color:'+getComputedStyle(document.documentElement).getPropertyValue(state.color).trim() || "#fff"+'">'+state.name+'</span>'
  }
  if(reviewSection && reviewInput){
    if(current && current.state === "study"){
      reviewSection.classList.remove("hidden");
      reviewInput.value = "";
    } else {
      reviewSection.classList.add("hidden");
    }
  }
  if(noteInput) noteInput.value = "";
  modal.dataset.targetState = stateId;
  modal.classList.remove("hidden");
}

function handleStateClick(stateId){
  const current = findCurrentRecord();
  if(current && current.state === stateId) return;
  showSwitchDialog(stateId);
}

function setupLongPress(btn, stateId){
  let pressTimer = null;
  let pressStart = 0;
  let triggered = false;
  const duration = 3000;

  function onStart(e){
    const current = findCurrentRecord();
    if(!current || !needsFriction(current.state, stateId)) return;
    if(btn.classList.contains("active")) return;
    triggered = false;
    pressStart = Date.now();
    pressingState = btn;
    btn.classList.add("pressing");
    pressTimer = setInterval(()=>{
      const elapsed = Date.now() - pressStart;
      if(elapsed >= duration){
        clearInterval(pressTimer);
        pressTimer = null;
        btn.classList.remove("pressing");
        pressingState = null;
        triggered = true;
        if(settings.friction === "longpress" || settings.friction === "both"){
          showFrictionConfirm(stateId);
        }
      }
    }, 50);
  }

  function onEnd(){
    if(pressTimer){ clearInterval(pressTimer); pressTimer = null; }
    btn.classList.remove("pressing");
    pressingState = null;
  }

  btn.addEventListener("touchstart", onStart, {passive:true});
  btn.addEventListener("touchend", onEnd);
  btn.addEventListener("touchcancel", onEnd);
  btn.addEventListener("mousedown", onStart);
  btn.addEventListener("mouseup", onEnd);
  btn.addEventListener("mouseleave", onEnd);
}

// ===== NOTE MODAL =====
function showNoteModal(stateId){
  showSwitchDialog(stateId);
}

// ===== STATE GRID =====
function renderStateGrid(){
  const grid = document.getElementById("state-grid");
  if(!grid) return;
  grid.innerHTML = "";
  for(const s of STATES){
    const btn = document.createElement("button");
    btn.className = "state-btn";
    btn.dataset.state = s.id;
    const color = getComputedStyle(document.documentElement).getPropertyValue(s.color).trim();
    btn.innerHTML = "<span class=\"sbtn-emoji\">"+s.emoji+"</span><span class=\"sbtn-name\">"+s.name+"</span><span class=\"sbtn-current\"></span>";
    btn.addEventListener("click", ()=>handleStateClick(s.id));
    grid.appendChild(btn);
    setupLongPress(btn, s.id);
  }
}

// ===== NAVIGATION =====
function switchView(view){
  currentView = view;
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
  const ve = document.getElementById("view-"+view);
  const ne = document.querySelector(".nav-item[data-view=\""+view+"\"]");
  if(ve) ve.classList.add("active");
  if(ne) ne.classList.add("active");
  if(view === "history") renderHistory();
  if(view === "settings") updateSettingsUI();
}

// ===== HISTORY =====
let historyDate = new Date();

function formatDate(d){
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}

function formatDateDisplay(d){
  const weekdays = ["日","一","二","三","四","五","六"];
  return d.getMonth()+1+"月"+d.getDate()+"日 周"+weekdays[d.getDay()];
}
async function renderHistory(){
  const dateStr = formatDate(historyDate);
  const display = document.getElementById("history-date-display");
  if(display) display.textContent = formatDateDisplay(historyDate);
  const content = document.getElementById("history-content");
  if(!content) return;
  const allRecs = await getAllRecords();
  const dayRecs = allRecs.filter(r=>r.date===dateStr);
  if(dayRecs.length === 0){
    content.innerHTML = "<div class=\"empty-state\">这一天没有记录</div>";
    return;
  }
  // Stats
  const stateDurs = {};
  for(const s of STATES) stateDurs[s.id] = 0;
  const dayStart = new Date(dateStr+"T00:00:00").getTime();
  const dayEnd = dayStart + 86400000;
  const n = now();
  for(const r of dayRecs){
    const end = r.endTime ? Math.min(r.endTime,dayEnd) : Math.min(n,dayEnd);
    const start = Math.max(r.startTime, dayStart);
    if(end > start) stateDurs[r.state] = (stateDurs[r.state]||0) + (end-start);
  }
  let html = "<div class=\"history-day-summary\"><div class=\"hs-date\">"+formatDateDisplay(historyDate)+"</div><div class=\"hs-stats\">";
  for(const s of STATES){
    const d = stateDurs[s.id];
    if(d > 60000){
      const color = getComputedStyle(document.documentElement).getPropertyValue(s.color).trim();
      html += "<span class=\"hs-stat\"><span style=\"display:inline-block;width:8px;height:8px;border-radius:4px;background:"+color+"\"></span>"+s.emoji+" "+s.name+" "+formatDurationShort(d)+"</span>";
    }
  }
  html += "</div></div>";
  // Timeline
  const sorted = [...dayRecs].sort((a,b)=>a.startTime-b.startTime);
  html += "<div style=\"padding-left:12px;border-left:2px solid var(--border);margin-left:6px\">";
  for(const r of sorted){
    const state = STATE_MAP[r.state];
    const sT = new Date(r.startTime);
    const eT = r.endTime ? new Date(r.endTime) : null;
    const d = r.endTime ? (r.endTime-r.startTime) : (now()-r.startTime);
    const sStr = String(sT.getHours()).padStart(2,"0")+":"+String(sT.getMinutes()).padStart(2,"0");
    const eStr = eT ? String(eT.getHours()).padStart(2,"0")+":"+String(eT.getMinutes()).padStart(2,"0") : "进行中";
    const color = state ? getComputedStyle(document.documentElement).getPropertyValue(state.color).trim() : "var(--text3)";
    html += "<div style=\"position:relative;padding:6px 0 6px 16px;border-left:3px solid "+color+";margin-left:-2px;margin-bottom:4px\">";
    html += "<div style=\"font-size:11px;color:var(--text2)\">"+sStr+" → "+eStr+"</div>";
    html += "<div style=\"font-size:13px;font-weight:500\">"+(state?state.emoji+" "+state.name:"未知")+" <span style=\"font-size:11px;color:var(--text2);font-weight:400\">"+formatDurationShort(d)+"</span></div>";
    if(r.note) html += "<div style=\"font-size:11px;color:var(--text2);margin-top:2px\">📝 "+r.note+"</div>";
    if(r.review && r.state === "study") html += "<div class=\"history-review\"><div class=\"review-label\">📖 学习回顾</div>"+r.review+"</div>";
    html += "</div>";
  }
  html += "</div>";
  content.innerHTML = html;
}

// ===== SETTINGS UI =====
function updateSettingsUI(){
  const goalEl = document.getElementById("setting-goal-display");
  const reminderEl = document.getElementById("setting-reminder-display");
  if(goalEl) goalEl.textContent = formatDurationShort(settings.goalMs);
  if(reminderEl) reminderEl.textContent = formatDurationShort(settings.reminderMs);
  document.querySelectorAll(".friction-option").forEach(btn=>{
    btn.classList.toggle("selected", btn.dataset.friction === settings.friction);
  });
  const it = document.getElementById("toggle-inertia");
  const nt = document.getElementById("toggle-notification");
  const lt = document.getElementById("toggle-laziness");
  if(it) it.checked = settings.inertiaEnabled;
  if(nt) nt.checked = settings.notificationEnabled;
  if(lt) lt.checked = settings.lazinessEnabled;
}

// ===== EXPORT =====
async function exportData(){
  const allRecs = await getAllRecords();
  const data = {
    exportDate: new Date().toISOString(),
    settings: settings,
    records: allRecs.map(r=>({...r,startTime:new Date(r.startTime).toISOString(),endTime:r.endTime?new Date(r.endTime).toISOString():null}))
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "时间觉察_数据_"+getTodayStr()+".json";
  a.click();
  URL.revokeObjectURL(url);
}

// ===== INIT =====
async function init(){
  try{ db = await openDB(); }catch(e){ console.error("DB:",e); }
  loadSettings();
  records = await loadRecords();
  renderStateGrid();

  // Nav
  document.querySelectorAll(".nav-item").forEach(item=>{
    item.addEventListener("click", ()=>switchView(item.dataset.view));
  });

  // History arrows
  document.getElementById("history-prev")?.addEventListener("click", ()=>{ historyDate.setDate(historyDate.getDate()-1); renderHistory(); });
  document.getElementById("history-next")?.addEventListener("click", ()=>{ historyDate.setDate(historyDate.getDate()+1); renderHistory(); });

  // Goal
  document.querySelectorAll("[data-goal-adjust]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      settings.goalMs = Math.max(30*60000, settings.goalMs + parseInt(btn.dataset.goalAdjust)*60000);
      saveSettings(); updateSettingsUI(); updateCurrentStateUI();
    });
  });

  // Reminder
  document.querySelectorAll("[data-reminder-adjust]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      settings.reminderMs = Math.max(10*60000, Math.min(120*60000, settings.reminderMs + parseInt(btn.dataset.reminderAdjust)*60000));
      saveSettings(); updateSettingsUI(); startReminderInterval();
    });
  });

  // Friction
  document.querySelectorAll(".friction-option").forEach(btn=>{
    btn.addEventListener("click", ()=>{ settings.friction = btn.dataset.friction; saveSettings(); updateSettingsUI(); });
  });

  // Toggles
  document.getElementById("toggle-inertia")?.addEventListener("change", ()=>{ settings.inertiaEnabled = document.getElementById("toggle-inertia").checked; saveSettings(); });
  document.getElementById("toggle-notification")?.addEventListener("change", ()=>{
    settings.notificationEnabled = document.getElementById("toggle-notification").checked;
    saveSettings();
    if(settings.notificationEnabled) startReminderInterval(); else stopReminderInterval();
  });
  document.getElementById("toggle-laziness")?.addEventListener("change", ()=>{ settings.lazinessEnabled = document.getElementById("toggle-laziness").checked; saveSettings(); });

  // Modals
  document.getElementById("modal-confirm")?.addEventListener("click", ()=>{
    const m = document.getElementById("switch-modal");
    const sid = m.dataset.targetState;
    const note = document.getElementById("switch-note")?.value.trim() || "";
    const review = document.getElementById("review-input")?.value.trim() || "";
    m.classList.add("hidden");
    if(sid) switchToState(sid, note, review);
  });
  document.getElementById("modal-cancel")?.addEventListener("click", ()=>document.getElementById("switch-modal").classList.add("hidden"));
  document.querySelectorAll("#switch-modal .modal-overlay").forEach(el=>el.addEventListener("click",()=>document.getElementById("switch-modal").classList.add("hidden")));

  document.getElementById("note-confirm")?.addEventListener("click", ()=>{
    const m = document.getElementById("note-modal");
    const sid = m.dataset.targetState;
    m.classList.add("hidden");
    if(sid) showSwitchDialog(sid);
  });
  document.getElementById("note-cancel")?.addEventListener("click", ()=>{
    document.getElementById("note-modal").classList.add("hidden");
  });
  document.querySelectorAll("#note-modal .modal-overlay").forEach(el=>el.addEventListener("click",()=>document.getElementById("note-modal").classList.add("hidden")));

  document.getElementById("micro-cancel")?.addEventListener("click", ()=>endMicroMode(false));
  document.querySelectorAll("#micro-modal .modal-overlay").forEach(el=>el.addEventListener("click",()=>endMicroMode(false)));

  // Export
  document.getElementById("btn-export")?.addEventListener("click", exportData);

  // Reset
  document.getElementById("btn-reset")?.addEventListener("click", async ()=>{
    if(confirm("确定要删除所有数据吗？此操作不可撤销。")){
      await clearAllRecords();
      records = [];
      updateCurrentStateUI();
      renderDonutChart();
    }
  });

  // Micro-start button
  const section = document.querySelector(".current-state-section");
  if(section){
    const microBtn = document.createElement("button");
    microBtn.id = "micro-start-btn";
    microBtn.style.cssText = "margin:8px auto 0;padding:8px 20px;background:var(--card-bg);border:1px solid var(--state-study);border-radius:var(--radius-sm);color:var(--text);cursor:pointer;font-size:13px;width:auto;display:block";
    microBtn.innerHTML = "🔥 只做5分钟";
    microBtn.addEventListener("click", ()=>{
      const cur = findCurrentRecord();
      if(cur && (cur.state==="study"||cur.state==="work")){
        startMicroMode();
      }else{
        showSwitchDialog("study");
      }
    });
    section.appendChild(microBtn);
  }

  await requestNotifPermission();
  startTimer();
  startReminderInterval();
  console.log("时间觉察 App initialized");
}


// ===== CALENDAR =====
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();

async function getAllDatesWithRecords(){
  const all = await getAllRecords();
  const dates = new Set();
  all.forEach(r => { if(r.date) dates.add(r.date); });
  return dates;
}

function renderCalendar(year, month){
  const container = document.getElementById("calendar-container");
  if(!container) return;
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  
  // Header
  let html = "<div class=\"cal-month-nav\">";
  html += "<button class=\"cal-month-btn\" data-cal-nav=\"-1\">◀</button>";
  html += "<span class=\"cal-month-title\">" + year + "年" + (month+1) + "月</span>";
  html += "<button class=\"cal-month-btn\" data-cal-nav=\"1\">▶</button>";
  html += "</div>";
  
  // Weekday headers
  html += "<div class=\"cal-weekdays\">";
  ["一","二","三","四","五","六","日"].forEach(function(d){
    html += "<span class=\"cal-weekday\">" + d + "</span>";
  });
  html += "</div>";
  
  // Day grid
  html += "<div class=\"cal-days\" id=\"cal-days-grid\">";
  
  // Empty cells before first day
  let startDay = firstDay.getDay();
  let emptyCount = startDay === 0 ? 6 : startDay - 1;
  for(let i = 0; i < emptyCount; i++){
    html += "<span class=\"cal-day empty\"></span>";
  }
  
  // Previous month days (for context)
  const prevMonthLast = new Date(year, month, 0).getDate();
  for(let i = emptyCount - 1; i >= 0 && emptyCount > 0; i--){
    const d = prevMonthLast - i;
    html += "<span class=\"cal-day other-month\" data-date=\"\">" + d + "</span>";
  }
  
  // Current month days
  const today = getTodayStr();
  const selectedStr = formatDate(historyDate);
  const promises = getAllDatesWithRecords();
  // We'll handle async differently - just render without record indicators for now
  // and update them after
  for(let d = 1; d <= lastDay.getDate(); d++){
    const dateStr = formatDateStr(year, month, d);
    const isToday = dateStr === today;
    const isSelected = dateStr === selectedStr;
    let cls = "cal-day";
    if(isToday) cls += " today";
    if(isSelected) cls += " selected";
    html += "<span class=\"" + cls + "\" data-date=\"" + dateStr + "\">" + d + "</span>";
  }
  
  html += "</div>";
  container.innerHTML = html;
  
  // Async: mark days with records
  getAllDatesWithRecords().then(function(datesWithRecords){
    document.querySelectorAll("#cal-days-grid .cal-day[data-date]").forEach(function(el){
      if(datesWithRecords.has(el.dataset.date)){
        el.classList.add("has-record");
      }
    });
  });
}

function formatDateStr(year, month, day){
  return year + "-" + String(month+1).padStart(2,"0") + "-" + String(day).padStart(2,"0");
}

document.addEventListener("DOMContentLoaded", init);
})();
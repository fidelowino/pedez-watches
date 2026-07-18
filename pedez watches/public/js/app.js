// ── CONFIG ──
const API  = window.location.origin + '/api';
const BASE = window.location.origin;

// ── STATE ──
let token   = localStorage.getItem('pz_token');
let user    = JSON.parse(localStorage.getItem('pz_user') || 'null');
let USD_KES = 129;

// Live exchange rate
fetch('https://open.er-api.com/v6/latest/USD')
  .then(r=>r.json()).then(d=>{if(d?.rates?.KES) USD_KES=d.rates.KES;}).catch(()=>{});

const fmtKES = n => 'KES ' + Math.ceil(Number(n)*USD_KES).toLocaleString('en-KE');
const fmtUSD = n => 'KES ' + Math.ceil(Number(n)*USD_KES).toLocaleString('en-KE'); // both show KES
const toKES  = n => Math.ceil(Number(n)*USD_KES);

// ── API FETCH ──
async function apiFetch(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}) }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

// ── AUTH ──
function setAuth(tok, u) {
  token = tok; user = u;
  localStorage.setItem('pz_token', tok);
  localStorage.setItem('pz_user', JSON.stringify(u));
}
function clearAuth() {
  token = null; user = null;
  localStorage.removeItem('pz_token');
  localStorage.removeItem('pz_user');
}

// ── TOAST ──
function toast(msg, dur=3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), dur);
}

// ── WATCH SVG PLACEHOLDER ──
function watchSVG(size=90) {
  return `<svg width="${size}" height="${Math.round(size*330/260)}" viewBox="0 0 260 330" fill="none">
    <rect x="95" y="0" width="70" height="72" rx="10" fill="#141414" stroke="#1e1e1e"/>
    <rect x="95" y="258" width="70" height="72" rx="10" fill="#141414" stroke="#1e1e1e"/>
    <rect x="38" y="68" width="184" height="194" rx="32" fill="#0e0e0e" stroke="#c9a84c" stroke-width="1.5"/>
    <circle cx="130" cy="165" r="74" fill="#080808" stroke="#c9a84c" stroke-width=".8"/>
    <rect x="127" y="97" width="6" height="13" rx="1" fill="#c9a84c"/>
    <rect x="127" y="220" width="6" height="13" rx="1" fill="#c9a84c"/>
    <rect x="63" y="162" width="13" height="6" rx="1" fill="#c9a84c"/>
    <rect x="184" y="162" width="13" height="6" rx="1" fill="#c9a84c"/>
    <text x="130" y="172" font-family="Montserrat,sans-serif" font-size="12" letter-spacing="4" fill="#c9a84c" text-anchor="middle">PEDEZ</text>
    <line x1="130" y1="165" x2="122" y2="128" stroke="#e8c97a" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="130" y1="165" x2="153" y2="124" stroke="#f5f0e8" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="130" cy="165" r="4.5" fill="#c9a84c"/>
    <circle cx="130" cy="165" r="2" fill="#080808"/>
  </svg>`;
}

function watchImg(w, size=90) {
  if (w.image_url) {
    const src = w.image_url.startsWith('http') ? w.image_url : BASE + w.image_url;
    return `<img src="${src}" alt="${w.name}" style="width:100%;height:100%;object-fit:cover"
      onerror="this.style.display='none';this.insertAdjacentHTML('afterend','${watchSVG(size).replace(/'/g,"&#39;").replace(/"/g,'&quot;')}')">`;
  }
  return watchSVG(size);
}

// ── SCROLL REVEAL ──
function initReveal() {
  const check = () => document.querySelectorAll('.reveal').forEach(el => {
    if (el.getBoundingClientRect().top < innerHeight * .88) el.classList.add('in');
  });
  window.addEventListener('scroll', check, { passive: true });
  setTimeout(check, 120);
}

// ── COPY ──
function copyText(text, btnEl, label='Copied!') {
  navigator.clipboard?.writeText(text).then(() => {
    const orig = btnEl.textContent;
    btnEl.textContent = label;
    btnEl.style.color = '#5fc86a';
    setTimeout(() => { btnEl.textContent = orig; btnEl.style.color = ''; }, 2200);
  });
}

// ── QUESTS ──
const QUESTS = [
  { id:1, milestone:5,  emoji:'⌚', title:'First Collector',  desc:'Make 5 purchases and join the inner circle of Pedez collectors.',    reward:'10% off your next order',                         code:'PEDEZ-COL5',    rEmoji:'🎁' },
  { id:2, milestone:10, emoji:'💎', title:'Watch Enthusiast', desc:'10 purchases — you clearly have an eye for the finest timepieces.',   reward:'Free luxury gift packaging on any order',          code:'PEDEZ-GIFT10',  rEmoji:'🎀' },
  { id:3, milestone:15, emoji:'🥇', title:'Connoisseur',       desc:'15 purchases. You are no longer a buyer — you are a true collector.', reward:'15% off + VIP early access to new arrivals',       code:'PEDEZ-VIP15',   rEmoji:'👑' },
  { id:4, milestone:20, emoji:'🏆', title:'Pedez Legend',      desc:'20 purchases. There is no higher status in the Pedez collection.',   reward:'20% off + exclusive access + personal concierge', code:'PEDEZ-LEGEND20', rEmoji:'🏆' },
];

function getOrderCount() {
  return parseInt(localStorage.getItem('pz_orders') || user?.order_count || '0');
}
function incrementOrderCount() {
  const c = getOrderCount() + 1;
  localStorage.setItem('pz_orders', c);
  if (user) { user.order_count = c; localStorage.setItem('pz_user', JSON.stringify(user)); }
  checkQuests(c);
  if (typeof renderQuests === 'function') renderQuests();
}
function checkQuests(count) {
  QUESTS.forEach(q => {
    const k = `pz_q_${q.id}`;
    if (count >= q.milestone && !localStorage.getItem(k)) {
      localStorage.setItem(k, '1');
      setTimeout(() => showRewardPopup(q), 1000);
    }
  });
}
function showRewardPopup(quest) {
  const popup = document.getElementById('rewardPopup');
  if (!popup) return;
  const cf = document.getElementById('rewardConfetti');
  if (cf) {
    cf.innerHTML = '';
    const cols = ['#c9a84c','#e8c97a','#fff','#a07830','#f5e4b0','#ffeb3b'];
    for (let i=0; i<60; i++) {
      const p = document.createElement('div');
      p.className = 'cfp';
      p.style.cssText = `left:${Math.random()*100}%;top:-10px;width:${4+Math.random()*9}px;height:${4+Math.random()*9}px;background:${cols[i%cols.length]};border-radius:${Math.random()>.5?'50%':'2px'};animation-delay:${Math.random()*2.5}s;animation-duration:${2+Math.random()*2}s`;
      cf.appendChild(p);
    }
  }
  document.getElementById('rewardEmoji').textContent = quest.rEmoji;
  document.getElementById('rewardSub').innerHTML = `🎉 You've unlocked <strong style="color:var(--gd2)">${quest.title}</strong>!<br><br>${quest.reward}`;
  document.getElementById('rewardCode').textContent = quest.code;
  popup.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeRewardPopup() {
  document.getElementById('rewardPopup')?.classList.remove('open');
  document.body.style.overflow = '';
}
function copyRewardCode() {
  const code = document.getElementById('rewardCode')?.textContent;
  if (code) navigator.clipboard?.writeText(code).then(() => toast('Code copied! 🎉'));
}

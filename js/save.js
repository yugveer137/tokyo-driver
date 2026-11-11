// save.js — accounts, per-account saves, login gate and $1 pay gate for tokyo-driver1.
// Ported from the old index.html (login gate, pay gate, tdKey/tdSession). Plain script,
// no modules: exposes window.Save. Needs nothing else; builds its own DOM + CSS.
//
//   Save.boot()          -> Promise<{ account, isCreator }>, resolves once the player may play
//   Save.account()       -> 'creator' | '<lowercased email>' | 'guest'
//   Save.isCreator()
//   Save.get(key, fb) / Save.set(key, value)       per account, stored as 'td:<acct>:<key>'
//   Save.getGlobal(key, fb) / Save.setGlobal(...)  un-namespaced keys (td_pay_link, td_sound)
//   Save.signOut()       what SWITCH PLAYER did: forget who is signed in, reload
//
// Storage format matches the old game so existing saves load as they are: numbers and
// objects are JSON ('td:<acct>:coins' = 120, 'ownedCars' = ["starter"]), strings are stored
// raw ('selectedCar' = starter, 'paid' = yes). get() tries JSON first and falls back to the
// raw string, so a string that looks like JSON (e.g. "123") reads back as the number.
//
// !! deliveryLevel and deliveryCooldownEnd used to be stored un-namespaced
// (localStorage 'deliveryLevel' / 'deliveryCooldownEnd'), so every account on a browser
// shared one delivery progress. v2 must store them with Save.set('deliveryLevel', n) and
// Save.set('deliveryCooldownEnd', t) so they are per account. Do not read the old keys.
(function () {
    'use strict';

    const SESSION_KEY = 'td_login';     // sessionStorage: who is signed in in this tab
    const ACCT_KEY = 'td_accounts';     // localStorage: { email: code } made on this browser
    const PAY_LINK_KEY = 'td_pay_link'; // localStorage: payment link, set by the creator
    const REMEMBER_KEY = 'td_remember'; // localStorage: a login installed by a #play link (your own phone): stays signed in
    // Keep in sync with the old game: the hash is the SHA-256 of the normalised unlock code.
    // The creator signs in with the owner email plus the creator password (players need the
    // money code instead). Only SHA-256 hashes are kept here, so the page shows no secrets.
    const CREATOR_EMAIL_HASH = '6ee032b5ef8ee117025d16bb28a092236b878467917535b29b3d6fac1f25fb8a';   // of the owner email with only its letters and digits kept (see norm)
    const OWNER_EMAIL = 'yugveer.18@gmail.com';  // "Contact Owner" emails this address
    const CREATOR_PASS_HASH = '490218043cd686f8b85d564602af99bfb4dfeb9b2e94876c96395f0f9e797322';   // the creator's own password, kept only as its SHA-256
    const UNLOCK_HASH = '63640264849a87c90356129d99ea165e37aa5fabc1fea46906df1a7ca50db492';

    // ---------- CSS (copied from the old index.html) ----------
    const CSS = `
        /* Title board: tokyo-driver1 / PLAY */
        #splash-gate {
            position: fixed; inset: 0; z-index: 3100; display: flex; flex-direction: column;
            justify-content: center; align-items: center; color: #fff; font-family: monospace;
            background: radial-gradient(ellipse at 50% 30%, #16233f 0%, #0b1020 55%, #05070e 100%);
        }
        #splash-gate h1 {
            font-size: clamp(2.4rem, 8vw, 5rem); letter-spacing: 6px; color: #00e5ff; margin: 0 0 10px;
            text-shadow: 0 0 30px rgba(0, 229, 255, 0.7), 0 0 60px rgba(0, 229, 255, 0.3);
        }
        #splash-gate p { color: #9ab; font-size: 0.95rem; margin: 0 0 36px; text-align: center; max-width: 520px; line-height: 1.5; padding: 0 20px; }
        #splash-play {
            padding: 22px 90px; font-size: 1.8rem; font-weight: 900; letter-spacing: 6px; border: none; border-radius: 50px;
            color: #06290f; background: linear-gradient(135deg, #7cf7a8, #38d66b); box-shadow: 0 0 50px rgba(56, 214, 107, 0.6); cursor: pointer; font-family: inherit;
        }
        #splash-play:hover { transform: scale(1.04); }
        #splash-gate small { position: absolute; bottom: 24px; color: #567; font-size: 0.75rem; }
        /* Login Gate (first-visit email + code) */
        #login-gate {
            position: fixed;
            inset: 0;
            background: linear-gradient(135deg, #0d0d1a, #101a2e);
            z-index: 3000;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            color: #fff;
            font-family: monospace;
        }
        #login-gate .lg-card {
            background: rgba(10, 14, 26, 0.9);
            border: 1px solid rgba(0, 229, 255, 0.3);
            border-radius: 16px;
            padding: 40px 44px;
            width: min(90vw, 420px);
            box-shadow: 0 0 40px rgba(0, 229, 255, 0.15);
            display: flex;
            flex-direction: column;
        }
        #login-gate h2 {
            font-size: 1.9rem;
            letter-spacing: 3px;
            text-align: center;
            color: #00e5ff;
            margin: 0 0 6px;
            text-shadow: 0 0 18px rgba(0, 229, 255, 0.6);
        }
        #login-gate .lg-sub {
            text-align: center;
            color: #8aa;
            font-size: 0.82rem;
            margin: 0 0 26px;
            line-height: 1.5;
        }
        #login-gate label {
            font-size: 0.72rem;
            letter-spacing: 1px;
            color: #7fa;
            text-transform: uppercase;
            margin-bottom: 6px;
        }
        #login-gate input {
            width: 100%;
            box-sizing: border-box;
            padding: 13px 14px;
            margin-bottom: 18px;
            background: #0a0f1c;
            border: 1px solid #23324a;
            border-radius: 9px;
            color: #eaf6ff;
            font-size: 1rem;
            font-family: monospace;
            outline: none;
            transition: border-color 0.15s, box-shadow 0.15s;
        }
        #login-gate input:focus {
            border-color: #00e5ff;
            box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.15);
        }
        #login-gate #lg-error {
            color: #ff5d6c;
            font-size: 0.78rem;
            min-height: 1.1em;
            text-align: center;
            margin: -8px 0 12px;
        }
        #login-gate #lg-enter {
            padding: 14px;
            background: linear-gradient(135deg, #00ff88, #00cc66);
            color: #04120b;
            border: none;
            border-radius: 10px;
            font-size: 1.05rem;
            font-weight: bold;
            letter-spacing: 2px;
            font-family: monospace;
            cursor: pointer;
            transition: transform 0.15s, box-shadow 0.15s;
        }
        #login-gate #lg-enter:hover {
            transform: translateY(-1px);
            box-shadow: 0 8px 24px rgba(0, 255, 136, 0.3);
        }

        /* Pay gate ($1 to play) */
        #pay-gate {
            position: fixed;
            inset: 0;
            z-index: 2500;
            background: linear-gradient(135deg, #0d0d1a, #101a2e);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-family: monospace;
        }
        #pay-gate .pay-card {
            background: rgba(10, 14, 26, 0.92);
            border: 1px solid rgba(0, 229, 255, 0.3);
            border-radius: 16px;
            padding: 38px 44px;
            width: min(90vw, 400px);
            text-align: center;
            box-shadow: 0 0 40px rgba(0, 229, 255, 0.15);
        }
        #pay-gate h2 {
            font-size: 1.5rem;
            letter-spacing: 3px;
            color: #00e5ff;
            margin: 0 0 10px;
            text-shadow: 0 0 18px rgba(0, 229, 255, 0.6);
        }
        #pay-gate .pay-price {
            font-size: 3.6rem;
            font-weight: bold;
            color: #00ff88;
            line-height: 1;
            margin: 6px 0 10px;
            text-shadow: 0 0 24px rgba(0, 255, 136, 0.5);
        }
        #pay-gate .pay-sub { color: #8aa; font-size: 0.82rem; line-height: 1.5; margin: 0 0 22px; }
        #pay-btn, #paid-btn {
            width: 100%;
            padding: 15px;
            border: none;
            border-radius: 10px;
            font-size: 1.05rem;
            font-weight: bold;
            letter-spacing: 2px;
            font-family: monospace;
            cursor: pointer;
            background: linear-gradient(135deg, #00ff88, #00cc66);
            color: #04120b;
        }
        #paid-btn { background: linear-gradient(135deg, #ffb347, #ff8c00); color: #201400; }
        #pay-gate .pay-row { display: flex; gap: 8px; }
        #pay-gate .pay-row #pay-btn { flex: 1; }
        #pay-more { width: 54px; border: none; border-radius: 10px; font-size: 1.3rem; cursor: pointer; background: #1c2a3c; color: #00e5ff; border: 1px solid rgba(0, 229, 255, 0.35); }
        #pay-plans, #pay-more-box { display: none; margin-top: 14px; }
        #pay-plans.on, #pay-more-box.on { display: block; }
        #pay-plans .plans { display: grid; grid-template-columns: minmax(0, 220px); justify-content: center; gap: 8px; margin-bottom: 12px; }
        #pay-plans .plan { background: #101a2e; border: 1px solid rgba(0, 229, 255, 0.25); border-radius: 12px; padding: 12px 6px; }
        #pay-plans .plan b { display: block; font-size: 1.5rem; color: #00ff88; }
        #pay-plans .plan span { display: block; font-size: 0.72rem; color: #8aa; margin: 4px 0 8px; }
        #pay-plans .plan a { display: inline-block; font-size: 0.7rem; padding: 6px 8px; border-radius: 8px; background: #00e5ff22; color: #00e5ff; text-decoration: none; border: 1px solid #00e5ff55; }
        #trial7, #free3 { width: 100%; margin-top: 10px; padding: 12px; border: 1px solid #ffb34766; border-radius: 10px; font-family: monospace; font-weight: bold; letter-spacing: 1px; cursor: pointer; background: #2a2010; color: #ffb347; }
        #free3 { background: #10261a; color: #7fe0a0; border-color: #7fe0a066; }
        #pay-after { display: none; margin-top: 18px; }
        #pay-after .pay-sub { margin: 0 0 10px; }
        #pay-note { color: #ff5d6c; font-size: 0.76rem; min-height: 1em; margin-top: 12px; }
        #contact-owner {
            display: none;
            margin-top: 12px;
            padding: 12px;
            border-radius: 10px;
            background: #0072ff;
            color: #fff;
            font-family: monospace;
            font-size: 0.95rem;
            font-weight: bold;
            letter-spacing: 2px;
            text-decoration: none;
            text-align: center;
        }
        #contact-owner:hover { background: #1a85ff; }
        #unlock-row { margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.08); text-align: left; }
        #unlock-row label { display: block; font-size: 0.7rem; color: #7fa; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 7px; }
        #unlock-row .unlock-line { display: flex; gap: 8px; }
        #unlock-input {
            flex: 1; min-width: 0; padding: 10px;
            background: #0a0f1c; border: 1px solid #23324a; border-radius: 8px;
            color: #eaf6ff; font-family: monospace; font-size: 0.9rem; outline: none;
        }
        #unlock-input:focus { border-color: #00e5ff; }
        #unlock-btn {
            padding: 10px 14px; border: none; border-radius: 8px; cursor: pointer;
            background: linear-gradient(135deg, #ffb347, #ff8c00); color: #201400;
            font-family: monospace; font-weight: bold; letter-spacing: 1px;
        }
        #unlock-err { color: #ff5d6c; font-size: 0.72rem; min-height: 1em; margin-top: 6px; }

        /* Creator sign on the side */
        #creator-side { position: fixed; right: 22px; bottom: 22px; text-align: right; }
        #creator-btn {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 10px;
            color: #cfe;
            padding: 12px 16px;
            font-family: monospace;
            font-size: 0.8rem;
            letter-spacing: 1px;
            cursor: pointer;
        }
        #creator-btn:hover { border-color: #00e5ff; color: #00e5ff; }
        #creator-box {
            display: none;
            margin-top: 10px;
            background: rgba(10, 14, 26, 0.95);
            border: 1px solid rgba(0, 229, 255, 0.3);
            border-radius: 10px;
            padding: 14px;
            width: 210px;
            text-align: left;
        }
        #creator-box label { display: block; font-size: 0.66rem; color: #7fa; letter-spacing: 1px; margin-bottom: 6px; text-transform: uppercase; }
        #creator-input {
            width: 100%; box-sizing: border-box; padding: 9px;
            background: #0a0f1c; border: 1px solid #23324a; border-radius: 7px;
            color: #eaf6ff; font-family: monospace; font-size: 0.85rem; outline: none;
        }
        #creator-input:focus { border-color: #00e5ff; }
        #creator-go {
            width: 100%; margin-top: 8px; padding: 9px;
            background: #0072ff; color: #fff; border: none; border-radius: 7px;
            font-family: monospace; font-size: 0.8rem; letter-spacing: 1px; cursor: pointer;
        }
        #creator-err { color: #ff5d6c; font-size: 0.7rem; min-height: 1em; margin-top: 6px; }
    `;

    const LOGIN_HTML = `
        <div class="lg-card">
            <h2>Bay Area Driver</h2>
            <p class="lg-sub">Enter your email and create a code to play.<br>You'll only do this once.</p>
            <label for="lg-email">Email</label>
            <input id="lg-email" type="email" autocomplete="email" placeholder="you@example.com" />
            <label for="lg-code">Create a code</label>
            <input id="lg-code" type="password" autocomplete="new-password" placeholder="Make up a code (4+ characters)" />
            <div id="lg-error"></div>
            <button id="lg-enter">ENTER</button>
        </div>
    `;

    const SPLASH_HTML = `
        <h1>Bay Area Driver</h1>
        <p>Drive the Bay Area: San Francisco to San Jose, Oakland to Fremont, three bridges over the water.<br>You need money to play: email <b>${OWNER_EMAIL}</b> to get it.</p>
        <button id="splash-play">PLAY</button>
        <small>Questions and money: ${OWNER_EMAIL}</small>
    `;

    const PAY_HTML = `
        <div class="pay-card">
            <h2>Bay Area Driver</h2>
            <div class="pay-price">PAY $1</div>
            <p class="pay-sub">Bay Area Driver costs $1, once. Pay the owner by email and you get a money code that opens the game for good. There is nothing to pay for inside the game.</p>
            <div class="pay-row"><button id="pay-btn">PAY $1</button><button id="pay-more" title="more choices">&#9662;</button></div>
            <div id="pay-plans">
                <div class="plans">
                    <div class="plan"><b>$1</b><span>once, and the game is yours to keep</span><a id="mail-once" href="#">EMAIL TO PAY</a></div>
                </div>
                <p class="pay-sub" style="margin-bottom:8px">To play you have to email the owner at<br>
                   <b style="color:#fff;font-size:1.1em">${OWNER_EMAIL}</b><br>
                   Write your game login in the email:<br>
                   <b id="pay-login" style="color:#7fa"></b><br>
                   The owner emails you back your money code. Type it below and you can play.</p>
                <button id="copy-owner" class="toggle-btn">COPY THE OWNER'S EMAIL ADDRESS</button>
            </div>
            <div id="pay-more-box"><button id="free3">HAVE THE GAME FREE FOR 3 DAYS</button></div>
            <button id="trial7">HAVE A 7-DAY FREE TRIAL</button>
            <div id="pay-note"></div>
            <div id="unlock-row">
                <label for="unlock-input">Got your money code?</label>
                <div class="unlock-line">
                    <input id="unlock-input" type="text" placeholder="e.g. DRIFT-1234" autocomplete="off" />
                    <button id="unlock-btn">PLAY</button>
                </div>
                <div id="unlock-err"></div>
            </div>
        </div>
        <div id="creator-side">
            <button id="creator-btn">I AM CREATOR</button>
            <div id="creator-box">
                <label for="creator-input">Owner email</label>
                <input id="creator-input" type="email" placeholder="owner email" autocomplete="off" />
                <label for="creator-pass" style="margin-top:8px">Password</label>
                <input id="creator-pass" type="password" placeholder="creator password" autocomplete="off" />
                <button id="creator-go">ENTER</button>
                <div id="creator-err"></div>
            </div>
        </div>
    `;

    // ---------- session + storage ----------
    // Who's signed in lives in sessionStorage: it survives reloads in the same tab but is
    // gone when the tab closes, so the next person to open the game gets the login screen
    // instead of walking into the last player's account.
    const session = {
        get() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } },
        set(v) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); } catch (e) {} },
        clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }
    };

    function account() {
        const s = session.get();
        if (!s) return 'guest';
        if (s.type === 'creator') return 'creator';
        const e = s.email || 'guest';
        return e === 'creator' ? 'guest' : e;                                 // (only a creator session is the creator, whatever its email says)
    }
    function isCreator() { return account() === 'creator'; }
    function nsKey(name) { return 'td:' + account() + ':' + name; }

    function readRaw(k, fallback) {
        let raw = null;
        try { raw = localStorage.getItem(k); } catch (e) {}
        if (raw === null) return fallback;
        try { return JSON.parse(raw); } catch (e) { return raw; }
    }
    function writeRaw(k, value) {
        try {
            if (value === undefined || value === null) localStorage.removeItem(k);
            else localStorage.setItem(k, typeof value === 'string' ? value : JSON.stringify(value));
        } catch (e) {}
    }

    function readAccounts() {
        try { return JSON.parse(localStorage.getItem(ACCT_KEY) || '{}') || {}; } catch (e) { return {}; }
    }

    // One-time move from the very old single-save version: one login {email, code} in
    // localStorage 'td_login' and one shared save in 'coins' / 'ownedCars' / 'selectedCar'.
    // Carry both into the per-account system so returning players keep code and progress.
    function migrateOldKeys() {
        try {
            const old = JSON.parse(localStorage.getItem('td_login') || 'null');
            let acct = null;
            if (old && old.type === 'creator') acct = 'creator';
            else if (old && old.email && old.code) {
                acct = String(old.email).trim().toLowerCase();
                const accts = readAccounts();
                if (!Object.prototype.hasOwnProperty.call(accts, acct)) {
                    accts[acct] = old.code;
                    localStorage.setItem(ACCT_KEY, JSON.stringify(accts));
                }
            }
            if (acct) {
                ['coins', 'ownedCars', 'selectedCar'].forEach(function (k) {
                    const v = localStorage.getItem(k);
                    if (v !== null && localStorage.getItem('td:' + acct + ':' + k) === null) {
                        localStorage.setItem('td:' + acct + ':' + k, v);
                    }
                });
            }
        } catch (e) {}
        // Logins used to be remembered forever in localStorage; drop the old one now that it's moved.
        try { localStorage.removeItem('td_login'); } catch (e) {}
    }

    function runUrlSwitches() {
        const where = location.hash + location.search;
        // #creator — while developing on your own machine, sign in as the creator straight
        // away (skips the title, login and money screens). Only honoured on localhost, so
        // the public site never has a password-free door.
        const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
        if (local && /[#?&]creator\b/i.test(where)) {
            session.set({ type: 'creator', ts: Date.now() });
            try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
        }
        // #reset — just sign out. Accounts and saved games are kept.
        if (/[#?&]reset\b/i.test(where)) {
            session.clear();
            try { localStorage.removeItem(REMEMBER_KEY); } catch (e) {}
            try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
        }
        // #wipe — erase EVERYTHING for a totally fresh start: every account (emails +
        // codes), every saved game, every paid flag, and the payment link.
        if (/[#?&]wipe\b/i.test(where)) {
            try {
                const doomed = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    // Everything this game owns: namespaced saves plus its top-level keys.
                    if (k && (k.indexOf('td:') === 0 || k.indexOf('td_') === 0 ||
                              k === 'coins' || k === 'ownedCars' || k === 'selectedCar')) {
                        doomed.push(k);
                    }
                }
                doomed.forEach(function (k) { localStorage.removeItem(k); });
                session.clear();
                Save.wiped = doomed.length;
            } catch (e) {}
            try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
        }
    }

    // ---------- DOM ----------
    function whenBody(fn) {
        if (document.body) fn();
        else document.addEventListener('DOMContentLoaded', fn, { once: true });
    }
    function injectCss() {
        if (document.getElementById('save-gate-css')) return;
        const st = document.createElement('style');
        st.id = 'save-gate-css';
        st.textContent = CSS;
        document.head.appendChild(st);
    }
    function makeGate(id, html) {
        injectCss();
        const el = document.createElement('div');
        el.id = id;
        el.innerHTML = html;
        // Typing in a gate must never reach the game's driving key handlers.
        ['keydown', 'keyup', 'keypress'].forEach(function (t) {
            el.addEventListener(t, function (e) { e.stopPropagation(); });
        });
        document.body.appendChild(el);
        return el;
    }

    function showLoginGate() {
        return new Promise(function (resolve) {
            const gate = makeGate('login-gate', LOGIN_HTML);
            const emailEl = gate.querySelector('#lg-email');
            const codeEl = gate.querySelector('#lg-code');
            const errEl = gate.querySelector('#lg-error');
            // Sign in to an existing account, or create a brand new game
            function submit() {
                const email = emailEl.value.trim().toLowerCase();
                const code = codeEl.value;
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    errEl.textContent = 'Enter a valid email address.'; emailEl.focus(); return;
                }
                if (code.length < 4) {
                    errEl.textContent = 'Your code must be at least 4 characters.'; codeEl.focus(); return;
                }
                const accounts = readAccounts();
                if (Object.prototype.hasOwnProperty.call(accounts, email)) {
                    // Returning player — the code must match, so nobody else can open your game.
                    if (accounts[email] !== code) {
                        errEl.textContent = 'Wrong code for that email.'; codeEl.focus(); codeEl.select(); return;
                    }
                } else {
                    // New email = brand new account with its own fresh game.
                    accounts[email] = code;
                    try { localStorage.setItem(ACCT_KEY, JSON.stringify(accounts)); } catch (e) {}
                }
                session.set({ type: 'player', email: email, ts: Date.now() });
                // No reload needed: nothing has loaded this account's save yet.
                gate.remove();
                resolve();
            }
            gate.querySelector('#lg-enter').addEventListener('click', submit);
            emailEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') codeEl.focus(); });
            codeEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
            setTimeout(function () { emailEl.focus(); }, 50);
        });
    }

    // 'paid2': the money gate was re-armed on 2026-10-24, so old 'paid' flags no longer count.
    // A free trial counts as paid until its day runs out (one trial per account).
    function trialLeftMs() { const until = Number(readRaw(nsKey('trialUntil'), 0)) || 0; return until - Date.now(); }
    function isPaid() { return readRaw(nsKey('paid2'), null) === 'yes' || trialLeftMs() > 0; }

    // $1 pay gate. Payment happens on the payment company's own secure site --
    // this page never asks for card details.
    // Title board: "tokyo-driver1 — PLAY". Shown before the login and pay screens.
    function showSplash() {
        return new Promise(function (resolve) {
            const gate = makeGate('splash-gate', SPLASH_HTML);
            gate.querySelector('#splash-play').addEventListener('click', function () { gate.remove(); resolve(); });
        });
    }

    function showPayGate() {
        return new Promise(function (resolve) {
            const gate = makeGate('pay-gate', PAY_HTML);
            const noteEl = gate.querySelector('#pay-note');
            function unlock() {
                writeRaw(nsKey('paid2'), 'yes');
                gate.remove();
                resolve();
            }

            // The player writes the email themselves in their own Gmail; we show their login so
            // they can put it in the message, and a button to copy the owner's address.
            gate.querySelector('#pay-login').textContent = account() || '(not signed in)';
            gate.querySelector('#copy-owner').addEventListener('click', function () {
                const done = () => { noteEl.textContent = 'Copied. Now open Gmail and send the email to ' + OWNER_EMAIL + '.'; };
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(OWNER_EMAIL).then(done, done); else done();
            });

            // PAY $1 opens the one price ($1, once: the money code never runs out); EMAIL TO PAY drafts the email to the owner
            const plans = gate.querySelector('#pay-plans'), more = gate.querySelector('#pay-more-box');
            const login = account() || '(not signed in)';
            [['mail-once', '$1, once']].forEach(function (pair) {
                const a = gate.querySelector('#' + pair[0]);
                a.href = 'mailto:' + OWNER_EMAIL + '?subject=' + encodeURIComponent('Bay Area Driver: ' + pair[1]) + '&body=' + encodeURIComponent('Hi, I want to play Bay Area Driver: ' + pair[1] + '.\nMy game login: ' + login + '\nPlease send me my money code.');
            });
            gate.querySelector('#pay-btn').addEventListener('click', function () {
                plans.classList.toggle('on'); more.classList.remove('on');
                const link = String(getGlobal(PAY_LINK_KEY, '') || '').trim();
                if (link) window.open(link, '_blank', 'noopener');
                noteEl.textContent = plans.classList.contains('on') ? 'Email ' + OWNER_EMAIL + ' to pay your $1, and type the money code you get back.' : '';
            });
            gate.querySelector('#pay-more').addEventListener('click', function () { more.classList.toggle('on'); });
            // the free trials: one per account; the gate comes back when the days are up
            function startTrial(days) {
                if (readRaw(nsKey('trialUsed'), null) === 'yes') { noteEl.textContent = 'You already had your free trial. Email ' + OWNER_EMAIL + ' for a money code.'; return; }
                writeRaw(nsKey('trialUsed'), 'yes');
                writeRaw(nsKey('trialUntil'), String(Date.now() + days * 86400000));
                gate.remove(); resolve();
            }
            gate.querySelector('#trial7').addEventListener('click', function () { startTrial(7); });
            gate.querySelector('#free3').addEventListener('click', function () { startTrial(3); });
            if (readRaw(nsKey('trialUsed'), null) === 'yes') {                    // one trial per account: the buttons go grey
                ['#trial7', '#free3'].forEach(function (sel) { var b = gate.querySelector(sel); b.disabled = true; b.style.opacity = '0.45'; b.textContent = 'FREE TRIAL ALREADY USED'; });
                if (trialLeftMs() <= 0) noteEl.textContent = 'Your free trial has ended. $1, once, keeps you driving for good.';
            }

            // Unlock code the owner emails to people who've paid. Only its SHA-256 fingerprint
            // is stored here, so reading the page source doesn't reveal it. Honor system:
            // anyone given the code could pass it on.
            const unlockInput = gate.querySelector('#unlock-input');
            const unlockErr = gate.querySelector('#unlock-err');
            async function sha256Hex(text) {
                const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
                return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
            }
            async function tryUnlockCode() {
                // Forgiving: ignore capitals, spaces and dashes ("drift 5744" works)
                const code = unlockInput.value.toUpperCase().replace(/[\s-]+/g, '');
                if (!code) { unlockErr.textContent = 'Type the money code the owner emailed you.'; return; }
                if (!window.crypto || !crypto.subtle) { unlockErr.textContent = 'This browser can\'t check codes.'; return; }
                if (await sha256Hex(code) === UNLOCK_HASH) {
                    unlock();
                } else {
                    unlockErr.textContent = 'That code isn\'t right.';
                    unlockInput.select();
                }
            }
            gate.querySelector('#unlock-btn').addEventListener('click', tryUnlockCode);
            unlockInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryUnlockCode(); });

            // Creator sign-in: the owner email plus the creator password, both checked by hash.
            const box = gate.querySelector('#creator-box');
            const input = gate.querySelector('#creator-input');
            const passInput = gate.querySelector('#creator-pass');
            const err = gate.querySelector('#creator-err');
            gate.querySelector('#creator-btn').addEventListener('click', function () {
                box.style.display = (box.style.display === 'block') ? 'none' : 'block';
                if (box.style.display === 'block') input.focus();
            });
            // Be forgiving: only the letters and digits count, so capitals, spaces, the dots
            // Gmail ignores anyway and even a missing @ (autofill drops it) all still sign in.
            function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
            async function tryCreator() {
                if (!window.crypto || !crypto.subtle) { err.textContent = 'This browser can\'t check the sign-in.'; return; }
                const emailOk = await sha256Hex(norm(input.value)) === CREATOR_EMAIL_HASH;
                const passOk = await sha256Hex(passInput.value.replace(/\s+/g, '')) === CREATOR_PASS_HASH;
                if (emailOk && passOk) {
                    session.set({ type: 'creator', ts: Date.now() });
                    gate.remove();
                    resolve();
                } else {
                    err.textContent = emailOk ? 'That password isn\'t right.' : 'That is not the owner email.';
                    (emailOk ? passInput : input).select();
                }
            }
            gate.querySelector('#creator-go').addEventListener('click', tryCreator);
            input.addEventListener('keydown', function (e) { if (e.key === 'Enter') passInput.focus(); });
            passInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryCreator(); });
        });
    }

    // ---------- public API ----------
    function get(key, fallback) { return readRaw(nsKey(key), fallback); }
    function set(key, value) { writeRaw(nsKey(key), value); }
    function getGlobal(key, fallback) { return readRaw(key, fallback); }
    function setGlobal(key, value) { writeRaw(key, value); }

    // #play=<token> — a link (or QR code) made on the owner's machine that carries a login and
    // a saved game: {t:'creator', p:password} or {e:email, c:code}, plus s: the account's save
    // keys. It signs that account in, writes the save over this browser's copy, and remembers
    // the login on this device (REMEMBER_KEY), so the phone it was scanned on never sees the
    // login screen again (#reset forgets it). The creator password is checked against its
    // hash, the same as typing it in.
    async function sha256HexOf(text) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    async function applyPlayLink() {
        const m = (location.hash + location.search).match(/[#?&]play=([A-Za-z0-9_-]+)/);
        if (!m) return;
        // (drop the token from the address so a reload never applies the save again; keep ?room=)
        const q = location.search.replace(/([?&])play=[^&]*&?/, '$1').replace(/[?&]$/, '');
        try { history.replaceState(null, '', location.pathname + q); } catch (e) {}
        let tok = null;
        try { tok = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return; }
        if (!tok || !window.crypto || !crypto.subtle) return;
        let login = null, acct = null;
        if (tok.t === 'creator' && tok.p && await sha256HexOf(String(tok.p).replace(/\s+/g, '')) === CREATOR_PASS_HASH) { login = { type: 'creator', ts: Date.now() }; acct = 'creator'; }
        else if (tok.e && tok.c) {
            // a player's link: a real email, never 'creator'/'guest', and never another player's
            // account on this device with a different code
            acct = String(tok.e).trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acct)) return;
            const accts = readAccounts();
            if (Object.prototype.hasOwnProperty.call(accts, acct) && accts[acct] !== tok.c) return;
            login = { type: 'player', email: acct, code: tok.c, ts: Date.now() };
            accts[acct] = tok.c;
            try { localStorage.setItem(ACCT_KEY, JSON.stringify(accts)); } catch (e) {}
        }
        if (!login) return;
        // (a player's link carries the save, never the paid/trial flags: those come from the money code)
        const blocked = login.type === 'creator' ? [] : ['paid2', 'trialUntil', 'trialUsed'];
        if (tok.s && typeof tok.s === 'object') Object.keys(tok.s).forEach(function (k) { if (blocked.indexOf(k) === -1) writeRaw('td:' + acct + ':' + k, tok.s[k]); });
        session.set(login);
        try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(login)); } catch (e) {}
    }
    function rememberedLogin() {
        try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null'); } catch (e) { return null; }
    }

    let bootPromise = null;
    function boot() {
        if (bootPromise) return bootPromise;
        bootPromise = new Promise(function (resolve) { whenBody(resolve); }).then(async function () {
            runUrlSwitches();
            await applyPlayLink();
            if (!session.get() && rememberedLogin()) {                         // this device was set up with a #play link
                session.set(rememberedLogin());
                // (an unpaid remembered player would trap the device on the money screen: forget them)
                if (!isCreator() && !isPaid()) { session.clear(); try { localStorage.removeItem(REMEMBER_KEY); } catch (e) {} }
            }
            migrateOldKeys();
            if (!isCreator()) await showSplash();
            if (!session.get()) await showLoginGate();
            if (!isCreator() && !isPaid()) await showPayGate();
            return { account: account(), isCreator: isCreator() };
        });
        return bootPromise;
    }

    // Sign out so someone else can play their own game on this device (old SWITCH PLAYER).
    function signOut() {
        session.clear();
        try { localStorage.removeItem(REMEMBER_KEY); } catch (e) {}   // (a login installed by a #play link is forgotten too)
        location.reload();
    }

    const Save = {
        boot: boot,
        account: account,
        isCreator: isCreator,
        get: get,
        set: set,
        getGlobal: getGlobal,
        setGlobal: setGlobal,
        signOut: signOut,
        wiped: 0
    };
    window.Save = Save;
})();

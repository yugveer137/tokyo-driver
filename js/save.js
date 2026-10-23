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
    // Keep in sync with the old game: the hash is the SHA-256 of the normalised unlock code.
    const CREATOR_GITHUB = 'yugveer137';  // typing this in the creator box plays free
    const OWNER_EMAIL = 'yugveer.18@gmail.com';  // "Contact Owner" emails this address
    const UNLOCK_HASH = '4f84719d0fa3c300fe55c8b1bc6a8b0732310093030ce0d90d370101464fdf56';

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
        #creator-side { position: fixed; right: 22px; top: 50%; transform: translateY(-50%); text-align: right; }
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
            <h2>tokyo-driver1</h2>
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
        <h1>tokyo-driver1</h1>
        <p>Drive from Tokyo to New York. Real exits, seven cities, traffic, day and night.<br>$1 to play, once.</p>
        <button id="splash-play">PLAY</button>
        <small>Questions: ${OWNER_EMAIL}</small>
    `;

    const PAY_HTML = `
        <div class="pay-card">
            <h2>tokyo-driver1</h2>
            <div class="pay-price">$1</div>
            <p class="pay-sub">One-time payment to play. You only pay once.<br>
               Pay with the button, or send $1 to <b style="color:#fff">${OWNER_EMAIL}</b> (PayPal),<br>
               then email that address your game login to get your unlock code.</p>
            <button id="pay-btn">PAY $1</button>
            <div id="pay-note"></div>
            <a id="contact-owner" href="#" style="display:block">EMAIL ${OWNER_EMAIL}</a>
            <div id="unlock-row">
                <label for="unlock-input">Have an unlock code?</label>
                <div class="unlock-line">
                    <input id="unlock-input" type="text" placeholder="e.g. DRIFT-1234" autocomplete="off" />
                    <button id="unlock-btn">UNLOCK</button>
                </div>
                <div id="unlock-err"></div>
            </div>
        </div>
        <div id="creator-side">
            <button id="creator-btn">I AM CREATOR</button>
            <div id="creator-box">
                <label for="creator-input">GitHub account</label>
                <input id="creator-input" type="text" placeholder="your GitHub username" autocomplete="off" />
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
        return s.type === 'creator' ? 'creator' : (s.email || 'guest');
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
        // #reset — just sign out. Accounts and saved games are kept.
        if (/[#?&]reset\b/i.test(where)) {
            session.clear();
            try { history.replaceState(null, '', location.pathname); } catch (e) {}
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
            try { history.replaceState(null, '', location.pathname); } catch (e) {}
        }
        // #creator / ?creator (bookmark it): sign in as creator, skipping both gates.
        if (!session.get() && /[#?&]creator\b/i.test(where)) {
            session.set({ type: 'creator', ts: Date.now() });
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

    function isPaid() { return readRaw(nsKey('paid'), null) === 'yes'; }

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
                writeRaw(nsKey('paid'), 'yes');
                gate.remove();
                resolve();
            }

            // The contact link always carries the player's login so the owner knows who paid
            const subject = 'tokyo-driver1 - paying $1';
            const body = 'Hi! I want to pay $1 to play tokyo-driver1.\n\nMy game login: ' +
                (account() || '(not signed in)') + '\n';
            const contact = gate.querySelector('#contact-owner');
            contact.href = 'mailto:' + OWNER_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);

            gate.querySelector('#pay-btn').addEventListener('click', function () {
                const link = String(getGlobal(PAY_LINK_KEY, '') || '').trim();
                if (!link) {
                    // No payment link set by the owner yet: the email is the way to pay
                    noteEl.textContent = 'Send $1 to ' + OWNER_EMAIL + ' and email your login; you get an unlock code back.';
                    window.location.href = contact.href;
                    return;
                }
                window.open(link, '_blank', 'noopener');
                noteEl.textContent = 'After paying, email ' + OWNER_EMAIL + ' your game login to get your unlock code.';
            });

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
                if (!code) { unlockErr.textContent = 'Type the code the owner emailed you.'; return; }
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

            // Creator sign: type the GitHub account to play without paying.
            const box = gate.querySelector('#creator-box');
            const input = gate.querySelector('#creator-input');
            const err = gate.querySelector('#creator-err');
            gate.querySelector('#creator-btn').addEventListener('click', function () {
                box.style.display = (box.style.display === 'block') ? 'none' : 'block';
                if (box.style.display === 'block') input.focus();
            });
            // Be forgiving: ignore spaces, a leading @, and capitals. Phone keyboards and
            // autocorrect love to slip a space into "yugveer 137".
            function norm(s) { return String(s).replace(/\s+/g, '').replace(/^@+/, '').toLowerCase(); }
            function tryCreator() {
                if (norm(input.value) === norm(CREATOR_GITHUB)) {
                    session.set({ type: 'creator', ts: Date.now() });
                    gate.remove();
                    resolve();
                } else {
                    err.textContent = 'That is not the creator account.';
                    input.select();
                }
            }
            gate.querySelector('#creator-go').addEventListener('click', tryCreator);
            input.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryCreator(); });
        });
    }

    // ---------- public API ----------
    function get(key, fallback) { return readRaw(nsKey(key), fallback); }
    function set(key, value) { writeRaw(nsKey(key), value); }
    function getGlobal(key, fallback) { return readRaw(key, fallback); }
    function setGlobal(key, value) { writeRaw(key, value); }

    let bootPromise = null;
    function boot() {
        if (bootPromise) return bootPromise;
        bootPromise = new Promise(function (resolve) { whenBody(resolve); }).then(async function () {
            runUrlSwitches();
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

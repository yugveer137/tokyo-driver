// tokyo-driver1 v2 — HUD, start menu, settings, garage, fast travel, keyboard + touch input.
window.UI = (function () {
    const U = { area: 'Open country', limit: 65 };
    const $ = (id) => document.getElementById(id);
    let speedEl, gearEl, clockEl, areaEl, carEl, fpsEl, coinsEl, limitEl, toastTimer;

    const keyMap = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'drift' };

    // ---------- the free trial: a button that tells how long is left, and the end of it ----------
    // Only someone playing on a free trial sees the button. When the time is up the game stops
    // for them: their coins and cars are saved, a notice covers the screen, and the page loads
    // again, where Save's money screen is waiting.
    function timeLeft(ms) {
        const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
        const n = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');
        if (d > 0) return n(d, 'day') + ' and ' + n(h, 'hour');
        if (h > 0) return n(h, 'hour') + ' and ' + n(m, 'minute');
        return m > 0 ? n(m, 'minute') + ' and ' + n(s % 60, 'second') : n(s, 'second');
    }
    function initTrial() {
        const btn = $('trial-btn');
        let showing = 0, ended = false;
        function refresh() {
            const t = Save.trial();
            btn.style.display = t && Game.started ? 'block' : 'none';
            if (!t || ended) return;
            if (t.leftMs <= 0) {
                ended = true;
                try { Game.save(); } catch (e) { /* (nothing to save yet) */ }
                $('trial-over').style.display = 'flex';
                setTimeout(() => location.reload(), 4000);
                return;
            }
            const ask = 'SEE YOUR ' + (t.days ? t.days + '-DAY' : 'FREE') + ' TRIAL: HOW MUCH TIME IS LEFT?';
            // (the last five minutes it counts down by itself, so the end is no surprise)
            btn.textContent = showing > Date.now() || t.leftMs < 300000 ? 'FREE TRIAL: ' + timeLeft(t.leftMs) + ' left' : ask;
        }
        btn.onclick = () => { btn.blur(); showing = Date.now() + 8000; refresh(); };
        setInterval(refresh, 1000); refresh();
    }

    U.init = function () {
        initTrial();
        speedEl = $('hud-speed'); gearEl = $('hud-gear'); clockEl = $('hud-clock'); areaEl = $('hud-area');
        carEl = $('hud-car'); fpsEl = $('hud-fps'); coinsEl = $('hud-coins'); limitEl = $('hud-limit-v');

        window.addEventListener('keydown', e => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
            if (!Game.started) return;
            if (keyMap[e.code]) { Car.keys[keyMap[e.code]] = true; e.preventDefault(); }
            if (e.repeat) return;
            if (e.code === 'KeyZ') Car.gearUp();
            if (e.code === 'KeyX') Car.gearDown();
            if (e.code === 'KeyC') { if (window.Train && Train.riding) Train.toggleView(); else Car.toggleView(); }
            if (e.code === 'KeyB') Car.boostStart();
            if (e.code === 'KeyG' && window.Walk) Walk.toggle();
            if (e.code === 'KeyN') Sky.speed = Sky.speed === 1 ? 12 : 1;
            if (e.code === 'KeyV') Features.toggleRain();
            if (e.code === 'KeyK') Features.toggleCruise();
            if (e.code === 'KeyQ') Features.setSignal('left');
            // E on foot: a door or a counter here (places.js), else the robbery's doors
            if (e.code === 'KeyE') { if (window.Walk && Walk.active) { if (!(window.Places && Places.use())) Robbery.rob(); } else Features.setSignal('right'); }
            if (e.code === 'KeyH') Features.setSignal('hazard');
            if (e.code === 'KeyT') Train.toggle();
            if (e.code === 'KeyP' && window.Shop) Shop.parkKey();           // back into your garage, when stopped by its drive
            if (e.code === 'KeyR') Car.reset();
            if (e.code === 'KeyM') { SelfDrive.draw(); $('map-modal').classList.toggle('open'); }
            if (e.code === 'Escape') U.closeModals();
        });
        window.addEventListener('keyup', e => { if (keyMap[e.code]) Car.keys[keyMap[e.code]] = false; if (e.code === 'KeyE' && window.Robbery) Robbery.release(); });

        // menu
        $('continue-btn').onclick = () => U.enterDriveReady();
        $('newgame-btn').onclick = () => { if (confirm('Start a new game? Coins and cars are reset for this account.')) { Game.newGame(); Game.selectCar('starter'); U.enterDriveReady(); } };
        $('settings-btn').onclick = () => { $('menu-main').style.display = 'none'; $('settings-panel').style.display = 'block'; refreshSettings(); };
        $('settings-back').onclick = () => { $('menu-main').style.display = 'block'; $('settings-panel').style.display = 'none'; };
        $('multiplayer-btn').onclick = () => Multiplayer.showMenu();
        $('mode-toggle').onclick = () => { Robbery.setEnabled(!Robbery.isOn()); refreshSettings(); };
        $('switch-player-btn').onclick = () => Save.signOut();
        $('paylink-save').onclick = () => {
            const v = $('paylink-input').value.trim();
            if (v && !/^https:\/\//i.test(v)) { $('paylink-note').textContent = 'The link must start with https://'; return; }
            Save.setGlobal('td_pay_link', v); $('paylink-note').textContent = v ? 'Saved. Players see this link on the $1 screen.' : 'Cleared.';
        };
        $('drive-btn').onclick = () => { $('drive-btn').style.display = 'none'; Game.start(); U.toast('Drive safe. Take Exit 1 for San Francisco.'); };

        // side buttons + modals
        $('garage-btn').onclick = () => { U.renderGarage(); $('garage-modal').classList.add('open'); };
        $('travel-btn').onclick = () => { U.renderTravel(); $('travel-modal').classList.add('open'); };
        $('delivery-btn').onclick = () => { if (Game.started) Features.startDelivery(); };
        $('cruise-btn').onclick = () => { if (Game.started) Features.toggleCruise(); };
        $('rain-btn').onclick = () => Features.toggleRain();
        $('race-btn').onclick = () => { if (Game.started) Races.startStreet(); };
        $('train-btn').onclick = () => { if (Game.started) Train.toggle(); };
        $('map-btn').onclick = () => { SelfDrive.draw(); $('map-modal').classList.add('open'); };
        // the Waymo's SELF DRIVE button: open the map to pick a city, then a street
        $('selfdrive-btn').onclick = () => { SelfDrive.showOverview(); $('map-modal').classList.add('open'); U.toast('Click a city for its street map, then click where to go', 3000); };
        $('map-back').onclick = () => SelfDrive.showOverview();
        $('friends-btn').onclick = () => Robbery.callFriends();             // robbery mode only (shown by Robbery.setEnabled)
        $('msg-btn').onclick = () => { Robbery.renderMessages(); $('msg-modal').classList.add('open'); };
        $('escape-btn').onclick = () => Robbery.sneak();                        // shown only while in jail
        $('escape-big').onclick = () => Robbery.sneak();
        $('next-city').onclick = () => Robbery.nextCity();
        $('getmoney-big').onclick = () => Robbery.getMoney();
        $('chat-alert-reply').onclick = () => { $('chat-alert').classList.remove('on'); Robbery.renderMessages(); $('msg-modal').classList.add('open'); };
        document.querySelectorAll('#msg-who button').forEach((b, i) => b.onclick = () => { Robbery.msgWho = i; Robbery.renderMessages(); });
        const sendMsg = () => { const t = $('msg-text').value.trim(); if (!t) return; Robbery.message(Robbery.msgWho || 0, t); $('msg-text').value = ''; Robbery.renderMessages(); };
        $('msg-send').onclick = sendMsg;
        $('msg-text').addEventListener('keydown', e => { if (e.key === 'Enter') { sendMsg(); e.stopPropagation(); } });
        // paste or drop a screenshot into the chat
        const takeImage = (files) => { const f = [...(files || [])].find(x => x.type && x.type.startsWith('image/')); if (!f) return false; const rd = new FileReader(); rd.onload = () => { Robbery.messageImage(Robbery.msgWho || 0, rd.result); Robbery.renderMessages(); }; rd.readAsDataURL(f); return true; };
        $('msg-modal').addEventListener('paste', e => { const items = e.clipboardData && e.clipboardData.files; if (takeImage(items)) e.preventDefault(); });
        $('msg-modal').addEventListener('dragover', e => e.preventDefault());
        $('msg-modal').addEventListener('drop', e => { e.preventDefault(); takeImage(e.dataTransfer && e.dataTransfer.files); });
        $('map-cancel').onclick = () => { SelfDrive.cancel(); U.closeModals(); };
        $('osm-btn').onclick = () => { if (Game.started) OSM.enter(); };
        $('osm-exit').onclick = () => OSM.exit();
        $('fwrace-btn').onclick = () => { if (Game.started) Races.startFreeway(); };
        $('lane-btn').onclick = () => { if (Game.started) Features.toggleLaneLock(); };
        $('front-btn').onclick = () => { if (Game.started) Features.toggleFrontLock(); };
        $('view-btn').onclick = () => { if (window.Train && Train.riding) Train.toggleView(); else Car.toggleView(); };
        $('walk-btn').onclick = () => { if (Game.started && window.Walk) Walk.toggle(); };
        $('boost-btn').onclick = () => { if (Game.started) Car.boostStart(); };
        $('fix-btn').onclick = () => { if (Game.started) Features.fixAtWorkshop(); };
        $('damage-btn').onclick = () => { Features.renderDamage(); $('damage-modal').classList.add('open'); };
        $('saves-btn').onclick = () => { Save.backup(); U.renderSaves(); $('saves-modal').classList.add('open'); };
        $('reset-btn').onclick = () => { if (Game.started) Car.reset(); };
        $('tow-btn').onclick = () => { if (Game.started) Features.callTow(); };
        document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).classList.remove('open'));

        // phones: the button panel folds behind MENU, and closes again once a button is tapped
        $('menu-toggle').onclick = () => { const open = $('side-btns').classList.toggle('open'); $('menu-toggle').textContent = open ? 'MENU ▴' : 'MENU ▾'; };
        document.querySelectorAll('.side-btn').forEach(b => b.addEventListener('click', () => { $('side-btns').classList.remove('open'); $('menu-toggle').textContent = 'MENU ▾'; }));
        // touch controls on touch devices
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
            $('touch').classList.add('on');
            const bind = (id, key) => {
                const el = $(id);
                const on = (e) => { e.preventDefault(); Car.keys[key] = true; };
                const off = (e) => { e.preventDefault(); Car.keys[key] = false; };
                el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off);
                el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
            };
            bind('t-left', 'left'); bind('t-right', 'right'); bind('t-brake', 'back'); bind('t-gas', 'fwd'); bind('t-drift', 'drift');
        }
    };

    function refreshSettings() {
        $('mode-toggle').textContent = (window.Robbery && Robbery.isOn()) ? 'ROBBERY' : 'DRIVE';
        $('who-label').textContent = Save.isCreator() ? 'creator' : Save.account();
        $('paylink-row').style.display = Save.isCreator() ? 'block' : 'none';
        $('paylink-input').value = Save.getGlobal('td_pay_link', '') || '';
    }

    U.showMenu = function () { $('start-screen').style.display = 'flex'; };
    U.enterDriveReady = function () { $('start-screen').style.display = 'none'; $('drive-btn').style.display = 'block'; };
    // The SAVES panel: the backups of this account's save (save.js), newest first. RESTORE puts
    // one back and reloads the game on it.
    U.renderSaves = function () {
        const body = $('saves-body'); body.innerHTML = '';
        const list = Save.backups();
        const say = document.createElement('div'); say.className = 'own-row';
        say.textContent = list.length ? 'The game keeps copies of your save as you play. Pick one to go back to it: your coins, cars, houses and things as they were then.' : 'No saved copies yet. One is made when a game starts and every ten minutes after.';
        body.appendChild(say);
        const today = new Date().toDateString();
        list.forEach(b => {
            const d = new Date(b.at), day = d.toDateString() === today ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const row = document.createElement('div'); row.className = 'own-row';
            const text = document.createElement('span');
            text.textContent = day + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '   ' + b.coins.toLocaleString('en-US') + ' coins, ' + b.cars + (b.cars === 1 ? ' car' : ' cars') + (b.houses ? ', ' + b.houses + (b.houses === 1 ? ' house' : ' houses') : '');
            const go = document.createElement('button'); go.className = 'toggle-btn'; go.textContent = 'RESTORE';
            go.onclick = () => {
                if (!confirm('Go back to this save? You will have ' + b.coins.toLocaleString('en-US') + ' coins again. The save you have now is kept in this list too.')) return;
                if (Save.restore(b.at)) location.reload(); else U.toast('That save could not be put back.', 3000);
            };
            row.appendChild(text); row.appendChild(go); body.appendChild(row);
        });
    };

    U.closeModals = function () { document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); };

    U.toast = function (text, ms) {
        const t = $('toast'); t.textContent = text; t.classList.add('show');
        clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms || 1800);
    };

    U.renderGarage = function () {
        const grid = $('cars-grid'); grid.innerHTML = '';
        $('garage-coins').textContent = Game.state.coins + ' coins';
        const robbery = !!(window.Robbery && Robbery.isOn());
        Object.entries(CARS).forEach(([id, d]) => {
            const owned = Game.state.ownedCars.includes(id), selected = Game.state.selectedCar === id;
            const locked = d.robberyOnly && !robbery;                       // the Robber's Car: only in ROBBERY mode (Settings > Game mode)
            const card = document.createElement('div');
            card.className = 'car-card' + (selected ? ' selected' : '');
            const col = '#' + (d.bodyColor || d.color || 0x888888).toString(16).padStart(6, '0');
            card.innerHTML = `
                <div class="car-preview" style="background: linear-gradient(135deg, ${col}, #222);">🚗</div>
                <h3>${d.name}</h3>
                <div class="car-stats">
                    <div><span>Speed</span><div class="stat-bar"><div class="stat-fill" style="width:${Math.min(100, d.maxSpeed / 3)}%"></div></div></div>
                    <div><span>Accel</span><div class="stat-bar"><div class="stat-fill" style="width:${Math.min(100, d.acceleration * 2)}%"></div></div></div>
                    <div><span>Handling</span><div class="stat-bar"><div class="stat-fill" style="width:${Math.min(100, d.handling * 4500)}%"></div></div></div>
                </div>
                ${owned ? '' : `<div class="car-price">${d.price} coins</div>`}${d.robberyOnly ? '<div class="car-price">ROBBERY mode only</div>' : ''}`;
            const btn = document.createElement('button');
            btn.className = 'car-btn ' + (owned ? (selected ? 'selected-btn' : 'select-btn') : 'buy-btn');
            btn.textContent = locked ? 'ROBBERY ONLY' : owned ? (selected ? 'EQUIPPED' : 'SELECT') : 'BUY';
            btn.disabled = locked || selected || (!owned && Game.state.coins < d.price);
            btn.onclick = () => {
                if (owned) { Game.selectCar(id); U.toast('Now driving the ' + d.name); }
                else if (Game.buyCar(id)) { Game.selectCar(id); U.toast('Bought the ' + d.name + '!'); }
                U.renderGarage();
            };
            card.appendChild(btn);
            grid.appendChild(card);
        });
    };

    U.renderTravel = function () {
        const list = $('travel-list'); list.innerHTML = '';
        World.cities.forEach(c => {
            const b = document.createElement('button');
            b.className = 'travel-btn';
            b.innerHTML = `${c.name}<small>${c.sub || ''} · ${c.exitNumber !== undefined ? 'Exit ' + c.exitNumber + ' · ' + (c.side === 1 ? 'northbound side' : 'southbound side') : 'over the Golden Gate'}</small>`;   // (Sausalito has no exit of its own)
            b.onclick = () => { U.closeModals(); World.travelTo(c); U.toast('On I-80, one mile before the ' + c.name + ' exit'); };
            list.appendChild(b);
        });
    };

    U.update = function (fps) {
        if (!Car.body) return;
        speedEl.textContent = Math.round(Car.mph);
        gearEl.textContent = CFG.GEARS[Car.gear].name;
        clockEl.textContent = Sky.clockText();
        areaEl.textContent = U.area;
        carEl.textContent = Car.data.name;
        coinsEl.textContent = Game.state.coins;
        limitEl.textContent = U.limit;
        if (fps !== undefined) fpsEl.textContent = Math.round(fps) + ' fps';
    };

    return U;
})();

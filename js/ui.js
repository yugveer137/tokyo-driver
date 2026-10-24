// tokyo-driver1 v2 — HUD, start menu, settings, garage, fast travel, keyboard + touch input.
window.UI = (function () {
    const U = { area: 'Open country', limit: 65 };
    const $ = (id) => document.getElementById(id);
    let speedEl, gearEl, clockEl, areaEl, carEl, fpsEl, coinsEl, limitEl, toastTimer;

    const keyMap = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'drift' };

    U.init = function () {
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
            if (e.code === 'KeyF' && window.GameAudio) GameAudio.honk();
            if (e.code === 'KeyN') Sky.speed = Sky.speed === 1 ? 12 : 1;
            if (e.code === 'KeyV') Features.toggleRain();
            if (e.code === 'KeyK') Features.toggleCruise();
            if (e.code === 'KeyQ') Features.setSignal('left');
            if (e.code === 'KeyE') { if (window.Walk && Walk.active) Robbery.rob(); else Features.setSignal('right'); }
            if (e.code === 'KeyH') Features.setSignal('hazard');
            if (e.code === 'KeyT') Train.toggle();
            if (e.code === 'KeyR') Car.reset();
            if (e.code === 'KeyM') { SelfDrive.draw(); $('map-modal').classList.toggle('open'); }
            if (e.code === 'Escape') U.closeModals();
        });
        window.addEventListener('keyup', e => { if (keyMap[e.code]) Car.keys[keyMap[e.code]] = false; });

        // menu
        $('continue-btn').onclick = () => U.enterDriveReady();
        $('newgame-btn').onclick = () => { if (confirm('Start a new game? Coins and cars are reset for this account.')) { Game.newGame(); Game.selectCar('starter'); U.enterDriveReady(); } };
        $('settings-btn').onclick = () => { $('menu-main').style.display = 'none'; $('settings-panel').style.display = 'block'; refreshSettings(); };
        $('settings-back').onclick = () => { $('menu-main').style.display = 'block'; $('settings-panel').style.display = 'none'; };
        $('multiplayer-btn').onclick = () => Multiplayer.showMenu();
        $('sound-toggle').onclick = () => { if (window.GameAudio) { GameAudio.setEnabled(!GameAudio.isEnabled()); refreshSettings(); } };
        $('mode-toggle').onclick = () => { Robbery.setEnabled(!Robbery.isOn()); refreshSettings(); };
        $('switch-player-btn').onclick = () => Save.signOut();
        $('paylink-save').onclick = () => {
            const v = $('paylink-input').value.trim();
            if (v && !/^https:\/\//i.test(v)) { $('paylink-note').textContent = 'The link must start with https://'; return; }
            Save.setGlobal('td_pay_link', v); $('paylink-note').textContent = v ? 'Saved. Players see this link on the $1 screen.' : 'Cleared.';
        };
        $('drive-btn').onclick = () => { $('drive-btn').style.display = 'none'; Game.start(); U.toast('Drive safe. Take Exit 1 for Tokyo.'); };

        // side buttons + modals
        $('garage-btn').onclick = () => { U.renderGarage(); $('garage-modal').classList.add('open'); };
        $('travel-btn').onclick = () => { U.renderTravel(); $('travel-modal').classList.add('open'); };
        $('honk-btn').onclick = () => { if (window.GameAudio && Game.started) GameAudio.honk(); };
        $('delivery-btn').onclick = () => { if (Game.started) Features.startDelivery(); };
        $('cruise-btn').onclick = () => { if (Game.started) Features.toggleCruise(); };
        $('rain-btn').onclick = () => Features.toggleRain();
        $('race-btn').onclick = () => { if (Game.started) Races.startStreet(); };
        $('train-btn').onclick = () => { if (Game.started) Train.toggle(); };
        $('map-btn').onclick = () => { SelfDrive.draw(); $('map-modal').classList.add('open'); };
        $('map-cancel').onclick = () => { SelfDrive.cancel(); U.closeModals(); };
        $('osm-btn').onclick = () => { if (Game.started) OSM.enter(); };
        $('osm-exit').onclick = () => OSM.exit();
        $('fwrace-btn').onclick = () => { if (Game.started) Races.startFreeway(); };
        $('lane-btn').onclick = () => { if (Game.started) Features.toggleLaneLock(); };
        $('front-btn').onclick = () => { if (Game.started) Features.toggleFrontLock(); };
        $('view-btn').onclick = () => { if (window.Train && Train.riding) Train.toggleView(); else Car.toggleView(); };
        $('music-btn').onclick = () => { U.renderMusic(); $('music-modal').classList.add('open'); };
        $('music-stop').onclick = () => { Music.stop(); U.renderMusic(); };
        $('walk-btn').onclick = () => { if (Game.started && window.Walk) Walk.toggle(); };
        $('boost-btn').onclick = () => { if (Game.started) Car.boostStart(); };
        $('fix-btn').onclick = () => { if (Game.started) Features.fixAtWorkshop(); };
        $('tires-btn').onclick = () => { Features.renderTires(); $('tires-modal').classList.add('open'); };
        $('reset-btn').onclick = () => { if (Game.started) Car.reset(); };
        $('tow-btn').onclick = () => { if (Game.started) Features.callTow(); };
        document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).classList.remove('open'));

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
        $('sound-toggle').textContent = (window.GameAudio && !GameAudio.isEnabled()) ? 'OFF' : 'ON';
        $('mode-toggle').textContent = (window.Robbery && Robbery.isOn()) ? 'ROBBERY' : 'DRIVE';
        $('who-label').textContent = Save.isCreator() ? 'creator' : Save.account();
        $('paylink-row').style.display = Save.isCreator() ? 'block' : 'none';
        $('paylink-input').value = Save.getGlobal('td_pay_link', '') || '';
    }

    U.renderMusic = function () {
        const list = $('music-list'); if (!list || !window.Music) return;
        list.innerHTML = '';
        Music.songs.forEach(sg => {
            const b = document.createElement('button'); b.className = 'menu-btn'; b.style.margin = '6px 0';
            const on = Music.current === sg && Music.playing;
            b.textContent = (on ? '■  ' : '▶  ') + sg.title + '   —   ' + sg.bpm + ' bpm';
            if (on) b.style.background = 'linear-gradient(135deg, #ffd21e, #ff9a00)';
            b.onclick = () => { if (on) Music.stop(); else Music.play(sg.id); U.renderMusic(); };
            list.appendChild(b);
        });
        const note = document.createElement('div'); note.style.cssText = 'opacity:0.7;font-size:0.8rem;margin-top:8px;line-height:1.4';
        note.textContent = 'Four original instrumental rap beats the game plays live (drums, 808s, synth).';
        list.appendChild(note);
    };
    U.showMenu = function () { $('start-screen').style.display = 'flex'; };
    U.enterDriveReady = function () { $('start-screen').style.display = 'none'; $('drive-btn').style.display = 'block'; };
    U.closeModals = function () { document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); };

    U.toast = function (text, ms) {
        const t = $('toast'); t.textContent = text; t.classList.add('show');
        clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms || 1800);
    };

    U.renderGarage = function () {
        const grid = $('cars-grid'); grid.innerHTML = '';
        $('garage-coins').textContent = Game.state.coins + ' coins';
        Object.entries(CARS).forEach(([id, d]) => {
            const owned = Game.state.ownedCars.includes(id), selected = Game.state.selectedCar === id;
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
                ${owned ? '' : `<div class="car-price">${d.price} coins</div>`}`;
            const btn = document.createElement('button');
            btn.className = 'car-btn ' + (owned ? (selected ? 'selected-btn' : 'select-btn') : 'buy-btn');
            btn.textContent = owned ? (selected ? 'EQUIPPED' : 'SELECT') : 'BUY';
            btn.disabled = selected || (!owned && Game.state.coins < d.price);
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
            b.innerHTML = `${c.name}<small>${c.sub || ''} · Exit ${c.exitNumber} · ${c.side === 1 ? 'northbound side' : 'southbound side'}</small>`;
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

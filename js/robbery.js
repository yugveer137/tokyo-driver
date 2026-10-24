// tokyo-driver1 v2 — ROBBERY mode (Settings > Game mode). The same world, but each level is a
// city with houses to rob: a glowing marker stands at each front door, you park, get out (G),
// walk up and hold E for six seconds to grab the loot. That alerts the police: get 500 m away
// and the loot is yours, get caught and you lose it. Rob every house in the level and the next
// city opens. San Francisco's level includes the big downtown tower, worth the most.
window.Robbery = (function () {
    const R = { on: false, level: 1, done: [], targets: [], loot: 0, active: null };
    let scene, hud, lastHint = 0, pulse = 0;
    const ROB_TIME = 6, REACH = 5;

    // one level per city along the route (I-80 first, then the I-15 loop)
    function cityForLevel(n) {
        const list = World.freeways.flatMap(fw => fw.cities);
        return list[(n - 1) % list.length];
    }
    // deterministic pick of houses in a city: a block corner each, plus the landmark in SF
    function makeTargets(city, level) {
        let seed = level * 7919 + 13;
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        const n = Math.min(3 + Math.floor(level / 2), 7);
        const out = [];
        for (let k = 0; k < n; k++) {
            const i = Math.floor(rnd() * city.rows), j = Math.floor(rnd() * city.cols);
            const lx = city.streetX(j) + city.street / 2 + 3.2, lz = city.streetZ(i) + city.pitch / 2;
            const p = city.toWorld(lx, lz);
            out.push({ id: level + ':' + k, p, name: city.streets.ns[j % city.streets.ns.length] + ' house', value: 80 + level * 40 + Math.floor(rnd() * 60) });
        }
        if (city.id === 'sf') { const p = city.toWorld((city.lmX || 0) - 14, (city.lmZ || 0)); out.push({ id: level + ':tower', p, name: 'the Transamerica tower vault', value: 600, big: true }); }
        return out;
    }

    function marker(t) {
        const g = new THREE.Group();
        const col = t.big ? 0xffd21e : 0xff5a3c;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.18, 8, 32), new THREE.MeshBasicMaterial({ color: col })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.3; g.add(ring);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 30, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, side: THREE.DoubleSide })); beam.position.y = 15; g.add(beam);
        const y = Terrain.height(t.p.x, t.p.z);
        g.position.set(t.p.x, y, t.p.z);
        scene.add(g); return g;
    }
    function clearMarkers() { R.targets.forEach(t => { if (t.mesh) scene.remove(t.mesh); }); }
    function load() {
        const st = Save.get('robbery', null) || { level: 1, done: [] };
        R.level = st.level || 1; R.done = st.done || [];
    }
    function save() { Save.set('robbery', { level: R.level, done: R.done }); }
    function setup() {
        clearMarkers();
        const city = cityForLevel(R.level); R.city = city;
        R.targets = makeTargets(city, R.level).map(t => Object.assign(t, { robbed: R.done.indexOf(t.id) !== -1 }));
        R.targets.forEach(t => { if (!t.robbed) t.mesh = marker(t); });
        updateHud();
    }
    function updateHud() {
        if (!hud) hud = document.getElementById('rob-hud'); if (!hud) return;
        if (!R.on) { hud.textContent = ''; return; }
        const left = R.targets.filter(t => !t.robbed).length;
        hud.textContent = 'ROBBERY — Level ' + R.level + ': ' + R.city.name + ' — ' + (R.targets.length - left) + '/' + R.targets.length + ' robbed' + (R.active ? ' — ROBBING ' + Math.ceil(ROB_TIME - R.active.t) + 's' : '') + (Police.state === 'chase' && Police.wanted ? ' — WANTED: lose the police!' : '');
    }

    R.setEnabled = function (on) {
        R.on = !!on; Save.set('mode', R.on ? 'robbery' : 'drive');
        if (R.on) { load(); setup(); UI.toast('ROBBERY mode. Level ' + R.level + ': ' + R.city.name + '. Fast travel there, find the glowing doors, get out (G) and hold E.', 5000); }
        else { clearMarkers(); R.targets = []; R.active = null; updateHud(); UI.toast('Back to driving.'); }
    };
    R.isOn = function () { return R.on; };

    // the nearest unrobbed house to someone on foot
    function nearTarget(pos) { let best = null, bd = REACH; R.targets.forEach(t => { if (t.robbed) return; const d = Math.hypot(t.p.x - pos.x, t.p.z - pos.z); if (d < bd) { bd = d; best = t; } }); return best; }

    R.rob = function () {                                                  // E on foot
        if (!R.on || !window.Walk || !Walk.active) return;
        if (R.active) return;
        const t = nearTarget(Walk.pos);
        if (!t) { UI.toast('Walk up to a glowing door first'); return; }
        R.active = { house: t, t: 0 };
        UI.toast('Robbing ' + t.name + '… stay by the door', 2000);
    };

    R.update = function (dt) {
        if (!R.on) return;
        pulse += dt;
        R.targets.forEach(t => { if (t.mesh) { t.mesh.children[0].scale.setScalar(1 + 0.15 * Math.sin(pulse * 4)); t.mesh.visible = t.mesh.position.distanceTo(Car.body.position) < 1500; } });
        const walking = window.Walk && Walk.active;
        if (R.active) {
            const a = R.active;
            if (!walking || Math.hypot(a.house.p.x - Walk.pos.x, a.house.p.z - Walk.pos.z) > REACH + 1) { R.active = null; UI.toast('You left the door — robbery aborted', 2000); updateHud(); return; }
            a.t += dt;
            if (a.t >= ROB_TIME) {
                const target = a.house; R.active = null;
                target.robbed = true; R.done.push(target.id); if (target.mesh) { scene.remove(target.mesh); target.mesh = null; }
                R.loot += target.value; Game.addCoins(target.value); save();
                UI.toast('Got ' + target.value + ' coins from ' + target.name + '! The police are coming — get to the car and lose them.', 4000);
                if (window.GameAudio) GameAudio.honk();
                Police.alert();
                if (R.targets.every(x => x.robbed)) {
                    const bonus = 200 + R.level * 100; Game.addCoins(bonus);
                    R.level += 1; R.done = []; save();
                    UI.toast('Level complete! +' + bonus + ' bonus. Level ' + R.level + ': ' + cityForLevel(R.level).name + ' is open — fast travel there.', 6000);
                    setup();
                }
            }
        } else if (walking) {
            const now = performance.now();
            const t = nearTarget(Walk.pos);
            if (t && now - lastHint > 3000) { UI.toast('E: rob ' + t.name + ' (' + t.value + ' coins)', 1500); lastHint = now; }
        }
        updateHud();
    };
    // the police caught you while wanted: the loot from this run is gone
    R.onCaught = function () { if (!R.on || !R.loot) return; const lost = Math.min(R.loot, Game.state.coins); Game.addCoins(-lost); UI.toast('Busted! The police took back ' + lost + ' coins of loot.', 4000); R.loot = 0; };
    R.onEscaped = function () { if (!R.on || !R.loot) return; UI.toast('You got away with ' + R.loot + ' coins of loot!', 3500); R.loot = 0; };

    R.init = function (sc) { scene = sc; if (Save.get('mode', 'drive') === 'robbery') setTimeout(() => R.setEnabled(true), 500); };
    return R;
})();

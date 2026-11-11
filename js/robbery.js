// tokyo-driver1 v2 — ROBBERY mode (Settings > Game mode). The same world, but each level is a
// city with houses to rob: a glowing marker stands at each front door, you park, get out (G),
// walk up and hold E for six seconds to grab the loot. That alerts the police: get 500 m away
// and the loot is yours, get caught and you lose it. Rob every house in the level and the next
// city opens. San Francisco's level includes the big downtown tower, worth the most.
window.Robbery = (function () {
    const R = { on: false, level: 1, done: [], targets: [], loot: 0, active: null, inside: null, friends: [], crew: null };
    let scene, hud, lastHint = 0, pulse = 0;
    const ROB_TIME = 4, REACH = 3.2, NOISE_RUN = 0.9, NOISE_NEAR = 0.3, NOISE_DRAWER = 0.18;

    // one level per city and town along the route (US-101 first, then I-880)
    function cityForLevel(n) {
        const list = World.freeways.flatMap(fw => fw.cities);
        return list[(n - 1) % list.length];
    }
    // deterministic pick of houses in the suburb, plus the landmark vault in SF (robbed from
    // the door, the old way: no going in)
    function makeTargets(city, level) {
        let seed = level * 7919 + 13;
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        const n = Math.min(3 + Math.floor(level / 2), 7);
        const out = [], used = {};
        for (let k = 0; k < n * 4 && out.length < n; k++) {
            let plan;
            if (city.suburbCols) {
                const i = Math.floor(rnd() * city.rows), j = Math.floor(rnd() * city.suburbCols), side = rnd() < 0.5 ? -1 : 1, h = Math.floor(rnd() * City.housesPerBlock(city));
                plan = City.housePlan(city, i, j, side, h);
            } else {   // a city without a suburb: a corner of a downtown block, the old way
                const i = Math.floor(rnd() * city.rows), j = Math.floor(rnd() * city.cols);
                const p = city.toWorld(city.streetX(j) + city.street / 2 + 3.2, city.streetZ(i) + city.pitch / 2);
                plan = { key: city.id + ':' + i + ':' + j, p, address: city.streets.ns[j % city.streets.ns.length] + ' house', big: true };
            }
            if (used[plan.key]) continue; used[plan.key] = true;
            out.push({ id: level + ':' + plan.key, plan, p: plan.p, name: plan.address || plan.name, value: 80 + level * 40 + Math.floor(rnd() * 60), big: !!plan.big });
        }
        // the last job of every level: the police station's evidence room, by the frontage road
        const st = World.policeStationAt(city);
        out.push({ id: level + ':station', p: st.door.clone(), station: st, name: 'the ' + city.name + ' police station', value: 250 + level * 60 });
        return out;
    }

    function marker(t) {
        const g = new THREE.Group();
        const col = t.station ? 0x3fa9ff : t.big ? 0xffd21e : 0xff5a3c;
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
        clearMarkers(); leaveHouse(true);
        R.friends.forEach(f => { f.target = null; if (f.state === 'walk' || f.state === 'inside') { f.state = 'back'; f.mesh.visible = true; } else if (f.state === 'drive') f.state = 'follow'; });   // a new level: new houses
        const city = cityForLevel(R.level); R.city = city;
        R.targets = makeTargets(city, R.level).map(t => Object.assign(t, { robbed: R.done.indexOf(t.id) !== -1 }));
        R.targets.forEach(t => { if (!t.robbed) t.mesh = marker(t); });
        if (R.targets.length && R.targets.every(t => t.robbed)) { finishLevel(); return; }   // (a level left finished, say the mode was switched off mid-room)
        updateHud();
    }
    function updateHud() {
        if (!hud) hud = document.getElementById('rob-hud'); if (!hud) return;
        if (!R.on) { hud.textContent = ''; const box = document.getElementById('rob-map'); if (box) box.classList.remove('on'); return; }
        const left = R.targets.filter(t => !t.robbed).length;
        const copOutside = R.inside && !R.inside.room.awake && Police.car && Police.state === 'watch' && Police.car.mesh.position.distanceTo(R.inside.room.doorOut) < COP_SEES;   // (the car that would see you step out)
        const inside = R.jail ? (R.jail.sneaking ? ' — SNEAKING OUT: walk, don\'t run' : ' — IN JAIL (press SNEAK)') : R.inside ? (R.inside.room.awake ? ' — THEY ARE AWAKE: get out!' : ' — INSIDE: sneak (walk, don\'t run)' + (copOutside ? ' — a patrol car is right outside: wait for it to pass' : '')) : '';
        const crew = R.friends.length ? ' — ' + R.friends.map(f => { const tn = f.target ? f.target.name : 'a house'; return f.name + ': ' + (f.state === 'drive' ? 'driving to ' + tn : f.state === 'walk' ? 'walking to ' + tn : f.state === 'inside' ? 'inside ' + tn : f.state === 'back' ? 'back to the car' : f.state === 'wait' ? 'waiting' : f.state === 'come' ? 'coming' : f.state === 'riding' ? 'riding with you' : f.state === 'police' ? 'after the cops' : 'behind you'); }).join(', ') : '';   // (a target can be cleared mid-trip: never read through null)
        hud.textContent = 'ROBBERY — Level ' + R.level + ': ' + R.city.name + ' — ' + (R.targets.length - left) + '/' + R.targets.length + ' robbed' + inside + crew + (R.active ? ' — ROBBING ' + Math.ceil(ROB_TIME - R.active.t) + 's' : '') + (Police.state === 'chase' && Police.wanted ? ' — WANTED: lose the police!' : '');
    }
    R.setEnabled = function (on) {
        // the world may not be built yet (a saved robbery mode kicks in at boot): try again shortly
        if (on && !(World.freeways && World.freeways.length && World.freeways[0].cities.length)) { setTimeout(() => R.setEnabled(true), 500); return; }
        R.on = !!on; Save.set('mode', R.on ? 'robbery' : 'drive');
        ['friends-btn', 'msg-btn'].forEach(id => { const b = document.getElementById(id); if (b) b.style.display = R.on ? '' : 'none'; });
        if (R.on) { load(); setup(); UI.toast('ROBBERY mode. Level ' + R.level + ': ' + R.city.name + '. Fast travel there, find the glowing doors, get out (G), go in with E and sneak to the drawers.', 5000); }
        else { leaveHouse(true); R.levelDone = false; if (R.jail) R.escape(); showNextCity(false); if (CARS[Game.state.selectedCar] && CARS[Game.state.selectedCar].robberyOnly) Game.selectCar('starter'); /* the Robber's Car stays in the garage outside the mode */ const gm = document.getElementById('getmoney-big'); if (gm) gm.classList.remove('on'); clearMarkers(); dismissFriends(); R.targets = []; R.active = null; updateHud(); UI.toast('Back to driving.'); }
    };
    R.isOn = function () { return R.on; };

    // the nearest unrobbed house to someone on foot
    // a house a friend has claimed still counts while he is only on his way to it: you take it over at the door
    function nearTarget(pos) { let best = null, bd = REACH; R.targets.forEach(t => { if (t.robbed || t.spooked || (t.crewOf && t.crewOf.state === 'inside')) return; const d = Math.hypot(t.p.x - pos.x, t.p.z - pos.z); if (d < bd) { bd = d; best = t; } }); return best; }

    // ---- going in ----
    function enterHouse(t) {
        if (t.crewOf) {                                                        // a friend was on his way here: it is yours now, he moves on
            const f = t.crewOf; t.crewOf = null; f.target = null; f.order = null;
            f.state = f.state === 'walk' ? 'back' : 'follow'; if (f.state === 'follow') f.mesh.visible = false;
            say(f, pick(['You got ' + t.name + '? Fine, I\'ll find another.', 'Beat me to it. Moving on.']));
        }
        const room = t.station ? City.stationInterior(t.station) : City.houseInterior(t.plan);
        R.inside = { t, room, noise: 0, took: 0 };
        Walk.enterRoom(room);
        if (t.station) UI.toast('Inside the police station. The night officer is asleep on the cot: WALK, don\'t run. The cash is in the evidence locker drawers (E opens, E takes). E at the door to leave.', 6000);
        else UI.toast('Inside ' + t.name + '. Someone is asleep: WALK, don\'t run. E at the side table pulls a drawer open, E again takes the money. E at the door to leave.', 5500);
        updateHud();
    }
    function leaveHouse(quiet) {
        if (!R.inside) return;
        const i = R.inside; R.inside = null; R.active = null;
        if (window.Walk && Walk.room === i.room) Walk.leaveRoom();
        i.room.remove();
        if (i.took && !i.t.robbed) { i.t.spooked = false; robbed(i.t); }      // you grabbed money and left: that house is done
        if (!quiet) {
            // step out with the money while the patrol car is right there and it has seen you
            const cop = Police.car && Police.state === 'watch' && Police.car.mesh.position.distanceTo(Walk.pos) < COP_SEES;
            if (i.took && cop && !Police.wanted) { UI.toast('The police saw you come out with the money — big chase! Get to the car!', 4000); Police.alert(); }
            else UI.toast(i.room.awake ? 'Out. Now lose the police!' : i.took ? 'Out with the money, nobody saw a thing.' : 'Out, nice and quiet.', 2500);
        }
        if (R.levelDone && R.on) finishLevel();                                // the last house of the level: it ends on the doorstep
        updateHud();
    }
    // the drawers: E pulls the next one open, E again takes the money in it
    function useDrawer(i) {
        if (i.room.awake) { UI.toast('Too late — they are awake. Get out!', 2000); return; }
        const dr = i.room.drawers.find(d => !d.open || (d.cash && !d.taken));
        if (!dr) { UI.toast('The drawers are empty. Slip out (E at the door).', 2000); return; }
        if (!dr.open) {
            i.room.openDrawer(dr); i.noise += NOISE_DRAWER;
            UI.toast(dr.cash ? 'Drawer open — there is money in it! E takes it.' : 'Drawer open — nothing but socks.', 2000);
            return;
        }
        i.room.takeCash(dr);
        const t = i.t, cashDrawers = i.room.drawers.filter(d => d.cash).length;
        const got = Math.round(t.value / cashDrawers);
        i.took += got; R.loot += got; Game.addCoins(got);
        UI.toast('Got ' + got + ' coins!', 2500);
        if (i.room.drawers.every(d => !d.cash || d.taken)) robbed(t);
    }
    // a house is done: its marker goes, the level is checked
    function robbed(target) {
        target.robbed = true; R.done.push(target.id); if (target.mesh) { scene.remove(target.mesh); target.mesh = null; }
        save();
        checkLevel(true);
    }
    // every house robbed or lost: the level is over (a woken house or station is lost for the
    // level, so getting caught in the last one ends it too)
    function checkLevel(quiet) {
        if (!R.targets.length || !R.targets.every(x => x.robbed || x.spooked)) return;
        if (R.inside) { R.levelDone = true; if (quiet) UI.toast('That was the last of it! Slip out (E at the door) and the level is done.', 4000); return; }   // finish it once you are back outside, not mid-room
        finishLevel();
    }
    // the level is over: the bonus, the next city's houses, the NEXT CITY button
    function finishLevel() {
        R.levelDone = false;
        const bonus = 200 + R.level * 100; Game.addCoins(bonus);
        R.level += 1; R.done = []; save();
        UI.toast('Level complete! +' + bonus + ' bonus. Level ' + R.level + ': ' + cityForLevel(R.level).name + ' is open — press NEXT CITY.', 6000);
        setup();
        showNextCity(true);
    }
    // the NEXT CITY button: shows once a level is done, takes you (and the friends) to the next one
    function showNextCity(on) {
        const b = document.getElementById('next-city'); if (!b) return;
        b.classList.toggle('on', !!on);
        if (on && R.city) document.getElementById('next-city-name').textContent = R.city.name + ' — level ' + R.level;
    }
    // the button stays up whenever the level's city is far from you (a finished level, a game
    // loaded on the road, a wander off), and goes once you are there
    let nextAt = 0;
    function updateNextCity() {
        const now = performance.now(); if (now - nextAt < 1000) return; nextAt = now;
        if (!R.city || R.jail || R.inside || (window.Walk && Walk.ride)) { showNextCity(false); return; }
        const me = (window.Walk && Walk.active) ? Walk.pos : Car.body.position;
        const far = Math.hypot(R.city.center.x - me.x, R.city.center.z - me.z) > 2500;
        showNextCity(far);
        if (far) document.getElementById('next-city-name').textContent = R.city.name + ' — level ' + R.level + (R.targets.some(t => t.robbed) ? '' : ' (' + R.targets.length + ' houses)');
    }
    // the way to the level's city from where you are: which freeway, north or south, how far,
    // and the exit number off the city's own sign boards
    R.wayToCity = function () {
        const c = R.city; if (!c || !c.fw || !c.fw.frames) return '';
        const me = (window.Walk && Walk.active) ? Walk.pos : Car.body.position;
        const n = Road.nearest(c.fw, me);
        const exitS = c.s - c.side * (c.town ? 650 : 1200);                  // the exit on the city's side
        const along = exitS - n.s, dist = Math.abs(along);
        const far = dist > 2000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m';
        if (n.dist > 400) {                                                 // off the city's freeway (the other one, or deep in a city)
            const other = (window.World && World.freeways || []).find(f => f !== c.fw && Road.nearest(f, me).dist < 400);
            return 'Get onto ' + c.fw.name + (other ? ' (' + (c.fw.name === 'US-101' ? 'I-880 merges into it before San Jose, or cross a bridge' : 'cross a bridge') + ')' : '') + ', then Exit ' + c.exitNumber + ' for ' + c.name;
        }
        return c.fw.name + ' ' + (along > 0 ? 'south' : 'north') + ' ' + far + ', then Exit ' + c.exitNumber + ' for ' + c.name;
    };
    // NEXT CITY takes you (and the friends) straight to the level's city, a mile before its exit
    R.nextCity = function () {
        if (!R.on || !R.city || (window.Walk && Walk.ride)) return;
        showNextCity(false);
        if (R.jail) R.escape();
        leaveHouse(true);
        if (window.Walk && Walk.active) Walk.getIn();
        World.travelTo(R.city);
        UI.toast('Off to ' + R.city.name + '. Take Exit ' + R.city.exitNumber + ', the glowing doors are in the suburb.', 4000);
        if (R.friends.length) R.friends.forEach(f => { if (f === R.borrowed) return; f.order = null; if (f.target) { f.target.crewOf = null; f.target = null; } f.state = 'follow'; f.mesh.visible = false; });
        updateHud();
    };

    // ---- robber friends. CALL ROBBER FRIENDS brings Albert and Benny, each in a black car
    // of his own. They tail you; as soon as a house of the level is in reach they drive off to
    // it through the streets, get out, rob it (never the house nearest you), drive on to the
    // next free one, and fall in behind you again when the street is done. MESSAGES lets you
    // text either of them an order: rob a house, come to you, or wait. Their takings are yours. ----
    const CREW_GAP = 22, CREW_WALK = 4, CREW_DRIVE = 17, CREW_INSIDE = 8, CREW_NAMES = ['Albert', 'Benny'];
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const opener = () => pick(['All right, let\'s see. ', 'Okay. ', 'Copy that. ', '', '', 'Got it. ', 'Right. ']);
    const carPos = () => new THREE.Vector3().copy(Car.body.position);      // (the physics body's vector is Cannon's, not three's)
    R.crew = null;                                                          // { trail, lastP } shared by both cars
    R.callFriends = function () {
        if (!R.on) { UI.toast('Turn on ROBBERY first: SETTINGS > Game mode', 3000); return; }
        if (R.friends.length) { UI.toast('Albert and Benny are already behind you', 2000); return; }
        const yaw = Car.yaw(), cp = carPos();
        R.crew = { trail: [], lastP: cp.clone() };
        R.friends = CREW_NAMES.map((name, k) => {
            const car = (window.Models && Models.ready) ? Models.car(k ? 'sedan' : 'sedan-sports', 0x141414, 4.4, { wheels: true }) : new THREE.Group();
            if (!(window.Models && Models.ready)) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.2, 4.3), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.4, metalness: 0.5 })); m.position.y = 0.9; car.add(m); }
            const p = cp.clone().add(new THREE.Vector3(-Math.sin(yaw) * (14 + 10 * k), 0, -Math.cos(yaw) * (14 + 10 * k)));
            p.y = Walk.groundY(p.x, p.z, cp.y);
            car.position.copy(p); car.rotation.y = yaw; scene.add(car);
            const ped = Peds.person({ shirt: 0x1a1a1a, pants: 0x202020, hair: 0x111111 }); ped.visible = false; scene.add(ped);
            return { name, k, mesh: ped, car: { mesh: car, pos: p.clone(), yaw }, state: 'follow', target: null, route: null, t: 0, order: null, thread: [] };
        });
        UI.toast('Albert and Benny pull up behind you, each in his own car. Near the houses they drive off and rob on their own. MESSAGES to give them orders.', 5000);
        say(R.friends[0], 'Right behind you, boss.'); say(R.friends[1], 'Let\'s go.');
        updateHud();
    };
    function dismissFriends() { if (R.borrowed) R.takeOwnCar(); R.friends.forEach(f => { scene.remove(f.mesh); scene.remove(f.car.mesh); }); R.friends = []; R.crew = null; R.targets.forEach(t => { t.crewOf = null; }); }
    let alertTimer = null;
    function say(f, text) {
        f.thread.push({ from: f.name, text, at: Date.now() }); if (f.thread.length > 30) f.thread.shift(); R.msgDirty = true;
        // a chat alert pops up unless you are already in the chat
        const modal = document.getElementById('msg-modal'), box = document.getElementById('chat-alert');
        if (!box || (modal && modal.classList.contains('open'))) return;
        document.getElementById('chat-alert-text').innerHTML = '<b>' + f.name + ':</b> ' + text;
        box.classList.add('on'); R.msgWho = f.k;
        clearTimeout(alertTimer); alertTimer = setTimeout(() => box.classList.remove('on'), 6000);
    }

    // the point `gap` metres back along the trail your car has left
    function crewWant(c, gap) {
        const cp = carPos();
        let acc = c.trail.length ? cp.distanceTo(c.trail[c.trail.length - 1]) : 0;
        for (let i = c.trail.length - 1; i >= 0; i--) {
            if (acc >= gap) return c.trail[i];
            if (i > 0) acc += c.trail[i].distanceTo(c.trail[i - 1]);
        }
        const yaw = Car.yaw();
        return cp.clone().add(new THREE.Vector3(-Math.sin(yaw) * gap, 0, -Math.cos(yaw) * gap));
    }
    // a spot just ahead of your car, one friend each side
    function besideCar(f) { const yaw = Car.yaw(), side = f.k ? 1 : -1; return carPos().add(new THREE.Vector3(Math.sin(yaw) * 3 + Math.cos(yaw) * side * 4.4, 0, Math.cos(yaw) * 3 - Math.sin(yaw) * side * 4.4)); }
    // drive a friend's car (kinematically) toward a point; returns the distance left
    function driveTo(f, to, dt, maxSp) {
        const c = f.car, dx = to.x - c.pos.x, dz = to.z - c.pos.z, d = Math.hypot(dx, dz);
        if (d > 0.4) {
            const sp = Math.min(maxSp, d * 2), step = Math.min(d, sp * dt);
            c.pos.x += dx / d * step; c.pos.z += dz / d * step;
            let e = Math.atan2(dx, dz) - c.yaw; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
            c.yaw += e * Math.min(1, dt * 5);
        }
        c.pos.y = Walk.groundY(c.pos.x, c.pos.z, c.pos.y + 1);
        c.mesh.position.copy(c.pos); c.mesh.rotation.y = c.yaw;
        return d;
    }
    // A route through the city's streets from one world point to another: along the nearest
    // north-south street to an east-west one, across, then to the target (the frontage road if
    // the target lies beyond the grid). The police car uses this to drive you to the station.
    R.gridRoute = function (city, from, to) {
        const l0 = city.toLocal(from.x, from.z), l1 = city.toLocal(to.x, to.z);
        const col = (lx) => city.streetX(Math.max(0, Math.min(city.cols, Math.round((lx + city.W / 2) / city.pitch))));
        const row = (lz) => city.streetZ(Math.max(0, Math.min(city.rows, Math.round((lz + city.D / 2) / city.pitch))));
        const xs0 = col(l0.lx), zi = row(l0.lz), xsT = l1.lx > city.W / 2 + 10 ? city.W / 2 + 34 : col(l1.lx);
        const pts = [[xs0, l0.lz]];
        if (Math.abs(xs0 - xsT) > 1) pts.push([xs0, zi], [xsT, zi]);
        pts.push([xsT, l1.lz]);
        return pts.map(([lx, lz]) => city.toWorld(lx, lz));
    };
    R.leaveNow = () => leaveHouse(true);
    // A route through the city's streets to a house: along the nearest north-south street to
    // an east-west one, across to the house's street, up to its door, and into the kerb
    function routeTo(f, t) {
        const city = R.city, p = t.plan, c = f.car.pos;
        const l = city.toLocal(c.x, c.z);
        const nearestJ = (lx) => Math.max(0, Math.min(city.cols, Math.round((lx + city.W / 2) / city.pitch)));
        const nearestI = (lz) => Math.max(0, Math.min(city.rows, Math.round((lz + city.D / 2) / city.pitch)));
        const jHouse = p.facing < 0 ? p.j : p.j + 1, xs = city.streetX(jHouse), xs0 = city.streetX(nearestJ(l.lx)), zi = city.streetZ(nearestI(l.lz));
        const doorL = city.toLocal(t.p.x, t.p.z);
        const park = { lx: xs - p.facing * (city.street / 2 - 2.0), lz: doorL.lz };
        const pts = [[xs0, l.lz]];
        if (Math.abs(xs0 - xs) > 1) pts.push([xs0, zi], [xs, zi]);
        pts.push([xs, park.lz], [park.lx, park.lz]);
        return pts.map(([lx, lz]) => city.toWorld(lx, lz));
    }
    // inside the level city's streets or on its frontage road (not up on the freeway deck)
    function inCity(pos) { const c = R.city; if (!c) return false; const l = c.toLocal(pos.x, pos.z); return Math.abs(l.lx) < c.W / 2 + 70 && Math.abs(l.lz) < c.D / 2 + 400 && Math.abs(pos.y - c.base) < 6; }
    // each friend takes the nearest free house, never the one nearest you
    function freeHouseFor(f) {
        // the house you are closest to is yours, but only while you are actually near it (80 m):
        // once you have moved on, the friends finish the street
        const me = (window.Walk && Walk.active) ? Walk.pos : carPos();
        const nearest = R.targets.filter(t => !t.robbed && !t.spooked && !t.big && !t.station).sort((a, b) => a.p.distanceTo(me) - b.p.distanceTo(me))[0];
        const mine = nearest && nearest.p.distanceTo(me) < 80 ? nearest : null;
        const free = R.targets.filter(t => !t.robbed && !t.spooked && !t.big && !t.station && t !== mine && !t.crewOf && t.p.distanceTo(f.car.pos) < 700);
        free.sort((a, b) => a.p.distanceTo(f.car.pos) - b.p.distanceTo(f.car.pos));
        return free[0] || null;
    }
    function sendTo(f, t, quiet) {
        if (f.target) f.target.crewOf = null;
        f.target = t; t.crewOf = f; f.route = t.station ? R.gridRoute(R.city, f.car.pos, t.p).concat([t.p.clone()]) : routeTo(f, t); f.state = 'drive'; f.mesh.visible = false;
        if (!quiet) say(f, 'On it — ' + t.name + '.');
    }
    function updateFriends(dt) {
        if (!R.friends.length) return;
        const c = R.crew, cp = carPos();
        if (cp.distanceTo(c.lastP) > 200) { c.trail = []; c.lastP.copy(cp); R.friends.forEach((f, k) => { if (f.state === 'follow') f.car.pos.copy(crewWant(c, CREW_GAP * (k + 1))); }); }   // fast travel: they pop up behind you
        else if (cp.distanceTo(c.lastP) > 3) { c.trail.push(cp.clone()); c.lastP.copy(cp); if (c.trail.length > 300) c.trail.shift(); }
        R.friends.forEach(f => friendStep(f, dt));
    }
    function walkTo(f, to, dt, speed) {
        const m = f.mesh, dx = to.x - m.position.x, dz = to.z - m.position.z, d = Math.hypot(dx, dz);
        if (d > 0.5) { const step = Math.min(d, speed * dt); m.position.x += dx / d * step; m.position.z += dz / d * step; m.rotation.y = Math.atan2(dx, dz); }
        m.position.y = Walk.groundY(m.position.x, m.position.z, m.position.y);
        Peds.animate(m, dt, d > 0.5, speed > 6);
        return d;
    }
    function friendStep(f, dt) {
        const c = f.car, m = f.mesh;
        if (f.state === 'riding') { c.pos.copy(carPos()); c.yaw = Car.yaw(); return; }   // you are driving his car
        if (f.state === 'police') {
            const cop = window.Police && Police.car;
            if (!cop) { f.state = 'follow'; f.order = null; say(f, 'Cops are gone.'); return; }
            if (driveTo(f, cop.mesh.position, dt, 20) < 4.5) { Police.rammed(f.name); say(f, 'Boom. That patrol car is in the hedge.'); f.state = 'follow'; f.order = null; }
            return;
        }
        if (f.state === 'follow') {
            // behind you on the move; when you stop they pull up beside you where you can see them
            const stopped = Car.mph < 3 && !(window.Walk && Walk.active);
            driveTo(f, stopped ? besideCar(f) : crewWant(R.crew, 12 + 9 * f.k), dt, Math.max(0, Car.mph / CFG.MPH) + 25);
            if (f.order === 'police' && window.Police && Police.car) { f.state = 'police'; say(f, 'There they are — going for them.'); return; }
            if (f.order !== 'wait' && f.order !== 'police' && R.city && inCity(f.car.pos)) { const t = freeHouseFor(f); if (t) sendTo(f, t); }
        } else if (f.state === 'wait') {
            // waiting by his car for you: once you are in a car again he gets in and falls in behind
            if (f.pickup && !(window.Walk && Walk.active)) { f.pickup = false; f.order = null; f.state = 'follow'; m.visible = false; }
            else if (f.pickup) { m.rotation.y = Math.atan2(Walk.pos.x - m.position.x, Walk.pos.z - m.position.z); Peds.animate(m, dt, false); }
            else if (f.order !== 'wait') f.state = 'follow';
        } else if (f.state === 'come') {
            // to you: if you are on foot they stop right beside you and wait until you get in a car
            const onFoot = window.Walk && Walk.active;
            const to = onFoot ? new THREE.Vector3(Walk.pos.x + (f.k ? 4 : -4), 0, Walk.pos.z + 2) : besideCar(f);
            if (driveTo(f, to, dt, 18) < 2.5) {
                if (onFoot) {
                    // arrived: he gets out and stands by his car until you are ready
                    f.state = 'wait'; f.order = 'wait'; f.pickup = true;
                    m.visible = true; m.position.copy(c.pos).add(new THREE.Vector3(Math.cos(c.yaw) * 1.7, 0, -Math.sin(c.yaw) * 1.7)); m.position.y = Walk.groundY(m.position.x, m.position.z, c.pos.y); m.rotation.y = Math.atan2(Walk.pos.x - m.position.x, Walk.pos.z - m.position.z);
                    say(f, pick(['Here. Jump in when you\'re ready.', 'All right, I\'m here. Take your time.', 'Made it. Say the word.']));
                } else { f.state = 'follow'; say(f, pick(['Here.', 'Right behind you again.'])); }
            }
        } else if (f.state === 'drive') {
            if (!f.target || f.target.robbed || f.target.spooked) { if (f.target) f.target.crewOf = null; f.target = null; f.state = 'follow'; return; }
            if (driveTo(f, f.route[0], dt, CREW_DRIVE) < 2.5) {
                f.route.shift();
                if (!f.route.length) { f.state = 'walk'; m.visible = true; m.position.copy(c.pos).add(new THREE.Vector3(Math.cos(c.yaw) * 1.6, 0, -Math.sin(c.yaw) * 1.6)); }
            }
        } else if (f.state === 'walk') {
            if (!f.target || f.target.robbed || f.target.spooked) { f.state = 'back'; return; }
            if (walkTo(f, f.target.p, dt, m.position.distanceTo(f.target.p) > 25 ? 8 : CREW_WALK) < 1.4) { f.state = 'inside'; f.t = 0; m.visible = false; }
        } else if (f.state === 'inside') {
            f.t += dt;
            if (f.t > CREW_INSIDE) {
                const t = f.target; f.target = null; t.crewOf = null;
                m.visible = true; f.state = 'back';
                if (!t.robbed) { const got = Math.round(t.value * 0.7); R.loot += got; Game.addCoins(got); say(f, 'Done. ' + t.name + ': ' + got + ' coins.'); UI.toast(f.name + ' robbed ' + t.name + ': +' + got + ' coins', 3000); robbed(t); }
            }
        } else if (f.state === 'back') {
            const side = c.pos.clone().add(new THREE.Vector3(Math.cos(c.yaw) * 1.6, 0, -Math.sin(c.yaw) * 1.6));
            if (walkTo(f, side, dt, CREW_WALK) < 0.8) {
                m.visible = false;
                const t = f.order === 'wait' ? null : freeHouseFor(f);
                if (t) sendTo(f, t); else { f.state = f.order === 'wait' ? 'wait' : 'follow'; if (!t && f.order !== 'wait') say(f, 'Street\'s done here. Falling in behind you.'); }
            }
        }
    }
    // ---- MESSAGES: text a friend an order ----
    R.message = function (k, text) {
        const f = R.friends[k]; if (!f) return;
        f.thread.push({ from: 'You', text, at: Date.now() });
        const lower = text.toLowerCase();
        // the house named in full first ("Rob 105 Elm St"), else the first free one on the street named
        const free = t => !t.robbed && !t.spooked && !t.big && !t.station && (!t.crewOf || t.crewOf === f);
        const house = R.targets.find(t => free(t) && lower.includes(t.name.toLowerCase())) || R.targets.find(t => free(t) && lower.includes(t.name.toLowerCase().replace(/^\d+ /, '')));
        if (f === R.borrowed) { say(f, pick(['I\'m riding with you, boss. Swap back first (G by your car).', 'Can\'t, you\'ve got my wheels. I\'m in the passenger seat.'])); return; }   // (his car is the one you're driving)
        const meP = (window.Walk && Walk.active) ? Walk.pos : carPos();
        if (/\b(police|cops?|patrol|5-0|feds)\b/.test(lower) && /\b(kill|ram|chase|get|stop|block|deal|take out|lose|wreck|smash|crash|run)\b/.test(lower)) {
            f.order = 'police'; if (f.target) { f.target.crewOf = null; f.target = null; }
            if (window.Police && Police.car) { f.state = 'police'; f.mesh.visible = false; say(f, opener() + pick(['Say no more. Ramming them.', 'On the cops now — hold tight.', 'Going for the patrol car.', 'I see them. This\'ll be loud.'])); }
            else { if (f.state === 'walk' || f.state === 'inside') f.state = 'back'; say(f, opener() + pick(['No cops around right now. First one I see, I run it off the road.', 'Quiet so far — I\'ll keep an eye out and ram the first patrol car.', 'Nothing with a light bar in sight. I\'ll be ready.'])); }
        }
        else if (/\b(station|evidence|precinct|cop shop)\b/.test(lower) && R.targets.some(t => t.station && !t.robbed)) {
            const st = R.targets.find(t => t.station && !t.robbed);
            if (st.crewOf && st.crewOf !== f) say(f, st.crewOf.name + ' is already on the station.');
            else { f.order = 'rob'; sendTo(f, st, true); say(f, opener() + pick(['The police station? Ballsy. Going.', 'Evidence room it is. Quiet as a mouse.', 'On it — the station. Wish me luck.'])); }
        }
        else if (house) { f.order = 'rob'; sendTo(f, house, true); say(f, opener() + pick(['On it — ' + house.name + '.', house.name + '? Easy. Going now.', 'Heading to ' + house.name + '.', house.name + '. Keep the engine running.'])); }
        else if (/\b(nearest|any|a house|rob|hit|loot|money|cash|job|work)\b/.test(lower)) { const t = freeHouseFor(f) || R.targets.find(x => !x.robbed && !x.spooked && !x.big && !x.station && !x.crewOf); if (t) { f.order = 'rob'; sendTo(f, t, true); say(f, opener() + pick(['On it — ' + t.name + '.', 'Taking ' + t.name + '. Back in a minute.', t.name + ' looks easy. Going.'])); } else if (R.targets.some(x => x.station && !x.robbed)) say(f, pick(['Houses are done. Only the police station is left — say "do the station" and I\'ll go.', 'Just the station left, boss. Want me to take it?'])); else say(f, pick(['Nothing left to rob here. Next town?', 'Street\'s picked clean, boss.', 'All done around here. Let\'s move.'])); }
        else if (/\b(come|here|to me|follow|back|pick me|get me)\b/.test(lower)) { f.order = null; if (f.target) { f.target.crewOf = null; f.target = null; } if (f.state === 'walk' || f.state === 'inside') f.state = 'back'; else { f.route = [meP.clone()]; f.state = 'come'; f.mesh.visible = false; } say(f, opener() + pick(['Coming.', 'On my way.', 'Two minutes. Stay there.', 'Hold on, I\'m turning around.'])); }
        else if (/\b(wait|stay|stop|hold|park|chill)\b/.test(lower)) { f.order = 'wait'; if (f.target) { f.target.crewOf = null; f.target = null; } if (f.state === 'walk' || f.state === 'inside') f.state = 'back'; if (f.state === 'drive' || f.state === 'follow' || f.state === 'come' || f.state === 'police') f.state = 'wait'; f.mesh.visible = f.state === 'walk' || f.state === 'back'; say(f, opener() + pick(['Waiting here.', 'Parked up. Say when.', 'Staying put.'])); }
        else if (/\b(where|status|what are you|doing|report)\b/.test(lower)) { const d = Math.round(f.car.pos.distanceTo(meP)); const tn = f.target ? f.target.name : 'a house'; say(f, f.state === 'inside' ? 'Inside ' + tn + ' right now, ' + d + ' m from you.' : f.state === 'drive' || f.state === 'walk' ? 'Heading to ' + tn + ', ' + d + ' m from you.' : f.state === 'wait' ? 'Parked, waiting, ' + d + ' m away.' : f.state === 'police' ? 'Chasing the cops.' : 'Right behind you, ' + d + ' m back.'); }
        else if (/\b(hi|hello|hey|yo|sup|morning)\b/.test(lower)) say(f, pick(['Hey boss.', 'Yo. What\'s the job?', 'Ready when you are.']));
        else if (/\b(thanks|thank you|nice|good job|great|well done)\b/.test(lower)) say(f, pick(['Anytime.', 'That\'s what we do.', 'Split\'s fair, that\'s all I ask.']));
        else if (/\b(no|don\'t|never mind|cancel|forget)\b/.test(lower)) { f.order = null; if (f.target) { f.target.crewOf = null; f.target = null; } if (f.state === 'walk' || f.state === 'inside') { f.state = 'back'; f.mesh.visible = true; } if (f.state === 'drive' || f.state === 'police' || f.state === 'come') f.state = 'follow'; say(f, pick(['Okay, dropping it.', 'Forget it, got it.'])); }
        else say(f, pick(['Not sure what you mean. Rob a house (tell me the street), "nearest", "come", "wait", or "get the cops".', 'Say that again? I do houses, pick-ups, waiting, and cops.']));
        R.msgDirty = true;
    };
    // a screenshot pasted into the chat: it goes in the thread and the friend answers it (the
    // game has no AI behind it, so this is a friendly guess, not a real look at the picture)
    R.messageImage = function (k, dataUrl) {
        const f = R.friends[k]; if (!f) return;
        f.thread.push({ from: 'You', img: dataUrl, at: Date.now() });
        say(f, opener() + pick(['Yeah, that\'s my car — the black one.', 'Ha, that\'s us. Nice shot.', 'Yep, that\'s me right behind you.', 'That\'s the one. Don\'t scratch it.']));
        R.msgDirty = true;
    };
    R.renderMessages = function () {
        const box = document.getElementById('msg-list'), quick = document.getElementById('msg-quick'); if (!box) return;
        const k = R.msgWho || 0, f = R.friends[k];
        document.querySelectorAll('#msg-who button').forEach((b, i) => b.classList.toggle('on', i === k));
        if (!f) { box.innerHTML = '<div style="opacity:0.7">Call your robber friends first (CALL ROBBER FRIENDS).</div>'; quick.innerHTML = ''; return; }
        box.innerHTML = f.thread.map(m => '<div style="margin:4px 0;text-align:' + (m.from === 'You' ? 'right' : 'left') + '"><span style="display:inline-block;max-width:80%;padding:6px 10px;border-radius:12px;background:' + (m.from === 'You' ? '#1d6fd6' : '#2a3140') + '">' + (m.img ? '<img src="' + m.img + '" style="max-width:100%;border-radius:8px;display:block">' : m.text) + '</span></div>').join('') || '<div style="opacity:0.7">No messages yet. Paste a screenshot or type.</div>';
        box.scrollTop = box.scrollHeight;
        const houses = R.targets.filter(t => !t.robbed && !t.spooked && !t.big && !t.station && !t.crewOf).slice(0, 5);
        const stationLeft = R.targets.some(t => t.station && !t.robbed && !t.crewOf);
        quick.innerHTML = ['Rob the nearest house', ...houses.map(t => 'Rob ' + t.name), ...(stationLeft ? ['Do the police station'] : []), 'Come to me', 'Wait there'].map(txt => '<button class="toggle-btn" data-msg="' + txt.replace(/"/g, '') + '">' + txt + '</button>').join(' ');
        quick.querySelectorAll('button').forEach(b => b.onclick = () => { R.message(k, b.dataset.msg); R.renderMessages(); });
        R.msgDirty = false;
    };

    // the sleeper wakes: in a house they call the police; in the station the officer has you right there
    function wakeUp() {
        const i = R.inside; if (!i || i.room.awake) return;
        i.room.wake(); i.t.spooked = true; R.active = null;
        if (i.t.mesh) { scene.remove(i.t.mesh); i.t.mesh = null; }            // (a woken house is lost for the level: no glowing door)
        checkLevel(false);
        if (i.t.station) {
            UI.toast('"FREEZE!" The night officer has you — handcuffed on the spot.', 3500);
            Walk.cuffed = true; i.caught = 0;
            updateHud(); return;
        }
        UI.toast('They woke up and called the police! Get out (E at the door) and lose them.', 4000);
        Police.alert();
        updateHud();
    }
    // E on foot: go in at a glowing door; inside, hold E at the dresser to rob, E at the door to leave
    R.rob = function () {
        if (!window.Walk || !Walk.active) return;
        if (Walk.ride) { UI.toast('You are in the back of a police car. Sit tight.', 2000); return; }
        if (Walk.cuffed) { UI.toast('You are handcuffed.', 1500); return; }    // (the station's 2.5 s arrest runs on to the cell)
        if (!R.on) { UI.toast('Turn on ROBBERY first: SETTINGS > Game mode', 3000); return; }
        if (R.jail) {
            const j = R.jail;
            if (!j.room.open) { UI.toast('The cell is locked. Press SNEAK.', 2000); return; }
            if (Walk.pos.distanceTo(j.room.doorIn) < 1.8) { R.escape(); return; }
            UI.toast('Keep going: the exit door is at the end of the corridor, past the desk.', 2000); return;
        }
        if (R.inside) {
            const i = R.inside, me = Walk.pos;
            if (me.distanceTo(i.room.doorIn) < 1.6) { leaveHouse(); return; }
            if (me.distanceTo(i.room.loot) < 1.7) useDrawer(i);
            else UI.toast('The money is in the side table drawers, by the lamp. The door is the way out.', 2000);
            return;
        }
        if (R.active) return;
        const t = nearTarget(Walk.pos);
        if (!t) { UI.toast('Walk up to a glowing door first'); return; }
        if (t.big) { R.active = { target: t, at: t.p, t: 0 }; UI.toast('Robbing ' + t.name + '… keep holding E by the door', 2000); return; }
        enterHouse(t);
    };
    // E let go early: the robbery stops
    R.release = function () {
        if (!R.active) return;
        R.active = null; updateHud();
        UI.toast('You let go of E — robbery stopped', 1500);
    };

    R.update = function (dt) {
        if (!R.on) return;
        pulse += dt;
        updateMap(); updateFriends(dt); updateNextCity(); updateJail(dt); updateGetMoney();
        if (R.msgDirty && document.getElementById('msg-modal') && document.getElementById('msg-modal').classList.contains('open')) R.renderMessages();
        R.targets.forEach(t => { if (t.mesh) { t.mesh.children[0].scale.setScalar(1 + 0.15 * Math.sin(pulse * 4)); t.mesh.visible = t.mesh.position.distanceTo(Car.body.position) < 1500; } });
        const walking = window.Walk && Walk.active;
        if (R.inside && !walking) leaveHouse(true);                             // got in the car somehow: the room goes
        if (R.jail && !walking) R.escape();
        if (R.inside) {
            // noise: running is loud, walking close to the bed is risky, standing still is quiet
            const i = R.inside, nearBed = Walk.pos.distanceTo(i.room.bed) < 2.4;
            const moving = Car.keys.fwd || Car.keys.back;
            if (i.caught !== undefined) { i.caught += dt; if (i.caught > 2.5) { Walk.cuffed = false; R.onArrested(); return; } }
            if (!i.room.awake) {
                if (Walk.running) i.noise += NOISE_RUN * dt;
                else if (moving && nearBed) i.noise += NOISE_NEAR * dt;
                else i.noise = Math.max(0, i.noise - 0.15 * dt);
                i.room.lamp.material.emissiveIntensity = 0.5 + 0.2 * Math.sin(pulse * 2);
                if (i.noise >= 1) wakeUp();
            }
        }
        if (R.active) {
            const a = R.active;
            if (!walking || Walk.pos.distanceTo(a.at) > REACH) { R.active = null; UI.toast('You stepped away — robbery stopped', 2000); updateHud(); return; }
            a.t += dt;
            if (a.t >= ROB_TIME) {                                             // (the vault and other big jobs, robbed from the door)
                const target = a.target; R.active = null;
                R.loot += target.value; Game.addCoins(target.value);
                UI.toast('Got ' + target.value + ' coins from ' + target.name + '! The police are coming — get to the car and lose them.', 4000); Police.alert();
                robbed(target);
            }
        } else if (walking && !R.inside && !Walk.cuffed && !Walk.ride && Police.state !== 'arrest') {   // (no door hints over the officer's lines)
            const now = performance.now();
            const t = nearTarget(Walk.pos);
            if (t && now - lastHint > 3000) { UI.toast((t.big ? 'Hold E: rob ' : t.station ? 'E: sneak into ' : 'E: go into ') + t.name + ' (' + t.value + ' coins)', 1500); lastHint = now; }
        }
        updateHud();
    };
    // the police caught you while wanted: the loot from this run is gone
    R.onCaught = function () { leaveHouse(true); if (!R.on || !R.loot) return; const lost = Math.min(R.loot, Game.state.coins); Game.addCoins(-lost); UI.toast('Busted! The police took back ' + lost + ' coins of loot.', 4000); R.loot = 0; };

    // ---- jail. Handcuffed on foot, you are driven to the station beside the frontage road and
    // locked in a cell. Your friends keep working the street. ESCAPE jumps you out of the
    // window: run to one of their cars and press G to jump in. ----
    R.onArrested = function (where) {
        const lost = Math.min(R.loot, Game.state.coins); if (lost) Game.addCoins(-lost); R.loot = 0;
        const city = where || R.city, st = World.policeStationAt(city);          // (this city's station: leaving the room may end the level and move R.city on)
        leaveHouse(true);
        if (Police.standDown) Police.standDown();                              // (cuffed by the night officer with a car still on its way: one arrest is enough)
        const room = City.cellBlockInterior(st);
        R.jail = { room, city, noise: 0, sneaking: false };
        Walk.enterRoom(room); Walk.pos.copy(room.cell); Walk.pos.y = room.floorY; Walk.yaw = st.yaw + Math.PI / 2;   // facing the bars
        const eb = document.getElementById('escape-btn'); if (eb) eb.style.display = '';
        const big = document.getElementById('escape-big'); if (big) big.classList.add('on');
        UI.toast('Locked in a cell at the ' + city.name + ' police station' + (lost ? ' — the ' + lost + ' coins of loot are gone' : '') + '. The night officer is dozing at the front desk. Press SNEAK to open the cell, then walk out past him.', 7000);
        updateHud();
    };
    // GET MONEY: at a door it takes you in; inside it pulls every drawer and pockets all the
    // cash at once (noisier than one drawer at a time); either way the crew gets the word to go
    // grab all the money on the street
    R.getMoney = function () {
        if (!R.on || !window.Walk || !Walk.active || R.jail || Walk.ride) return;
        if (R.inside) {
            const i = R.inside, room = i.room;
            if (room.awake) { UI.toast('Too late — they are awake. Get out!', 2000); }
            else if (Walk.pos.distanceTo(room.loot) > 2.2) { UI.toast('Get to the drawers first (' + Math.round(Walk.pos.distanceTo(room.loot)) + ' m).', 2000); }
            else {
                let got = 0, n = 0;
                room.drawers.forEach(d => { if (!d.open) { room.openDrawer(d); i.noise += NOISE_DRAWER; } if (d.cash && !d.taken) { room.takeCash(d); n++; } });
                const cashDrawers = room.drawers.filter(d => d.cash).length;
                if (n) { got = Math.round(i.t.value / cashDrawers) * n; i.took += got; R.loot += got; Game.addCoins(got); UI.toast('Grabbed everything: +' + got + ' coins! Now slip out (E at the door).', 3000); robbed(i.t); }
                else UI.toast('The drawers are already empty. Slip out (E at the door).', 2000);
            }
        } else {
            const t = nearTarget(Walk.pos);
            if (!t) UI.toast('Walk up to a glowing door first', 2000);
            else if (t.big) { R.active = { target: t, at: t.p, t: 0 }; UI.toast('Robbing ' + t.name + '… keep holding E by the door', 2000); }
            else enterHouse(t);
        }
        // the word goes out to the crew
        let sent = 0;
        R.friends.forEach(f => {
            if (f.state === 'drive' || f.state === 'walk' || f.state === 'inside' || f === R.borrowed) return;
            f.order = 'rob'; const t = freeHouseFor(f) || R.targets.find(x => !x.robbed && !x.spooked && !x.big && !x.station && !x.crewOf);
            if (t) { sendTo(f, t, true); say(f, opener() + pick(['Grabbing all the money — ' + t.name + ' first.', 'On it. ' + t.name + '.', 'Every last coin. Going to ' + t.name + '.'])); sent++; }
            else say(f, pick(['Nothing left to grab here, boss.', 'Street\'s empty. Say where next.']));
        });
        if (sent) UI.toast('Message sent: Albert and Benny are grabbing all the money too.', 2500);
        updateHud();
    };
    let moneyAt = 0;
    function updateGetMoney() {
        const now = performance.now(); if (now - moneyAt < 400) return; moneyAt = now;
        const b = document.getElementById('getmoney-big'); if (!b) return;
        let on = false, note = '';
        if (R.on && window.Walk && Walk.active && !R.jail && !Walk.ride && !Walk.cuffed && Police.state !== 'arrest') {
            if (R.inside) { const room = R.inside.room; on = !room.awake && room.drawers.some(d => d.cash && !d.taken); note = 'grab it all, and the crew too'; }
            else { const t = nearTarget(Walk.pos); on = !!t; note = t ? 'go in and grab it, and the crew too' : ''; }
        }
        b.classList.toggle('on', on);
        if (on) document.getElementById('getmoney-note').textContent = note;
    }
    // SNEAK: the cell door opens; walk the hallway past the desk to the exit door (E there)
    R.sneak = function () {
        const j = R.jail; if (!j || j.room.open) return;
        if (j.wakeT !== undefined) { UI.toast('He\'s still awake. Wait for him to doze off.', 2000); return; }
        j.room.openCell(); j.sneaking = true; j.noise = 0;
        const big = document.getElementById('escape-big'); if (big) big.classList.remove('on');
        UI.toast('The cell door slides open. WALK — don\'t run — down the hall and past the desk. E at the front door gets you out.', 5000);
    };
    function updateJail(dt) {
        const j = R.jail; if (!j) return;
        const room = j.room, nearDesk = Walk.pos.distanceTo(room.bed) < 3.5, moving = Car.keys.fwd || Car.keys.back;
        if (j.wakeT !== undefined) {                                           // he caught you: back in the cell, he dozes off again
            j.wakeT += dt; if (j.wakeT > 4) { room.sleep(); j.wakeT = undefined; const big = document.getElementById('escape-big'); if (big) big.classList.add('on'); }
            return;
        }
        if (!j.sneaking) return;
        if (Walk.running) j.noise += NOISE_RUN * dt;
        else if (moving && nearDesk) j.noise += NOISE_NEAR * dt;
        else j.noise = Math.max(0, j.noise - 0.15 * dt);
        if (j.noise >= 1) {
            room.wake(); room.closeCell(); j.sneaking = false; j.noise = 0; j.wakeT = 0;
            Walk.pos.copy(room.cell); Walk.pos.y = room.floorY;
            UI.toast('"HEY!" The officer grabs you and marches you straight back into the cell. Quieter next time.', 4000);
        }
    }
    R.escape = function () {
        if (!R.jail) return;
        const j = R.jail; R.jail = null;
        const eb = document.getElementById('escape-btn'); if (eb) eb.style.display = 'none';
        const big = document.getElementById('escape-big'); if (big) big.classList.remove('on');
        Walk.leaveRoom(); j.room.remove();
        Walk.pos.copy(j.room.doorOut); Walk.pos.y = Walk.groundY(Walk.pos.x, Walk.pos.z, j.room.doorOut.y + 1);
        R.escaping = true;
        if (R.friends.length) {
            R.friends.forEach(f => { if (f === R.borrowed) return; f.order = null; if (f.target) { f.target.crewOf = null; f.target = null; } f.route = [Walk.pos.clone()]; f.state = 'come'; f.mesh.visible = false; say(f, 'Saw you slip out — on my way!'); });
            UI.toast('Out of the station! Albert and Benny are racing over — run to a black car and press G to take the wheel.', 5000);
        } else UI.toast('Out of the station! Your car is back where you left it — run.', 4000);
        updateHud();
    };
    // ---- driving a friend's car. G beside one of the black cars and it is yours to drive: your
    // own car stays parked where you left it (a copy of it stands there), the friend rides
    // along. G beside your parked car hands the black car back and he gets out and waits. ----
    R.ownCar = null; R.borrowed = null;
    function friendCarData(f) {
        return Object.assign({}, CARS.starter, { id: 'friendcar', name: f.name + '\'s sedan', maxSpeed: f.k ? 125 : 135, acceleration: 50, handling: 0.013, color: 0x141414, bodyColor: 0x141414 });
    }
    R.driveFriendCar = function (f) {
        const here = carPos();
        if (R.borrowed) {                                                      // swapping from one black car to the other
            const g = R.borrowed; g.car.pos.copy(here); g.car.yaw = Car.yaw(); g.car.mesh.visible = true; g.car.mesh.position.copy(here); g.car.mesh.rotation.y = g.car.yaw; g.state = 'follow';
        } else {
            // leave your own car where it is
            const parked = new THREE.Group(); parked.add(Car.group.clone()); Car.wheels.forEach(w => parked.add(w.clone()));
            scene.add(parked);
            R.ownCar = { data: Car.data, pos: here.clone(), yaw: Car.yaw(), mesh: parked };
        }
        const pos = f.car.pos.clone(), yaw = f.car.yaw;
        f.car.mesh.visible = false; f.mesh.visible = false; f.state = 'riding'; f.order = null; if (f.target) { f.target.crewOf = null; f.target = null; }
        Car.spawn(friendCarData(f), new THREE.Vector3(pos.x, pos.y + 0.6, pos.z), yaw);
        Walk.getIn(); R.borrowed = f; R.escaping = false;
        if (window.Police) Police.wanted = false;
        UI.toast('You take the wheel of ' + f.name + '\'s car — he rides along. G by your own car to get it back.', 4000);
        say(f, pick(['Easy on her, boss.', 'She pulls a little to the left.', 'Don\'t scratch it. Go!']));
        updateHud();
    };
    R.takeOwnCar = function () {
        const own = R.ownCar; if (!own) return;
        const f = R.borrowed, here = carPos(), yaw = Car.yaw();
        if (f) { f.car.pos.copy(here); f.car.yaw = yaw; f.car.mesh.visible = true; f.car.mesh.position.copy(here); f.car.mesh.rotation.y = yaw; f.state = 'wait'; f.order = 'wait'; f.pickup = true; f.mesh.visible = true; f.mesh.position.copy(here).add(new THREE.Vector3(Math.cos(yaw) * 1.7, 0, -Math.sin(yaw) * 1.7)); f.mesh.position.y = Walk.groundY(f.mesh.position.x, f.mesh.position.z, here.y); }
        scene.remove(own.mesh);
        Car.spawn(own.data, new THREE.Vector3(own.pos.x, own.pos.y + 0.6, own.pos.z), own.yaw);
        R.ownCar = null; R.borrowed = null;
        Walk.getIn();
        UI.toast('Back in your own car.' + (f ? ' ' + f.name + ' has his keys back.' : ''), 3000);
        if (f) say(f, pick(['Thanks. Not a scratch — nice.', 'Got my car back. Let\'s go.']));
        updateHud();
    };
    // G on foot: a friend's black car within 8 m is yours to drive; your parked car takes you back
    const CAR_REACH = 8;
    const COP_SEES = 45;                                                    // the watching patrol car spots you stepping out with the money within this   // how close to a car G works on foot
    function friendCarNear() { return R.friends.find(x => x !== R.borrowed && x.car.pos.distanceTo(Walk.pos) < CAR_REACH); }
    R.jumpInNearby = function () {
        if (!window.Walk || !Walk.active || Walk.room) return false;
        if (R.ownCar && R.ownCar.pos.distanceTo(Walk.pos) < CAR_REACH) { R.takeOwnCar(); return true; }
        const f = friendCarNear(); if (!f) return false;
        R.driveFriendCar(f);
        return true;
    };
    // the on-foot hint line: what G would get you into from here
    R.carNearby = function () {
        if (!R.on || !window.Walk || !Walk.active || Walk.room) return '';
        if (R.ownCar && R.ownCar.pos.distanceTo(Walk.pos) < CAR_REACH) return 'Your car: press G to get back in';
        const f = friendCarNear(); if (f) return f.name + '\'s car: press G to drive it (he rides along)';
        return '';
    };
    R.onEscaped = function () { if (!R.on || !R.loot) return; UI.toast('You got away with ' + R.loot + ' coins of loot!', 3500); R.loot = 0; };

    R.init = function (sc) { scene = sc; if (Save.get('mode', 'drive') === 'robbery') setTimeout(() => R.setEnabled(true), 500); };

    // the side map: the level's city, every house as a dot, the nearest one left to rob ringed,
    // with its street-corner address and distance underneath (drawn twice a second)
    let mapAt = 0;
    function updateMap() {
        const box = document.getElementById('rob-map'); if (!box) return;
        if (!R.on || !R.city || !window.SelfDrive || !SelfDrive.drawCityTo) { box.classList.remove('on'); return; }
        const now = performance.now(); if (now - mapAt < 500) return; mapAt = now;
        box.classList.add('on');
        const me = (window.Walk && Walk.active) ? Walk.pos : Car.body.position;
        let next = null, bd = Infinity;
        R.targets.forEach(t => { if (t.robbed || t.spooked || t.crewOf) return; const d = Math.hypot(t.p.x - me.x, t.p.z - me.z); if (d < bd) { bd = d; next = t; } });
        const marks = R.targets.map(t => ({ p: t.p, police: !!t.station, color: t.robbed || t.spooked ? '#55606e' : t.station ? '#3fa9ff' : t.crewOf ? '#ff9a3c' : '#ff5a3c', highlight: t === next }));
        SelfDrive.drawCityTo(document.getElementById('rob-map-canvas'), R.city, { marks });
        const text = document.getElementById('rob-map-text');
        if (!next) { text.textContent = R.city.name + ': all robbed'; return; }
        const l = R.city.toLocal(next.p.x, next.p.z), a = SelfDrive.addressAt(R.city, l.lx, l.lz);
        text.textContent = 'NEXT: ' + next.name + ' — ' + a.name + ', ' + R.city.name + ' — ' + (bd > 2000 ? (bd / 1000).toFixed(1) + ' km' : Math.round(bd) + ' m')
            + (bd > 2500 ? ' · ' + R.wayToCity() : '');
    }
    return R;
})();

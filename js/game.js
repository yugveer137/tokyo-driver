// tokyo-driver1 v2 — game state (coins, cars) saved per account through Save, plus the
// coin pickups scattered along the roads around the player.
window.Game = (function () {
    const G = { started: false, state: { coins: 0, ownedCars: ['starter'], selectedCar: 'starter' } };

    G.load = function () {
        G.state.coins = Number(Save.get('coins', 0)) || 0;
        let owned = Save.get('ownedCars', ['starter']);
        if (typeof owned === 'string') { try { owned = JSON.parse(owned); } catch (e) { owned = ['starter']; } }
        if (!Array.isArray(owned) || !owned.length) owned = ['starter'];
        G.state.ownedCars = owned;
        G.state.selectedCar = Save.get('selectedCar', 'starter') || 'starter';
        if (!window.CARS || !CARS[G.state.selectedCar]) G.state.selectedCar = 'starter';
    };
    G.save = function () {
        Save.set('coins', G.state.coins);
        Save.set('ownedCars', G.state.ownedCars);
        Save.set('selectedCar', G.state.selectedCar);
    };
    G.newGame = function () {
        G.state = { coins: 0, ownedCars: ['starter'], selectedCar: 'starter' };
        G.save();
    };
    G.addCoins = function (n) { G.state.coins += n; G.save(); };
    G.carData = function (id) {
        const d = (window.CARS && CARS[id || G.state.selectedCar]) || CFG.DEFAULT_CAR;
        if (!d.id) d.id = id || G.state.selectedCar;
        return d;
    };
    G.buyCar = function (id) {
        const d = CARS[id]; if (!d || G.state.ownedCars.includes(id) || G.state.coins < d.price) return false;
        G.state.coins -= d.price; G.state.ownedCars.push(id); G.save();
        return true;
    };
    G.selectCar = function (id) {
        if (!G.state.ownedCars.includes(id)) return false;
        G.state.selectedCar = id; G.save();
        if (Car.body) {
            const p = Car.body.position, q = Car.body.quaternion;
            const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
            Car.spawn(G.carData(id), new THREE.Vector3(p.x, p.y + 0.5, p.z), yaw);
            if (window.GameAudio) GameAudio.setCar(G.carData(id));
        }
        return true;
    };
    G.start = function () {
        if (G.started) return;
        G.started = true;
        if (window.GameAudio) { GameAudio.init(); GameAudio.setCar(G.carData()); }
    };

    // ---------- coins ----------
    const Coins = { items: [], MAX: 36, R: 420 };
    let scene, coinGeom, coinMat;
    G.initCoins = function (sc) {
        scene = sc;
        coinGeom = new THREE.CylinderGeometry(0.7, 0.7, 0.14, 18); coinGeom.rotateX(Math.PI / 2);
        coinMat = new THREE.MeshStandardMaterial({ color: 0xffd21e, emissive: 0xff9a00, emissiveIntensity: 0.35, metalness: 0.8, roughness: 0.25 });
    };
    function spawnCoin(playerPos) {
        const cands = [];
        Road.all.forEach(r => { if (r.type === 'ramp' || !Object.keys(r.chunks).length) return; const n = Road.nearest(r, playerPos); if (n.dist < Coins.R) cands.push({ r, n }); });
        if (!cands.length) return;
        const { r, n } = cands[Math.floor(Math.random() * cands.length)];
        const lane = r.lanes[Math.floor(Math.random() * r.lanes.length)];
        const s = Math.max(5, Math.min(r.length - 5, n.s + (Math.random() - 0.5) * 2 * Coins.R));
        const p = Road.at(r, s, lane.offset).p;
        if (p.distanceTo(playerPos) < 40 || p.distanceTo(playerPos) > Coins.R) return;
        const m = new THREE.Mesh(coinGeom, coinMat);
        m.position.set(p.x, p.y + 1.1, p.z);
        m.castShadow = true;
        scene.add(m);
        Coins.items.push(m);
    }
    G.coinItems = () => Coins.items;
    G.updateCoins = function (dt, playerPos) {
        if (Coins.items.length < Coins.MAX && Math.random() < 0.4) spawnCoin(playerPos);
        for (let i = Coins.items.length - 1; i >= 0; i--) {
            const m = Coins.items[i];
            m.rotation.y += dt * 2.5;
            const d = m.position.distanceTo(playerPos);
            if (d < 2.8) { scene.remove(m); Coins.items.splice(i, 1); G.addCoins(10); UI.toast('+10 coins'); continue; }
            if (d > Coins.R * 1.8) { scene.remove(m); Coins.items.splice(i, 1); }
        }
    };

    return G;
})();

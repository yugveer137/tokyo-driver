// tokyo-driver1 v2 — what you own besides cars: the things and food you have bought, and houses.
//   SHOP          a panel of what is in your bag: the food (EAT eats one) and the other things,
//                 and a short list to buy from on the spot. The shops downtown (places.js) put
//                 what you buy there into the same bag.
//   BUY A HOUSE   the small houses of the city you are in, a few of them for sale. You bid: a
//                 bid that beats the other buyer's limit wins the house for that many coins,
//                 anything less and the other buyer goes higher. You can never bid more coins
//                 than you have. A house you own gets a YOUR HOUSE board, E at its door goes in
//                 (places.js builds the inside), and GO THERE in the panel drives you to it.
// Saved per account: `bag` ([{ name, food, n }]) and `houses` ([{ key, city, i, j, side, k, ... }]).
window.Shop = (function () {
    const S = {};
    let scene, bag = [], houses = [];
    const $ = (id) => document.getElementById(id);
    const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
    const round10 = (n) => Math.max(10, Math.round(n / 10) * 10);
    const PRICE = 3;
    // what the SHOP panel itself sells (the shops downtown have more)
    const MENU = [['an apple', true], ['a sandwich', true], ['a donut', true], ['a hot chocolate', true], ['a toy car', false], ['a cap', false]];

    // ---------- the bag ----------
    S.add = function (name, food) {
        const have = bag.find(x => x.name === name);
        if (have) have.n++; else bag.push({ name, food: !!food, n: 1 });
        Save.set('bag', bag);
    };
    S.things = () => bag.filter(x => !x.food && x.n > 0);
    function eat(item) {
        if (item.n < 1) return;
        item.n--; bag = bag.filter(x => x.n > 0); Save.set('bag', bag);
        UI.toast('Yum! You ate ' + item.name + '.', 2500);
        renderShop();
    }
    function buy(name, food) {
        if (Game.state.coins < PRICE) { UI.toast('That costs ' + PRICE + ' coins and you have ' + Game.state.coins + '.', 2500); return; }
        Game.addCoins(-PRICE); S.add(name, food);
        renderShop();
    }
    function renderShop() {
        const body = $('shop-body'); body.innerHTML = '';
        $('shop-coins').textContent = Game.state.coins + ' coins';
        const row = (text, button, run) => {
            const r = el('div', undefined, 'own-row'); r.appendChild(el('span', text));
            if (button) { const b = el('button', button, 'toggle-btn'); b.onclick = run; r.appendChild(b); }
            body.appendChild(r);
        };
        const count = (x) => x.name + (x.n > 1 ? '  x' + x.n : '');
        body.appendChild(el('div', 'FOOD YOU CAN EAT', 'own-head'));
        const food = bag.filter(x => x.food && x.n > 0);
        if (!food.length) row('No food yet. Buy some below, or in a market, bakery or cafe downtown.');
        food.forEach(x => row(count(x), 'EAT', () => eat(x)));
        body.appendChild(el('div', 'THINGS YOU BOUGHT', 'own-head'));
        if (!S.things().length) row('Nothing yet. The toy shops, book shops and clothes shops downtown sell things.');
        S.things().forEach(x => row(count(x)));
        body.appendChild(el('div', 'BUY SOMETHING (' + PRICE + ' COINS EACH)', 'own-head'));
        const menu = el('div', undefined, 'own-menu');
        MENU.forEach(([name, isFood]) => { const b = el('button', name, 'toggle-btn'); b.onclick = () => buy(name, isFood); menu.appendChild(b); });
        body.appendChild(menu);
    }
    S.open = function () { renderShop(); $('shop-modal').classList.add('open'); };

    // ---------- houses ----------
    // a number from 0 to 1 that is always the same for the same house
    // (the last three lines stir the bits: without them next-door houses, whose keys differ by
    // one character, came out with the same price and all for sale together)
    function chance(key, salt) {
        let h = salt || 7;
        for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        h ^= h >>> 15; h = Math.imul(h, 2246822519);
        h ^= h >>> 13; h = Math.imul(h, 3266489917);
        h ^= h >>> 16;
        return ((h >>> 0) % 1000) / 1000;
    }
    const cityOf = (id) => World.cities.find(c => c.id === id);
    const planOf = (o) => City.housePlan(cityOf(o.city), o.i, o.j, o.side, o.k);
    S.owns = (key) => houses.some(o => o.key === key);
    // the asking price: more in the big cities, less in the towns, and no two houses the same
    function priceOf(city, plan) {
        const base = city.town ? 220 : (city.id === 'sf' || city.id === 'sanjose') ? 800 : 520;
        return round10(base * (0.75 + chance(plan.key) * 0.5));
    }
    // the city whose houses the panel shows: the one you are in, else the nearest that has houses
    function cityHere() {
        const pos = window.Walk && Walk.active ? Walk.pos : Car.body.position;
        let best = null, bd = Infinity;
        World.cities.forEach(c => { if (!c.suburbCols) return; const d = Math.hypot(c.center.x - pos.x, c.center.z - pos.z); if (d < bd) { bd = d; best = c; } });
        return best;
    }
    // eight of a city's houses are for sale (always the same eight)
    function forSale(city) {
        const all = [];
        for (let i = 0; i < city.rows; i++) for (let j = 0; j < city.suburbCols; j++) [-1, 1].forEach(side => {
            for (let k = 0; k < City.housesPerBlock(city); k++) all.push({ i, j, side, k, key: city.id + ':' + i + ':' + j + ':' + side + ':' + k });
        });
        return all.sort((a, b) => chance(a.key, 3) - chance(b.key, 3)).slice(0, 8)
            .filter(h => !S.owns(h.key))
            .map(h => { const plan = City.housePlan(city, h.i, h.j, h.side, h.k); return Object.assign(h, { address: plan.address, price: priceOf(city, plan) }); });
    }
    // The bidding on a house: the other buyer has bid `high` and will go no higher than `limit`
    // (somewhere round the asking price, and you are not told where).
    const auctions = {};
    function auction(h) {
        return auctions[h.key] || (auctions[h.key] = { high: round10(h.price * 0.7), limit: round10(h.price * (0.85 + chance(h.key, 11) * 0.4)) });
    }
    function bid(city, h, amount) {
        const a = auction(h), coins = Game.state.coins;
        if (!(amount > a.high)) return 'Bid more than ' + a.high + ' coins: that is what the other buyer has offered.';
        if (amount > coins) return 'You only have ' + coins + ' coins.';
        if (amount < a.limit) {                                              // not enough: the other buyer goes higher
            a.high = Math.min(a.limit, round10(amount + h.price * (0.04 + Math.random() * 0.06)));
            return 'The other buyer bid ' + a.high + ' coins. Bid again?';
        }
        Game.addCoins(-amount);
        houses.push({ key: h.key, city: city.id, i: h.i, j: h.j, side: h.side, k: h.k, address: h.address, cityName: city.name, paid: amount });
        Save.set('houses', houses);
        delete auctions[h.key];
        UI.toast('SOLD! ' + h.address + ' in ' + city.name + ' is yours for ' + amount + ' coins.', 5000);
        return null;
    }
    let bidding = null;                                                      // the house whose bidding is open in the panel
    function renderHouses(message) {
        const body = $('house-body'); body.innerHTML = '';
        $('house-coins').textContent = Game.state.coins + ' coins';
        body.appendChild(el('div', 'YOUR HOUSES', 'own-head'));
        if (!houses.length) body.appendChild(el('div', 'You do not own a house yet.', 'own-row'));
        houses.forEach(o => {
            const r = el('div', undefined, 'own-row'); r.appendChild(el('span', o.address + ', ' + o.cityName));
            const b = el('button', 'GO THERE', 'toggle-btn'); b.onclick = () => S.goHome(o); r.appendChild(b);
            body.appendChild(r);
        });
        const city = cityHere();
        if (!city) return;
        body.appendChild(el('div', 'FOR SALE IN ' + city.name.toUpperCase(), 'own-head'));
        const list = forSale(city);
        if (!list.length) body.appendChild(el('div', 'Nothing left for sale here. Try another city.', 'own-row'));
        list.forEach(h => {
            const r = el('div', undefined, 'own-row'); r.appendChild(el('span', h.address + '   asking ' + h.price + ' coins'));
            const open = bidding === h.key;
            const b = el('button', open ? 'CLOSE' : 'BID', 'toggle-btn'); b.onclick = () => { bidding = open ? null : h.key; renderHouses(); }; r.appendChild(b);
            body.appendChild(r);
            if (!open) return;
            // the bidding for this house: what the other buyer has offered, your bid, and what came of it
            const a = auction(h), box = el('div', undefined, 'own-bid');
            box.appendChild(el('div', 'Another buyer has offered ' + a.high + ' coins. The highest bid gets the house. You have ' + Game.state.coins + ' coins.'));
            const line = el('div', undefined, 'own-menu');
            const input = el('input'); input.type = 'number'; input.min = a.high + 10; input.step = 10; input.value = a.high + 10;
            const go = el('button', 'PLACE BID', 'toggle-btn');
            const place = () => { const said = bid(city, h, Math.floor(Number(input.value))); if (said === null) bidding = null; renderHouses(said); };
            go.onclick = place; input.onkeydown = (e) => { if (e.key === 'Enter') place(); };
            line.appendChild(input); line.appendChild(go);
            box.appendChild(line);
            if (message) box.appendChild(el('div', message, 'own-note'));
            body.appendChild(box);
        });
    }
    S.openHouses = function () { bidding = null; renderHouses(); $('house-modal').classList.add('open'); };

    // drive to a house you own: the car is put on the street outside it
    S.goHome = function (o) {
        const city = cityOf(o.city); if (!city) return;
        UI.closeModals();
        if (window.Walk && Walk.active) { if (window.Places && Places.inside) Places.leave(); Walk.getIn(); }
        World.travelTo(city);
        const plan = planOf(o);
        const p = city.toWorld(plan.lx + o.side * (8 + city.street / 2 - 2.5), plan.lz);
        Terrain.update(p); World.update(p, true);
        Car.teleport(p.x, Terrain.height(p.x, p.z) + 1.2, p.z, city.heading);
        UI.toast('Home: ' + o.address + '. Get out (G), walk to the door and press E.', 5000);
    };
    // the house you own whose door is within `reach` of someone on foot (for places.js)
    S.homeNear = function (pos, reach) {
        for (const o of houses) {
            const city = cityOf(o.city); if (!city || !city.loaded) continue;
            const plan = planOf(o);
            if (Math.hypot(plan.p.x - pos.x, plan.p.z - pos.z) < reach && Math.abs(plan.p.y - pos.y) < 3) return { o, city, plan };
        }
        return null;
    };

    // A YOUR HOUSE board over the door of every house you own, while its city is built.
    const boards = {};
    let frame = 0;
    S.update = function () {
        if (frame++ % 30) return;
        houses.forEach(o => {
            const city = cityOf(o.city), up = !!(city && city.loaded);
            if (up && !boards[o.key]) {
                const plan = planOf(o), yaw = city.heading + plan.facing * Math.PI / 2;
                const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.75), Signs.nameFace('YOUR HOUSE', '#0a4a1f'));
                const at = city.toWorld(plan.lx + plan.facing * (plan.d / 2 + 0.12), plan.lz);
                board.position.set(at.x, plan.ground + 3.05, at.z); board.rotation.y = yaw;
                scene.add(board); boards[o.key] = board;
            } else if (!up && boards[o.key]) { scene.remove(boards[o.key]); boards[o.key].geometry.dispose(); delete boards[o.key]; }
        });
    };

    S.init = function (sc) {
        scene = sc;
        bag = Save.get('bag', []); if (!Array.isArray(bag)) bag = [];
        houses = Save.get('houses', []); if (!Array.isArray(houses)) houses = [];
        $('shop-btn').onclick = () => { if (Game.started) S.open(); };
        $('house-btn').onclick = () => { if (Game.started) S.openHouses(); };
    };
    return S;
})();

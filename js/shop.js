// tokyo-driver1 v2 — what you own besides cars: the things and food you have bought, and houses.
//   SHOP          a panel of what is in your bag: the food (EAT eats one) and the other things,
//                 and a short list to buy from on the spot. The shops downtown (places.js) put
//                 what you buy there into the same bag.
//   BUY A HOUSE   the small houses of the city you are in, a few of them for sale. Another
//                 buyer wants each one too. You get ONE bid on a house and so do they, neither
//                 seeing the other's: the higher bid gets the house. Win and it is yours for
//                 what you bid; lose and it is theirs, and you bid on the next house (after two
//                 lost in a row the third is yours whatever you bid). You can
//                 never bid more coins than you have. A house you own gets a YOUR HOUSE board, E
//                 at its door goes in (places.js builds the inside), GO THERE drives you to it.
//   SELL HOUSE    you call the realtor (Rita, of Bay Area Homes) about a house you own and tell
//                 her the price, any price you like. She brings buyers along one after another,
//                 each with a name and a bid round that price, and you choose whose bid to take:
//                 their coins are yours and the house is theirs.
//   The realtor also shows houses: SEE IT on a house for sale drives you there, she is waiting
//   at the door, and E goes round the inside with her (places.js) before you bid.
// Saved per account: `bag` ([{ name, food, n }]), `houses` ([{ key, city, i, j, side, k, ... }])
// and `housesLost` (the keys of the houses the other buyer got).
window.Shop = (function () {
    const S = {};
    let scene, bag = [], houses = [], lost = [];
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
    // eight of a city's houses are for sale at a time: the first eight, in an order that is
    // always the same, that nobody has bought yet
    function forSale(city) {
        const all = [];
        for (let i = 0; i < city.rows; i++) for (let j = 0; j < city.suburbCols; j++) [-1, 1].forEach(side => {
            for (let k = 0; k < City.housesPerBlock(city); k++) all.push({ i, j, side, k, key: city.id + ':' + i + ':' + j + ':' + side + ':' + k });
        });
        return all.sort((a, b) => chance(a.key, 3) - chance(b.key, 3))
            .filter(h => !S.owns(h.key) && lost.indexOf(h.key) === -1).slice(0, 8)
            .map(h => { const plan = City.housePlan(city, h.i, h.j, h.side, h.k); return Object.assign(h, { address: plan.address, price: priceOf(city, plan) }); });
    }
    // The bidding on a house. The other buyer's bid is fixed for the house (somewhere round the
    // asking price) and you are not told it. You bid once: higher than theirs and the house is
    // yours for what you bid, otherwise it is theirs and gone from the list. Returns what to tell
    // the player if the bid could not be placed at all, else null.
    // (70% to 105% of the asking price: at 85-125% a bid of the full asking price lost more often
    // than not, and the owner lost house after house)
    const rivalBid = (h) => round10(h.price * (0.7 + chance(h.key, 11) * 0.35));
    // And the other buyer never wins three times running: after two houses lost in a row, your
    // next bid gets the house whatever it is (they come in a little under you).
    let lossStreak = 0;
    function bid(city, h, amount) {
        const coins = Game.state.coins;
        if (!(amount >= 10)) return 'Type how many coins you bid.';
        if (amount > coins) return 'You only have ' + coins + ' coins.';
        if (amount >= 100) Save.backup();                                 // (a big spend: the save as it was can be had back from SAVES)
        let theirs = rivalBid(h);
        if (lossStreak >= 2 && amount <= theirs) theirs = Math.max(0, Math.floor(amount * 0.9 / 10) * 10);
        if (amount > theirs) {
            lossStreak = 0;
            Game.addCoins(-amount);
            houses.push({ key: h.key, city: city.id, i: h.i, j: h.j, side: h.side, k: h.k, address: h.address, cityName: city.name, paid: amount });
            Save.set('houses', houses);
            result = 'SOLD to you! You bid ' + amount + ' coins and the other buyer bid ' + theirs + '. ' + h.address + ' is yours.';
        } else {
            lossStreak++;
            lost.push(h.key); Save.set('housesLost', lost);
            result = 'The other buyer got ' + h.address + ': they bid ' + theirs + ' coins and you bid ' + amount + '. Bid on another house.';
        }
        Save.set('houseLosses', lossStreak);
        UI.toast(result, 6000);
        if (S.viewing && S.viewing.h.key === h.key) endViewing();           // (the realtor's work on this house is done)
        return null;
    }
    let result = '';                                                         // how the last bidding ended, shown at the top of the panel
    let bidding = null;                                                      // the house whose bidding is open in the panel
    function renderHouses(message) {
        const body = $('house-body'); body.innerHTML = '';
        $('house-coins').textContent = Game.state.coins + ' coins';
        if (result) body.appendChild(el('div', result, 'own-note'));
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
            const open = bidding === h.key, buttons = el('span', undefined, 'own-buttons');
            const see = el('button', 'SEE IT', 'toggle-btn'); see.onclick = () => seeHouse(city, h); buttons.appendChild(see);
            const b = el('button', open ? 'CLOSE' : 'BID', 'toggle-btn'); b.onclick = () => { bidding = open ? null : h.key; renderHouses(); }; buttons.appendChild(b);
            r.appendChild(buttons);
            body.appendChild(r);
            if (!open) return;
            // the bidding for this house: one bid, and no second go
            const box = el('div', undefined, 'own-bid');
            box.appendChild(el('div', 'Another buyer is bidding for this house too. You each get ONE bid and the higher bid gets the house. You have ' + Game.state.coins + ' coins.'));
            if (lossStreak >= 2) box.appendChild(el('div', 'The other buyer got the last two houses. Rita: "Not this time. Make your bid and this one is yours."', 'own-note'));
            const line = el('div', undefined, 'own-menu');
            const input = el('input'); input.type = 'number'; input.min = 10; input.step = 10; input.placeholder = 'your bid';
            const go = el('button', 'PLACE MY ONE BID', 'toggle-btn');
            const place = () => { const said = bid(city, h, Math.floor(Number(input.value))); if (said === null) bidding = null; renderHouses(said); };
            go.onclick = place; input.onkeydown = (e) => { if (e.key === 'Enter') place(); };
            line.appendChild(input); line.appendChild(go);
            box.appendChild(line);
            if (message) box.appendChild(el('div', message, 'own-note'));
            body.appendChild(box);
        });
    }
    S.openHouses = function () { bidding = null; result = ''; renderHouses(); $('house-modal').classList.add('open'); };
    // the panel with one house's bidding already open (from inside the house, with the realtor)
    S.openBid = function (key) { bidding = key; result = ''; renderHouses(); $('house-modal').classList.add('open'); };

    // ---------- seeing a house with the realtor ----------
    // SEE IT: you are driven to the house, a FOR SALE board goes up on it and the realtor waits
    // at the door. S.viewing is that house until its bidding is over or you go to see another.
    const REALTOR = 'Rita', REALTOR_LOOK = { shirt: 0x8a1f3a, pants: 0x1f1f2a, hair: 0x4a2a10 };
    S.viewing = null;
    S.realtor = () => ({ name: REALTOR, look: REALTOR_LOOK });
    function endViewing() {
        const v = S.viewing; if (!v) return;
        S.viewing = null;
        scene.remove(v.who); scene.remove(v.board); v.board.geometry.dispose();
    }
    function seeHouse(city, h) {
        endViewing();
        const plan = City.housePlan(city, h.i, h.j, h.side, h.k);
        driveTo(city, plan);
        const yaw = city.heading + plan.facing * Math.PI / 2;
        const who = Peds.person(REALTOR_LOOK);
        const at = city.toWorld(plan.lx + plan.facing * (plan.d / 2 + 1.6), plan.lz - plan.w / 4 + 1.5);   // beside the door, facing the street
        who.position.set(at.x, plan.ground, at.z); who.rotation.y = yaw; scene.add(who);
        const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.75), Signs.nameFace('FOR SALE', '#7a1f1f'));
        const on = city.toWorld(plan.lx + plan.facing * (plan.d / 2 + 0.12), plan.lz);
        board.position.set(on.x, plan.ground + 3.05, on.z); board.rotation.y = yaw; scene.add(board);
        S.viewing = { city, h, plan, who, board };
        UI.toast(REALTOR + ' the realtor is waiting at the door of ' + h.address + '. Get out (G), walk up to her and press E.', 6000);
    }
    // the house you came to see, if its door is within `reach` of someone on foot (for places.js)
    S.viewNear = function (pos, reach) {
        const v = S.viewing;
        return v && v.city.loaded && Math.hypot(v.plan.p.x - pos.x, v.plan.p.z - pos.z) < reach && Math.abs(v.plan.p.y - pos.y) < 3 ? v : null;
    };

    // ---------- selling ----------
    // A house up for sale: the price you put on it and the bids so far. The buyers bid round
    // your price, whatever it is (the owner of the game wanted to be able to ask a trillion),
    // and the seller picks the winner, who need not be the highest.
    const BUYERS = ['Maya', 'Leo', 'Priya', 'Sam', 'Mr. Tanaka', 'Grandma Rose', 'Diego', 'Zoe', 'Captain Bill', 'Nina'];
    const MAX_PRICE = 1e15;                                                  // (whole numbers are exact well past this)
    const coinsText = (n) => n.toLocaleString('en-US') + ' coins';
    const listings = {};
    let selling = null;                                                      // the house you are on the phone to the realtor about
    let answered = false;                                                    // ...and whether she has picked up yet
    function callRealtor(o) {
        selling = o.key; answered = false; renderSell();
        setTimeout(() => { if (selling === o.key) { answered = true; if ($('sell-modal').classList.contains('open')) renderSell(); } }, 1800);
    }
    function putUp(o, price) {
        const l = listings[o.key] = { price, bids: [], more: 4, names: BUYERS.slice().sort(() => Math.random() - 0.5) };
        const next = () => {
            if (listings[o.key] !== l || !l.more) return;                     // (sold or taken off the market meanwhile)
            // a bid somewhere from 60% to 110% of the asking price, in round numbers
            const raw = price * (0.6 + Math.random() * 0.5), unit = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 1));
            l.bids.push({ name: l.names[l.bids.length], amount: Math.max(1, Math.round(raw / unit) * unit) });
            l.more--;
            if ($('sell-modal').classList.contains('open')) renderSell();
            if (l.more) setTimeout(next, 1400 + Math.random() * 1200);
        };
        setTimeout(next, 1200);
    }
    function sellTo(o, b) {
        Game.addCoins(b.amount);
        houses = houses.filter(x => x.key !== o.key); Save.set('houses', houses);
        lost.push(o.key); Save.set('housesLost', lost);                      // (it is somebody else's now, not for sale again)
        delete listings[o.key];
        UI.toast('SOLD! ' + b.name + ' bought ' + o.address + ' for ' + coinsText(b.amount) + '.', 6000);
        renderSell();
    }
    function renderSell(message) {
        const body = $('sell-body'); body.innerHTML = '';
        $('sell-coins').textContent = coinsText(Game.state.coins);
        body.appendChild(el('div', 'YOUR HOUSES', 'own-head'));
        if (!houses.length) body.appendChild(el('div', 'You do not own a house yet. BUY A HOUSE gets you one to sell.', 'own-row'));
        houses.forEach(o => {
            const l = listings[o.key], open = selling === o.key;
            const r = el('div', undefined, 'own-row'); r.appendChild(el('span', o.address + ', ' + o.cityName + (l ? '   for sale at ' + coinsText(l.price) : '')));
            if (!l) { const b = el('button', open ? 'HANG UP' : 'CALL THE REALTOR', 'toggle-btn'); b.onclick = () => { if (open) { selling = null; renderSell(); } else callRealtor(o); }; r.appendChild(b); }
            body.appendChild(r);
            if (l) {
                // the bids so far: pick whose to take
                const box = el('div', undefined, 'own-bid');
                box.appendChild(el('div', REALTOR + ': "It is on the market. I am showing buyers round now."'));
                if (!l.bids.length) box.appendChild(el('div', 'Waiting for the first buyer...'));
                l.bids.forEach(b => {
                    const row = el('div', undefined, 'own-row'); row.appendChild(el('span', REALTOR + ': "' + b.name + ' offers ' + coinsText(b.amount) + '."'));
                    const take = el('button', 'SELL TO ' + b.name.toUpperCase(), 'toggle-btn'); take.onclick = () => sellTo(o, b); row.appendChild(take);
                    box.appendChild(row);
                });
                if (l.bids.length && l.more) box.appendChild(el('div', 'More buyers are on their way...'));
                if (l.bids.length && !l.more) box.appendChild(el('div', REALTOR + ': "Those are all the offers. You choose who gets the house."', 'own-note'));
                const off = el('button', 'TAKE IT OFF THE MARKET', 'toggle-btn'); off.onclick = () => { delete listings[o.key]; renderSell(); };
                const line = el('div', undefined, 'own-menu'); line.appendChild(off); box.appendChild(line);
                body.appendChild(box);
            } else if (open) {
                // on the phone to the realtor: it rings, she answers, and you tell her your price
                const box = el('div', undefined, 'own-bid');
                if (!answered) { box.appendChild(el('div', 'Calling Bay Area Homes...   ring ring...')); body.appendChild(box); return; }
                box.appendChild(el('div', REALTOR + ': "Bay Area Homes, ' + REALTOR + ' speaking! You want to sell ' + o.address + '? Lovely house. What price shall I put on it? Any price you like."'));
                box.appendChild(el('div', 'You paid ' + coinsText(o.paid) + ' for it.'));
                const line = el('div', undefined, 'own-menu');
                const input = el('input'); input.type = 'number'; input.min = 1; input.placeholder = 'your price'; input.style.width = '200px';
                const go = el('button', 'TELL ' + REALTOR.toUpperCase() + ' THE PRICE', 'toggle-btn');
                const list = () => {
                    const price = Math.floor(Number(input.value));
                    if (!(price >= 1)) { renderSell('Type the price you want, in coins.'); return; }
                    if (price > MAX_PRICE) { renderSell('That is more coins than there are. The most you can ask is ' + coinsText(MAX_PRICE) + '.'); return; }
                    selling = null; putUp(o, price); renderSell();
                };
                go.onclick = list; input.onkeydown = (e) => { if (e.key === 'Enter') list(); };
                line.appendChild(input); line.appendChild(go); box.appendChild(line);
                if (message) box.appendChild(el('div', message, 'own-note'));
                body.appendChild(box);
            }
        });
    }
    S.openSell = function () { selling = null; answered = false; renderSell(); $('sell-modal').classList.add('open'); };

    // drive to a house you own: the car is put on the street outside it
    S.goHome = function (o) {
        const city = cityOf(o.city); if (!city) return;
        driveTo(city, planOf(o));
        UI.toast('Home: ' + o.address + '. Get out (G), walk to the door and press E.', 5000);
    };
    // the panels close and the car is put on the street outside a house
    function driveTo(city, plan) {
        UI.closeModals();
        if (window.Walk && Walk.active) { if (window.Places && Places.inside) Places.leave(); Walk.getIn(); }
        World.travelTo(city);
        const p = city.toWorld(plan.lx + plan.side * (8 + city.street / 2 - 2.5), plan.lz);
        Terrain.update(p); World.update(p, true);
        Car.teleport(p.x, Terrain.height(p.x, p.z) + 1.2, p.z, city.heading);
    }
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
        if (S.viewing && !S.viewing.city.loaded) endViewing();
        // (a house you have sold loses its board)
        Object.keys(boards).forEach(key => { if (!S.owns(key)) { scene.remove(boards[key]); boards[key].geometry.dispose(); delete boards[key]; } });
    };

    S.init = function (sc) {
        scene = sc;
        bag = Save.get('bag', []); if (!Array.isArray(bag)) bag = [];
        houses = Save.get('houses', []); if (!Array.isArray(houses)) houses = [];
        lost = Save.get('housesLost', []); if (!Array.isArray(lost)) lost = [];
        lossStreak = Number(Save.get('houseLosses', 0)) || 0;
        $('shop-btn').onclick = () => { if (Game.started) S.open(); };
        $('house-btn').onclick = () => { if (Game.started) S.openHouses(); };
        $('sell-btn').onclick = () => { if (Game.started) S.openSell(); };
    };
    return S;
})();

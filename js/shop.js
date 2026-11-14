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
//   YOUR GARAGE   every house you own has a garage door and a drive down to the street. Stop on
//                 the street by the drive and P (or the big button) backs the car in: the door
//                 rolls up, the car turns its tail to the house and reverses inside, the door
//                 comes down and you are standing in your house. The grey door inside drives it
//                 out again (so does G by the garage, from outside).
//   In multiplayer every player tells the room which houses are theirs (Shop.myHouses, sent
//   with their car). Those houses get a board with the owner's name, and anyone can walk in
//   (places.js): "This is Yugveer's house". Two players in the same room see each other.
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

    // ---------- other players' houses (multiplayer) ----------
    // the keys of my houses, for the others; and theirs, as Multiplayer hands them over
    S.myHouses = () => houses.slice(0, 6).map(o => o.key);
    let others = [];                                                         // [{ id, name, keys }]
    S.setOthers = function (list) { others = Array.isArray(list) ? list : []; };
    // A house key is "city:i:j:side:k". One that comes from another player is checked before it
    // is believed: a real city, a block of houses in it, a real house on that block.
    function planFromKey(key) {
        const m = /^([a-z]+):(\d+):(\d+):(-?1):(\d+)$/.exec(String(key)); if (!m) return null;
        const city = cityOf(m[1]), i = +m[2], j = +m[3], side = +m[4], k = +m[5];
        if (!city || !city.suburbCols || i >= city.rows || j >= city.suburbCols || k >= City.housesPerBlock(city)) return null;
        return { city, plan: City.housePlan(city, i, j, side, k) };
    }
    // every house that belongs to another player in the room (and not to me), with whose it is
    function friendsHouses() {
        const out = [];
        others.forEach(p => (Array.isArray(p.keys) ? p.keys : []).slice(0, 6).forEach(key => {
            if (S.owns(key) || out.some(x => x.key === key)) return;
            const at = planFromKey(key); if (at) out.push({ key, id: p.id, name: p.name, city: at.city, plan: at.plan });
        }));
        return out;
    }
    // the other player's house whose door is within `reach` of someone on foot (for places.js)
    S.friendHomeNear = function (pos, reach) {
        return friendsHouses().find(h => h.city.loaded && Math.hypot(h.plan.p.x - pos.x, h.plan.p.z - pos.z) < reach && Math.abs(h.plan.p.y - pos.y) < 3) || null;
    };
    // a board with the owner's name over the door of each of them, while its city is built
    const nameBoards = {};
    function dropNameBoard(key) { const b = nameBoards[key]; if (!b) return; scene.remove(b.mesh); b.mesh.geometry.dispose(); delete nameBoards[key]; }
    function friendsBoards() {
        const now = friendsHouses(), wanted = {};
        now.forEach(h => {
            if (!h.city.loaded) return;
            wanted[h.key] = true;
            const text = String(h.name).toUpperCase() + "'S HOUSE";
            if (nameBoards[h.key] && nameBoards[h.key].text === text) return;
            dropNameBoard(h.key);
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.75), Signs.nameFace(text, '#1f3f6a'));
            const at = h.city.toWorld(h.plan.lx + h.plan.facing * (h.plan.d / 2 + 0.12), h.plan.lz);
            mesh.position.set(at.x, h.plan.ground + 3.05, at.z); mesh.rotation.y = h.city.heading + h.plan.facing * Math.PI / 2;
            scene.add(mesh); nameBoards[h.key] = { mesh, text };
        });
        Object.keys(nameBoards).forEach(key => { if (!wanted[key]) dropNameBoard(key); });
    }

    // ---------- the garage of a house you own ----------
    // Where things are, for house o. Along the house's own axes: the garage door is in the
    // street wall at the quarter of the house away from the front door, `inside` is where the
    // car stands in the garage, `mouth` where it waits on the street before backing in, and
    // `yawOut` the heading from the house to the street (the car backs in, so it faces that way).
    function garageOf(o) {
        const city = cityOf(o.city), plan = planOf(o), f = plan.facing, z = plan.lz + plan.w / 4;
        const street = f < 0 ? plan.j : plan.j + 1;                              // the north-south street the house faces (every third is an avenue)
        const half = Road.widthOf(street % 3 === 0 ? 'avenue' : 'street') / 2;
        const xWall = plan.lx + f * plan.d / 2, xRoad = plan.lx + f * (8 + city.street / 2 - half);   // the street wall, and the road's near edge
        const mouth = city.toWorld(xRoad + f * 2.0, z); mouth.y = Terrain.height(mouth.x, mouth.z) + 0.12;
        const inside = city.toWorld(xWall - f * 3.0, z); inside.y = plan.ground + 0.36;
        return { city, plan, f, z, xWall, drive: Math.abs(xRoad - xWall), mouth, inside, yawOut: city.heading + f * Math.PI / 2 };
    }
    // the door (which rolls up), the dark of the garage behind it, and the drive: built with the YOUR HOUSE board
    const garages = {};
    function buildGarage(o) {
        const g = garageOf(o), plan = g.plan, f = g.f;
        const group = new THREE.Group(); group.position.set(plan.centre.x, plan.ground, plan.centre.z); group.rotation.y = g.city.heading;
        const box = (w, h, d, color, x, y, z, basic) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshStandardMaterial({ color, roughness: 0.8 })); m.position.set(x, y, z); m.receiveShadow = true; group.add(m); return m; };
        // (both stand clear of the wall: a house built without a garage has a window there, and its frame sticks out)
        const door = box(0.12, 2.55, 3.0, 0xd8d8d2, f * (plan.d / 2 + 0.24), 1.275, plan.w / 4);
        [-0.6, 0, 0.6].forEach(y => { const line = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 2.8), new THREE.MeshStandardMaterial({ color: 0x8a8a84 })); line.position.y = y; door.add(line); });
        box(0.06, 2.55, 3.0, 0x0a0a0a, f * (plan.d / 2 + 0.15), 1.275, plan.w / 4, true);
        box(g.drive, 0.5, 3.2, 0x55554f, f * (plan.d / 2 + g.drive / 2), 0.11, plan.w / 4);
        scene.add(group);
        return { group, door, open: 0, want: 0 };
    }
    function dropGarage(key) { const g = garages[key]; if (!g) return; scene.remove(g.group); g.group.traverse(m => { if (m.geometry) m.geometry.dispose(); }); delete garages[key]; }
    const setDoor = (key, open) => { if (garages[key]) garages[key].want = open; };
    // The car is moved by hand while it parks or leaves (it passes through the house wall, which
    // is solid): held frozen, as it is under a train, and put where the move says each frame.
    let move = null, busy = false, garaged = null;                           // garaged: { key, o } while the car is inside
    const turnY = new CANNON.Vec3(0, 1, 0);
    function setCar(p, yaw) {
        const b = Car.body;
        b.position.set(p.x, p.y, p.z); b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
        b.quaternion.setFromAxisAngle(turnY, yaw);
    }
    function glide(p1, y1, seconds, then) { const b = Car.body; move = { t: 0, seconds, p0: new THREE.Vector3(b.position.x, b.position.y, b.position.z), y0: Car.yaw(), p1, y1, then }; }
    // the camera stands across the street and watches the garage while the car goes in or out
    // (a frozen car does not move the camera, so it stays where this puts it)
    function watch(g) {
        const out = new THREE.Vector3(Math.sin(g.yawOut), 0, Math.cos(g.yawOut)), side = new THREE.Vector3(out.z, 0, -out.x);
        const cam = game.camera;
        cam.position.copy(g.mouth).addScaledVector(out, 9).addScaledVector(side, 7); cam.position.y += 4.5;
        cam.lookAt(g.inside.x + out.x * 4, g.inside.y + 1, g.inside.z + out.z * 4);
    }
    function showCar(on) { Car.group.visible = on; Car.wheels.forEach(w => { w.visible = on; }); }
    // the house whose drive the car is stopped by, if any
    function driveNear() {
        if (busy || garaged || !Car.body || Car.frozen || Car.parked || Math.abs(Car.mph) > 15) return null;
        const p = Car.body.position;
        for (const o of houses) {
            const city = cityOf(o.city); if (!city || !city.loaded) continue;
            const g = garageOf(o);
            if (Math.hypot(g.mouth.x - p.x, g.mouth.z - p.z) < 10 && Math.abs(g.mouth.y - p.y) < 4) return { o, g };
        }
        return null;
    }
    // what the big button offers while driving (places.js asks): backing into your garage
    S.garagePrompt = function () {
        const near = driveNear();
        return near ? { label: 'BACK INTO YOUR GARAGE', key: 'P', run: () => park(near.o, near.g) } : null;
    };
    S.parkKey = function () { const p = S.garagePrompt(); if (p) p.run(); };
    function park(o, g) {
        busy = true;
        if (window.SelfDrive && SelfDrive.active) SelfDrive.cancel(true);
        Car.cruise = null; Object.assign(Car.keys, { fwd: false, back: false, left: false, right: false, drift: false });
        // how high the car rides over the road, to keep it there on the drive
        const ride = Math.max(0.3, Math.min(1.2, Car.body.position.y - (Terrain.height(Car.body.position.x, Car.body.position.z) + 0.12)));
        const mouth = g.mouth.clone(); mouth.y += ride;
        const inside = g.inside.clone(); inside.y += ride;
        Car.frozen = true;
        setDoor(o.key, 1); watch(g);
        glide(mouth, g.yawOut, 1.6, () => glide(inside, g.yawOut, 2.8, () => {
            setDoor(o.key, 0);
            garaged = { key: o.key, o, g, at: inside, yaw: g.yawOut, mouth };
            showCar(false); busy = false;
            Walk.getOut();                                                  // out of the car, and through into the house
            const home = { o, city: g.city, plan: g.plan };
            Places.goHome(home);
            UI.toast('Parked in your garage. The grey door in the back wall drives the car out again.', 5000);
        }));
    }
    S.garaged = () => garaged;
    // out of the garage: from inside the house (the grey door) or with G by the garage
    S.driveOut = function () {
        const g = garaged; if (!g || busy) return;
        busy = true; garaged = null;
        if (window.Places && Places.inside) Places.leave();
        if (Walk.active) Walk.getIn();
        Car.frozen = true; showCar(true); setCar(g.at, g.yaw);
        setDoor(g.key, 1); watch(g.g);
        // out to the street, then round onto it: into the near lane, the house on the driver's right
        const along = g.yaw - Math.PI / 2, onRoad = g.mouth.clone();
        onRoad.x += Math.sin(along) * 6; onRoad.z += Math.cos(along) * 6;
        glide(g.mouth, g.yaw, 2.4, () => { setDoor(g.key, 0); glide(onRoad, along, 1.5, () => { Car.frozen = false; busy = false; UI.toast('Out of the garage. Off you go.', 2500); }); });
    };
    function garageFrame(dt) {
        if (!Car.body) return;
        if (move) {
            move.t += dt;
            const k = Math.min(1, move.t / move.seconds), e = k * k * (3 - 2 * k);
            let turn = move.y1 - move.y0; while (turn > Math.PI) turn -= 2 * Math.PI; while (turn < -Math.PI) turn += 2 * Math.PI;
            setCar(new THREE.Vector3().lerpVectors(move.p0, move.p1, e), move.y0 + turn * e);
            if (k >= 1) { const then = move.then; move = null; if (then) then(); }
        } else if (garaged) {
            // the car sits in the garage, out of sight. If something else has moved it (fast
            // travel, the tow truck, a train), it is not in the garage any more.
            const b = Car.body.position;
            if (Math.hypot(b.x - garaged.at.x, b.z - garaged.at.z) > 4) { garaged = null; if (!(window.Train && Train.riding)) { Car.frozen = false; showCar(true); } }
            else { Car.frozen = true; setCar(garaged.at, garaged.yaw); showCar(false); }
        }
        Object.keys(garages).forEach(key => {                                // the doors roll up and down
            const g = garages[key];
            if (g.open === g.want) return;
            g.open += Math.sign(g.want - g.open) * Math.min(Math.abs(g.want - g.open), dt * 1.6);
            g.door.scale.y = 1 - 0.93 * g.open; g.door.position.y = 2.55 - 1.275 * g.door.scale.y;
        });
    }

    // A YOUR HOUSE board over the door of every house you own, and its garage, while its city is built.
    const boards = {};
    let frame = 0;
    S.update = function (dt) {
        garageFrame(dt || 0);
        if (frame++ % 30) return;
        houses.forEach(o => {
            const city = cityOf(o.city), up = !!(city && city.loaded);
            if (up && !garages[o.key]) garages[o.key] = buildGarage(o); else if (!up && garages[o.key]) dropGarage(o.key);
            if (up && !boards[o.key]) {
                const plan = planOf(o), yaw = city.heading + plan.facing * Math.PI / 2;
                const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.75), Signs.nameFace('YOUR HOUSE', '#0a4a1f'));
                const at = city.toWorld(plan.lx + plan.facing * (plan.d / 2 + 0.12), plan.lz);
                board.position.set(at.x, plan.ground + 3.05, at.z); board.rotation.y = yaw;
                scene.add(board); boards[o.key] = board;
            } else if (!up && boards[o.key]) { scene.remove(boards[o.key]); boards[o.key].geometry.dispose(); delete boards[o.key]; }
        });
        friendsBoards();
        if (S.viewing && !S.viewing.city.loaded) endViewing();
        // (a house you have sold loses its board)
        Object.keys(boards).forEach(key => { if (!S.owns(key)) { scene.remove(boards[key]); boards[key].geometry.dispose(); delete boards[key]; } });
        Object.keys(garages).forEach(key => { if (!S.owns(key)) dropGarage(key); });
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

// tokyo-driver1 v2 — the route map and self-drive.
// MAP opens a map of the whole route (both freeways, cities, train lines); click a city and
// you get its street map. Only the Waymo drives itself (its SELF DRIVE button opens the map):
// click a street corner and it goes there, following lanes, picking the road that gets
// closest to the destination at each junction, taking city exits, 200 mph on the freeway and
// braking for traffic. Any driving key cancels it.
window.SelfDrive = (function () {
    const S = { active: false, dest: null, road: null, dir: 1, laneIndex: 0, cross: null };
    let canvas, ctx;
    const W = 960, H = 420, PAD = 40;

    S.init = function () {
        canvas = document.getElementById('map-canvas');
        canvas.width = W; canvas.height = H;
        ctx = canvas.getContext('2d');
        canvas.addEventListener('click', onClick);
    };

    // ---------- map ----------
    // Two views. The overview lays each freeway out as a strip, arc length left -> right and
    // lateral offset up -> down (exaggerated so cities are visible beside the road); clicking a
    // city opens its street map, a top-down plan of the grid where a click picks the street
    // corner to drive to. Only the Waymo drives itself; the map is still there to look at.
    const LAT_SCALE = 6;
    S.view = { kind: 'overview' };
    let hits = [];                                                     // city boxes on the overview, for clicks
    function toMap(p) {
        const n = Road.nearest(World.freeway, p), f = n.frame;
        const dx = p.x - f.p.x, dz = p.z - f.p.z;
        const lat = dx * f.right.x + dz * f.right.z;
        return { x: PAD + n.s / World.freeway.length * (W - 2 * PAD), y: H / 2 + lat * LAT_SCALE * (H / 2 - PAD) / 900, s: n.s, lat };
    }
    function fromMap(mx, my) {
        const s = (mx - PAD) / (W - 2 * PAD) * World.freeway.length;
        const lat = (my - H / 2) / (LAT_SCALE * (H / 2 - PAD) / 900);
        return Road.at(World.freeway, Math.max(0, Math.min(World.freeway.length, s)), lat).p;
    }
    // the I-880 strip is drawn below US-101
    const ROW2 = H - 90;
    function toMap2(p) {
        const fw = World.freeways[1]; if (!fw) return null;
        const n = Road.nearest(fw, p), f = n.frame;
        const dx = p.x - f.p.x, dz = p.z - f.p.z;
        const lat = dx * f.right.x + dz * f.right.z;
        return { x: PAD + n.s / fw.length * (W - 2 * PAD), y: ROW2 + lat * LAT_SCALE * 40 / 900, s: n.s, lat, dist: n.dist };
    }
    function fromMap2(mx, my) {
        const fw = World.freeways[1];
        const s = (mx - PAD) / (W - 2 * PAD) * fw.length;
        const lat = (my - ROW2) / (LAT_SCALE * 40 / 900);
        return Road.at(fw, Math.max(0, Math.min(fw.length, s)), lat).p;
    }
    const canSelfDrive = () => !!(Car.data && Car.data.isWaymo);
    S.showOverview = function () { S.view = { kind: 'overview' }; S.draw(); };
    S.showCity = function (city) { S.view = { kind: 'city', city }; S.draw(); };
    S.draw = function () {
        const title = document.getElementById('map-title'), back = document.getElementById('map-back');
        if (S.view.kind === 'city') { drawCity(S.view.city); if (title) title.textContent = S.view.city.name.toUpperCase() + ' STREETS'; if (back) back.style.display = ''; return; }
        if (title) title.textContent = 'MAP'; if (back) back.style.display = 'none';
        drawOverview();
    };
    function drawOverview() {
        hits = [];
        ctx.fillStyle = '#0f1522'; ctx.fillRect(0, 0, W, H);
        // the train lines (one beside each freeway, on its cities' side) and US-101
        ctx.strokeStyle = '#6b6257'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
        if (window.Train) {
            const l1 = Train.lineOf(World.freeway);
            [l1.lat, l1.lat2].forEach(lat => { const y = H / 2 + lat * LAT_SCALE * (H / 2 - PAD) / 900; ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke(); });
            if (World.freeways[1]) { const l2 = Train.lineOf(World.freeways[1]); [l2.lat, l2.lat2].forEach(lat => { const y = ROW2 + lat * LAT_SCALE * 40 / 900; ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke(); }); }
        }
        ctx.setLineDash([]);
        ctx.strokeStyle = '#cfd3d8'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(PAD, H / 2); ctx.lineTo(W - PAD, H / 2); ctx.stroke();
        ctx.fillStyle = '#9ab'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(World.freeway.name, PAD, H / 2 - 10);
        // I-880 strip
        if (World.freeways[1]) {
            ctx.strokeStyle = '#b9bec4'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(PAD, ROW2); ctx.lineTo(W - PAD, ROW2); ctx.stroke();
            ctx.fillStyle = '#9ab'; ctx.fillText(World.freeways[1].name + ' (east bay, joins ' + World.freeway.name + ' before San Jose)', PAD, ROW2 - 10);
        }
        // cities: box + name + exit number (click one for its street map)
        World.cities.forEach(c => {
            const onLoop = c.fw && c.fw.index === 1;
            const m = onLoop ? toMap2(new THREE.Vector3(c.center.x, 0, c.center.z)) : toMap(new THREE.Vector3(c.center.x, 0, c.center.z));
            const w = Math.max(26, c.D / c.fw.length * (W - 2 * PAD)), h = Math.max(14, c.W * LAT_SCALE * (onLoop ? 40 : (H / 2 - PAD)) / 900);
            ctx.fillStyle = c.loaded ? 'rgba(124,247,168,0.25)' : 'rgba(90,110,140,0.35)';
            ctx.fillRect(m.x - w / 2, m.y - h / 2, w, h);
            ctx.strokeStyle = '#7cf7a8'; ctx.lineWidth = 1; ctx.strokeRect(m.x - w / 2, m.y - h / 2, w, h);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(c.name, m.x, m.y + h / 2 + 16);
            if (c.exitNumber) { ctx.fillStyle = '#ffd21e'; ctx.font = '11px sans-serif'; ctx.fillText('Exit ' + c.exitNumber, m.x - w / 2 - 10, (onLoop ? ROW2 : H / 2) + 16); }
            ctx.textAlign = 'left';
            hits.push({ city: c, x0: m.x - w / 2 - 8, x1: m.x + w / 2 + 8, y0: m.y - h / 2 - 8, y1: m.y + h / 2 + 20 });
        });
        // player (on whichever strip is closer)
        if (Car.body) {
            const m2 = toMap2(Car.body.position), m1 = toMap(Car.body.position);
            const m = (m2 && m2.dist < Road.nearest(World.freeway, Car.body.position).dist) ? m2 : m1;
            ctx.fillStyle = '#7cf7a8'; ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, 6.3); ctx.fill();
            ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
        }
        if (S.dest) drawCross(destOnOverview(S.dest));
        ctx.fillStyle = '#9ab'; ctx.font = '12px sans-serif';
        ctx.fillText(canSelfDrive() ? 'Click a city for its street map, or anywhere on a freeway to self-drive there.' : 'Click a city for its street map. Only the Waymo drives itself (GARAGE).', PAD, H - 12);
    }
    function destOnOverview(p) {
        const m2 = toMap2(p);
        return (m2 && m2.dist < Road.nearest(World.freeway, p).dist) ? m2 : toMap(p);
    }
    function drawCross(m) {
        ctx.strokeStyle = '#ff5d7a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(m.x - 7, m.y - 7); ctx.lineTo(m.x + 7, m.y + 7); ctx.moveTo(m.x + 7, m.y - 7); ctx.lineTo(m.x - 7, m.y + 7); ctx.stroke();
    }
    // ---- the street map of one city ----
    // Local x runs across the grid toward the freeway (right), local z along it (down). The map
    // shows the grid, the frontage road, the rails and station, and the freeway at the edge.
    const FRONT_LX = (c) => c.W / 2 + 34;                              // the frontage road's local x (see World.loadCityRoads)
    // g = the canvas to draw on: {ctx, W, H, PAD} (the big map by default; the robbery side map is small)
    function cityScale(c, g) {
        const lx0 = -c.W / 2 - 30, lx1 = FRONT_LX(c) + 60, lz0 = -c.D / 2 - 90, lz1 = c.D / 2 + 90;
        const k = Math.min((g.W - 2 * g.PAD) / (lx1 - lx0), (g.H - 2 * g.PAD) / (lz1 - lz0));
        const ox = g.PAD + ((g.W - 2 * g.PAD) - (lx1 - lx0) * k) / 2 - lx0 * k, oz = g.PAD + ((g.H - 2 * g.PAD) - (lz1 - lz0) * k) / 2 - lz0 * k;
        return { k, toX: (lx) => ox + lx * k, toZ: (lz) => oz + lz * k, fromX: (x) => (x - ox) / k, fromZ: (y) => (y - oz) / k };
    }
    const mainG = () => ({ ctx, W, H, PAD });
    function drawCity(c, g, extras) {
        g = g || mainG(); extras = extras || {};
        const ctx = g.ctx, W = g.W, H = g.H, PAD = g.PAD, small = g.W < 400;
        const m = cityScale(c, g), ns = c.streets.ns, ew = c.streets.ew;
        ctx.fillStyle = '#0f1522'; ctx.fillRect(0, 0, W, H);
        // blocks (parks green)
        for (let j = 0; j < c.cols; j++) for (let i = 0; i < c.rows; i++) {
            const park = (c.parks || []).some(p => p[0] === j && p[1] === i);
            ctx.fillStyle = park ? '#1f5a35' : '#202a3a';
            const x = m.toX(c.streetX(j) + c.street / 2), y = m.toZ(c.streetZ(i) + c.street / 2);
            ctx.fillRect(x, y, c.block * m.k, c.block * m.k);
        }
        // streets with their names: north-south (vertical) then east-west (horizontal)
        ctx.lineCap = 'round';
        for (let j = 0; j <= c.cols; j++) {
            const x = m.toX(c.streetX(j)), avenue = j % 3 === 0;
            ctx.strokeStyle = avenue ? '#cfd3d8' : '#8a93a3'; ctx.lineWidth = Math.max(2, c.street * m.k * (avenue ? 0.8 : 0.55));
            ctx.beginPath(); ctx.moveTo(x, m.toZ(c.streetZ(0))); ctx.lineTo(x, m.toZ(c.streetZ(c.rows))); ctx.stroke();
            if (!small) { ctx.save(); ctx.translate(x, m.toZ(c.streetZ(0)) - 6); ctx.rotate(-Math.PI / 2); ctx.fillStyle = '#dfe6f0'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(ns[j % ns.length], 0, 4); ctx.restore(); }
        }
        for (let i = 0; i <= c.rows; i++) {
            const y = m.toZ(c.streetZ(i));
            ctx.strokeStyle = '#8a93a3'; ctx.lineWidth = Math.max(2, c.street * m.k * 0.55);
            ctx.beginPath(); ctx.moveTo(m.toX(c.streetX(0)), y); ctx.lineTo(m.toX(c.streetX(c.cols)), y); ctx.stroke();
            if (!small) { ctx.fillStyle = '#dfe6f0'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'right'; ctx.fillText(ew[i % ew.length], m.toX(c.streetX(0)) - 8, y + 4); }
        }
        // the frontage road, its stubs to the grid, the rails + station, and the freeway
        const fx = m.toX(FRONT_LX(c));
        ctx.strokeStyle = '#cfd3d8'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(fx, m.toZ(-c.D / 2 - 40)); ctx.lineTo(fx, m.toZ(c.D / 2 + 40)); ctx.stroke();
        ctx.lineWidth = 2; for (let i = 0; i <= c.rows; i += 2) { const y = m.toZ(c.streetZ(i)); ctx.beginPath(); ctx.moveTo(m.toX(c.streetX(c.cols)), y); ctx.lineTo(fx, y); ctx.stroke(); }
        ctx.setLineDash([3, 3]); ctx.strokeStyle = '#6b6257'; ctx.lineWidth = 1.5;
        [FRONT_LX(c) - 12, FRONT_LX(c) - 26].forEach(lx => { const x = m.toX(lx); ctx.beginPath(); ctx.moveTo(x, m.toZ(-c.D / 2 - 50)); ctx.lineTo(x, m.toZ(c.D / 2 + 50)); ctx.stroke(); });
        ctx.setLineDash([]);
        ctx.fillStyle = '#3fa9ff'; ctx.fillRect(m.toX(FRONT_LX(c) - 22) - 3, m.toZ(-32), 6, 64 * m.k);
        if (!small) { ctx.fillStyle = '#9fd3ff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('STATION', m.toX(FRONT_LX(c) - 19), m.toZ(40)); }
        const wx = m.toX(FRONT_LX(c) + 48);
        ctx.strokeStyle = '#e8ecf0'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(wx, PAD / 2); ctx.lineTo(wx, H - PAD / 2); ctx.stroke();
        ctx.save(); ctx.translate(wx + 14, H / 2); ctx.rotate(Math.PI / 2); ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(c.fw.name, 0, 0); ctx.restore();
        if (!small) { ctx.save(); ctx.translate(fx + 12, H / 2); ctx.rotate(Math.PI / 2); ctx.fillStyle = '#cfd3d8'; ctx.font = '10px sans-serif'; ctx.fillText('Frontage Rd', 0, 0); ctx.restore(); }
        // landmark, player, destination
        ctx.fillStyle = '#ffd21e'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('★', m.toX(c.lmX), m.toZ(c.lmZ) + 5);
        if (Car.body) { const l = c.toLocal(Car.body.position.x, Car.body.position.z); if (Math.abs(l.lx) < c.W + 200 && Math.abs(l.lz) < c.D + 200) { ctx.fillStyle = '#7cf7a8'; ctx.beginPath(); ctx.arc(m.toX(l.lx), m.toZ(l.lz), 6, 0, 6.3); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke(); } }
        if (S.dest && !small) { const l = c.toLocal(S.dest.x, S.dest.z); if (Math.abs(l.lx) < c.W + 200 && Math.abs(l.lz) < c.D + 200) drawCross({ x: m.toX(l.lx), y: m.toZ(l.lz) }); }
        // extra marks (robbery houses): dots, the highlighted one with a ring
        (extras.marks || []).forEach(mk => {
            const l = c.toLocal(mk.p.x, mk.p.z), x = m.toX(l.lx), y = m.toZ(l.lz);
            if (mk.police) {                                                   // the police station: a blue square with a P
                ctx.fillStyle = mk.color || '#3fa9ff'; ctx.fillRect(x - 7, y - 7, 14, 14);
                ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('P', x, y + 4);
            } else { ctx.fillStyle = mk.color || '#ff5a3c'; ctx.beginPath(); ctx.arc(x, y, mk.big ? 6 : 4, 0, 6.3); ctx.fill(); }
            if (mk.highlight) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 11, 0, 6.3); ctx.stroke(); }
        });
        if (!small) {
            ctx.fillStyle = '#9ab'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
            ctx.fillText(canSelfDrive() ? 'Click a street corner and the Waymo drives there.' : 'Only the Waymo drives itself: pick it in the GARAGE.', PAD, H - 12);
        }
    }
    // draw a city's street map on any canvas (the robbery side map)
    S.drawCityTo = function (cv, city, extras) {
        const g = { ctx: cv.getContext('2d'), W: cv.width, H: cv.height, PAD: 10 };
        drawCity(city, g, extras);
    };
    S.addressAt = (c, lx, lz) => addressAt(c, lx, lz);
    // the nearest street corner to a local point, as an address
    function addressAt(c, lx, lz) {
        const j = Math.max(0, Math.min(c.cols, Math.round((lx + c.W / 2) / c.pitch))), i = Math.max(0, Math.min(c.rows, Math.round((lz + c.D / 2) / c.pitch)));
        if (lx > c.W / 2 + 20) return { lx: FRONT_LX(c), lz: Math.max(-c.D / 2, Math.min(c.D / 2, lz)), name: 'the frontage road' };
        return { lx: c.streetX(j), lz: c.streetZ(i), name: c.streets.ns[j % c.streets.ns.length] + ' & ' + c.streets.ew[i % c.streets.ew.length] };
    }
    function onClick(e) {
        const r = canvas.getBoundingClientRect();
        const mx = (e.clientX - r.left) * W / r.width, my = (e.clientY - r.top) * H / r.height;
        if (S.view.kind === 'overview') {
            const hit = hits.find(h => mx >= h.x0 && mx <= h.x1 && my >= h.y0 && my <= h.y1);
            if (hit) { S.showCity(hit.city); return; }
            if (!canSelfDrive()) { UI.toast('Only the Waymo drives itself — pick it in the GARAGE. Click a city to see its streets.', 3000); return; }
            S.goTo(World.freeways[1] && my > ROW2 - 45 ? fromMap2(mx, my) : fromMap(mx, my));
            UI.closeModals();
            return;
        }
        const c = S.view.city, m = cityScale(c, mainG());
        const a = addressAt(c, m.fromX(mx), m.fromZ(my));
        if (!canSelfDrive()) { UI.toast(a.name + ', ' + c.name + ' — only the Waymo drives itself (GARAGE)', 3000); return; }
        S.goTo(c.toWorld(a.lx, a.lz), { label: a.name + ', ' + c.name });
        UI.closeModals();
    }

    // ---------- self-drive ----------
    S.goTo = function (point, opts) {
        opts = opts || {};
        if (!opts.tow && !canSelfDrive()) { UI.toast('Only the Waymo drives itself — pick it in the GARAGE', 3000); return; }
        // snap to the nearest built road
        let best = null, bd = Infinity;
        Road.all.forEach(r => { if (!Object.keys(r.chunks).length) return; const n = Road.nearest(r, point); if (n.dist < bd) { bd = n.dist; best = { r, n }; } });
        S.dest = best ? best.n.frame.p.clone() : point.clone();
        S.destRoad = best ? best.r : null;
        // a point inside a city whose streets are not built yet would snap onto the freeway;
        // keep the city as the goal and snap again once its streets exist
        // (a point in a city whose streets are not built yet: the nearest built road may be the
        // freeway, or a bridge ramp a mile off, so the city stays the goal until its streets exist)
        S.destCity = null;
        const city = World.cities.find(c => Math.hypot(c.center.x - point.x, c.center.z - point.z) < c.radius + 60);
        if (city && !(best && bd < 60 && city.roads.indexOf(best.r) !== -1)) { S.destCity = city; S.dest = point.clone(); S.destRoad = null; S.target = point.clone(); }
        // (a point out on the other freeway, unbuilt yet: keep it as the goal and snap once a road is built within 60 m)
        S.farSnap = !S.destCity && (!best || bd > 100);
        if (S.farSnap) { S.dest = point.clone(); S.destRoad = null; S.target = point.clone(); }
        S.active = true; S.cross = null; S.opts = opts; S.lastTow = null; S.kinRoad = null; S.roaming = false;
        S.stuck = 0; S.turn = null; S.flipTurn = false;                     // (a fresh trip: the last one's stuck timer and turn are gone)
        const cur = nearestRoad(Car.body.position);
        S.road = cur.r; S.dir = headingDir(cur.r, cur.n);
        S.laneIndex = S.road.lanes.filter(l => l.dir === S.dir).length - 1;
        if (!opts.quiet) UI.toast('Self-drive on' + (opts.label ? ' to ' + opts.label : '') + ' — ' + Math.round(S.dest.distanceTo(Car.body.position)) + ' m. Touch the wheel to cancel.', 3500);
    };
    S.cancel = function (quiet) {
        if (!S.active) return;
        S.active = false; Car.assistSteer = null; Car.cruise = null; Car.autoBrake = false; Car.assistReverse = false; S.turn = null; S.flipTurn = false; S.farSnap = false;
        if (!quiet) UI.toast('Self-drive off');
    };
    function nearestRoad(pos) {
        let best = null, bd = Infinity;
        Road.all.forEach(r => { if (!Object.keys(r.chunks).length) return; const n = Road.nearest(r, pos); if (n.dist < bd) { bd = n.dist; best = { r, n }; } });
        // a ramp's shared stretch (an exit's first 150 m, an on-ramp's last 320 m) runs inside
        // the freeway's corridor, so a car in the outer lane is "nearest" to it: while we are on
        // the freeway count that as the freeway, unless we deliberately turned onto the ramp
        if (best && best.r.type === 'ramp' && best.r !== S.road && best.r.from) {
            const shared = (best.r.isExit && best.n.s < 150) || (best.r.isOnramp && best.n.s > best.r.length - 320);
            if (shared) { const nf = Road.nearest(best.r.from, pos); if (nf.dist < best.r.from.width * 0.6) best = { r: best.r.from, n: nf }; }
        }
        return best;
    }
    // how squarely the car points along the road (1 = dead ahead in our direction)
    function alignedWith(n) {
        const yaw = Car.yaw();
        return (Math.sin(yaw) * n.frame.tan.x + Math.cos(yaw) * n.frame.tan.z) * S.dir;
    }
    function headingDir(road, n) {
        const yaw = Car.yaw(), fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        return fwd.dot(n.frame.tan) >= 0 || !road.typeDef.twoWay ? 1 : -1;
    }
    // the city the destination is in (or nearest to, within its plateau)
    function destCity() {
        let best = null, bd = Infinity;
        World.cities.forEach(c => { const d = Math.hypot(c.center.x - S.dest.x, c.center.z - S.dest.z); if (d < c.radius + 150 && d < bd) { bd = d; best = c; } });
        return best;
    }
    // The U-turn loops sit at city.s + 1500 (leaving the forward carriageway) and city.s + 2400
    // (leaving the other one). Pick the first one ahead of us that leaves the exit ahead of us
    // afterwards; if we are heading the right way but have passed the exit, any loop will do
    // (the next call plans the second one).
    function chooseUturn(fw, s, dir, want) {
        // the loops that actually exist on this freeway (their link sits 40 m before the loop's s);
        // a city with a bridge interchange has no return loop, so a fixed list planned loops that
        // were never built
        const cands = Traffic.links.filter(l => l.from === fw && l.to.isUturn).map(l => ({ s: l.sFrom + l.fromDir * 40, fromDir: l.fromDir }));
        // (a loop is still "ahead" until we are 20 m from it: its link sits 40 m before u.s)
        const ahead = cands.filter(u => u.fromDir === dir && (dir === 1 ? u.s > s + 20 : u.s < s - 20)).sort((a, b) => dir === 1 ? a.s - b.s : b.s - a.s);
        if (dir !== want.dir) return ahead.find(u => want.dir === -1 ? u.s > want.s + 50 : u.s < want.s - 50) || null;   // (a city's own loop at s+1300 leads back to its exit at s+1200)
        return ahead[0] || null;
    }
    // where an exit leads: a ramp onto another freeway (a bridge) counts as the point 1.5 km along
    // it in the merge direction (the two ramps at a bridge end finish side by side, only their
    // freeways point different ways), any other ramp as its end
    function leadsTo(l) {
        const j = joinOf(l.to, l.from);
        return j ? Road.at(j.fw, Math.max(0, Math.min(j.fw.length, j.s + j.dir * 1500)), 0).p : Road.at(l.to, l.to.length, 0).p;
    }
    // the freeway a ramp joins at its end, and where and which way: through a traffic link, or
    // (the bridge exits) just by running into the freeway's deck
    function joinOf(ramp, from, depth) {
        const merge = Traffic.links.find(m => m.from === ramp && m.to.type === 'freeway');
        if (merge) return { fw: merge.to, s: merge.sTo, dir: merge.toDir };
        // (roads never move: a join once found is kept; a miss is looked for again after 2 s, in
        // case the freeway it meets is still to be built)
        if (ramp._sdJoin) return ramp._sdJoin;
        const now = performance.now(); if (ramp._sdMiss && now - ramp._sdMiss < 2000) return null;
        const e = Road.at(ramp, ramp.length, 0);
        let best = null;
        Road.all.forEach(f => {
            if (f.type !== 'freeway' || f === from) return;
            const n = Road.nearest(f, e.p);
            if (n.dist < 25 && Math.abs(n.frame.p.y - e.p.y) < 4 && (!best || n.dist < best.n.dist)) best = { f, n };
        });
        if (best) return (ramp._sdJoin = { fw: best.f, s: best.n.s, dir: e.tan.dot(best.n.frame.tan) >= 0 ? 1 : -1 });
        // a ramp that ends where another begins (a bridge's ground-level exit runs on into an
        // on-ramp): follow the chain to the freeway it finally joins
        if ((depth || 0) < 3) {
            // (the nearest ramp starting within 80 m at the same height: the deck-level ramp
            // right beside a ground-level one is not its continuation)
            let next = null, nd = 80;
            Road.all.forEach(r => {
                if (r.type !== 'ramp' || r === ramp) return;
                const p0 = Road.at(r, 0, 0).p, d = p0.distanceTo(e.p);
                if (d < nd && Math.abs(p0.y - e.p.y) < 7) { nd = d; next = r; }   // (ground ramps dip under the freeway: a few metres apart; the deck is 14+ above)
            });
            const j = next && joinOf(next, from, (depth || 0) + 1);
            if (j) return (ramp._sdJoin = j);
        }
        ramp._sdMiss = now; return null;
    }
    // how close joining freeway `fw` at `s` heading `dir` can get us: the best of driving on 4 km
    // and any exit in those 4 km (a straight line from the ramp's end would send us the wrong way
    // when the way to the destination is a bridge further along)
    function viaBest(fw, s, dir) {
        const end = Math.max(0, Math.min(fw.length, s + dir * 4000));
        let best = { d: Road.at(fw, end, 0).p.distanceTo(S.dest), s: end };
        Traffic.links.forEach(l => {
            if (l.from !== fw || !l.to.isExit || l.to.isUturn || l.fromDir !== dir) return;
            const ahead = (l.sFrom - s) * dir; if (ahead < 0 || ahead > 4000) return;
            const d = leadsTo(l).distanceTo(S.dest);
            if (d < best.d) best = { d, s: l.sFrom };
        });
        return best;
    }
    function viaScore(fw, s, dir) { return viaBest(fw, s, dir).d; }
    S._dbg = { viaBest, leadsTo, joinOf, rampScore };                       // (console access for testing routes)
    // an on-ramp's worth: by what its freeway reaches, else by its own end
    function rampScore(o) {
        const j = joinOf(o, null);
        return j ? viaScore(j.fw, j.s, j.dir) : Road.at(o, o.length, 0).p.distanceTo(S.dest);
    }
    // the index (among the lanes going our way) of the lane nearest the car
    function nearestLane(road, dir, pos) {
        const n = Road.nearest(road, pos), ls = road.lanes.filter(l => l.dir === dir);
        let best = 0, bd = Infinity;
        ls.forEach((l, k) => { const p = Road.at(road, n.s, l.offset).p, d = Math.hypot(p.x - pos.x, p.z - pos.z); if (d < bd) { bd = d; best = k; } });
        return best;
    }
    // a loop more than 2.5 km off is not worth it: the next exit and a turn on the frontage road is quicker
    function nearLoop(u, s) { return u && Math.abs(u.s - s) < 2500 ? u : null; }
    function laneOf(road, dir, idx) { const ls = road.lanes.filter(l => l.dir === dir); return ls[Math.min(idx, ls.length - 1)] || road.lanes[0]; }
    // at the end of the road: choose the connected road whose far end is closest to the destination
    function chooseNext() {
        const r = S.road, atEnd = S.dir === 1;
        const endP = Road.at(r, atEnd ? r.length : 0, 0).p;
        // ramps and U-turn loops merge onto a freeway: the traffic link says where and which way
        const merge = Traffic.links.find(l => l.from === r && l.to.type === 'freeway');
        if (merge) return { road: merge.to, dir: merge.toDir, far: Road.at(merge.to, merge.toDir === 1 ? merge.to.length : 0, 0).p };
        const opts = [];
        Road.all.forEach(o => {
            if (o === r || !Object.keys(o.chunks).length) return;
            const ps = Road.at(o, 0, 0).p, pe = Road.at(o, o.length, 0).p;
            if (ps.distanceTo(endP) < 36) opts.push({ road: o, dir: 1, far: pe });
            else if (pe.distanceTo(endP) < 36 && o.typeDef.twoWay) opts.push({ road: o, dir: -1, far: ps });
            else if (o.type !== 'freeway' && Road.nearest(o, endP).dist < 20) {            // we land part-way along it (ramp onto a frontage road)
                opts.push({ road: o, dir: 1, far: pe });
                if (o.typeDef.twoWay) opts.push({ road: o, dir: -1, far: ps });
            }
        });
        if (!opts.length) return null;
        opts.sort((a, b) => a.far.distanceTo(S.dest) - b.far.distanceTo(S.dest));
        return opts[0];
    }
    // Waymo mode: with no destination picked it just drives the road it is on at the limit, taking
    // the next road at the end, like the real ones cruising for a fare. Touch the wheel and it
    // hands over; let go for two seconds and it takes back.
    S.roam = function () {
        const cur = nearestRoad(Car.body.position); if (!cur) return;
        S.road = cur.r; S.dir = headingDir(cur.r, cur.n); S.destRoad = cur.r; S.roaming = true;
        S.dest = Road.at(cur.r, S.dir === 1 ? cur.r.length : 0, 0).p.clone();
        S.active = true; S.cross = null; S.opts = { quiet: true }; S.lastTow = null; S.kinRoad = null; S.destCity = null; S.stuck = 0; S.turn = null; S.flipTurn = false;
        S.laneIndex = S.road.lanes.filter(l => l.dir === S.dir).length - 1;
    };
    let idle = 0, btnShown = null;
    S.update = function (dt) {
        const hands = Car.keys.fwd || Car.keys.back || Car.keys.left || Car.keys.right;
        const waymo = canSelfDrive();
        if (waymo !== btnShown) { const b = document.getElementById('selfdrive-btn'); if (b) b.style.display = waymo ? '' : 'none'; btnShown = waymo; }
        if (Car.body && Car.data && Car.data.isWaymo && Game.started && !Car.parked && !Car.frozen && !Car.towed) {
            idle = hands ? 0 : idle + dt;
            if (!S.active && idle > 2) { S.roam(); UI.toast('Waymo: self-driving. Pick a place on the MAP, or just ride along.', 2500); }
        }
        if (!S.active || !Car.body) return;
        if (!waymo && !(S.opts && S.opts.tow)) { S.cancel(true); S.roaming = false; return; }   // (changed car in the garage: only the Waymo drives itself; the tow truck pulls any car)
        if (hands) { S.cancel(S.roaming); S.roaming = false; return; }
        const pos = Car.body.position;
        if (S.roaming) {                                                   // keep the target at the end of whatever road we are on
            const end = Road.at(S.road, S.dir === 1 ? S.road.length : 0, 0).p;
            if (end.distanceTo(S.dest) > 1) { S.dest = end.clone(); S.destRoad = S.road; }
            if (pos.distanceTo(S.dest) < 40 && S.road.type === 'freeway') { S.dir = -S.dir; S.laneIndex = S.road.lanes.filter(l => l.dir === S.dir).length - 1; }   // end of the line: turn back (the loops are for exits)
        }
        if (S.farSnap && S.scan % 30 === 0) {
            let fb = null, fd = 60;
            Road.all.forEach(r => { if (!Object.keys(r.chunks).length) return; const m = Road.nearest(r, S.target); if (m.dist < fd) { fd = m.dist; fb = { r, m }; } });
            if (fb) { S.dest = fb.m.frame.p.clone(); S.destRoad = fb.r; S.farSnap = false; }
        }
        if (S.destCity && S.destCity.loaded && !S.destRoad) {
            // the city's streets are built now: aim at the street nearest the original point
            let best = null, bd = Infinity;
            // (a street near the point: a city loads its bridge and ramps at once but its streets only
            // as we come near, and snapping to a ramp out in the bay would end the trip there)
            S.destCity.roads.forEach(r => { if (r.type === 'ramp' || r.type === 'freeway' || !Object.keys(r.chunks).length) return; const n = Road.nearest(r, S.target); if (n.dist < bd) { bd = n.dist; best = { r, n }; } });
            if (best && bd < 300) { S.dest = best.n.frame.p.clone(); S.destRoad = best.r; }
        }
        if (pos.distanceTo(S.dest) < 14 && !S.roaming) {
            const o = S.opts || {};
            S.cancel(true); Car.cruise = null;
            if (o.tow) S.lastTow = 'arrived';
            if (o.onArrive) o.onArrive(); else if (!o.quiet) UI.toast('You have arrived.', 2500);
            return;
        }
        // re-snap to whatever road we're actually on (ramps, lane changes)
        // (only once we've actually left the current road's corridor, so a turn in progress sticks)
        const cur = nearestRoad(pos);
        let n = Road.nearest(S.road, pos);
        // (a ramp we have just turned onto starts inside the freeway's corridor, and its first
        // frame may still be a little ahead of us: stay with it unless we have clearly fallen off)
        const approaching = S.road.type === 'ramp' && n.s < 1 && n.dist < 80;
        const offOurs = !approaching && n.dist > Math.max(S.road.width * 0.7, S.road.type === 'ramp' ? 12 : 0);
        // (never onto a deck above or below us: an on-ramp passes under the freeway)
        if (cur && cur.r !== S.road && cur.n.dist < cur.r.width * 0.6 && Math.abs(pos.y - cur.n.frame.p.y) < 3 && offOurs) { S.road = cur.r; S.dir = headingDir(cur.r, cur.n); S.laneIndex = Math.min(S.laneIndex, S.road.lanes.filter(l => l.dir === S.dir).length - 1); n = Road.nearest(S.road, pos); }
        // On the freeway: every city has an exit on both carriageways (1200 before it on its own
        // side, 1000 before it on the other, see World.loadFarRamps). If ours is already behind
        // us, plan a U-turn loop and take the other one; otherwise take the exit when it comes.
        const onFreeway = S.road.type === 'freeway';
        S.wantUturn = null;
        if (onFreeway && S.destRoad !== S.road) {
            const city = destCity();
            if (city && city.fw === S.road) {
                // (a town's own-side exit is closer in; the far-side one sits 1000 out like a city's)
                const exitS = (dir) => dir === city.side ? city.s - city.side * (city.town ? 650 : 1200) : city.s + city.side * 1000;
                const want = { dir: S.dir, s: exitS(S.dir) };
                const exitAhead = S.dir === 1 ? n.s < want.s - 60 : n.s > want.s + 60;
                S.wantExit = exitAhead ? want.s : null; S.offFw = false;                          // the city's own exit is ahead: that one and no other (a bridge ramp's end can look nearer)
                if (!exitAhead) S.wantUturn = nearLoop(chooseUturn(S.road, n.s, S.dir, { dir: -S.dir, s: exitS(-S.dir) }), n.s);
                // no loop ahead of us (north of the first city, say): the next exit of any city
                // will do, its ramps lead round to the other carriageway
                S.anyExit = !exitAhead && !S.wantUturn;
            } else {
                // the destination is off this freeway (the other one, over a bridge): if the best
                // way off behind us (an exit, a bridge) beats the best one ahead, we are heading
                // away from it, so turn round the same way and make for that one
                S.wantExit = null;
                S.offFw = !!city;                                               // (a city across the bay: only an exit onto another freeway is progress, see below)
                const fore = viaBest(S.road, n.s, S.dir), back = viaBest(S.road, n.s, -S.dir), behind = back.d < fore.d - 200;
                if (behind) S.wantUturn = nearLoop(chooseUturn(S.road, n.s, S.dir, { dir: -S.dir, s: back.s }), n.s);
                S.anyExit = behind && !S.wantUturn;
            }
            const ahead = (l) => S.dir === 1 ? (l.sFrom > n.s && l.sFrom < n.s + 900) : (l.sFrom < n.s && l.sFrom > n.s - 900);
            const links = Traffic.links.filter(l => l.from === S.road && l.to.isExit && l.fromDir === S.dir && ahead(l) && Object.keys(l.to.chunks).length);
            let link = null;
            if (S.wantUturn) link = links.find(l => l.to.isUturn && Math.abs(l.sFrom - (S.wantUturn.s - S.dir * 40)) < 120) || null;
            else if (S.wantExit !== null && S.wantExit !== undefined) link = links.find(l => !l.to.isUturn && Math.abs(l.sFrom - S.wantExit) < 250) || null;
            else {
                // judge an exit by where it leads: a ramp onto another freeway counts as the point
                // 1.5 km along that freeway in the merge direction (the two ramps at a bridge end
                // finish side by side, only their freeways point different ways); the best one that
                // gets us closer than we are, or any exit at all when we need to turn round
                let bestD = Infinity;
                links.forEach(l => {
                    if (l.to.isUturn) return;
                    if (S.offFw && !S.anyExit && !joinOf(l.to, l.from)) return;   // a city exit is no way across the bay
                    const d = leadsTo(l).distanceTo(S.dest);
                    if ((S.anyExit || d < pos.distanceTo(S.dest)) && d < bestD) { bestD = d; link = l; }
                });
            }
            S.exitDist = link ? Math.abs(n.s - link.sFrom) : Infinity;          // how far to the exit we will take
            // 30 m before the ramp begins, hand over to it (and measure ourselves against it from now on)
            if (link) { S.laneIndex = S.road.typeDef.lanes - 1; if (S.exitDist < 40) { S.road = link.to; S.dir = 1; S.laneIndex = 0; n = Road.nearest(S.road, pos); } }
        } else S.exitDist = Infinity;
        const toEnd = S.dir === 1 ? S.road.length - n.s : n.s;
        if (toEnd < 10 && (!onFreeway || S.road.isBridge)) {                 // (a bridge ends in ramps: hand over to the one we want, like any road)
            const nx = chooseNext();
            if (nx) { S.road = nx.road; S.dir = nx.dir; S.laneIndex = nearestLane(S.road, S.dir, pos); }   // (keep the lane we arrive in: a ramp joins a bridge's outer lane)
        }
        // side roads joining mid-way (city stubs off the collector): turn onto one if its far
        // end gets us closer to the destination than staying on this road would. Staying on
        // includes any on-ramp leaving this road further ahead (a frontage road's far end is
        // nowhere, its on-ramp is the way out), so the ramp wins over a side street.
        S.scan = (S.scan || 0) + 1;
        if (!onFreeway && S.scan % 10 === 0) {
            const ramps = [];                                                 // on-ramps leaving this road (only while the destination is far: in town the streets are the way)
            if (pos.distanceTo(S.dest) > 800) Road.all.forEach(o => {
                if (o.type !== 'ramp' || o.isExit || o === S.road || !Object.keys(o.chunks).length) return;
                const f0 = Road.at(o, 0, 0), at = Road.nearest(S.road, f0.p);
                if (at.dist >= 12) return;
                const along = (at.s - n.s) * S.dir, same = f0.tan.dot(at.frame.tan.clone().multiplyScalar(S.dir)) > 0.3;
                ramps.push({ road: o, along, same, tan: f0.tan, atTan: at.frame.tan, far: Road.at(o, o.length, 0).p, d: rampScore(o) });
            });
            const rampFar = ramps.filter(r => r.along > -25).reduce((m, r) => Math.min(m, r.d), Infinity);   // (one leaving the other way counts too: we turn round for it)
            const roadFar = Road.at(S.road, S.dir === 1 ? S.road.length : 0, 0).p.distanceTo(S.dest);
            const stayFar = Math.min(roadFar, rampFar);                        // what a side street has to beat; a ramp only has to beat the road's end
            const cand = [];
            const yaw = Car.yaw(), fx = Math.sin(yaw), fz = Math.cos(yaw);
            ramps.forEach(r => {
                // one leaving a little ahead of us: take it (lined up, on the road, entering from its
                // start, never from the side). One leaving the other way (a two-way frontage road's
                // ramps serve both directions): turn round on the spot and take it on the next pass
                // (and only once the car itself faces the ramp's way: one starting just after a bend is
                // taken out of the bend, not from the side of it, so allow up to 40 m past its start)
                // (nor while our road still bends before the ramp starts: steering for a ramp start
                // round a bend cuts the corner into the barrier)
                const facing = fx * r.tan.x + fz * r.tan.z > 0.9, straight = Math.abs(n.frame.tan.dot(r.atTan)) > 0.97;
                if (r.same && facing && straight && r.along > -40 && r.along < 60 && n.dist < S.road.width / 2 && alignedWith(n) > 0.85) cand.push({ road: r.road, dir: 1, far: r.far, d: r.d, s: 0, beat: roadFar });   // (a ramp runs beside the road for its first 30 m or so: just past its start still works)
                else if (!r.same && r.along > -60 && r.along < -25) cand.push({ road: S.road, dir: -S.dir, far: r.far, d: r.d, s: n.s, beat: roadFar, flip: true });   // (25 m past it first: the turn itself eats some road)
            });
            Road.all.forEach(o => {
                if (o === S.road || o.type === 'ramp' || !Object.keys(o.chunks).length) return;
                const f0 = Road.at(o, 0, 0), f1 = Road.at(o, o.length, 0);
                // (never a road we are facing away from: that is a turn round, which only a ramp is worth)
                if (f0.p.distanceTo(pos) < 16 && fx * f0.tan.x + fz * f0.tan.z > -0.3) cand.push({ road: o, dir: 1, far: f1.p, s: 0 });
                if (f1.p.distanceTo(pos) < 16 && o.typeDef.twoWay && -(fx * f1.tan.x + fz * f1.tan.z) > -0.3) cand.push({ road: o, dir: -1, far: f0.p, s: o.length });
            });
            let best = null;
            cand.forEach(c => { const d = c.d !== undefined ? c.d : c.far.distanceTo(S.dest); if (d < (c.beat || stayFar) - 20 && d < pos.distanceTo(S.dest) && (!best || d < best.d)) best = Object.assign(c, { d }); });
            if (best) { S.road = best.road; S.dir = best.dir; S.laneIndex = 0; if (best.flip) S.flipTurn = true; }
        }
        // steer toward a point ahead in our lane (further ahead at speed); firm gain like Debug.drive
        const lane = laneOf(S.road, S.dir, S.laneIndex);
        const ahead1 = Math.max(0, Math.min(S.road.length, n.s + S.dir * (10 + Car.mph * 0.12)));
        const look = Road.at(S.road, ahead1, lane.offset).p;
        const yaw = Car.yaw();
        let e = Math.atan2(look.x - pos.x, look.z - pos.z) - yaw;
        while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
        Car.assistSteer = Math.max(-0.5, Math.min(0.5, e * 3));
        // Facing the wrong way on a street (the destination, or the on-ramp we want, is behind
        // us): a three-point turn. Full lock forward to the kerb, back up on the opposite lock,
        // forward again, until we face along the road. The turning circle is wider than a street.
        // (only for a planned turn round, never at a junction we are merely facing away from)
        const wrongWay = !onFreeway && !(S.opts && S.opts.tow) && S.road.typeDef.twoWay && (S.turn ? alignedWith(n) < 0.8 : (S.flipTurn && alignedWith(n) < -0.3));
        if (wrongWay) {
            const turn = S.turn = S.turn || { phase: 'fwd', t: 0, lock: e > 0 ? 0.5 : -0.5 };
            turn.t += dt;
            const edge = n.dist > S.road.width / 2 - 2.5;
            if (turn.phase === 'fwd' && (edge || turn.t > 5)) { turn.phase = 'back'; turn.t = 0; }
            else if (turn.phase === 'back' && (turn.t > 2.5 || (turn.t > 0.8 && n.dist < 2))) { turn.phase = 'fwd'; turn.t = 0; }
            Car.assistSteer = turn.phase === 'fwd' ? turn.lock : -turn.lock;
        } else if (S.turn) { S.turn = null; S.flipTurn = false; Car.assistReverse = false; }
        // how much the road bends in the next 40 units -> slow down for curves
        const t1 = Road.at(S.road, ahead1, 0).tan, t2 = Road.at(S.road, Math.max(0, Math.min(S.road.length, n.s + S.dir * 40)), 0).tan;
        const bend = Math.acos(Math.max(-1, Math.min(1, t1.dot(t2))));
        // the Waymo self-drives at 200 mph on the freeway, easing off as the exit it will take
        // comes up (90 inside 900 m, 45 inside 350 m, so a U-turn loop followed closely by the
        // exit still works), 40 on ramps and streets; the tow truck is in a hurry too: 200 / 90
        const tow = !!(S.opts && S.opts.tow);
        const limit = S.road.type === 'freeway' ? 200 : (tow ? 90 : 40);
        let target = limit;
        if (onFreeway && !tow) target = Math.min(target, S.exitDist < 350 ? 45 : S.exitDist < 900 ? 90 : 200);
        if ((S.road.isBridge || (S.roaming && onFreeway)) && !tow) target = Math.min(target, toEnd < 350 ? 45 : toEnd < 900 ? 90 : 200);   // (a roaming Waymo also eases off before a freeway's open end)   // the end of a bridge is a ramp: slow for it as for an exit
        if (bend > 0.12) target = Math.min(target, tow ? 60 : 25);
        // and a bend further on (a tight ramp curve needs braking well before 40 m)
        const t3 = Road.at(S.road, Math.max(0, Math.min(S.road.length, n.s + S.dir * 90)), 0).tan;
        if (!onFreeway && Math.acos(Math.max(-1, Math.min(1, t1.dot(t3)))) > 0.5) target = Math.min(target, tow ? 60 : 25);
        // well off our lane (just joined a road, or knocked aside): get back into it before speeding up
        const laneP = Road.at(S.road, Road.nearest(S.road, pos).s, lane.offset).p, laneErr = Math.hypot(laneP.x - pos.x, laneP.z - pos.z);   // (n may still be the road we just left)
        if (laneErr > 4 && !tow) target = Math.min(target, 45);
        if (Math.abs(e) > 0.25) target = Math.min(target, tow ? 45 : 18);
        if (toEnd < 30 && !onFreeway && !S.road.isOnramp) target = Math.min(target, tow ? 40 : 16);   // (an on-ramp's end is a merge: keep rolling)
        if (S.road.isOnramp && n.s < 80 && !tow) target = Math.min(target, 20);                      // turning off a street onto the ramp: take it slowly or we swing wide
        if (wrongWay) target = Math.min(target, 6);                                                   // turning round: at a crawl
        if (!onFreeway && !tow && !wrongWay && alignedWith(n) < 0.9) target = Math.min(target, 12);   // not lined up with the road yet (out of a turn): ease back onto it
        if (pos.distanceTo(S.dest) < 60) target = Math.min(target, tow ? 25 : 12);
        if (tow) {
            // towed: the truck drags the car along the lane kinematically (no engine, no cap), so
            // 400 mph is fine and nothing can fling the car off the road
            const want = target / CFG.MPH;
            S.kin = Math.min(want, (S.kin || 0) + 70 * dt);
            // keep our own arc length: Road.nearest only knows the 8 m sample points, so
            // stepping from it would never get past the first one
            if (S.kinRoad !== S.road) { S.kinRoad = S.road; S.kinS = Road.nearest(S.road, pos).s; }   // (n is for the road we just left)
            S.kinS = Math.max(0, Math.min(S.road.length, S.kinS + S.dir * S.kin * dt));
            const s2 = S.kinS;
            const f = Road.at(S.road, s2, lane.offset);
            const tan = f.tan.clone().multiplyScalar(S.dir);
            const b = Car.body;
            b.position.set(f.p.x, f.p.y + 0.95, f.p.z);
            b.velocity.set(tan.x * S.kin, 0, tan.z * S.kin); b.angularVelocity.set(0, 0, 0);
            b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Road.yawOf(tan));
            Car.towed = true; Car.cruise = null; Car.autoBrake = false;
            return;
        }
        if (S.turn && S.turn.phase === 'back') {                                                      // backing up: no cruise, a gentle reverse
            Car.cruise = null; Car.autoBrake = false; Car.assistReverse = Car.mph < 5; S.stuck = 0;
            return;
        }
        Car.assistReverse = false;
        Car.cruise = target;
        // stuck watchdog: 4 s without moving -> give up rather than sit there
        S.stuck = Car.mph < 2 ? (S.stuck || 0) + dt : 0;
        if (S.stuck > 4) { S.cancel(true); UI.toast('Self-drive got stuck — you have the wheel', 3000); return; }
        // traffic ahead in our lane on this road
        let ahead = null;
        Traffic.cars.forEach(c => { if (c.road !== S.road || c.dir !== S.dir || c.lane.index !== lane.index) return; const gap = (c.s - n.s) * S.dir; if (gap > 0 && gap < 30 && (!ahead || gap < ahead)) ahead = gap; });
        Car.autoBrake = !!(ahead && ahead < 18 && Car.mph > 6);
        if (Car.mph > target + 6) Car.autoBrake = true;
    };
    return S;
})();

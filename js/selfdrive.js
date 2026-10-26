// tokyo-driver1 v2 — the route map and self-drive.
// MAP opens a map of the whole route (freeway, cities, train line); clicking sets a destination
// and the car drives itself there: it follows lanes, picks the road that gets closest to the
// destination at each junction, takes city exits when the destination is off the freeway,
// holds the speed limit and brakes for traffic. Any driving key cancels it.
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
    // The route runs along the freeway; the map lays arc length left -> right and lateral
    // offset up -> down (exaggerated 6x so cities are visible beside the road).
    const LAT_SCALE = 6;
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
    // the I-15 loop is drawn as a second strip below I-80
    const ROW2 = H - 90;
    function toMap2(p) {
        const fw = World.freeways[1]; if (!fw) return null;
        const n = Road.nearest(fw, p), f = n.frame;
        const dx = p.x - f.p.x, dz = p.z - f.p.z;
        const lat = dx * f.right.x + dz * f.right.z;
        return { x: PAD + n.s / fw.length * (W - 2 * PAD), y: ROW2 + lat * LAT_SCALE * 40 / 900, s: n.s, lat, dist: n.dist };
    }
    S.draw = function () {
        ctx.fillStyle = '#0f1522'; ctx.fillRect(0, 0, W, H);
        // train line and I-80
        ctx.strokeStyle = '#6b6257'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
        [Train.LAT, Train.LAT2].forEach(lat => { ctx.beginPath(); ctx.moveTo(PAD, H / 2 + lat * LAT_SCALE * (H / 2 - PAD) / 900); ctx.lineTo(W - PAD, H / 2 + lat * LAT_SCALE * (H / 2 - PAD) / 900); ctx.stroke(); });
        ctx.setLineDash([]);
        ctx.strokeStyle = '#cfd3d8'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(PAD, H / 2); ctx.lineTo(W - PAD, H / 2); ctx.stroke();
        ctx.fillStyle = '#9ab'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(World.freeway.name, PAD, H / 2 - 10);
        // I-15 loop strip
        if (World.freeways[1]) {
            ctx.strokeStyle = '#b9bec4'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(PAD, ROW2); ctx.lineTo(W - PAD, ROW2); ctx.stroke();
            ctx.fillStyle = '#9ab'; ctx.fillText(World.freeways[1].name + ' (east bay, joins ' + World.freeway.name + ' before San Jose)', PAD, ROW2 - 10);
        }
        // cities: box + name + exit number
        World.cities.forEach(c => {
            const onLoop = c.fw && c.fw.index === 1;
            const m = onLoop ? toMap2(new THREE.Vector3(c.center.x, 0, c.center.z)) : toMap(new THREE.Vector3(c.center.x, 0, c.center.z));
            const w = c.D / c.fw.length * (W - 2 * PAD), h = c.W * LAT_SCALE * (onLoop ? 40 : (H / 2 - PAD)) / 900;
            ctx.fillStyle = c.loaded ? 'rgba(124,247,168,0.25)' : 'rgba(90,110,140,0.35)';
            ctx.fillRect(m.x - w / 2, m.y - h / 2, w, h);
            ctx.strokeStyle = '#7cf7a8'; ctx.lineWidth = 1; ctx.strokeRect(m.x - w / 2, m.y - h / 2, w, h);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(c.name, m.x, m.y + h / 2 + 16);
            ctx.fillStyle = '#ffd21e'; ctx.font = '11px sans-serif'; ctx.fillText('Exit ' + c.exitNumber, m.x - w / 2 - 10, (onLoop ? ROW2 : H / 2) + 16);
            ctx.textAlign = 'left';
        });
        // player (on whichever strip is closer)
        if (Car.body) {
            const m2 = toMap2(Car.body.position), m1 = toMap(Car.body.position);
            const m = (m2 && m2.dist < Road.nearest(World.freeway, Car.body.position).dist) ? m2 : m1;
            ctx.fillStyle = '#7cf7a8'; ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, 6.3); ctx.fill();
            ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
        }
        if (S.dest) {
            const m = toMap(S.dest);
            ctx.strokeStyle = '#ff5d7a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(m.x - 7, m.y - 7); ctx.lineTo(m.x + 7, m.y + 7); ctx.moveTo(m.x + 7, m.y - 7); ctx.lineTo(m.x - 7, m.y + 7); ctx.stroke();
        }
        ctx.fillStyle = '#9ab'; ctx.font = '12px sans-serif'; ctx.fillText('Click anywhere to self-drive there. Cities are drawn wider than life so you can aim at them.', PAD, H - 12);
    };
    function onClick(e) {
        const r = canvas.getBoundingClientRect();
        const mx = (e.clientX - r.left) * W / r.width, my = (e.clientY - r.top) * H / r.height;
        S.goTo(fromMap(mx, my));
        UI.closeModals();
    }

    // ---------- self-drive ----------
    S.goTo = function (point, opts) {
        opts = opts || {};
        // snap to the nearest built road
        let best = null, bd = Infinity;
        Road.all.forEach(r => { if (!Object.keys(r.chunks).length) return; const n = Road.nearest(r, point); if (n.dist < bd) { bd = n.dist; best = { r, n }; } });
        S.dest = best ? best.n.frame.p.clone() : point.clone();
        S.destRoad = best ? best.r : null;
        // a point inside a city whose streets are not built yet would snap onto the freeway;
        // keep the city as the goal and snap again once its streets exist
        S.destCity = null;
        if (!best || best.r.type === 'freeway') {
            const city = World.cities.find(c => Math.hypot(c.center.x - point.x, c.center.z - point.z) < c.radius + 60);
            if (city) { S.destCity = city; S.dest = point.clone(); S.destRoad = null; S.target = point.clone(); }
        }
        S.active = true; S.cross = null; S.opts = opts; S.lastTow = null; S.kinRoad = null; S.roaming = false;
        const cur = nearestRoad(Car.body.position);
        S.road = cur.r; S.dir = headingDir(cur.r, cur.n);
        S.laneIndex = S.road.lanes.filter(l => l.dir === S.dir).length - 1;
        if (!opts.quiet) UI.toast('Self-drive on — ' + Math.round(S.dest.distanceTo(Car.body.position)) + ' m. Touch the wheel to cancel.', 3000);
    };
    S.cancel = function (quiet) {
        if (!S.active) return;
        S.active = false; Car.assistSteer = null; Car.cruise = null; Car.autoBrake = false;
        if (!quiet) UI.toast('Self-drive off');
    };
    function nearestRoad(pos) {
        let best = null, bd = Infinity;
        Road.all.forEach(r => { if (!Object.keys(r.chunks).length) return; const n = Road.nearest(r, pos); if (n.dist < bd) { bd = n.dist; best = { r, n }; } });
        return best;
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
        const cands = [];
        fw.cities.forEach((c, k) => { if (k < fw.cities.length - 1) { cands.push({ s: c.s + 1500, fromDir: 1 }); cands.push({ s: c.s + 2400, fromDir: -1 }); } });
        const ahead = cands.filter(u => u.fromDir === dir && (dir === 1 ? u.s > s + 80 : u.s < s - 80)).sort((a, b) => dir === 1 ? a.s - b.s : b.s - a.s);
        if (dir !== want.dir) return ahead.find(u => want.dir === -1 ? u.s > want.s + 100 : u.s < want.s - 100) || null;
        return ahead[0] || null;
    }
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
        S.active = true; S.cross = null; S.opts = { quiet: true }; S.lastTow = null; S.kinRoad = null; S.destCity = null;
        S.laneIndex = S.road.lanes.filter(l => l.dir === S.dir).length - 1;
    };
    let idle = 0;
    S.update = function (dt) {
        const hands = Car.keys.fwd || Car.keys.back || Car.keys.left || Car.keys.right;
        if (Car.body && Car.data && Car.data.isWaymo && Game.started && !Car.parked && !Car.frozen && !Car.towed) {
            idle = hands ? 0 : idle + dt;
            if (!S.active && idle > 2) { S.roam(); UI.toast('Waymo: self-driving. Pick a place on the MAP, or just ride along.', 2500); }
        }
        if (!S.active || !Car.body) return;
        if (hands) { S.cancel(S.roaming); S.roaming = false; return; }
        const pos = Car.body.position;
        if (S.roaming) {                                                   // keep the target at the end of whatever road we are on
            const end = Road.at(S.road, S.dir === 1 ? S.road.length : 0, 0).p;
            if (end.distanceTo(S.dest) > 1) { S.dest = end.clone(); S.destRoad = S.road; }
            if (pos.distanceTo(S.dest) < 40 && S.road.type === 'freeway') { S.dir = -S.dir; S.laneIndex = S.road.lanes.filter(l => l.dir === S.dir).length - 1; }   // end of the line: turn back (the loops are for exits)
        }
        if (S.destCity && S.destCity.loaded && !S.destRoad) {
            // the city's streets are built now: aim at the street nearest the original point
            let best = null, bd = Infinity;
            S.destCity.roads.forEach(r => { if (!Object.keys(r.chunks).length) return; const n = Road.nearest(r, S.target); if (n.dist < bd) { bd = n.dist; best = { r, n }; } });
            if (best) { S.dest = best.n.frame.p.clone(); S.destRoad = best.r; }
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
        if (cur && cur.r !== S.road && cur.n.dist < cur.r.width * 0.6 && Road.nearest(S.road, pos).dist > S.road.width * 0.7) { S.road = cur.r; S.dir = headingDir(cur.r, cur.n); S.laneIndex = Math.min(S.laneIndex, S.road.lanes.filter(l => l.dir === S.dir).length - 1); }
        const n = Road.nearest(S.road, pos);
        // On the freeway: work out which carriageway the destination's exit is on. If we are on
        // the wrong one (or already past it), plan a U-turn loop; otherwise take the exit when it
        // comes. Each city's exit is on the carriageway of its side, 1200 before the city.
        const onFreeway = S.road.type === 'freeway';
        S.wantUturn = null;
        if (onFreeway && S.destRoad !== S.road) {
            const city = destCity();
            if (city && city.fw === S.road) {
                const want = { dir: city.side, s: city.s - city.side * 1200 };
                const exitAhead = S.dir === want.dir && (S.dir === 1 ? n.s < want.s - 60 : n.s > want.s + 60);
                if (!exitAhead) S.wantUturn = chooseUturn(S.road, n.s, S.dir, want);
            }
            const ahead = (l) => S.dir === 1 ? (l.sFrom > n.s && l.sFrom < n.s + 400) : (l.sFrom < n.s && l.sFrom > n.s - 400);
            const links = Traffic.links.filter(l => l.from === S.road && l.to.isExit && l.fromDir === S.dir && ahead(l) && Object.keys(l.to.chunks).length);
            let link = null;
            if (S.wantUturn) link = links.find(l => l.to.isUturn && Math.abs(l.sFrom - (S.wantUturn.s - S.dir * 40)) < 120) || null;
            else link = links.find(l => !l.to.isUturn && Road.at(l.to, l.to.length, 0).p.distanceTo(S.dest) < pos.distanceTo(S.dest)) || null;
            if (link) { S.laneIndex = S.road.typeDef.lanes - 1; if (Math.abs(n.s - link.sFrom) < 60) { S.road = link.to; S.dir = 1; S.laneIndex = 0; } }
        }
        const toEnd = S.dir === 1 ? S.road.length - n.s : n.s;
        if (toEnd < 10 && !onFreeway) {
            const nx = chooseNext();
            if (nx) { S.road = nx.road; S.dir = nx.dir; S.laneIndex = Math.min(S.laneIndex, S.road.lanes.filter(l => l.dir === S.dir).length - 1); }
        }
        // side roads joining mid-way (city stubs off the collector): turn onto one if its far
        // end gets us closer to the destination than staying on this road would
        S.scan = (S.scan || 0) + 1;
        if (!onFreeway && S.scan % 10 === 0) {
            const ourFar = Road.at(S.road, S.dir === 1 ? S.road.length : 0, 0).p.distanceTo(S.dest);
            let best = null;
            Road.all.forEach(o => {
                if (o === S.road || o.type === 'ramp' || !Object.keys(o.chunks).length) return;
                const ps = Road.at(o, 0, 0).p, pe = Road.at(o, o.length, 0).p;
                const cand = [];
                if (ps.distanceTo(pos) < 16) cand.push({ road: o, dir: 1, far: pe, s: 0 });
                if (pe.distanceTo(pos) < 16 && o.typeDef.twoWay) cand.push({ road: o, dir: -1, far: ps, s: o.length });
                cand.forEach(c => { const d = c.far.distanceTo(S.dest); if (d < ourFar - 20 && d < pos.distanceTo(S.dest) && (!best || d < best.d)) best = Object.assign(c, { d }); });
            });
            if (best) { S.road = best.road; S.dir = best.dir; S.laneIndex = 0; }
        }
        // steer toward a point ahead in our lane (further ahead at speed); firm gain like Debug.drive
        const lane = laneOf(S.road, S.dir, S.laneIndex);
        const ahead1 = Math.max(0, Math.min(S.road.length, n.s + S.dir * (10 + Car.mph * 0.12)));
        const look = Road.at(S.road, ahead1, lane.offset).p;
        const yaw = Car.yaw();
        let e = Math.atan2(look.x - pos.x, look.z - pos.z) - yaw;
        while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
        Car.assistSteer = Math.max(-0.5, Math.min(0.5, e * 3));
        // how much the road bends in the next 40 units -> slow down for curves
        const t1 = Road.at(S.road, ahead1, 0).tan, t2 = Road.at(S.road, Math.max(0, Math.min(S.road.length, n.s + S.dir * 40)), 0).tan;
        const bend = Math.acos(Math.max(-1, Math.min(1, t1.dot(t2))));
        // the tow truck is in a hurry: 200 mph on the freeway, 90 on ramps and streets, 60 in bends
        const tow = !!(S.opts && S.opts.tow);
        const limit = S.road.type === 'freeway' ? (tow ? 200 : 62) : (tow ? 90 : 26);
        let target = limit;
        if (bend > 0.12) target = Math.min(target, tow ? 60 : 16);
        if (Math.abs(e) > 0.25) target = Math.min(target, tow ? 45 : 12);
        if (toEnd < 30 && !onFreeway) target = Math.min(target, tow ? 40 : 14);
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
        Car.cruise = target;
        // stuck watchdog: 4 s without moving -> give up rather than sit there
        S.stuck = Car.mph < 1 ? (S.stuck || 0) + dt : 0;
        if (S.stuck > 4) { S.cancel(true); UI.toast('Self-drive got stuck — you have the wheel', 3000); return; }
        // traffic ahead in our lane on this road
        let ahead = null;
        Traffic.cars.forEach(c => { if (c.road !== S.road || c.dir !== S.dir || c.lane.index !== lane.index) return; const gap = (c.s - n.s) * S.dir; if (gap > 0 && gap < 30 && (!ahead || gap < ahead)) ahead = gap; });
        Car.autoBrake = !!(ahead && ahead < 18 && Car.mph > 6);
        if (Car.mph > target + 6) Car.autoBrake = true;
    };
    return S;
})();

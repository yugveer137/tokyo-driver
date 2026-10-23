// tokyo-driver1 v2 — console helpers for testing (no gameplay). Example in the console:
//   Debug.drive([World.exits[0], World.avenue], 600, 45)
window.Debug = (function () {
    const D = { route: null };

    // Drive the car along a list of roads in order for `ticks` simulation steps, holding
    // `targetMph`. Returns a short log; `minAbove` is the lowest the car got relative to the road.
    D.drive = function (roads, ticks, targetMph) {
        if (!D.route || D.route.roads !== roads) D.route = { roads, i: 0 };
        const R = D.route, log = [];
        let minAbove = Infinity;
        for (let t = 0; t < ticks; t++) {
            const p = Car.body.position;
            let n = Road.nearest(roads[R.i], p);
            if (n.s > roads[R.i].length - 12 && R.i < roads.length - 1) { R.i++; n = Road.nearest(roads[R.i], p); }
            const cur = roads[R.i];
            // aim for a driving lane, not the centreline (freeways have a median wall there)
            const lane = cur.lanes.find(l => l.dir === 1 && l.index === cur.lanes.filter(x => x.dir === 1).length - 1);
            const look = Road.at(cur, Math.min(cur.length - 1, n.s + 14), lane ? lane.offset : 0).p;
            const q = Car.body.quaternion;
            const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
            let e = Math.atan2(look.x - p.x, look.z - p.z) - yaw;
            while (e > Math.PI) e -= 2 * Math.PI;
            while (e < -Math.PI) e += 2 * Math.PI;
            Car.keys.left = e > 0.03; Car.keys.right = e < -0.03;
            Car.keys.fwd = Car.mph < targetMph; Car.keys.back = Car.mph > targetMph + 8;
            game.tick(1 / 60);
            minAbove = Math.min(minAbove, p.y - n.frame.p.y);
            if (t % 120 === 0) log.push(`${cur.name} s${n.s.toFixed(0)} y${p.y.toFixed(1)}/${n.frame.p.y.toFixed(1)} off${n.dist.toFixed(1)} ${Car.mph.toFixed(0)}mph`);
        }
        Object.assign(Car.keys, { fwd: false, back: false, left: false, right: false });
        log.push('minAbove ' + minAbove.toFixed(2));
        return log;
    };

    // Put the car at arc-length s on a road, facing forward
    D.goto = function (road, s, lateral) {
        const f = Road.at(road, s, lateral || 0);
        Car.teleport(f.p.x, f.p.y + 1.2, f.p.z, Road.yawOf(f.tan));
        for (let i = 0; i < 20; i++) game.tick(1 / 60);
    };

    return D;
})();

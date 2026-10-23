// tokyo-driver1 v2 — top-down minimap: nearby roads, traffic, coins and the player, heading up.
window.Minimap = (function () {
    const M = { size: 200, range: 170 };
    let canvas, ctx, frame = 0;

    M.init = function () {
        canvas = document.getElementById('minimap');
        canvas.width = canvas.height = M.size;
        ctx = canvas.getContext('2d');
    };

    const widths = { freeway: 9, avenue: 6, street: 4, ramp: 4 };
    const colors = { freeway: '#cfd3d8', avenue: '#b9bec4', street: '#a4a9af', ramp: '#cfd3d8' };

    M.update = function (playerPos, yaw) {
        if (!ctx || frame++ % 3 !== 0) return;
        const S = M.size, c = S / 2, k = S / (2 * M.range);
        ctx.clearRect(0, 0, S, S);
        ctx.save();
        ctx.beginPath(); ctx.arc(c, c, c - 1, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = 'rgba(12, 18, 30, 0.85)'; ctx.fillRect(0, 0, S, S);
        // world -> map: translate to player, rotate so the car's heading points up, scale
        ctx.translate(c, c); ctx.rotate(yaw); ctx.scale(k, -k);
        ctx.translate(-playerPos.x, -playerPos.z);
        // cities as faint blocks
        if (window.World) World.cities.forEach(city => {
            if (!city.loaded) return;
            ctx.save(); ctx.translate(city.center.x, city.center.z); ctx.rotate(-city.heading);
            ctx.fillStyle = 'rgba(90, 110, 140, 0.25)'; ctx.fillRect(-city.W / 2, -city.D / 2, city.W, city.D); ctx.restore();
        });
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const r2 = (M.range * 1.3) ** 2;
        Road.all.forEach(road => {
            if (!Object.keys(road.chunks).length) return;
            ctx.strokeStyle = colors[road.type] || '#aaa'; ctx.lineWidth = (widths[road.type] || 4) / k;
            ctx.beginPath(); let drawing = false;
            const fr = road.frames, step = road.type === 'freeway' ? 2 : 1;
            for (let i = 0; i < fr.length; i += step) {
                const p = fr[i].p, dx = p.x - playerPos.x, dz = p.z - playerPos.z;
                if (dx * dx + dz * dz > r2) { drawing = false; continue; }
                if (!drawing) { ctx.moveTo(p.x, p.z); drawing = true; } else ctx.lineTo(p.x, p.z);
            }
            ctx.stroke();
        });
        // coins and traffic
        if (window.Game && Game.coinItems) { ctx.fillStyle = '#ffd21e'; Game.coinItems().forEach(m => { ctx.beginPath(); ctx.arc(m.position.x, m.position.z, 1.6 / k, 0, 6.3); ctx.fill(); }); }
        if (window.Traffic) { ctx.fillStyle = '#ff6a6a'; Traffic.cars.forEach(t => { ctx.beginPath(); ctx.arc(t.mesh.position.x, t.mesh.position.z, 1.8 / k, 0, 6.3); ctx.fill(); }); }
        ctx.restore();
        // player arrow (always centre, pointing up)
        ctx.save(); ctx.translate(c, c);
        ctx.fillStyle = '#7cf7a8'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
        ctx.restore();
        // north tick
        ctx.save(); ctx.translate(c, c); ctx.rotate(yaw);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', 0, -c + 12);
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c, c, c - 1, 0, Math.PI * 2); ctx.stroke();
    };

    return M;
})();

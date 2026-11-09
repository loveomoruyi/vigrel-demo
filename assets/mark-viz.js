/* Vigrel mark: the app's small plexus orb, scaled to icon size.
   Mirrors renderer/mini.js drawPlexus (cyan mesh, dark disc, breathing core).
   Initialises every canvas.brand-mark on the page — header and footer — so the
   identity is identical wherever the logo appears. Static under reduced motion. */
(function () {
  "use strict";

  var marks = document.querySelectorAll("canvas.brand-mark");
  if (!marks.length) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  marks.forEach(function (canvas) {
    var ctx = canvas.getContext("2d");
    var SIZE = 26;
    var DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * DPR;
    canvas.height = SIZE * DPR;

    var cx = SIZE / 2, cy = SIZE / 2;
    var MAX_R = 10.2;
    var NODES = 16;
    var LINK = 8.6;
    var nodes = [];

    for (var i = 0; i < NODES; i++) {
      nodes.push({
        a: Math.random() * Math.PI * 2,
        r: 3.4 + Math.random() * (MAX_R - 4),
        da: (Math.random() - 0.5) * 0.0016,
        dr: (Math.random() - 0.5) * 0.012,
        size: 0.55 + Math.random() * 0.75,
        depth: 0.55 + Math.random() * 0.45
      });
    }

    var pulse = Math.random() * Math.PI * 2;
    var last = 0;
    var raf = null;

    function draw() {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);

      // dark ground so the mesh reads on any background
      var disc = ctx.createRadialGradient(cx, cy, 1, cx, cy, MAX_R * 1.55);
      disc.addColorStop(0, "rgba(4,10,18,.94)");
      disc.addColorStop(.65, "rgba(4,10,18,.72)");
      disc.addColorStop(1, "rgba(4,10,18,0)");
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(cx, cy, MAX_R * 1.55, 0, Math.PI * 2);
      ctx.fill();

      var pts = [];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        n.a += n.da;
        n.r += n.dr;
        if (n.r < 3.2 || n.r > MAX_R) n.dr *= -1;
        n.r = Math.max(3.2, Math.min(MAX_R, n.r));
        pts.push([cx + Math.cos(n.a) * n.r, cy + Math.sin(n.a) * n.r * 0.96]);
      }

      for (var a = 0; a < pts.length; a++) {
        for (var b = a + 1; b < pts.length; b++) {
          var dx = pts[a][0] - pts[b][0];
          var dy = pts[a][1] - pts[b][1];
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d > LINK) continue;
          ctx.strokeStyle = "rgba(0,212,255," + ((1 - d / LINK) * 0.72).toFixed(3) + ")";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(pts[a][0], pts[a][1]);
          ctx.lineTo(pts[b][0], pts[b][1]);
          ctx.stroke();
        }
      }

      for (var k = 0; k < pts.length; k++) {
        ctx.beginPath();
        ctx.fillStyle = "rgba(150,238,255," + (0.42 + nodes[k].depth * 0.42).toFixed(2) + ")";
        ctx.arc(pts[k][0], pts[k][1], nodes[k].size, 0, Math.PI * 2);
        ctx.fill();
      }

      var breathe = 1 + Math.sin(pulse * 0.05) * 0.06;
      var core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 4.6 * breathe);
      core.addColorStop(0, "rgba(245,253,255,.95)");
      core.addColorStop(.35, "rgba(150,235,255,.55)");
      core.addColorStop(1, "rgba(0,170,235,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, 4.6 * breathe, 0, Math.PI * 2);
      ctx.fill();
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return;      // ~30fps is plenty at this size
      last = now;
      pulse += 0.9;
      draw();
    }

    function start() { if (raf === null) { last = 0; raf = requestAnimationFrame(frame); } }
    function stop() { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } }

    draw();                              // always paint one frame
    if (!reduce) {
      start();
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) stop(); else start();
      });
    }
  });
})();

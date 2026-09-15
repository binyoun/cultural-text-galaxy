(function () {
  var canvas = document.getElementById('starfield');
  if (!canvas) return;

  var ctx = canvas.getContext('2d');
  var stars = [];
  var glowStars = [];
  var nebulae = [];
  var STAR_COUNT = 220;
  var GLOW_STAR_COUNT = 14;
  var NEBULA_COLORS = ['111,140,255', '255,120,190', '130,90,255'];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = document.documentElement.scrollHeight;
  }

  function init() {
    stars = [];
    for (var i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.4 + 0.3,
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 1.2
      });
    }

    glowStars = [];
    for (var g = 0; g < GLOW_STAR_COUNT; g++) {
      glowStars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.2 + 1.4,
        haloR: Math.random() * 10 + 14,
        phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.6
      });
    }

    nebulae = [];
    for (var n = 0; n < 3; n++) {
      nebulae.push({
        baseX: Math.random() * canvas.width,
        baseY: Math.random() * canvas.height * 0.8,
        r: Math.min(canvas.width, 900) * (0.35 + Math.random() * 0.25),
        color: NEBULA_COLORS[n % NEBULA_COLORS.length],
        driftR: 60 + Math.random() * 60,
        phase: Math.random() * Math.PI * 2,
        speed: 0.00004 + Math.random() * 0.00003
      });
    }
  }

  function draw(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (var n = 0; n < nebulae.length; n++) {
      var neb = nebulae[n];
      var nx = neb.baseX + Math.cos(t * neb.speed + neb.phase) * neb.driftR;
      var ny = neb.baseY + Math.sin(t * neb.speed * 0.8 + neb.phase) * neb.driftR;
      var grad = ctx.createRadialGradient(nx, ny, 0, nx, ny, neb.r);
      grad.addColorStop(0, 'rgba(' + neb.color + ', 0.08)');
      grad.addColorStop(1, 'rgba(' + neb.color + ', 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var twinkle = 0.5 + 0.5 * Math.sin(t * 0.0006 * s.speed + s.phase);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(180, 200, 255, ' + (0.15 + twinkle * 0.5) + ')';
      ctx.fill();
    }

    for (var j = 0; j < glowStars.length; j++) {
      var gs = glowStars[j];
      var glowTwinkle = 0.6 + 0.4 * Math.sin(t * 0.0004 * gs.speed + gs.phase);
      var haloGrad = ctx.createRadialGradient(gs.x, gs.y, 0, gs.x, gs.y, gs.haloR);
      haloGrad.addColorStop(0, 'rgba(200, 215, 255, ' + (0.25 * glowTwinkle) + ')');
      haloGrad.addColorStop(1, 'rgba(200, 215, 255, 0)');
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(gs.x, gs.y, gs.haloR, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(gs.x, gs.y, gs.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(235, 240, 255, ' + (0.7 + 0.3 * glowTwinkle) + ')';
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', function () {
    resize();
    init();
  });

  resize();
  init();
  requestAnimationFrame(draw);
})();

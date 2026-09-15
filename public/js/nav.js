function connectDots(containerId, polylineId) {
  var container = document.getElementById(containerId);
  var polyline = document.getElementById(polylineId);
  if (!container || !polyline) return null;

  return function draw() {
    var dots = container.querySelectorAll('.star-dot');
    var containerRect = container.getBoundingClientRect();
    var points = [];
    var tops = [];

    dots.forEach(function (dot) {
      var r = dot.getBoundingClientRect();
      var x = r.left + r.width / 2 - containerRect.left;
      var y = r.top + r.height / 2 - containerRect.top;
      points.push(x + ',' + y);
      tops.push(r.top);
    });

    var singleRow = tops.length > 0 && (Math.max.apply(null, tops) - Math.min.apply(null, tops)) < 4;
    polyline.setAttribute('points', singleRow ? points.join(' ') : '');
  };
}

function wireConstellations(pairs) {
  var drawers = pairs
    .map(function (pair) { return connectDots(pair[0], pair[1]); })
    .filter(Boolean);

  function drawAll() {
    drawers.forEach(function (draw) { draw(); });
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawAll, 100);
  });

  window.addEventListener('load', drawAll);
  drawAll();
}

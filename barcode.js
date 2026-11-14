/* Code 128B баркод → SVG. Бэлгийн картын кодыг дэлгэцэн дээр уншуулахад хэрэглэнэ.
 *
 * Код 128 нь хямд USB/QR уншигч бүр дээр үйлдвэрээс нь ASAН байдаг (Code 39 нь
 * заримд хаалттай) — тиймээс үүнийг сонгосон. Зөвхөн B багц: ASCII 32…126,
 * бэлгийн картын «BS-XXXX-XXXX» бүрэн багтана.
 *
 * window.buddyBarcode(text, opts) → SVG текст. opts: {height, module, quiet, color}
 */
(function () {
  // Стандарт Code 128 хэв (0…106). Тус бүр нь зураас/зай-н өргөнүүд, зураасаар эхэлнэ.
  var P = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 '
    + '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
    + '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 '
    + '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
    + '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 '
    + '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
    + '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 '
    + '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
    + '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 '
    + '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
    + '114131 311141 411131 211412 211214 211232 2331112').split(/\s+/);

  var START_B = 104, STOP = 106;

  // Текстийг Code 128B-ийн утгууд болгоно. Багцад байхгүй тэмдэгтийг хаяна.
  function values(text) {
    var out = [START_B], s = String(text == null ? '' : text);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 32 && c <= 126) out.push(c - 32);
    }
    var sum = START_B;
    for (var k = 1; k < out.length; k++) sum += out[k] * k;
    out.push(sum % 103); // шалгах тэмдэгт
    out.push(STOP);
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Баркодыг canvas дээр зурахад хэрэгтэй: [{x,w}] модулиудын жагсаалт.
     Зургаар хадгалах товч үүгээр PNG үүсгэнэ — гадны сан хэрэггүй. */
  window.buddyBarcodeBars = function (text, module, quiet) {
    var m = Math.max(1, module || 2), q = quiet == null ? 10 : quiet;
    var vals = values(text), out = [], x = q * m;
    for (var i = 0; i < vals.length; i++) {
      var pat = P[vals[i]];
      for (var j = 0; j < pat.length; j++) {
        var w = (+pat[j]) * m;
        if (j % 2 === 0) out.push({ x: x, w: w });
        x += w;
      }
    }
    return { bars: out, width: x + q * m };
  };

  window.buddyBarcode = function (text, opts) {
    opts = opts || {};
    var m = Math.max(1, opts.module || 2);        // нэг модулийн өргөн, px
    var h = Math.max(20, opts.height || 70);      // зураасны өндөр
    var q = opts.quiet == null ? 10 : opts.quiet; // хоёр талын цагаан зай (модуль)
    var color = opts.color || '#111';
    var vals = values(text);

    var rects = '', x = q * m, total = x;
    for (var i = 0; i < vals.length; i++) {
      var pat = P[vals[i]];
      for (var j = 0; j < pat.length; j++) {
        var w = (+pat[j]) * m;
        if (j % 2 === 0) rects += '<rect x="' + x + '" y="0" width="' + w + '" height="' + h + '"/>';
        x += w;
      }
    }
    total = x + q * m;
    var label = opts.label === false ? '' :
      '<text x="' + (total / 2) + '" y="' + (h + 16) + '" text-anchor="middle" '
      + 'font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="15" '
      + 'letter-spacing="2" fill="' + color + '">' + esc(text) + '</text>';
    var H = h + (opts.label === false ? 0 : 22);

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + H + '" '
      + 'width="100%" height="' + H + '" role="img" aria-label="Баркод: ' + esc(text) + '" '
      + 'style="max-width:' + total + 'px;display:block;margin:0 auto">'
      + '<rect width="' + total + '" height="' + H + '" fill="#fff"/>'
      + '<g fill="' + color + '">' + rects + '</g>' + label + '</svg>';
  };
})();

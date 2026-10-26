/* Removes repeated photos from product galleries (same picture saved under several addresses).
   Checked by file content on 26 October 2026: 18 products, 89 repeated photos. */
(() => {
  const hide = {"642136":["de3be447","3a86489b","782a5ab3","5bd8df58","21e0bf39","030fa04f","5600b115","fb4e6952","6a140896"],"650430":["72531c0d","89ed968c","74596be4","0a00eb59","17275adb","de3b4be4"],"650532":["f4377412","63c4aaeb","8151f393","24cfd76c","92eeba30","f2c5980a","7bee0cba"],"650829":["66a495fe","b8d77b6b","22fc5c44","3b4a2315","0ad433e5"],"650854":["c81d5a22","dd8fa5e0","d16b671a","973376a1","826b7e99"],"650862":["65629158","0d83fd63","260cfd5f","2f2296d3","daaedfcc"],"650866":["bba9d4b5","1ed53d87","ab71a677","31363a55","60694c4c","199b49eb"],"650868":["6742c0e0","9b8bcb81","5a826da9","ab7ff872","9c8a1e03","72db6ca8"],"650869":["4ff91db0","99068007","eaf33a3e","34e8cc8a","8c26f4c5","431077cc"],"650882":["b0001037","a5df90d0","a29b2b53"],"650893":["a47e3d65","8a40d0bb","37d52131","1729237e"],"861971":["f12662bc","7802bfe1","b567bb8c"],"862005":["dc9f7513","678a507c","90b70c85","266bbefd"],"862010":["assets/products/862010.jpg","7920d992","449dbf66","9d0d2697","ebe89bb1"],"862012":["assets/products/862012.jpg","cecbe4d9","ebb70f91","bd5e1173"],"862014":["assets/products/862014.jpg","b2578d23","ab8c4fa1","ad994071","7fd22e9b"],"862015":["assets/products/862015.jpg","f53333f1","050d69af","21a00834","891d3ce2"],"887410":["1f0e80c0"]};
  const isHidden = (id, url) => (hide[String(id)] || []).some(h => h.startsWith('assets/') ? url === h : url.startsWith('https://cdn.zochil.shop/' + h));
  const oldImages = productImages;
  productImages = function(p) {
    const all = oldImages(p);
    const kept = all.filter(url => !isHidden(p.id, url));
    return kept.length ? kept : all;
  };
})();

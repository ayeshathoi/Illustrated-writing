// Dreamy nature backdrop: your background photo (set in the studio) or a painted
// pastel meadow, a soft wash for readability, and a few rising bubbles.
(function () {
  const sky = document.createElement("div");
  sky.className = "dreamy-sky";
  sky.setAttribute("aria-hidden", "true");
  sky.innerHTML = '<div class="scene"></div><div class="wash"></div><div class="grain"></div>';
  const scene = sky.firstChild;
  document.body.prepend(sky);

  // ---- painted meadow (used until a photo is chosen)
  function meadow() {
    let flowers = "";
    const colors = ["#ffd1e1", "#ffffff", "#fff0b8", "#f7b6cf", "#e8dcff"];
    let seed = 7;
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 140; i++) {
      const x = rand() * 1600, y = 860 + rand() * 150, r = 2 + rand() * 4.5;
      flowers += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="${colors[i % colors.length]}" opacity="${(0.65 + rand() * 0.35).toFixed(2)}"/>`;
    }
    let trees = "";
    [[260, 742, 1], [310, 748, .8], [1240, 728, 1.1], [1300, 736, .85], [1352, 742, .7], [760, 770, .6]].forEach(([x, y, s]) => {
      trees += `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-3" y="0" width="6" height="26" fill="#7d8f74"/><ellipse cx="0" cy="-10" rx="26" ry="34" fill="#93b493"/><ellipse cx="-8" cy="-18" rx="14" ry="18" fill="#a9c7a3" opacity=".8"/></g>`;
    });
    return `<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#cfd9f2"/><stop offset=".45" stop-color="#f6d9e4"/><stop offset=".75" stop-color="#fde5d6"/>
        </linearGradient>
        <radialGradient id="sun" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#fffaf0"/><stop offset=".35" stop-color="#fff1df" stop-opacity=".8"/><stop offset="1" stop-color="#ffe9df" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
        <filter id="soft"><feGaussianBlur stdDeviation="3"/></filter>
        <filter id="cloud"><feGaussianBlur stdDeviation="18"/></filter>
      </defs>
      <rect width="1600" height="1000" fill="url(#sk)"/>
      <circle cx="1080" cy="470" r="330" fill="url(#sun)"/>
      <g filter="url(#cloud)" fill="#fff" opacity=".7">
        <ellipse cx="300" cy="200" rx="220" ry="40"/><ellipse cx="420" cy="230" rx="160" ry="30"/>
        <ellipse cx="1250" cy="160" rx="240" ry="38"/><ellipse cx="900" cy="290" rx="180" ry="26"/>
      </g>
      <path filter="url(#soft)" fill="#cbc3e3" opacity=".75" d="M0 620 L140 520 L250 580 L420 430 L560 560 L700 480 L860 590 L1010 470 L1180 560 L1330 440 L1480 540 L1600 500 V1000 H0Z"/>
      <path filter="url(#soft)" fill="#b9c6de" opacity=".8" d="M0 660 L180 590 L330 640 L520 560 L690 640 L880 580 L1060 650 L1240 590 L1420 650 L1600 600 V1000 H0Z"/>
      <rect y="590" width="1600" height="150" fill="url(#mist)"/>
      <path fill="#c3dbb9" d="M0 760 C 220 690 420 700 640 745 S 1060 700 1260 720 S 1520 735 1600 720 V1000 H0Z"/>
      ${trees}
      <path fill="#a9cba1" d="M0 830 C 260 770 520 790 760 820 S 1200 780 1600 800 V1000 H0Z"/>
      <path fill="#92bb8e" d="M0 900 C 300 850 640 870 900 890 S 1380 860 1600 880 V1000 H0Z"/>
      ${flowers}
    </svg>`;
  }

  function usePhoto(url) {
    const img = new Image();
    img.onload = () => { scene.innerHTML = ""; scene.style.backgroundImage = `url("${url}")`; sky.classList.add("has-photo"); };
    img.src = url;
  }

  scene.innerHTML = meadow();
  fetch("books/site.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : {}))
    .then((site) => {
      // A different picture from your collection on each visit.
      const list = site.backgrounds || (site.background ? [site.background] : []);
      if (list.length) usePhoto("books/" + encodeURIComponent(list[Math.floor(Math.random() * list.length)]));
    })
    .catch(() => {});
  // The studio calls this right after you pick a new photo.
  window.storyshelfBackground = (url) => (url ? usePhoto(url) : ((scene.style.backgroundImage = ""), sky.classList.remove("has-photo"), (scene.innerHTML = meadow())));

  // ---- rising bubbles
  // On the public pages they float over everything (but never catch clicks);
  // in the book reader and the studio they stay behind the content.
  const overPage = document.body.classList.contains("site");
  const layer = overPage ? document.createElement("div") : sky;
  if (overPage) {
    layer.className = "bubble-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
  }
  const count = window.innerWidth < 600 ? 5 : 10;
  for (let i = 0; i < count; i++) {
    const b = document.createElement("span");
    b.className = "bubble";
    const d = 20 + Math.random() * 18;
    b.style.setProperty("--x", (Math.random() * 100).toFixed(1) + "vw");
    b.style.setProperty("--s", (14 + Math.random() * 34).toFixed(0) + "px");
    b.style.setProperty("--d", d.toFixed(1) + "s");
    b.style.setProperty("--delay", (-Math.random() * d).toFixed(1) + "s");
    layer.appendChild(b);
  }
})();

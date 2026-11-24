// Dreamy pastel sky: drifting glow orbs, paper grain and twinkling sparkles.
(function () {
  const sky = document.createElement("div");
  sky.className = "dreamy-sky";
  sky.setAttribute("aria-hidden", "true");
  sky.innerHTML = '<div class="orb"></div><div class="orb"></div><div class="orb"></div><div class="orb"></div><div class="grain"></div>';

  const star = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 0c.8 6.2 5.8 11.2 12 12-6.2.8-11.2 5.8-12 12-.8-6.2-5.8-11.2-12-12C6.2 11.2 11.2 6.2 12 0z"/></svg>';
  const count = Math.round(Math.min(34, (window.innerWidth * window.innerHeight) / 42000));
  for (let i = 0; i < count; i++) {
    const s = document.createElement("span");
    s.className = "sparkle";
    s.innerHTML = star;
    s.style.left = Math.random() * 100 + "%";
    s.style.top = Math.random() * 100 + "%";
    s.style.setProperty("--s", (6 + Math.random() * 12).toFixed(1) + "px");
    s.style.setProperty("--d", (3 + Math.random() * 4).toFixed(1) + "s");
    s.style.setProperty("--delay", (-Math.random() * 6).toFixed(1) + "s");
    sky.appendChild(s);
  }
  document.body.prepend(sky);
})();

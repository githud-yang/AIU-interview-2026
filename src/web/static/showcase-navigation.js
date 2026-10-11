/** Follow the continuous document without remounting or reloading any project. */
export function initializeShowcaseNavigation({ document: doc = globalThis.document, window: win = globalThis.window } = {}) {
  const sections = [...doc.querySelectorAll(".project-section")];
  const links = [...doc.querySelectorAll(".site-nav a")];
  const header = doc.querySelector(".site-header");
  const listeners = [];
  let frame = null;
  let destroyed = false;
  let initialAlignmentCancelled = false;

  function listen(target, name, handler, options) {
    target.addEventListener(name, handler, options);
    const remove = () => target.removeEventListener(name, handler, options);
    listeners.push(remove);
    return remove;
  }
  function hashTarget() {
    try { return doc.getElementById(decodeURIComponent(win.location.hash.slice(1))); }
    catch { return null; }
  }
  function projectFor(target) { return sections.find((section) => section === target || section.contains(target)); }
  function mark(section) {
    links.forEach((link) => {
      if (section && link.hash === `#${section.id}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }
  const pixels = (value) => Number.parseFloat(value) || 0;
  function anchorOffset(section) {
    return pixels(win.getComputedStyle(doc.documentElement).scrollPaddingTop)
      + pixels(win.getComputedStyle(section).scrollMarginTop);
  }
  function update() {
    frame = null;
    if (destroyed) return;
    const headerBottom = header?.getBoundingClientRect().bottom || 0;
    let active = sections[0];
    // IntersectionObserver entries contain only changed intersections. Read every
    // section so a departing long project cannot overwrite the actual current one.
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= Math.max(headerBottom, anchorOffset(section)) + 1) active = section;
    }
    const last = sections[sections.length - 1];
    if (last && win.scrollY > 0 && win.scrollY + win.innerHeight >= doc.documentElement.scrollHeight - 1
      && last.getBoundingClientRect().top < win.innerHeight) active = last;
    mark(active);
  }
  function scheduleUpdate() {
    if (frame === null && !destroyed) frame = win.requestAnimationFrame(update);
  }
  listen(win, "scroll", scheduleUpdate, { passive: true });
  listen(win, "resize", scheduleUpdate);
  listen(win, "pageshow", scheduleUpdate);
  listen(win, "hashchange", () => {
    initialAlignmentCancelled = true;
    const section = projectFor(hashTarget());
    if (section) mark(section);
    scheduleUpdate();
  });

  const initialHash = win.location.hash;
  const initialTarget = hashTarget();
  const initialProject = projectFor(initialTarget);
  mark(initialProject || sections[0]);
  if (initialProject) {
    const cancel = () => { initialAlignmentCancelled = true; };
    const removeInteractionListeners = ["wheel", "touchstart", "pointerdown", "keydown"].map((name) => listen(win, name, cancel, { passive: true }));
    const alignInitialTarget = () => {
      win.requestAnimationFrame(() => {
        removeInteractionListeners.forEach((remove) => remove());
        if (destroyed || initialAlignmentCancelled || win.location.hash !== initialHash) return;
        // Native fragment positioning can be superseded by browser restoration.
        // Correct once after the initial layout, only if it is still misplaced.
        const top = initialTarget.getBoundingClientRect().top + win.scrollY;
        const maximum = Math.max(0, doc.documentElement.scrollHeight - win.innerHeight);
        const expected = Math.max(0, Math.min(maximum, top - anchorOffset(initialTarget)));
        if (Math.abs(win.scrollY - expected) > 1) initialTarget.scrollIntoView({ behavior: "auto", block: "start" });
        update();
      });
    };
    if (doc.readyState === "complete") alignInitialTarget();
    else listen(win, "load", alignInitialTarget, { once: true });
  }
  scheduleUpdate();
  return { destroy() {
    destroyed = true;
    if (frame !== null) win.cancelAnimationFrame(frame);
    listeners.forEach((remove) => remove());
  } };
}

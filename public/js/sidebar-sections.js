/**
 * Collapsible sections for the Clean Sprite Sheet and Reframe sidebars.
 *
 * Both sidebars are a single tall column of `.cleaner-control-section` blocks.
 * Fully expanded they run well past the viewport, so the sticky column turns
 * into a scroll-within-a-scroll and the controls a user is not currently using
 * push the ones they are out of sight. Folding a section away is the cheapest
 * fix that keeps every control exactly where it was.
 *
 * The markup carries only the section title; the body wrapper is built here so
 * that adding a section to `index.html` needs no extra div. `app.js` has its own
 * copy of this idea (`.collapsible-section` / `.section-collapse-header`) wired
 * to hand-written markup and per-section ids; this is the same behaviour for
 * sidebars whose sections are uniform enough to do it in a loop.
 *
 * Dependency direction is one way: the tab modules import this; this imports
 * nothing.
 */

const slug = (text) => String(text || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

/**
 * @param {ParentNode|null} root sidebar element
 * @param {object} [options]
 * @param {string} [options.storagePrefix] namespace for the remembered state
 */
export function initCollapsibleSections(root, { storagePrefix = 'section' } = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') return;

  for (const section of root.querySelectorAll('.cleaner-control-section')) {
    const title = section.querySelector(':scope > .cleaner-section-title');
    // A section with no title has nothing to click on, so it stays open.
    if (!title || title.dataset.collapsible === 'ready') continue;

    const body = document.createElement('div');
    body.className = 'cleaner-section-body';
    while (title.nextSibling) body.appendChild(title.nextSibling);
    section.appendChild(body);

    const key = `${storagePrefix}.${section.dataset.sectionKey || slug(title.textContent)}`;
    let expanded = section.dataset.collapsed !== 'true';
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) expanded = stored === 'true';
    } catch (_) { /* private mode: fall back to the markup default */ }

    // An <i>, not a <span>: the title row styles a *second span* as the value
    // label on its right, and the chevron must not become that label.
    const chevron = document.createElement('i');
    chevron.className = 'cleaner-section-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    title.appendChild(chevron);

    title.dataset.collapsible = 'ready';
    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');

    const apply = (next, { persist = true } = {}) => {
      expanded = Boolean(next);
      section.classList.toggle('is-collapsed', !expanded);
      title.setAttribute('aria-expanded', String(expanded));
      if (!persist) return;
      try {
        localStorage.setItem(key, String(expanded));
      } catch (_) { /* nothing to remember with, still folds for this session */ }
    };

    title.addEventListener('click', (event) => {
      // The title row carries live values on its right-hand side in some
      // sections; a control that lands there must still be clickable.
      if (event.target.closest('button, input, select, a, label')) return;
      apply(!expanded);
    });
    title.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      apply(!expanded);
    });

    apply(expanded, { persist: false });
  }
}

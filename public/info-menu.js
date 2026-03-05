const infoMenus = Array.from(document.querySelectorAll('[data-info-menu]'));

if (infoMenus.length > 0) {
  const desktopHoverMedia = window.matchMedia('(hover: hover) and (pointer: fine)');

  function setExpanded(menu, expanded) {
    const trigger = menu.querySelector('[data-info-menu-trigger]');
    if (!trigger) return;
    trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function closeMenu(menu) {
    if (!menu) return;
    menu.classList.remove('is-open');
    setExpanded(menu, false);
  }

  function closeAllMenus(exceptMenu = null) {
    infoMenus.forEach((menu) => {
      if (menu === exceptMenu) return;
      closeMenu(menu);
    });
  }

  function openMenu(menu) {
    if (!menu) return;
    closeAllMenus(menu);
    menu.classList.add('is-open');
    setExpanded(menu, true);
  }

  infoMenus.forEach((menu) => {
    const trigger = menu.querySelector('[data-info-menu-trigger]');
    const panel = menu.querySelector('[data-info-menu-panel]');
    if (!trigger || !panel) return;

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      const isOpen = menu.classList.contains('is-open');
      if (isOpen) {
        closeMenu(menu);
        return;
      }
      openMenu(menu);
    });

    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenu(menu);
        trigger.focus();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (menu.classList.contains('is-open')) {
          closeMenu(menu);
        } else {
          openMenu(menu);
        }
      }
    });

    panel.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => closeMenu(menu));
    });

    menu.addEventListener('mouseenter', () => {
      if (!desktopHoverMedia.matches) return;
      openMenu(menu);
    });
    menu.addEventListener('mouseleave', () => {
      if (!desktopHoverMedia.matches) return;
      closeMenu(menu);
    });
  });

  document.addEventListener('click', (event) => {
    const insideMenu = infoMenus.some((menu) => menu.contains(event.target));
    if (!insideMenu) closeAllMenus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllMenus();
  });
}

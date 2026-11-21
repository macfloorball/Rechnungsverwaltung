// Keep every view mounted: navigation must never save, reload or reset forms.
export function initializeNavigation() {
  const navigation = document.querySelector('.app-navigation');
  const views = [...document.querySelectorAll('[data-view]')];
  const links = [...navigation.querySelectorAll('[data-view-link]')];
  try {
    const remembered = sessionStorage.getItem('ttc.activeView');
    const selected = views.find(view => view.dataset.view === remembered);
    if (selected) {
      for (const view of views) view.hidden = view !== selected;
      for (const link of links) {
        if (link.dataset.viewLink === remembered) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
    }
  } catch { /* calendar is the default view */ }
  navigation.addEventListener('click', (event) => {
    const link = event.target.closest('[data-view-link]');
    if (!link || !navigation.contains(link)) return;
    event.preventDefault();
    const view = views.find((item) => item.dataset.view === link.dataset.viewLink);
    if (!view || !view.hidden) return;
    try { sessionStorage.setItem("ttc.activeView", view.dataset.view); } catch { /* optional */ }
    for (const item of views) item.hidden = item !== view;
    for (const item of links) {
      if (item === link) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    view.querySelector('.view-title').focus();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}

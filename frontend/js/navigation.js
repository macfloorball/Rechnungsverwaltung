// Keep every view mounted: navigation must never save, reload or reset forms.
export function initializeNavigation() {
  const navigation = document.querySelector('.app-navigation');
  const views = [...document.querySelectorAll('[data-view]')];
  const links = [...navigation.querySelectorAll('[data-view-link]')];
  navigation.addEventListener('click', (event) => {
    const link = event.target.closest('[data-view-link]');
    if (!link || !navigation.contains(link)) return;
    event.preventDefault();
    const view = views.find((item) => item.dataset.view === link.dataset.viewLink);
    if (!view || !view.hidden) return;
    for (const item of views) item.hidden = item !== view;
    for (const item of links) {
      if (item === link) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    view.querySelector('.view-title').focus();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}

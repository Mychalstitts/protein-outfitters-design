// Shared admin nav — drop <div class="po-nav-links" data-admin-nav></div>
// (or any [data-admin-nav]) and include this script.
(function () {
  const LINKS = [
    { href: '/admin-overview', label: 'Overview', match: ['/admin', '/admin-overview'] },
    { href: '/admin-hotspots', label: 'Hotspots' },
    { href: '/admin-analytics', label: 'Analytics' },
    { href: '/admin-moderation', label: 'Listings' },
    { href: '/admin-health', label: 'Health' },
    { href: '/admin-email', label: 'Email' },
    { href: '/admin-ams-import', label: 'Import', match: ['/admin-ams-import', '/admin-fsis-import'] },
    { href: '/map', label: 'Map' },
  ];

  function path() {
    return (location.pathname || '').replace(/\.html$/, '') || '/';
  }

  function html() {
    const here = path();
    return LINKS.map((l) => {
      const aliases = l.match || [l.href];
      const on = aliases.includes(here);
      return `<a href="${l.href}"${on ? ' style="font-weight:800"' : ''}>${l.label}</a>`;
    }).join('');
  }

  function paint() {
    document.querySelectorAll('[data-admin-nav]').forEach((el) => { el.innerHTML = html(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();
})();

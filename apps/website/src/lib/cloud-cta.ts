export const CLOUD_HOST = 'cloud.rawdash.dev';
export const CLOUD_SIGNUP_URL = `https://${CLOUD_HOST}/signup`;

export const CLOUD_UTM_FORWARD_SCRIPT = `(function () {
  function forwardUtm() {
    var current = new URLSearchParams(window.location.search);
    var utm = [];
    current.forEach(function (value, key) {
      if (key.indexOf('utm_') === 0 && value) {
        utm.push([key, value]);
      }
    });
    if (utm.length === 0) {
      return;
    }
    var anchors = document.querySelectorAll('a[href*="${CLOUD_HOST}"]');
    anchors.forEach(function (anchor) {
      var url = new URL(anchor.href);
      if (url.hostname !== '${CLOUD_HOST}') {
        return;
      }
      utm.forEach(function (pair) {
        if (!url.searchParams.has(pair[0])) {
          url.searchParams.set(pair[0], pair[1]);
        }
      });
      anchor.href = url.toString();
    });
  }
  function run() {
    try {
      forwardUtm();
    } catch (err) {
      console.warn('Cloud UTM forwarding failed:', err);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();`;

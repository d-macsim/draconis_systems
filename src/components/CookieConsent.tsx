import { useEffect, useState } from "preact/hooks";

interface Props {
  domain: string;
}

const CONSENT_KEY = "draconis-analytics-consent";

function loadPlausible(domain: string): void {
  if (document.querySelector('script[data-draconis-analytics="true"]')) {
    return;
  }
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://plausible.io/js/script.js";
  script.dataset.domain = domain;
  script.dataset.draconisAnalytics = "true";
  document.head.appendChild(script);
}

export default function CookieConsent({ domain }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const existing = window.localStorage.getItem(CONSENT_KEY);
    if (existing === "accepted") {
      loadPlausible(domain);
      return;
    }
    if (existing === "declined") {
      return;
    }
    setVisible(true);
  }, [domain]);

  function accept(): void {
    window.localStorage.setItem(CONSENT_KEY, "accepted");
    loadPlausible(domain);
    setVisible(false);
  }

  function decline(): void {
    window.localStorage.setItem(CONSENT_KEY, "declined");
    setVisible(false);
  }

  if (!visible) {
    return null;
  }

  return (
    <aside
      className="surface"
      style={{
        position: "fixed",
        right: "1rem",
        bottom: "1rem",
        padding: "1rem",
        maxWidth: "360px",
        zIndex: 70
      }}
      aria-live="polite"
    >
      <strong>Analytics preference</strong>
      <p className="small" style={{ marginTop: "0.4rem" }}>
        We use privacy-friendly analytics to improve site performance and content quality.
      </p>
      <div className="row">
        <button type="button" className="button primary" onClick={accept}>
          Accept
        </button>
        <button type="button" className="button secondary" onClick={decline}>
          Decline
        </button>
      </div>
    </aside>
  );
}

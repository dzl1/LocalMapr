import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brandBlock}>
          <img
            className={styles.logo}
            src="/brand/logo_white.png"
            alt="LocalMapr"
          />
          <p>Create and share small map-based webapps for local stories.</p>
        </div>

        <div className={styles.partnerBlock}>
          <span>Built on</span>
          <a
            className={styles.partnerLink}
            href="https://www.pasifikanavigators.nz"
            target="_blank"
            rel="noreferrer"
            aria-label="Visit Pasifika Navigators"
          >
            <img
              className={styles.partnerLogo}
              src="/brand/pacifikalogo.png"
              alt="Pasifika Navigators"
            />
          </a>
        </div>

        <address className={styles.contact}>
          <span>Contact</span>
          <a href="mailto:contact@localmapr.com">contact@localmapr.com</a>
        </address>
      </div>
    </footer>
  );
}

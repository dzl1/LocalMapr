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

        <address className={styles.contact}>
          <span>Contact</span>
          <a href="mailto:contact@localmapr.com">contact@localmapr.com</a>
        </address>
      </div>
    </footer>
  );
}

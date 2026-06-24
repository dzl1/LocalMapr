import Image from "next/image";
import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brandBlock}>
          <Image
            className={styles.logo}
            src="/brand/logo_white.png"
            alt="LocalMapr"
            width={220}
            height={64}
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

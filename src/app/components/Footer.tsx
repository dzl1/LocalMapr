import { Link } from "react-router-dom";
import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brandBlock}>
          <Link className={styles.logoLink} to="/" aria-label="LocalMapr home">
            <img
              className={styles.logo}
              src="/brand/logo_white.png"
              alt="LocalMapr"
            />
          </Link>
          <p>Create and share small map-based webapps for local stories.</p>
        </div>

        <address className={styles.contact}>
          <span>Contact</span>
          <Link to="/contact">Contact us</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/help">Help</Link>
        </address>
      </div>
    </footer>
  );
}

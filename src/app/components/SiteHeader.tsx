import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { useAuth } from "@/lib/authContext";
import styles from "./SiteHeader.module.css";

type SiteHeaderProps = {
  accountHref?: string;
  className?: string;
  isAdmin?: boolean;
  onSignOut?: () => void | Promise<void>;
  showEmail?: boolean;
  user?: User | null;
};

const navItems = [
  { href: "/map-stories", label: "Map Stories" },
  { href: "/local-guides", label: "Local Guides" },
  { href: "/pricing", label: "Pricing" },
  { href: "/help", label: "Help" },
  { href: "/contact", label: "Contact" },
];

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader({
  accountHref,
  className,
  isAdmin = false,
  onSignOut,
  showEmail = true,
  user,
}: SiteHeaderProps) {
  const location = useLocation();
  const auth = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const resolvedUser = user === undefined ? auth.user : user;
  const resolvedAccountHref =
    accountHref ?? (resolvedUser ? "/dashboard" : `/login?next=${location.pathname}`);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  return (
    <header className={classNames(styles.siteHeader, className)}>
      <Link className={styles.brand} to="/" aria-label="LocalMapr home">
        <img className={styles.brandLogo} src="/brand/logo_dark.png" alt="LocalMapr" />
      </Link>

      <button
        type="button"
        className={styles.menuButton}
        aria-label={isMenuOpen ? "Close menu" : "Open menu"}
        aria-expanded={isMenuOpen}
        aria-controls="site-navigation-menu"
        onClick={() => setIsMenuOpen((current) => !current)}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>

      <div
        id="site-navigation-menu"
        className={classNames(styles.menuPanel, isMenuOpen && styles.menuPanelOpen)}
      >
        <nav className={styles.navLinks} aria-label="Primary navigation">
          {navItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              aria-current={isActivePath(location.pathname, item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.accountNav}>
          {showEmail && resolvedUser?.email ? (
            <span className={styles.accountEmail}>{resolvedUser.email}</span>
          ) : null}
          {isAdmin ? (
            <Link className={styles.adminLink} to="/admin">
              Admin
            </Link>
          ) : null}
          <Link className={styles.navCta} to={resolvedAccountHref}>
            {resolvedUser ? "Dashboard" : "Log in"}
          </Link>
          {onSignOut ? (
            <button className={styles.signOutButton} type="button" onClick={onSignOut}>
              Sign out
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

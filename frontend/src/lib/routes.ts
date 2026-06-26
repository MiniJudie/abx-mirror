/** Internal app routes — use `.html` paths for S3 static hosting compatibility. */
export const ROUTES = {
  home: "/",
  auction: "/auction.html",
  staking: "/staking.html",
  abxAbd: "/abx-abd.html",
} as const;

export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === ROUTES.home) {
    return pathname === "/" || pathname === "/index.html";
  }
  const withoutHtml = href.replace(/\.html$/, "");
  return (
    pathname === href ||
    pathname === withoutHtml ||
    pathname === `${withoutHtml}/` ||
    pathname === `${withoutHtml}/index.html`
  );
}

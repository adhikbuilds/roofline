export const NAV = [
  { href: '/homes', label: 'Homes' },
  { href: '/pgs', label: 'PGs' },
  { href: '/deals', label: 'Deals' },
  { href: '/compare', label: 'Compare' },
  { href: '/analytics', label: 'Analytics' },
] as const;

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

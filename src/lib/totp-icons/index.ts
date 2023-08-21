import catalog from './catalog.json';

export function findIcon(name: string) {
  const nameNorm = name.toLowerCase();
  const iconMeta = catalog.icons.find(p => p.issuer.some(i => i == nameNorm || nameNorm.includes(i)));
  return iconMeta?.filename;
}

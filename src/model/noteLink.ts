export type ExternalLink = Readonly<{
  href: string;
}>;

export const parseExternalLink = (text: string): ExternalLink | null => {
  const candidate = text.trim();
  if (candidate.length === 0 || /\s/.test(candidate)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  return {
    href: url.href,
  };
};

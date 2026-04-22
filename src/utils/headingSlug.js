export function makeHeadingSlug(text) {
  return 'toc-' + String(text)
    .replace(/\*\*/g, '')
    // eslint-disable-next-line no-irregular-whitespace
    .replace(/[^\w　-鿿]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '')
}

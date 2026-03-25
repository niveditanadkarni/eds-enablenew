/* global WebImporter */

/**
 * WKND uses lazy loading — images have data-src or data-cmp-src instead of src.
 * Copy those to src so the importer can see and download them.
 */
function fixLazyImages(main) {
  main.querySelectorAll('img').forEach((img) => {
    const lazySrc = img.getAttribute('data-src')
      || img.getAttribute('data-cmp-src')
      || img.getAttribute('data-lazy-src');
    if (lazySrc && !img.src) {
      img.src = lazySrc;
    }
  });
}

/**
 * Rewrites image srcs to go through the local proxy to avoid CORS issues.
 * e.g. https://wknd.site/path/img.jpg → http://localhost:3001/path/img.jpg?host=https://wknd.site
 */
function makeProxySrcs(main, host) {
  const origin = new URL(host).origin;
  main.querySelectorAll('img').forEach((img) => {
    // already going through the proxy — leave it alone
    if (!img.src || img.src.startsWith('http://localhost')) return;

    // make relative URLs absolute using the original host
    if (img.src.startsWith('/')) {
      img.src = `${origin}${img.src}`;
    }

    try {
      const {
        hostname, origin: imgOrigin, pathname, search,
      } = new URL(img.src);
      // only reroute external images (not already on localhost)
      if (hostname === 'localhost') return;
      const proxySearch = search ? `${search}&host=${imgOrigin}` : `?host=${imgOrigin}`;
      img.src = `http://localhost:3001${pathname}${proxySearch}`;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Unable to make proxy src for ${img.src}: ${error.message}`);
    }
  });
}

/**
 * Builds the Metadata block from <head> meta tags.
 */
function createMetadataBlock(main, document) {
  const meta = {};

  const title = document.querySelector('title');
  if (title) meta.Title = title.innerHTML.replace(/[\n\t]/gm, '');

  const desc = document.querySelector('[property="og:description"], [name="description"]');
  if (desc) meta.Description = desc.content;

  const ogImage = document.querySelector('[property="og:image"]');
  if (ogImage) {
    const el = document.createElement('img');
    el.src = ogImage.content;
    meta.Image = el;
  }

  const block = WebImporter.Blocks.getMetadataBlock(document, meta);
  main.append(block);
  return meta;
}

/**
 * Converts the WKND carousel (.cmp-carousel) into a Carousel block table.
 */
function transformCarousel(main, document) {
  const carousel = main.querySelector('.cmp-carousel');
  if (!carousel) return;

  const items = [...carousel.querySelectorAll('.cmp-carousel__item')];
  if (!items.length) {
    carousel.remove();
    return;
  }

  const rows = items.map((item) => {
    // background images are already converted to <img> by transformBackgroundImages
    const img = item.querySelector('img');
    const title = item.querySelector('.cmp-title__text, h1, h2, h3');
    const text = item.querySelector('.cmp-text p, p');
    const link = item.querySelector('.cmp-teaser__action-link, a');

    const cell = document.createElement('div');
    if (img) cell.appendChild(img.cloneNode(true));
    if (title) cell.appendChild(title.cloneNode(true));
    if (text) cell.appendChild(text.cloneNode(true));
    if (link) cell.appendChild(link.cloneNode(true));
    return [cell];
  });

  const block = WebImporter.DOMUtils.createTable([['Carousel'], ...rows], document);
  carousel.replaceWith(block);
}

/**
 * Converts groups of .cmp-teaser cards into a Cards block.
 * A container with 2+ teasers becomes Cards; a single teaser becomes a Columns block.
 */
function transformTeasers(main, document) {
  // Process containers that have multiple teasers → Cards block
  main.querySelectorAll('.responsivegrid, .aem-Grid, [class*="container"]').forEach((container) => {
    const teasers = [...container.querySelectorAll(':scope > .cmp-teaser, :scope > div > .cmp-teaser')];
    if (teasers.length < 2) return;

    const rows = teasers.map((teaser) => {
      const img = teaser.querySelector('img');
      const title = teaser.querySelector('.cmp-teaser__title-link, .cmp-title__text, h2, h3');
      const desc = teaser.querySelector('.cmp-teaser__description p, p');
      const link = teaser.querySelector('.cmp-teaser__action-link, a');

      const cell = document.createElement('div');
      if (img) cell.appendChild(img.cloneNode(true));
      if (title) cell.appendChild(title.cloneNode(true));
      if (desc) cell.appendChild(desc.cloneNode(true));
      if (link && link !== title) cell.appendChild(link.cloneNode(true));
      return [cell];
    });

    const block = WebImporter.DOMUtils.createTable([['Cards'], ...rows], document);
    // replace the first teaser's parent section, not just one teaser
    teasers[0].closest('.responsivegrid, .aem-Grid, [class*="container"]')?.replaceWith(block);
  });

  // Remaining single teasers → Columns block (image | text)
  main.querySelectorAll('.cmp-teaser').forEach((teaser) => {
    const img = teaser.querySelector('img');
    const title = teaser.querySelector('.cmp-teaser__title-link, .cmp-title__text, h2, h3');
    const desc = teaser.querySelector('.cmp-teaser__description p, p');
    const link = teaser.querySelector('.cmp-teaser__action-link, a');

    const imgCell = document.createElement('div');
    if (img) imgCell.appendChild(img.cloneNode(true));

    const textCell = document.createElement('div');
    if (title) textCell.appendChild(title.cloneNode(true));
    if (desc) textCell.appendChild(desc.cloneNode(true));
    if (link && link !== title) textCell.appendChild(link.cloneNode(true));

    const block = WebImporter.DOMUtils.createTable([['Columns'], [imgCell, textCell]], document);
    teaser.replaceWith(block);
  });
}

/**
 * Removes elements that must not appear in the imported document.
 */
function cleanup(main) {
  WebImporter.DOMUtils.remove(main, [
    'header',
    'footer',
    'nav',
    '.cmp-navigation',
    '.cmp-search',
    '.cmp-languagenavigation',
    '.cmp-breadcrumb',
    '.cmp-carousel__actions',
    '.cmp-carousel__indicators',
    'noscript',
    'script',
    'style',
    '[data-cmp-hook-search]',
  ]);
}

export default {
  /**
   * Main transformation — called once per imported page.
   * Returns the element to convert + the output path.
   */
  transformDOM: ({ document, url }) => {
    const main = document.querySelector('main') || document.body;

    // 1. Fix lazy-loaded images (WKND uses data-src / data-cmp-src instead of src)
    fixLazyImages(main);

    // 2. Convert CSS background-images to <img> elements (required for WKND hero/carousel)
    WebImporter.rules.transformBackgroundImages(main, document);

    // 3. Rewrite image URLs through the local proxy to avoid CORS issues
    makeProxySrcs(main, url);

    // 4. Remove chrome (nav, footer, etc.)
    cleanup(main);

    // 5. Convert WKND-specific components to EDS blocks
    transformCarousel(main, document);
    transformTeasers(main, document);

    // 6. Append metadata block
    createMetadataBlock(main, document);

    return main;
  },

  /**
   * Controls the output file path.
   * Strips .html suffix and trailing slashes; sanitizes the path.
   */
  generateDocumentPath: ({ url }) => WebImporter.FileUtils.sanitizePath(
    new URL(url).pathname
      .replace(/\.html$/, '')
      .replace(/\/$/, '')
    || '/index',
  ),
};

// extractor.js - Extração e Sanitização do DOM da página web

async function extractSanitizedPageContent() {
  const originalUrl = window.location.href;
  const pageLang = document.documentElement.lang || 'en';

  const h1 = document.querySelector('h1') || 
             document.querySelector('.ArticleHeader_article-title__futDC') || 
             document.querySelector('.entry-title');
  const mainTitle = h1 ? h1.innerText : document.title;

  const contentSelectors = [
    '.MainArticleContent_articleMainContentCss__b_1_R',
    'article',
    '.article-body',
    '.entry-content',
    '.text',
    'main'
  ];

  let mainContainer = null;
  for (const selector of contentSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      mainContainer = el;
      break;
    }
  }

  if (!mainContainer) mainContainer = document.body;
  const clone = mainContainer.cloneNode(true);

  // Tratamento de Shadow DOM em componentes de código (<gfg-tabs>)
  const originalGfgTabs = mainContainer.querySelectorAll('gfg-tabs, .code-container, .responsive-tabs');
  const clonedGfgTabs = clone.querySelectorAll('gfg-tabs, .code-container, .responsive-tabs');

  originalGfgTabs.forEach((origTabsContainer, index) => {
    const targetCloneContainer = clonedGfgTabs[index];
    if (!targetCloneContainer) return;

    let panels = Array.from(origTabsContainer.querySelectorAll('gfg-panel, [role="tabpanel"], .tab-panel'));
    let tabs = Array.from(origTabsContainer.querySelectorAll('gfg-tab, [role="tab"], .tab-link'));

    if (origTabsContainer.shadowRoot) {
      const shadowPanels = Array.from(origTabsContainer.shadowRoot.querySelectorAll('gfg-panel, [role="tabpanel"], .tab-panel'));
      const shadowTabs = Array.from(origTabsContainer.shadowRoot.querySelectorAll('gfg-tab, [role="tab"], .tab-link'));
      if (shadowPanels.length > 0) panels = shadowPanels;
      if (shadowTabs.length > 0) tabs = shadowTabs;
    }

    const wrapper = document.createElement('div');

    if (panels.length > 0) {
      panels.forEach((panel, idx) => {
        let lang = panel.getAttribute('data-code-lang') || '';
        let tabName = tabs[idx] ? tabs[idx].textContent.trim() : lang;

        if (!lang && tabName) {
          lang = tabName.toLowerCase()
            .replace('c++', 'cpp')
            .replace('c#', 'csharp')
            .replace('javascript', 'javascript');
        }

        const preTag = panel.querySelector('pre');
        const codeText = preTag ? preTag.textContent : panel.textContent;

        if (codeText && codeText.trim()) {
          const details = document.createElement('details');
          if (idx === 0) details.setAttribute('open', '');

          const summary = document.createElement('summary');
          summary.textContent = tabName || lang.toUpperCase() || 'CÓDIGO';

          const newPre = document.createElement('pre');
          newPre.setAttribute('data-lang', lang);

          const newCode = document.createElement('code');
          newCode.setAttribute('data-lang', lang);
          newCode.textContent = codeText.trim();

          newPre.appendChild(newCode);
          details.appendChild(summary);
          details.appendChild(newPre);
          wrapper.appendChild(details);
        }
      });

      if (targetCloneContainer.parentNode) {
        targetCloneContainer.parentNode.replaceChild(wrapper, targetCloneContainer);
      }
    }
  });

  // Remoção de elementos de interface e anúncios
  const junkSelectors = [
    'header', 'footer', 'nav', 'aside',
    '.gfg-header', '.navigation-bar', '.sidebar',
    '.author-details', '.author-info', '[class*="author"]',
    '.comments', '.related-posts', '.social-share',
    '.ad-unit', '.adsbygoogle', '[class*="ad-"]',
    'script', 'style', 'iframe', 'button', 'input', 'form', 'svg',
    '.CodeMirror', '.copy-code-button', '.editor-buttons',
    '.gfg-preview-carousel-toolbar', '.gfg-preview-carousel-index-count'
  ];

  junkSelectors.forEach(selector => {
    clone.querySelectorAll(selector).forEach(el => el.remove());
  });

  clone.querySelectorAll('img.bg, .gfg-preview-carousel-img.bg, img[class*="bg"]').forEach(el => el.remove());

  // Download e conversão de imagens em Base64
  const imgElements = Array.from(clone.querySelectorAll('img'));
  const images = [];
  const seenImageSrcs = new Set();

  for (let i = 0; i < imgElements.length; i++) {
    const img = imgElements[i];
    const src = img.src || img.getAttribute('data-src');

    if (!src || src.startsWith('data:') || seenImageSrcs.has(src)) {
      img.remove();
      continue;
    }

    const srcLower = src.toLowerCase();
    const isJunkImg = srcLower.includes('avatar') || 
                      srcLower.includes('logo') || 
                      srcLower.includes('icon') || 
                      srcLower.includes('profile');

    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;

    if (isJunkImg || (width > 0 && width < 60) || (height > 0 && height < 60)) {
      img.remove();
      continue;
    }

    seenImageSrcs.add(src);

    try {
      const response = await fetch(src);
      const blob = await response.blob();
      
      const mimeType = blob.type || 'image/png';
      let ext = mimeType.split('/')[1] || 'png';
      if (ext.includes('+')) ext = ext.split('+')[0];

      const filename = `image_${images.length + 1}.${ext}`;

      const base64Data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });

      images.push({
        originalSrc: src,
        filename: filename,
        data: base64Data
      });
      
      img.src = src;
    } catch (e) {
      console.warn('Erro ao baixar imagem:', src, e);
    }
  }

  const urlPaths = window.location.pathname.split('/').filter(Boolean);
  const slug = urlPaths[urlPaths.length - 1] || 'documentation';

  return {
    mainTitle: mainTitle,
    html: clone.innerHTML,
    images: images,
    slug: slug,
    originalUrl: originalUrl,
    pageLang: pageLang
  };
}
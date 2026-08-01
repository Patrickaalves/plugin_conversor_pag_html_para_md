document.getElementById('exportBtn').addEventListener('click', async () => {
  const status = document.getElementById('status');
  status.innerText = 'Extraindo e tratando conteúdo...';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    // Injeta a função de extração na página ativa
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractSanitizedPageContent
    });

    if (!result || !result.html.trim()) {
      status.innerText = 'Erro: Conteúdo principal não encontrado.';
      return;
    }

    status.innerText = 'Baixando imagens e convertendo para Markdown...';

    const zip = new JSZip();
    const imagesFolder = zip.folder("images");
    let htmlContent = result.html;

    // Redireciona os links das imagens para a pasta /images do ZIP
    for (const img of result.images) {
      imagesFolder.file(img.filename, img.data, { base64: true });
      const escapedUrl = escapeRegExp(img.originalSrc);
      const regex = new RegExp(escapedUrl, 'g');
      htmlContent = htmlContent.replace(regex, `images/${img.filename}`);
    }

    // Instancia o conversor HTML -> Markdown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    });

    // REGRA 1: Preserva e limpa as tags <details> e <summary> (Blocos expansíveis sem **)
    turndownService.addRule('detailsSummary', {
      filter: function (node) {
        return node.nodeName === 'DETAILS' || node.nodeName === 'SUMMARY';
      },
      replacement: function (content, node) {
        if (node.nodeName === 'DETAILS') {
          const isOpen = node.hasAttribute('open') ? ' open' : '';
          return `\n\n<details${isOpen}>\n${content.trim()}\n</details>\n\n`;
        }
        if (node.nodeName === 'SUMMARY') {
          const cleanText = content.replace(/\*/g, '').trim();
          return `<summary>${cleanText}</summary>\n\n`;
        }
        return content;
      }
    });

    // REGRA 2: Ajusta a largura máxima das imagens (400px)
    turndownService.addRule('compactImages', {
      filter: 'img',
      replacement: function (content, node) {
        const src = node.getAttribute('src');
        const alt = node.getAttribute('alt') || 'imagem';
        if (!src) return '';
        return `\n\n<img src="${src}" alt="${alt}" width="400" />\n\n`;
      }
    });

    // REGRA 3: Converte elementos <pre data-lang="..."> em blocos de código com sintaxe
    turndownService.addRule('fencedCodeBlocks', {
      filter: function (node) {
        return node.nodeName === 'PRE';
      },
      replacement: function (content, node) {
        const codeElement = node.querySelector('code') || node;
        const lang = node.getAttribute('data-lang') || codeElement.getAttribute('data-lang') || '';
        
        let text = codeElement.textContent || '';
        text = text.replace(/\u200B/g, '').trim();

        return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
      }
    });

    // Executa a conversão para Markdown
    let markdown = turndownService.turndown(htmlContent);

    // Garante que o Título H1 seja adicionado no topo do documento
    if (result.mainTitle) {
      const cleanTitle = result.mainTitle.replace(/[\n\r]+/g, ' ').trim();
      markdown = markdown.replace(new RegExp(`^#+\\s*${escapeRegExp(cleanTitle)}`, 'i'), '').trim();
      markdown = `# ${cleanTitle}\n\n` + markdown;
    }

    // Limpeza de linhas em branco consecutivas
    markdown = markdown
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // ADICIONA O LINK DA PÁGINA ORIGINAL NO FINAL DO ARQUIVO
    const pageUrl = result.originalUrl || tab.url;
    markdown += `\n\n---\n\n> **Fonte original:** [${pageUrl}](${pageUrl})\n`;

    zip.file("documentation.md", markdown);

    status.innerText = 'Gerando arquivo .ZIP...';

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const downloadUrl = URL.createObjectURL(zipBlob);

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${result.slug}.zip`;
    a.click();

    status.innerText = 'Download concluído com sucesso!';
  } catch (err) {
    console.error(err);
    status.innerText = 'Erro: ' + err.message;
  }
});

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ====================================================================
// FUNÇÃO INJETADA QUE RODA NA PÁGINA DENTRO DO CHROMIUM
// ====================================================================
async function extractSanitizedPageContent() {
  // Captura a URL original da aba
  const originalUrl = window.location.href;

  // 1. CAPTURA O TÍTULO PRINCIPAL
  const h1 = document.querySelector('h1') || 
             document.querySelector('.ArticleHeader_article-title__futDC') || 
             document.querySelector('.entry-title');
  const mainTitle = h1 ? h1.innerText : document.title;

  // 2. SELECIONA A ÁREA DE CONTEÚDO PRINCIPAL
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

  // 3. DESESTRUTURAÇÃO ESPECIAL DE ABAS DE CÓDIGO DO GFG (<gfg-tabs>)
  const gfgTabs = clone.querySelectorAll('gfg-tabs, .code-container, .responsive-tabs');
  
  gfgTabs.forEach(tabsContainer => {
    const wrapper = document.createElement('div');
    const panels = tabsContainer.querySelectorAll('gfg-panel, [role="tabpanel"], .tab-panel');
    const tabs = tabsContainer.querySelectorAll('gfg-tab, [role="tab"], .tab-link');

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
          
          if (idx === 0) {
            details.setAttribute('open', '');
          }

          const summary = document.createElement('summary');
          summary.textContent = tabName || lang.toUpperCase();

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

      if (tabsContainer.parentNode) {
        tabsContainer.parentNode.replaceChild(wrapper, tabsContainer);
      }
    }
  });

  // 4. LIMPEZA DE LIXO E ELEMENTOS DE INTERFACE
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

  // Remove imagens duplicadas de background do carrossel
  clone.querySelectorAll('img.bg, .gfg-preview-carousel-img.bg, img[class*="bg"]').forEach(el => el.remove());

  // 5. DEDUPLICAÇÃO E TRATAMENTO DE IMAGENS
  const imgElements = Array.from(clone.querySelectorAll('img'));
  const images = [];
  const seenImageSrcs = new Set();

  for (let i = 0; i < imgElements.length; i++) {
    const img = imgElements[i];
    const src = img.src || img.getAttribute('data-src');

    if (!src || src.startsWith('data:')) {
      img.remove();
      continue;
    }

    if (seenImageSrcs.has(src)) {
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
    originalUrl: originalUrl
  };
}
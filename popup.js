document.getElementById('exportBtn').addEventListener('click', async () => {
  const exportBtn = document.getElementById('exportBtn');
  const status = document.getElementById('status');
  
  // Reseta e exibe a barra de progresso
  exportBtn.disabled = true;
  updateProgress(5, 'Extraindo conteúdo...');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractSanitizedPageContent
    });

    if (!result || !result.html.trim()) {
      updateProgress(0, 'Erro: Conteúdo não encontrado.');
      exportBtn.disabled = false;
      return;
    }

    updateProgress(20, 'Tratando imagens...');

    const zip = new JSZip();
    const imagesFolder = zip.folder("images");
    let htmlContent = result.html;

    for (const img of result.images) {
      imagesFolder.file(img.filename, img.data, { base64: true });
      const escapedUrl = escapeRegExp(img.originalSrc);
      const regex = new RegExp(escapedUrl, 'g');
      htmlContent = htmlContent.replace(regex, `images/${img.filename}`);
    }

    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    });

    // REGRAS DO TURNDOWN
    turndownService.addRule('detailsSummary', {
      filter: (node) => node.nodeName === 'DETAILS' || node.nodeName === 'SUMMARY',
      replacement: (content, node) => {
        if (node.nodeName === 'DETAILS') {
          const isOpen = node.hasAttribute('open') ? ' open' : '';
          return `\n\n<details${isOpen}>\n${content.trim()}\n</details>\n\n`;
        }
        if (node.nodeName === 'SUMMARY') {
          return `<summary>${content.replace(/\*/g, '').trim()}</summary>\n\n`;
        }
        return content;
      }
    });

    turndownService.addRule('compactImages', {
      filter: 'img',
      replacement: (content, node) => {
        const src = node.getAttribute('src');
        const alt = node.getAttribute('alt') || 'imagem';
        return src ? `\n\n<img src="${src}" alt="${alt}" width="400" />\n\n` : '';
      }
    });

    turndownService.addRule('fencedCodeBlocks', {
      filter: 'pre',
      replacement: (content, node) => {
        const codeElement = node.querySelector('code') || node;
        const lang = node.getAttribute('data-lang') || codeElement.getAttribute('data-lang') || '';
        let text = (codeElement.textContent || '').replace(/\u200B/g, '').trim();
        return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
      }
    });

    turndownService.addRule('tables', {
      filter: 'table',
      replacement: (content, node) => {
        const rows = Array.from(node.querySelectorAll('tr'));
        if (rows.length === 0) return '';
        let markdownTable = '\n\n';
        rows.forEach((row, rowIndex) => {
          const cells = Array.from(row.querySelectorAll('th, td'));
          const cellTexts = cells.map(cell => cell.textContent.replace(/[\n\r]+/g, ' ').trim());
          markdownTable += '| ' + cellTexts.join(' | ') + ' |\n';
          if (rowIndex === 0) {
            markdownTable += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
          }
        });
        return markdownTable + '\n\n';
      }
    });

    updateProgress(35, 'Convertendo para Markdown...');
    let baseMarkdown = turndownService.turndown(htmlContent);

    if (result.mainTitle) {
      const cleanTitle = result.mainTitle.replace(/[\n\r]+/g, ' ').trim();
      baseMarkdown = baseMarkdown.replace(new RegExp(`^#+\\s*${escapeRegExp(cleanTitle)}`, 'i'), '').trim();
      baseMarkdown = `# ${cleanTitle}\n\n` + baseMarkdown;
    }

    baseMarkdown = baseMarkdown.replace(/\n{3,}/g, '\n\n').trim();
    const pageUrl = result.originalUrl || tab.url;
    baseMarkdown += `\n\n---\n\n> **Fonte original:** [${pageUrl}](${pageUrl})\n`;

    const pageLang = (result.pageLang || 'en').toLowerCase();
    const isPortuguese = pageLang.startsWith('pt');

    // Tradução com atualização de progresso dinâmico (35% -> 85%)
    if (isPortuguese) {
      zip.file("documentation-pt.md", baseMarkdown);
      const markdownEn = await translateMarkdownSafely(baseMarkdown, 'en', (p) => {
        const currentProgress = 35 + Math.round(p * 0.5);
        updateProgress(currentProgress, `Traduzindo (EN)... ${p}%`);
      });
      zip.file("documentation-en.md", markdownEn);
    } else {
      zip.file("documentation-en.md", baseMarkdown);
      const markdownPt = await translateMarkdownSafely(baseMarkdown, 'pt', (p) => {
        const currentProgress = 35 + Math.round(p * 0.5);
        updateProgress(currentProgress, `Traduzindo (PT-BR)... ${p}%`);
      });
      zip.file("documentation-pt.md", markdownPt);
    }

    updateProgress(90, 'Gerando arquivo .ZIP...');
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const downloadUrl = URL.createObjectURL(zipBlob);

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${result.slug}.zip`;
    a.click();

    updateProgress(100, 'Concluído com sucesso!');
  } catch (err) {
    console.error(err);
    status.innerText = 'Erro: ' + err.message;
  } finally {
    exportBtn.disabled = false;
  }
});

// Atualiza a Barra de Progresso no popup
function updateProgress(percent, statusMessage) {
  const container = document.getElementById('progressContainer');
  const bar = document.getElementById('progressBar');
  const text = document.getElementById('progressText');
  const status = document.getElementById('status');

  container.style.display = 'block';
  text.style.display = 'block';

  bar.style.width = `${percent}%`;
  text.innerText = `${percent}%`;
  status.innerText = statusMessage;
}

// TRADUÇÃO COM SUPORTE A PROGRESSO
async function translateMarkdownSafely(markdown, targetLang, onProgress) {
  const placeholders = [];
  const regexesToProtect = [
    /```[\s\S]*?```/g,
    /<img[^>]+>/g,
    /<details[^>]*>[\s\S]*?<\/details>/g,
    /!\[[^\]]*\]\([^)]+\)/g,
    /\|[^\n]+\|\n\|[\s:-|-]+\|\n(\|[^\n]+\|\n?)*/g
  ];

  let protectedMarkdown = markdown;
  regexesToProtect.forEach(regex => {
    protectedMarkdown = protectedMarkdown.replace(regex, (match) => {
      const placeholder = `[[[PROTECTED_BLOCK_${placeholders.length}]]]`;
      placeholders.push(match);
      return placeholder;
    });
  });

  const lines = protectedMarkdown.split('\n');
  const translatedLines = [];
  let textBatch = "";
  
  const totalLines = lines.length;

  for (let i = 0; i < totalLines; i++) {
    const line = lines[i];

    if (onProgress) {
      onProgress(Math.round(((i + 1) / totalLines) * 100));
    }

    if (!line.trim() || /^\[\[\[PROTECTED_BLOCK_\d+\]\]\]$/.test(line.trim())) {
      if (textBatch.trim()) {
        const translatedBatch = await callGoogleTranslateAPI(textBatch, targetLang);
        translatedLines.push(translatedBatch);
        textBatch = "";
      }
      translatedLines.push(line);
      continue;
    }

    if ((textBatch + "\n" + line).length > 1000) {
      const translatedBatch = await callGoogleTranslateAPI(textBatch, targetLang);
      translatedLines.push(translatedBatch);
      textBatch = line;
    } else {
      textBatch = textBatch ? textBatch + "\n" + line : line;
    }
  }

  if (textBatch.trim()) {
    const translatedBatch = await callGoogleTranslateAPI(textBatch, targetLang);
    translatedLines.push(translatedBatch);
  }

  let finalMarkdown = translatedLines.join('\n');

  placeholders.forEach((originalText, index) => {
    const placeholder = `[[[PROTECTED_BLOCK_${index}]]]`;
    finalMarkdown = finalMarkdown.replace(placeholder, originalText);
  });

  return finalMarkdown;
}

async function callGoogleTranslateAPI(text, targetLang) {
  if (!text || !text.trim()) return text;
  const encodedText = encodeURIComponent(text);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodedText}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) return text;
    const data = await response.json();
    if (data && data[0] && Array.isArray(data[0])) {
      return data[0].map(item => (item && item[0]) ? item[0] : '').join('');
    }
    return text;
  } catch (e) {
    return text;
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
          if (idx === 0) details.setAttribute('open', '');

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
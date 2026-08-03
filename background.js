importScripts('lib/jszip.min.js', 'translator.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startBackgroundExport') {
    processAndExportDocument(request.payload);
    sendResponse({ started: true });
  }
});

async function processAndExportDocument(payload) {
  const { baseMarkdown, images, slug, pageLang, translateEnabled, preferredService } = payload;
  const isPortuguese = (pageLang || 'en').toLowerCase().startsWith('pt');

  const zip = new JSZip();
  const imagesFolder = zip.folder("images");

  for (const img of images) {
    imagesFolder.file(img.filename, img.data, { base64: true });
  }

  if (translateEnabled) {
    if (isPortuguese) {
      zip.file("documentation-pt.md", baseMarkdown);
      
      const markdownEn = await translateMarkdownSafely(baseMarkdown, 'en', (percent) => {
        sendProgressUpdate(percent, `Traduzindo (EN)... ${percent}%`);
      }, preferredService);

      // Só adiciona a tradução ao ZIP se ela tiver sido concluída com sucesso (diferente de null)
      if (markdownEn) {
        zip.file("documentation-en.md", markdownEn);
      } else {
        console.warn("⚠️ Tradução para EN falhou em ambos os provedores. O arquivo documentation-en.md não foi gerado.");
        sendProgressUpdate(90, 'Provedores de tradução indisponíveis. Gerando ZIP apenas com o original...');
      }

    } else {
      zip.file("documentation-en.md", baseMarkdown);

      const markdownPt = await translateMarkdownSafely(baseMarkdown, 'pt', (percent) => {
        sendProgressUpdate(percent, `Traduzindo (PT-BR)... ${percent}%`);
      }, preferredService);

      // Só adiciona a tradução ao ZIP se ela tiver sido concluída com sucesso (diferente de null)
      if (markdownPt) {
        zip.file("documentation-pt.md", markdownPt);
      } else {
        console.warn("⚠️ Tradução para PT falhou em ambos os provedores. O arquivo documentation-pt.md não foi gerado.");
        sendProgressUpdate(90, 'Provedores de tradução indisponíveis. Gerando ZIP apenas com o original...');
      }
    }
  } else {
    const fileName = isPortuguese ? "documentation-pt.md" : "documentation-en.md";
    zip.file(fileName, baseMarkdown);
  }

  sendProgressUpdate(95, 'Gerando arquivo .ZIP...');

  const base64Zip = await zip.generateAsync({ type: "base64" });
  const dataUrl = `data:application/zip;base64,${base64Zip}`;

  chrome.downloads.download({
    url: dataUrl,
    filename: `${slug}.zip`,
    saveAs: false
  }, () => {
    sendProgressUpdate(100, 'Concluído com sucesso!');
  });
}

function sendProgressUpdate(percent, statusMessage) {
  chrome.runtime.sendMessage({
    action: 'updateProgressUI',
    percent: percent,
    statusMessage: statusMessage
  }).catch(() => {});
}
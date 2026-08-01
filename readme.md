# 🌐 Web Doc to Markdown Exporter

Uma extensão para navegadores baseados no **Chromium** (Google Chrome, Microsoft Edge, Brave, Opera, etc.) que converte artigos e documentações da web em arquivos **Markdown (`.md`)** prontos para uso offline no VS Code, Obsidian ou GitHub.

A extensão baixa automaticamente todas as imagens da página para uma pasta local, limpa anúncios e menus desnecessários, e entrega tudo compactado em um único arquivo `.zip`.

---

## ✨ Funcionalidades

* 📑 **Extração Inteligente de Conteúdo:** Captura o título e o corpo do artigo principal, removendo headers, footers, barras laterais, anúncios e comentários.
* 🖼️ **Download e Deduplicação de Imagens:** Baixa apenas as imagens relevantes da página (desprezando ícones e avatares), remove duplicatas e salva em uma pasta `images/` dentro do arquivo `.zip`.
* 📐 **Redimensionamento Automático de Imagens:** Define largura adequada para que o preview no VS Code ou Obsidian fique limpo e sem estouro de layout.
* 💻 **Suporte a Abas de Código (Multi-Linguagem):** Transforma abas de código (como as do GeeksforGeeks) em blocos retráteis HTML (`<details><summary>`), mantendo a formatação e destaque de sintaxe (` ```cpp `, ` ```java `, ` ```python `, etc.).
* 🔗 **Atribuição de Fonte:** Adiciona automaticamente um divisor e o link original da página no final do documento Markdown.

---

## 📁 Estrutura do Arquivo `.ZIP` Gerado

Após clicar para exportar, a extensão gera um arquivo com a seguinte estrutura:

```text
nome-do-artigo.zip
 ├── images/
 │    ├── image_1.png
 │    └── image_2.webp
 └── documentation.md

 ```
## 🚀 Como Instalar a Extensão no Navegador

### 1. Pré-requisitos
Garanta que as bibliotecas de terceiros estejam salvas dentro da pasta `lib/` da extensão:
* **Turndown JS** (Salvo como `lib/turndown.js`)
* **JSZip** (Salvo como `lib/jszip.min.js`)

### 2. Passo a Passo de Instalação
1. Abra o seu navegador (Chrome, Edge, Brave, etc.).
2. Digite na barra de endereço: `chrome://extensions/`
3. No canto superior direito, ative a opção **Modo do desenvolvedor** (*Developer Mode*).
4. Clique no botão **Carregar sem compactação** (*Load unpacked*).
5. Selecione a pasta do projeto da extensão (`web-to-markdown-extension`).

---

## 📥 Como Exportar e Usar a Documentação

### Passo 1: Exportar da Web
1. Acesse qualquer página de documentação ou artigo técnico (exemplo: GeeksforGeeks).
2. Clique no ícone da extensão no menu do navegador.
3. Clique no botão **Exportar para .ZIP**.
4. O navegador baixará um arquivo `.zip` com o nome da página (ex: `introduction-to-arrays.zip`).

---

## 💻 Como Importar no VS Code

1. Descompacte o arquivo `.zip` dentro da pasta do seu projeto ou repositório de estudos (ex: `/meu-projeto/arrays/`).
2. Abra o **VS Code**.
3. Abra a pasta onde você descompactou os arquivos (**File > Open Folder...**).
4. Abra o arquivo `documentation.md`.
5. Para visualizar a documentação formatada com as imagens locais e blocos retráteis:
   * Clique no ícone de **Visualização Lado a Lado** (*Open Preview to the Side*) no canto superior direito do editor.
   * Ou use o atalho: `Ctrl + K` e depois `V` (Windows/Linux) ou `Cmd + K` e depois `V` (Mac).

---

## 💎 Como Importar no Obsidian

1. Extraia o conteúdo do arquivo `.zip` baixado para dentro do seu **Cofre (Vault)** do Obsidian.
2. Certifique-se de manter o arquivo `documentation.md` e a pasta `images/` no mesmo nível do diretório.
3. Abra o **Obsidian**.
4. O arquivo `documentation.md` aparecerá automaticamente no seu painel lateral.
5. Ao abrir o arquivo, as imagens e os blocos expansíveis de código funcionarão nativamente!

---

## 🧰 Tecnologias Utilizadas

* **JavaScript (ES6+)**
* **Chrome Extension Manifest V3**
* **Turndown** — Conversor de HTML para Markdown.
* **JSZip** — Biblioteca de criação de arquivos `.zip` em JavaScript.

---

## 📝 Licença

Este projeto é de código aberto e destinado a fins educacionais e de automação pessoal de documentações.
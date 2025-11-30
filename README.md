# LinkLoom - Smart Bookmark Organizer

LinkLoom is a Chrome extension that helps you organize your bookmarks into smart, semantically relevant categories using AI.

### ✨ Features
- **Smart Categorization**: Uses AI to understand the content of your bookmarks, not just the URL.
- **Deep Scraping (Hybrid Mode)**: Actually visits the webpage to understand its context (requires Firecrawl API).
- **Metadata Mode**: Fast analysis using only URL and domain info (saves API credits).
- **Interactive Preview**: See the proposed structure, edit titles, and move items before applying changes.
- **Smart Rename**: AI suggests better, more descriptive titles for your bookmarks.
- **Dead Link Detection**: Identifies and groups broken links (404s, DNS errors) for easy cleanup.
- **Privacy Focused**: Your bookmarks are processed securely. API keys are stored locally.
- **🎛️ Adjustable Granularity**: Control how specific you want your folder structure to be (Low, Medium, High).

## How it Works

LinkLoom uses a sophisticated 3-pass algorithm to ensure high-quality organization:

1.  **Content Extraction (Firecrawl)**:
    - We use [Firecrawl](https://firecrawl.dev) to deep-scrape the content of your bookmarked pages, converting them into clean Markdown.
    - This allows the AI to understand the *full context* of the page, rather than guessing from the title.

2.  **Dynamic Structure Generation**:
    - An LLM (Large Language Model) analyzes the summaries of your bookmarks to design a custom folder structure.
    - It creates semantically relevant categories tailored specifically to your collection.

3.  **Smart Assignment & Enrichment**:
    - The AI assigns each bookmark to the most appropriate folder.
    - It simultaneously generates a better title and extracts keywords/tags for easier searching.

## Installation

1.  Clone this repository:
    ```bash
    git clone https://github.com/Erics1337/LinkLoom.git
    ```
2.  Open Google Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** in the top right corner.
4.  Click **Load unpacked** and select the directory where you cloned the repository.

## Usage

1.  Click the LinkLoom icon in your Chrome toolbar.
2.  Follow the on-screen instructions to organize your bookmarks.

## Development

This project is built with:
- JavaScript (ES6+)
- Chrome Extensions Manifest V3

## License

[MIT](LICENSE)

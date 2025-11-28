document.addEventListener('DOMContentLoaded', () => {
    const scanBtn = document.getElementById('scan-btn');
    const granularitySelect = document.getElementById('granularity-select');
    const dashboardView = document.getElementById('dashboard-view');
    const previewView = document.getElementById('preview-view');
    const settingsView = document.getElementById('settings-view');
    const treePreview = document.getElementById('tree-preview');
    const backBtn = document.getElementById('back-btn');
    const applyBtn = document.getElementById('apply-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const saveKeysBtn = document.getElementById('save-keys-btn');
    const firecrawlInput = document.getElementById('firecrawl-key');
    const llmInput = document.getElementById('llm-key');
    const premiumModal = document.getElementById('premium-modal');
    const closeModal = document.querySelector('.close-modal');
    const upgradeBtn = document.getElementById('upgrade-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const progressDetail = document.getElementById('progress-detail');

    let currentProposedStructure = null;

    // Load saved keys
    chrome.storage.local.get(['firecrawlKey', 'llmKey'], (result) => {
        if (result.firecrawlKey) firecrawlInput.value = result.firecrawlKey;
        if (result.llmKey) llmInput.value = result.llmKey;
    });

    // Settings Navigation
    settingsBtn.addEventListener('click', () => {
        switchView('settings');
    });

    closeSettingsBtn.addEventListener('click', () => {
        switchView('dashboard');
    });

    saveKeysBtn.addEventListener('click', () => {
        const firecrawlKey = firecrawlInput.value.trim();
        const llmKey = llmInput.value.trim();

        chrome.storage.local.set({ firecrawlKey, llmKey }, () => {
            alert('API Keys saved!');
            switchView('dashboard');
        });
    });

    // Handle Granularity Selection (Upsell)
    granularitySelect.addEventListener('change', (e) => {
        if (e.target.value === 'high') {
            premiumModal.classList.remove('hidden');
            // Reset to medium if they don't upgrade (simulated)
            e.target.value = 'medium';
        }
    });

    closeModal.addEventListener('click', () => {
        premiumModal.classList.add('hidden');
    });

    upgradeBtn.addEventListener('click', () => {
        // Simulate upgrade
        alert('Upgrade simulation: You are now Premium!');
        premiumModal.classList.add('hidden');
        granularitySelect.value = 'high';
        document.getElementById('status-badge').textContent = 'Premium';
        document.getElementById('status-badge').style.background = '#e9d5ff';
        document.getElementById('status-badge').style.color = '#7e22ce';
    });

    // Scan Bookmarks
    scanBtn.addEventListener('click', async () => {
        setLoading(true);

        try {
            // Send message to background script
            const response = await chrome.runtime.sendMessage({
                action: 'analyze_bookmarks',
                settings: {
                    granularity: granularitySelect.value
                }
            });

            if (response.status === 'success') {
                currentProposedStructure = response.structure;
                renderTree(currentProposedStructure, treePreview);
                switchView('preview');
            } else {
                alert('Error analyzing bookmarks: ' + response.message);
            }
        } catch (error) {
            console.error(error);
            // Fallback for testing without extension context
            console.log('Extension context not found, using mock data');
            const mockData = getMockData();
            renderTree(mockData, treePreview);
            switchView('preview');
        } finally {
            setLoading(false);
        }
    });

    backBtn.addEventListener('click', () => {
        switchView('dashboard');
    });

    applyBtn.addEventListener('click', async () => {
        if (!currentProposedStructure) return;

        applyBtn.textContent = 'Applying...';
        applyBtn.disabled = true;

        try {
            await chrome.runtime.sendMessage({
                action: 'apply_structure',
                structure: currentProposedStructure
            });
            alert('Bookmarks organized successfully!');
            switchView('dashboard');
        } catch (error) {
            console.error(error);
            alert('Simulated Apply: Success!');
            switchView('dashboard');
        } finally {
            applyBtn.textContent = 'Apply Changes';
            applyBtn.disabled = false;
        }
    });

    function switchView(viewName) {
        dashboardView.classList.add('hidden');
        previewView.classList.add('hidden');
        settingsView.classList.add('hidden');

        if (viewName === 'preview') {
            previewView.classList.remove('hidden');
        } else if (viewName === 'settings') {
            settingsView.classList.remove('hidden');
        } else {
            dashboardView.classList.remove('hidden');
        }

        // Save state
        chrome.storage.local.set({ currentView: viewName });
    }

    // Check for existing process or saved state on load
    chrome.storage.local.get(['processingState', 'currentView', 'analysisResult'], (result) => {
        // 1. If processing, show progress (highest priority)
        if (result.processingState && result.processingState.status === 'processing') {
            updateProgressUI(result.processingState);
            return;
        }

        // 2. If we were in preview mode and have data, restore it
        if (result.currentView === 'preview' && result.analysisResult) {
            currentProposedStructure = result.analysisResult;
            renderTree(currentProposedStructure, treePreview);
            switchView('preview');
        } else if (result.currentView === 'settings') {
            switchView('settings');
        }
    });

    // Listen for live updates
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'status_update') {
            updateProgressUI(request.state);
        }
    });

    function updateProgressUI(state) {
        if (state.status === 'processing') {
            setLoading(true);
            progressText.textContent = state.message || 'Processing...';

            // Update Progress Bar
            if (state.progress && state.progress.total > 0) {
                const percent = Math.round((state.progress.current / state.progress.total) * 100);
                progressFill.style.width = `${percent}%`;
                progressDetail.textContent = `${state.progress.current} / ${state.progress.total}`;

                // If 100% but still processing (e.g. LLM step), show indeterminate animation
                if (percent >= 100 && state.status === 'processing') {
                    progressFill.classList.add('indeterminate');
                } else {
                    progressFill.classList.remove('indeterminate');
                }
            } else {
                progressFill.style.width = '0%'; // Or 100% for indeterminate if no total
                progressFill.classList.add('indeterminate'); // Indeterminate if no progress info
                progressDetail.textContent = '';
            }
        } else if (state.status === 'complete') {
            setLoading(false);
            progressFill.classList.remove('indeterminate');

            // Retrieve result from storage
            chrome.storage.local.get(['analysisResult'], (result) => {
                if (result.analysisResult) {
                    currentProposedStructure = result.analysisResult;
                    renderTree(currentProposedStructure, treePreview);
                    switchView('preview');
                }
            });
        } else if (state.status === 'error') {
            setLoading(false);
            alert('Error: ' + state.message);
        }
    }

    function setLoading(isLoading) {
        const btnText = scanBtn.querySelector('.btn-text');

        if (isLoading) {
            scanBtn.classList.add('hidden');
            progressContainer.classList.remove('hidden');
        } else {
            scanBtn.classList.remove('hidden');
            progressContainer.classList.add('hidden');
        }
    }

    function renderTree(treeData, container) {
        container.innerHTML = '';

        // Helper to create folder node
        const createFolderNode = (node) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'tree-node';

            const header = document.createElement('div');
            header.className = 'tree-folder-header';

            const toggle = document.createElement('span');
            toggle.className = 'tree-toggle';
            toggle.innerHTML = '▼'; // Down arrow

            const icon = document.createElement('span');
            icon.textContent = '📁 ';

            const title = document.createElement('span');
            title.className = 'tree-item-title';
            title.textContent = node.title;
            title.contentEditable = true;
            title.onblur = () => { node.title = title.textContent; }; // Save on blur

            header.appendChild(toggle);
            header.appendChild(icon);
            header.appendChild(title);

            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'tree-children';

            // Toggle Logic
            header.onclick = (e) => {
                if (e.target === title) return; // Don't toggle if editing title
                toggle.classList.toggle('collapsed');
                childrenContainer.classList.toggle('hidden');
                toggle.innerHTML = childrenContainer.classList.contains('hidden') ? '▶' : '▼';
            };

            wrapper.appendChild(header);
            wrapper.appendChild(childrenContainer);

            // Render children
            if (node.children) {
                node.children.forEach(child => {
                    if (child.children) {
                        childrenContainer.appendChild(createFolderNode(child));
                    } else {
                        childrenContainer.appendChild(createItemNode(child));
                    }
                });
            }

            return wrapper;
        };

        // Helper to create item (bookmark) node
        const createItemNode = (node) => {
            const item = document.createElement('div');
            item.className = 'tree-item';

            // Build Tooltip Content
            let tooltip = `URL: ${node.url}`;
            if (node.tags && node.tags.length > 0) {
                tooltip += `\nTags: ${node.tags.join(', ')}`;
            }
            item.setAttribute('data-tooltip', tooltip);

            // Dead Link Check
            if (node.scrapeStatus === 'dead') {
                item.classList.add('dead-link');
            }

            const content = document.createElement('div');
            content.className = 'tree-item-content';

            // Smart Rename Button (Left of Icon)
            if (node.suggestedTitle && node.suggestedTitle !== node.title) {
                const autoBtn = document.createElement('button');
                autoBtn.className = 'smart-rename-btn';
                autoBtn.innerHTML = '✨'; // Just icon to save space
                autoBtn.title = `Rename to: ${node.suggestedTitle}`;
                autoBtn.onclick = (e) => {
                    e.stopPropagation();
                    node.title = node.suggestedTitle;
                    title.textContent = node.suggestedTitle;
                    autoBtn.remove();
                };
                content.appendChild(autoBtn);
            }

            // Icon
            const icon = document.createElement('span');
            if (node.scrapeStatus === 'dead') {
                icon.textContent = '� ';
                icon.title = "Broken Link";
                icon.className = 'dead-link-indicator';
            } else {
                icon.textContent = '�🔗 ';
            }
            content.appendChild(icon);

            // Title
            const title = document.createElement('span');
            title.className = 'tree-item-title';
            title.textContent = node.title;
            title.contentEditable = true;
            title.onblur = () => { node.title = title.textContent; };

            content.appendChild(title);
            item.appendChild(content);
            return item;
        };

        // Root level rendering
        treeData.forEach(node => {
            if (node.children) {
                container.appendChild(createFolderNode(node));
            } else {
                container.appendChild(createItemNode(node));
            }
        });
    }

    // --- New Event Listeners for Preview Actions ---

    const applyAllBtn = document.getElementById('apply-all-titles-btn');
    if (applyAllBtn) {
        applyAllBtn.addEventListener('click', () => {
            if (!currentProposedStructure) return;

            let count = 0;
            const applyRecursive = (nodes) => {
                nodes.forEach(node => {
                    if (node.suggestedTitle && node.suggestedTitle !== node.title) {
                        node.title = node.suggestedTitle;
                        count++;
                    }
                    if (node.children) applyRecursive(node.children);
                });
            };

            applyRecursive(currentProposedStructure);
            renderTree(currentProposedStructure, treePreview);
            alert(`Applied ${count} smart titles!`);
        });
    }

    // Regenerate Controls (Simple granular adjustment for now)
    const moreCatsBtn = document.getElementById('more-cats-btn');
    const lessCatsBtn = document.getElementById('less-cats-btn');

    if (moreCatsBtn) {
        moreCatsBtn.addEventListener('click', () => {
            // Logic to increase granularity and re-scan
            // For now, we'll just alert as re-scanning is a heavy op
            if (confirm("This will re-scan your bookmarks with higher granularity. Continue?")) {
                granularitySelect.value = 'high';
                scanBtn.click();
            }
        });
    }

    if (lessCatsBtn) {
        lessCatsBtn.addEventListener('click', () => {
            if (confirm("This will re-scan your bookmarks with lower granularity. Continue?")) {
                granularitySelect.value = 'low';
                scanBtn.click();
            }
        });
    }

    // Broken Link Controls
    const brokenControls = document.getElementById('broken-link-controls');
    const brokenCountEl = document.getElementById('broken-count');
    const removeBrokenBtn = document.getElementById('remove-broken-btn');

    function updateBrokenStats(treeData) {
        let count = 0;
        const countRecursive = (nodes) => {
            nodes.forEach(node => {
                if (node.scrapeStatus === 'dead') count++;
                if (node.children) countRecursive(node.children);
            });
        };
        countRecursive(treeData);

        if (count > 0) {
            brokenControls.classList.remove('hidden');
            brokenCountEl.textContent = `💀 ${count}`;
        } else {
            brokenControls.classList.add('hidden');
        }
    }

    if (removeBrokenBtn) {
        removeBrokenBtn.addEventListener('click', () => {
            if (!currentProposedStructure) return;

            if (confirm("Remove all broken links from the proposed structure?")) {
                const filterRecursive = (nodes) => {
                    return nodes.filter(node => {
                        if (node.scrapeStatus === 'dead') return false;
                        if (node.children) {
                            node.children = filterRecursive(node.children);
                            // Remove empty folders if they became empty
                            if (node.children.length === 0 && node.title !== "LinkLoom Organized") {
                                return false;
                            }
                        }
                        return true;
                    });
                };

                currentProposedStructure = filterRecursive(currentProposedStructure);
                renderTree(currentProposedStructure, treePreview);
            }
        });
    }

    // Hook into renderTree to update stats
    const originalRenderTree = renderTree;
    renderTree = function (treeData, container) {
        originalRenderTree(treeData, container);
        updateBrokenStats(treeData);
    };

    function getMockData() {
        return [
            {
                title: "Development",
                children: [
                    { title: "GitHub - LinkLoom", url: "https://github.com/..." },
                    { title: "Stack Overflow", url: "https://stackoverflow.com" }
                ]
            },
            {
                title: "News",
                children: [
                    { title: "Hacker News", url: "https://news.ycombinator.com" },
                    { title: "TechCrunch", url: "https://techcrunch.com" }
                ]
            },
            {
                title: "Uncategorized",
                children: [
                    { title: "Random Recipe", url: "https://allrecipes.com" }
                ]
            }
        ];
    }
});
